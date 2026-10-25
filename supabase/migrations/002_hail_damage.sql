-- Stormline: add hail and storm-damage reports. Run once in Supabase:
-- SQL Editor → New query → paste → Run. Safe to run more than once.
--
-- The existing `depth` column carries a 1–5 detail for these kinds too:
--   flood  → water depth (1 ankle … 5 over a car)
--   hail   → hail size (1 pea, 2 quarter, 3 golf ball, 4 tennis ball, 5 softball)
--   damage → what's damaged (1 trees/limbs down, 2 roof/building damage, 3 power lines down)

alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports add constraint reports_kind_check
  check (kind in ('flood', 'ice', 'power_out', 'power_back', 'hail', 'damage'));

-- Expiry set by the server: floods 6 h, ice 12 h, power 6 h, hail 3 h, damage 24 h.
create or replace function public.reports_set_expiry() returns trigger
language plpgsql as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  new.expires_at := now() + case new.kind
    when 'flood' then interval '6 hours'
    when 'ice' then interval '12 hours'
    when 'hail' then interval '3 hours'
    when 'damage' then interval '24 hours'
    else interval '6 hours' end;
  if new.kind not in ('flood', 'hail', 'damage') then new.depth := null; end if;
  if new.kind in ('flood', 'hail', 'damage') and new.depth is null then
    raise exception 'This report needs a detail (depth, hail size or damage type)';
  end if;
  if new.kind = 'damage' and new.depth > 3 then
    raise exception 'Unknown damage type';
  end if;
  return new;
end $$;
