-- Checks for migrations 0174 and 0178 (inviting another adult to a household;
-- daily limit, adults only, removing a login, the empty-household fold-in). Fresh
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
  ('00000000-0000-0000-0000-0000000000a4', 'other@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'cousin@example.test');
insert into public.households (id, display_name) values
  ('00000000-0000-0000-0000-0000000000b1', 'Test family'),
  ('00000000-0000-0000-0000-0000000000b2', 'Other family');
insert into public.household_members (household_id, profile_id, role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a4', 'owner');
insert into public.people (id, household_id, first_name, last_name, date_of_birth) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'Dad', 'Test', null),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 'Kid', 'Test', current_date - 3650),
  -- The other family's household holds a second person, so it is not empty (0178).
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000b2', 'Other', 'Kid', null);

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
declare v uuid; n int; j boolean;
begin
  select a.household_id, a.joined into v, j from public.accept_household_invite('invite-token-invite-token-1') a;
  if v <> '00000000-0000-0000-0000-0000000000b1' or not j then raise exception 'FAIL 2: wrong household'; end if;
  select count(*) into n from public.household_members where profile_id = '00000000-0000-0000-0000-0000000000a2' and role = 'adult';
  if n <> 1 then raise exception 'FAIL 2: not added as adult'; end if;
  select count(*) into n from public.people where id = '00000000-0000-0000-0000-0000000000c1' and profile_id = '00000000-0000-0000-0000-0000000000a2';
  if n <> 1 then raise exception 'FAIL 2: person not linked'; end if;
  -- Accepting again is harmless, and is not a second join.
  select a.joined into j from public.accept_household_invite('invite-token-invite-token-1') a;
  if j then raise exception 'FAIL 2: a repeat accept said joined'; end if;
  raise notice 'PASS 2 accepted, adult, person linked, idempotent';
end $$;
set local role postgres;
do $$
declare n int;
begin
  select count(*) into n from public.family_change_log
   where household_id = '00000000-0000-0000-0000-0000000000b1' and source_table = 'household_members'
     and field = 'login' and new_value like '%dad@example.test%';
  if n <> 1 then raise exception 'FAIL 2: % change-log lines for the new login', n; end if;
  raise notice 'PASS 2 the new login is on Recent Changes';
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
  -- A used invite shows its status and no names (0178).
  select * into r from public.household_invite_preview('invite-token-invite-token-1');
  if r.status <> 'accepted' or r.household_name is not null or r.invited_by_name is not null or r.email is not null then
    raise exception 'FAIL 3: a used invite still shows names';
  end if;
  raise notice 'PASS 3 anon cannot accept; preview works; old links show no names';
end $$;
rollback;

\echo == 4 adults only; ten invites a day, cancelled ones counted (0178)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"mom@example.test"}', true) \g /dev/null
do $$
begin
  begin
    perform public.create_household_invite('00000000-0000-0000-0000-0000000000b1', 'kid@example.test',
      '00000000-0000-0000-0000-0000000000c2', encode(sha256(convert_to('invite-token-invite-token-5', 'UTF8')), 'hex'));
    raise exception 'FAIL 4: a child was named on an invite';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'Choose an adult%' then raise exception 'FAIL 4: wrong refusal: %', sqlerrm; end if;
  end;
  raise notice 'PASS 4 child refused';
end $$;
set local role postgres;
-- Out of the one-a-minute window, so only the daily limit can refuse.
update public.household_invites set created_at = created_at - interval '5 minutes' where true;
insert into public.household_invites (household_id, email, token_hash, invited_by, created_at, cancelled_at)
select '00000000-0000-0000-0000-0000000000b1', 'n' || g || '@example.test',
       encode(sha256(convert_to('cap-token-' || g, 'UTF8')), 'hex'), '00000000-0000-0000-0000-0000000000a1',
       now() - interval '2 hours', now() - interval '1 hour'
  from generate_series(1, 10) g;
set local role authenticated;
do $$
begin
  begin
    perform public.create_household_invite('00000000-0000-0000-0000-0000000000b1', 'eleven@example.test', null,
      encode(sha256(convert_to('invite-token-invite-token-6', 'UTF8')), 'hex'));
    raise exception 'FAIL 4: an eleventh invite in a day was sent';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%enough invites for today%' then raise exception 'FAIL 4: wrong refusal: %', sqlerrm; end if;
  end;
  raise notice 'PASS 4 ten a day, cancelled counted';
end $$;
rollback;

\echo == 5 removing a login: owner yes, adult and outsider no (0178)
begin;
set local role authenticated;
-- Dad (an adult, joined in 2) cannot remove Mom (the owner).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"dad@example.test"}', true) \g /dev/null
do $$
begin
  begin
    perform public.remove_household_login('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'FAIL 5: an adult removed the owner';
  exception when insufficient_privilege or raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS 5 adult cannot remove the owner';
end $$;
-- An outsider (another family's owner) cannot remove anyone.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"other@example.test"}', true) \g /dev/null
do $$
begin
  begin
    perform public.remove_household_login('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2');
    raise exception 'FAIL 5: an outsider removed a login';
  exception when insufficient_privilege or raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS 5 outsider refused';
end $$;
-- Mom, the owner, cannot remove herself; she removes Dad.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"mom@example.test"}', true) \g /dev/null
do $$
begin
  begin
    perform public.remove_household_login('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'FAIL 5: the owner removed herself';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform public.remove_household_login('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2');
  raise notice 'PASS 5 owner removes an adult';
end $$;
set local role postgres;
do $$
declare n int;
begin
  select count(*) into n from public.household_members where profile_id = '00000000-0000-0000-0000-0000000000a2';
  if n <> 0 then raise exception 'FAIL 5: membership left behind'; end if;
  select count(*) into n from public.people where profile_id = '00000000-0000-0000-0000-0000000000a2';
  if n <> 0 then raise exception 'FAIL 5: person still linked'; end if;
  select count(*) into n from public.family_change_log where field = 'login' and new_value = 'Removed';
  if n <> 1 then raise exception 'FAIL 5: removal not logged'; end if;
  raise notice 'PASS 5 membership gone, person unlinked, logged';
end $$;
rollback;

\echo == 6 an empty household of one's own folds in; anything more is refused (0178)
begin;
set local role postgres;
-- The cousin made an account and set up a household, nothing more (0149's shape).
insert into public.households (id, display_name) values ('00000000-0000-0000-0000-0000000000b3', 'Cousin family');
insert into public.household_members (household_id, profile_id, role)
values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a5', 'owner');
insert into public.people (id, household_id, first_name, last_name, profile_id)
values ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000b3', 'Cousin', 'Test',
        '00000000-0000-0000-0000-0000000000a5');
update public.households set primary_contact_person_id = '00000000-0000-0000-0000-0000000000c5'
 where id = '00000000-0000-0000-0000-0000000000b3';
insert into public.household_invites (household_id, email, token_hash, invited_by)
values ('00000000-0000-0000-0000-0000000000b1', 'cousin@example.test',
        encode(sha256(convert_to('invite-token-invite-token-7', 'UTF8')), 'hex'), '00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a5', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"cousin@example.test"}', true) \g /dev/null
do $$
declare j boolean;
begin
  select a.joined into j from public.accept_household_invite('invite-token-invite-token-7') a;
  if not j then raise exception 'FAIL 6: the empty household did not fold in'; end if;
  raise notice 'PASS 6 empty household folded in';
end $$;
set local role postgres;
do $$
declare n int;
begin
  select count(*) into n from public.households where id = '00000000-0000-0000-0000-0000000000b3';
  if n <> 0 then raise exception 'FAIL 6: the empty household is still there'; end if;
  select count(*) into n from public.household_members where profile_id = '00000000-0000-0000-0000-0000000000a5'
     and household_id = '00000000-0000-0000-0000-0000000000b1';
  if n <> 1 then raise exception 'FAIL 6: not joined'; end if;
  raise notice 'PASS 6 one household now';
end $$;
rollback;

begin;
set local role postgres;
-- The same, but the cousin's household also has a deletion request on file.
insert into public.households (id, display_name) values ('00000000-0000-0000-0000-0000000000b3', 'Cousin family');
insert into public.household_members (household_id, profile_id, role)
values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a5', 'owner');
insert into public.data_deletion_requests (household_id, requested_by, scope)
values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a5', 'medical');
insert into public.household_invites (household_id, email, token_hash, invited_by)
values ('00000000-0000-0000-0000-0000000000b1', 'cousin@example.test',
        encode(sha256(convert_to('invite-token-invite-token-8', 'UTF8')), 'hex'), '00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a5', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"cousin@example.test"}', true) \g /dev/null
do $$
begin
  begin
    perform public.accept_household_invite('invite-token-invite-token-8');
    raise exception 'FAIL 6: a household with a record on file folded in';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS 6 a household with anything on file is refused';
end $$;
rollback;

\echo ALL HOUSEHOLD INVITE CHECKS PASSED
