-- Checks for migration 0174 (inviting another adult to a household). Fresh
-- database after every migration, no seed:
--   L14_DB=l14_inv bash supabase/tests/run_rls_local.sh
--   psql ... -d l14_inv -f supabase/tests/household_invite_rules.sql
-- Raises on failure; ends ALL HOUSEHOLD INVITE CHECKS PASSED.
\set ON_ERROR_STOP on
\pset footer off

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'mom@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'dad@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'stranger@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'other@example.test');
insert into public.households (id, display_name) values
  ('00000000-0000-0000-0000-0000000000b1', 'Test family'),
  ('00000000-0000-0000-0000-0000000000b2', 'Other family');
insert into public.household_members (household_id, profile_id, role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a4', 'owner');
insert into public.people (id, household_id, first_name, last_name) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'Dad', 'Test');

\echo == 1 a member invites; a stranger cannot; the hash stays hidden
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"mom@example.test"}', true) \g /dev/null
do $$
declare n int;
begin
  perform public.create_household_invite('00000000-0000-0000-0000-0000000000b1', 'Dad@Example.test',
    '00000000-0000-0000-0000-0000000000c1', encode(sha256(convert_to('invite-token-invite-token-1', 'UTF8')), 'hex'));
  select count(*) into n from public.household_invites where email = 'dad@example.test';
  if n <> 1 then raise exception 'FAIL 1: invite not visible to the household'; end if;
  begin
    perform token_hash from public.household_invites;
    raise exception 'FAIL 1: token hash readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_household_invite('00000000-0000-0000-0000-0000000000b1', 'mom@example.test', null,
      encode(sha256(convert_to('invite-token-invite-token-2', 'UTF8')), 'hex'));
    raise exception 'FAIL 1: invited own address';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS 1 member invites, hash hidden, own address refused';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"stranger@example.test"}', true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.household_invites;
  if n <> 0 then raise exception 'FAIL 1: stranger sees invites'; end if;
  begin
    perform public.create_household_invite('00000000-0000-0000-0000-0000000000b1', 'x@example.test', null,
      encode(sha256(convert_to('invite-token-invite-token-3', 'UTF8')), 'hex'));
    raise exception 'FAIL 1: stranger invited';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS 1 stranger refused';
end $$;
commit;

\echo == 2 only the invited address accepts; it links the named person
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"stranger@example.test"}', true) \g /dev/null
do $$
begin
  begin
    perform public.accept_household_invite('invite-token-invite-token-1');
    raise exception 'FAIL 2: wrong address accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS 2 wrong address refused';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"dad@example.test"}', true) \g /dev/null
do $$
declare v uuid; n int;
begin
  v := public.accept_household_invite('invite-token-invite-token-1');
  if v <> '00000000-0000-0000-0000-0000000000b1' then raise exception 'FAIL 2: wrong household'; end if;
  select count(*) into n from public.household_members where profile_id = '00000000-0000-0000-0000-0000000000a2' and role = 'adult';
  if n <> 1 then raise exception 'FAIL 2: not added as adult'; end if;
  select count(*) into n from public.people where id = '00000000-0000-0000-0000-0000000000c1' and profile_id = '00000000-0000-0000-0000-0000000000a2';
  if n <> 1 then raise exception 'FAIL 2: person not linked'; end if;
  -- Accepting again is harmless.
  perform public.accept_household_invite('invite-token-invite-token-1');
  raise notice 'PASS 2 accepted, adult, person linked, idempotent';
end $$;
commit;

\echo == 3 a login with its own household is refused; anon cannot accept
begin;
set local role postgres;
insert into public.household_invites (household_id, email, token_hash, invited_by)
values ('00000000-0000-0000-0000-0000000000b1', 'other@example.test',
        encode(sha256(convert_to('invite-token-invite-token-4', 'UTF8')), 'hex'), '00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"other@example.test"}', true) \g /dev/null
do $$
begin
  begin
    perform public.accept_household_invite('invite-token-invite-token-4');
    raise exception 'FAIL 3: login with a household accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS 3 existing household refused';
end $$;
set local role anon;
select set_config('request.jwt.claim.sub', '', true) \g /dev/null
do $$
declare r record;
begin
  begin
    perform public.accept_household_invite('invite-token-invite-token-4');
    raise exception 'FAIL 3: anon accepted';
  exception when insufficient_privilege then null;
  end;
  select * into r from public.household_invite_preview('invite-token-invite-token-4');
  if r.status <> 'open' or r.household_name <> 'Test family' then raise exception 'FAIL 3: preview wrong'; end if;
  raise notice 'PASS 3 anon cannot accept; preview works';
end $$;
rollback;

\echo ALL HOUSEHOLD INVITE CHECKS PASSED
