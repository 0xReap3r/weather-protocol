-- Stormline Phase 9: accept neighbor reports from anywhere in Texas (was the DFW region only).
-- Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run more than once.
alter table public.reports drop constraint if exists reports_cell_lat_check;
alter table public.reports drop constraint if exists reports_cell_lng_check;
alter table public.reports add constraint reports_cell_lat_check check (cell_lat between 25.5 and 36.8);
alter table public.reports add constraint reports_cell_lng_check check (cell_lng between -107.0 and -93.3);
