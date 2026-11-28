-- Checks for migration 0188 (the build effort report's snapshots). Run on a
-- fresh database after every migration (no seed needed):
--   L14_DB=l14_effort bash supabase/tests/run_rls_local.sh supabase/tests/build_effort_rules.sql
-- Raises on failure; ends ALL BUILD EFFORT CHECKS PASSED. The figures here
-- are made up.
\set ON_ERROR_STOP on
\pset footer off

-- Staff with Giving read, staff with only Registration write, an
-- administrator with no Giving grant, and a family login.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000018801', 'giving188@example.test'),
  ('00000000-0000-0000-0000-000000018802', 'reg188@example.test'),
  ('00000000-0000-0000-0000-000000018803', 'admin188@example.test'),
  ('00000000-0000-0000-0000-000000018804', 'fam188@example.test');
insert into public.staff (profile_id, role) values
  ('00000000-0000-0000-0000-000000018801', 'coordinator'),
  ('00000000-0000-0000-0000-000000018802', 'coordinator'),
  ('00000000-0000-0000-0000-000000018803', 'admin');
insert into public.staff_grants (profile_id, area, level) values
  ('00000000-0000-0000-0000-000000018801', 'giving', 'read'),
  ('00000000-0000-0000-0000-000000018802', 'registration', 'write');

-- Loaded the way the real rows are: as the database owner, from SQL.
insert into public.build_effort_snapshots (as_of, data) values
  ('2026-01-01', '{"weekly": [{"week_start": "2026-01-01", "commits": 1}]}'),
  ('2026-02-01', '{"weekly": [{"week_start": "2026-02-01", "commits": 2}]}');

\echo == 1 Giving read sees the snapshots, newest first, and cannot write
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000018801', true),
       set_config('request.jwt.claims', '{"aal":"aal2"}', true) \g /dev/null
do $$
declare d date; n int;
begin
  select as_of into d from public.build_effort_snapshots order by as_of desc, created_at desc limit 1;
  if d is distinct from '2026-02-01' then raise exception 'FAIL 1: newest read as %', d; end if;
  raise notice 'PASS 1 Giving read reads the newest snapshot';
  begin
    insert into public.build_effort_snapshots (as_of, data) values ('2026-03-01', '{}');
    raise exception 'FAIL 1b: Giving read inserted a snapshot';
  exception when insufficient_privilege then raise notice 'PASS 1b no insert through the API';
  end;
  begin
    update public.build_effort_snapshots set data = '{}';
    raise exception 'FAIL 1c: Giving read changed a snapshot';
  exception when insufficient_privilege then raise notice 'PASS 1c no update through the API';
  end;
  begin
    delete from public.build_effort_snapshots;
    raise exception 'FAIL 1d: Giving read deleted a snapshot';
  exception when insufficient_privilege then raise notice 'PASS 1d no delete through the API';
  end;
end $$;
rollback;

\echo == 2 Giving read with a weak session sees nothing
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000018801', true),
       set_config('request.jwt.claims', '{"aal":"aal1"}', true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.build_effort_snapshots;
  if n <> 0 then raise exception 'FAIL 2: % rows without two-factor', n; end if;
  raise notice 'PASS 2 no rows without a strong session';
end $$;
rollback;

\echo == 3 other staff, an administrator without Giving, and a family see nothing
begin;
set local role authenticated;
do $$
declare who uuid; n int;
begin
  foreach who in array array[
    '00000000-0000-0000-0000-000000018802',
    '00000000-0000-0000-0000-000000018803',
    '00000000-0000-0000-0000-000000018804']::uuid[] loop
    perform set_config('request.jwt.claim.sub', who::text, true);
    perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
    select count(*) into n from public.build_effort_snapshots;
    if n <> 0 then raise exception 'FAIL 3: % read % rows', who, n; end if;
  end loop;
  raise notice 'PASS 3 no Giving grant, no rows';
end $$;
rollback;

\echo == 4 an anonymous visitor cannot read the table at all
begin;
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from public.build_effort_snapshots;
    raise exception 'FAIL 4: anon read % rows', n;
  exception when insufficient_privilege then raise notice 'PASS 4 anon has no access';
  end;
end $$;
rollback;

\echo ALL BUILD EFFORT CHECKS PASSED
