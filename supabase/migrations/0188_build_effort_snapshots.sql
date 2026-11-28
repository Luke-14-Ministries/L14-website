-- 0188_build_effort_snapshots.sql
--
-- 28 Nov 2026 (Lawrence). The "Website Build Effort and Running Costs"
-- report, a Claude dashboard from 10 Nov 2026, moves onto the site as a staff
-- page (/admin/build-effort) that staff may show or print for donors.
--
-- The repository is public, so none of the report's figures live in code or
-- in a migration: hours (including late-night work counts), token use,
-- hire-out estimates and running-cost rates. They are one JSON document per
-- snapshot in this table, loaded by hand with SQL. The page reads the newest
-- row (as_of, then created_at), so a revision is a new row and no code change.
--
-- Access: read with the Giving grant (it is shown to donors and holds the
-- running-cost picture), the same rule as gifts. Nobody writes through the
-- API: no insert, update or delete for anon or authenticated, and no write
-- policy. Rows are added from the SQL editor.
--
-- This migration creates the table empty.

begin;

create table public.build_effort_snapshots (
  id         uuid primary key default gen_random_uuid(),
  as_of      date not null,
  data       jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.build_effort_snapshots is
  'The website build effort and running costs report (0188), one JSON document per snapshot; /admin/build-effort reads the newest. Figures live only here, never in the public repository. Giving read; written only from SQL.';

create index build_effort_snapshots_newest_idx
  on public.build_effort_snapshots (as_of desc, created_at desc);

alter table public.build_effort_snapshots enable row level security;

create policy build_effort_snapshots_select on public.build_effort_snapshots
  for select to authenticated using (public.has_grant('giving', 'read'));

revoke all on public.build_effort_snapshots from public, anon, authenticated;
grant select on public.build_effort_snapshots to authenticated;

commit;
