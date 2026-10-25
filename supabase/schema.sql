-- Stormline neighbor reports — run once in Supabase: SQL Editor → New query → paste → Run.
--
-- Privacy by design: a report stores only an H3 hexagon id and its center, never the exact
-- spot someone tapped. Road reports use resolution 10 (~66 m hexes); power reports use
-- resolution 8 (~460 m hexes) so no single home can be picked out.
-- People report as anonymous Supabase users: no email or name, but each device gets a
-- stable id we can rate-limit and use to count independent neighbors.

create extension if not exists pgcrypto;

-- ---------- Reports ----------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  kind        text not null check (kind in ('flood', 'ice', 'power_out', 'power_back')),
  depth       smallint check (depth between 1 and 5),   -- flood only: 1 ankle … 5 over car
  cell        text not null check (cell ~ '^[0-9a-f]{15}$'),
  cell_lat    double precision not null check (cell_lat between 31.0 and 35.0),   -- DFW region
  cell_lng    double precision not null check (cell_lng between -99.5 and -94.5),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  -- One active report per person, per kind, per hexagon. Re-reporting refreshes it.
  unique (user_id, kind, cell)
);
create index if not exists reports_active_idx on public.reports (expires_at, cell_lat, cell_lng);

-- Expiry is set by the server, not the client: floods 6 h, ice 12 h, power 6 h.
create or replace function public.reports_set_expiry() returns trigger
language plpgsql as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  new.expires_at := now() + case new.kind
    when 'flood' then interval '6 hours'
    when 'ice' then interval '12 hours'
    else interval '6 hours' end;
  if new.kind <> 'flood' then new.depth := null; end if;
  if new.kind = 'flood' and new.depth is null then
    raise exception 'Flood reports need a depth';
  end if;
  return new;
end $$;

-- Rate limit: at most 12 reports per person per hour.
create or replace function public.reports_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.reports
        where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 12 then
    raise exception 'Too many reports. Please wait a bit and try again.';
  end if;
  return new;
end $$;

drop trigger if exists reports_expiry on public.reports;
create trigger reports_expiry before insert or update on public.reports
  for each row execute function public.reports_set_expiry();
drop trigger if exists reports_limit on public.reports;
create trigger reports_limit before insert on public.reports
  for each row execute function public.reports_rate_limit();

alter table public.reports enable row level security;

-- People can add, refresh and remove only their own reports. Nobody can read raw rows
-- (that would expose who reported what); everyone reads the summary view below.
drop policy if exists "insert own" on public.reports;
create policy "insert own" on public.reports for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update own" on public.reports;
create policy "update own" on public.reports for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own" on public.reports;
create policy "delete own" on public.reports for delete to authenticated using (user_id = auth.uid());
drop policy if exists "read own" on public.reports;
create policy "read own" on public.reports for select to authenticated using (user_id = auth.uid());

-- ---------- Flags ("this report is wrong") ----------
create table if not exists public.report_flags (
  kind       text not null,
  cell       text not null,
  user_id    uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (kind, cell, user_id)
);
alter table public.report_flags enable row level security;
drop policy if exists "flag own" on public.report_flags;
create policy "flag own" on public.report_flags for insert to authenticated with check (user_id = auth.uid());

-- ---------- Public summary ----------
-- One row per hexagon and kind: how many different people reported it, the deepest water
-- reported, and when. Cells flagged by at least 3 people and by as many people as reported
-- them are hidden. No user ids leave the database.
create or replace view public.report_cells as
select
  r.kind, r.cell, r.cell_lat, r.cell_lng,
  count(distinct r.user_id)::int as reporters,
  max(r.depth)::int as depth,
  min(r.created_at) as first_at,
  max(r.created_at) as last_at
from public.reports r
where r.expires_at > now()
group by r.kind, r.cell, r.cell_lat, r.cell_lng
having coalesce((select count(*) from public.report_flags f
                 where f.kind = r.kind and f.cell = r.cell and f.created_at > min(r.created_at)), 0)
       < greatest(3, count(distinct r.user_id));

grant select on public.report_cells to anon, authenticated;
grant select, insert, update, delete on public.reports to authenticated;
grant insert on public.report_flags to authenticated;

-- Housekeeping: delete reports a day after they expire (run by Supabase cron if enabled, or by hand).
create or replace function public.reports_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from public.reports where expires_at < now() - interval '1 day';
  delete from public.report_flags where created_at < now() - interval '2 days';
$$;
