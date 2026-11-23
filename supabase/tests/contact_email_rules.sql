-- Checks for migration 0171 (a new contact email is confirmed first). Run on a
-- fresh database after every migration (no seed needed):
--   L14_DB=l14_email bash supabase/tests/run_rls_local.sh
--   psql ... -d l14_email -f supabase/tests/contact_email_rules.sql
-- Raises on failure; ends ALL CONTACT EMAIL CHECKS PASSED.
\set ON_ERROR_STOP on
\pset footer off

-- One family (login fam@example.test, contact old@example.test) and a stranger.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'fam@example.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'other@example.test');
insert into public.households (id, display_name, email)
values ('00000000-0000-0000-0000-0000000000f1', 'Test family', 'old@example.test');
insert into public.household_members (household_id, profile_id, role)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'owner');

\echo == 1 a family cannot write a new contact email directly
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"fam@example.test"}', true) \g /dev/null
do $$
begin
  begin
    update public.households set email = 'typo@example.test' where id = '00000000-0000-0000-0000-0000000000f1';
    raise exception 'FAIL 1: a family wrote an unconfirmed contact email';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 1 direct write refused';
  end;
  -- Their own login email and clearing it are still allowed.
  update public.households set email = 'FAM@example.test' where id = '00000000-0000-0000-0000-0000000000f1';
  update public.households set email = null where id = '00000000-0000-0000-0000-0000000000f1';
  -- Other columns save as before.
  update public.households set phone = '423-555-0100' where id = '00000000-0000-0000-0000-0000000000f1';
  raise notice 'PASS 1 login email, clearing and other columns allowed';
end $$;
rollback;

\echo == 2 request, read back without the hash, confirm with the token
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"fam@example.test"}', true) \g /dev/null
do $$
declare
  v text;
  n int;
begin
  v := public.request_household_email_change('00000000-0000-0000-0000-0000000000f1', 'new@example.test',
         encode(sha256(convert_to('token-token-token-token-1', 'UTF8')), 'hex'));
  if v <> 'pending' then raise exception 'FAIL 2: request said %', v; end if;
  select count(*) into n from public.household_email_changes where new_email = 'new@example.test';
  if n <> 1 then raise exception 'FAIL 2: family cannot see its pending change'; end if;
  begin
    perform token_hash from public.household_email_changes;
    raise exception 'FAIL 2: family read the token hash';
  exception when insufficient_privilege then raise notice 'PASS 2 token hash hidden';
  end;
  -- Still the old address until confirmed.
  select count(*) into n from public.households where email = 'old@example.test';
  if n <> 1 then raise exception 'FAIL 2: address changed before confirmation'; end if;
  -- A second request inside a minute is refused.
  begin
    perform public.request_household_email_change('00000000-0000-0000-0000-0000000000f1', 'new2@example.test',
              encode(sha256(convert_to('token-token-token-token-2', 'UTF8')), 'hex'));
    raise exception 'FAIL 2: a second link inside a minute was allowed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 2 one link a minute';
  end;
  -- Their login email applies at once.
  v := public.request_household_email_change('00000000-0000-0000-0000-0000000000f1', 'fam@example.test',
         encode(sha256(convert_to('token-token-token-token-3', 'UTF8')), 'hex'));
  if v <> 'applied' then raise exception 'FAIL 2: login email said %', v; end if;
  raise notice 'PASS 2 request, login email applies';
end $$;
rollback;

\echo == 3 the link works signed out; wrong, used and expired links do nothing
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"fam@example.test"}', true) \g /dev/null
select public.request_household_email_change('00000000-0000-0000-0000-0000000000f1', 'new@example.test',
         encode(sha256(convert_to('token-token-token-token-1', 'UTF8')), 'hex')) \g /dev/null
set local role anon;
select set_config('request.jwt.claim.sub', '', true) \g /dev/null
select set_config('request.jwt.claims', '', true) \g /dev/null
do $$
declare v text;
begin
  v := public.confirm_household_email_change('wrong-token-wrong-token-1');
  if v is not null then raise exception 'FAIL 3: a wrong token confirmed'; end if;
  v := public.confirm_household_email_change('token-token-token-token-1');
  if v is distinct from 'new@example.test' then raise exception 'FAIL 3: the right token gave %', v; end if;
  v := public.confirm_household_email_change('token-token-token-token-1');
  if v is not null then raise exception 'FAIL 3: a used token confirmed again'; end if;
  raise notice 'PASS 3 confirm once, signed out';
end $$;
set local role postgres;
do $$
declare n int;
begin
  select count(*) into n from public.households where id = '00000000-0000-0000-0000-0000000000f1' and email = 'new@example.test';
  if n <> 1 then raise exception 'FAIL 3: the address did not change'; end if;
  -- An expired link.
  insert into public.household_email_changes (household_id, new_email, token_hash, expires_at)
  values ('00000000-0000-0000-0000-0000000000f1', 'late@example.test',
          encode(sha256(convert_to('token-token-token-token-9', 'UTF8')), 'hex'), now() - interval '1 minute');
  if public.confirm_household_email_change('token-token-token-token-9') is not null then
    raise exception 'FAIL 3: an expired link confirmed';
  end if;
  raise notice 'PASS 3 expired link refused';
end $$;
rollback;

\echo == 4 a stranger cannot ask for, see or cancel a change for another family
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"fam@example.test"}', true) \g /dev/null
select public.request_household_email_change('00000000-0000-0000-0000-0000000000f1', 'new@example.test',
         encode(sha256(convert_to('token-token-token-token-1', 'UTF8')), 'hex')) \g /dev/null
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"other@example.test"}', true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.household_email_changes;
  if n <> 0 then raise exception 'FAIL 4: a stranger sees % pending rows', n; end if;
  begin
    perform public.request_household_email_change('00000000-0000-0000-0000-0000000000f1', 'evil@example.test',
              encode(sha256(convert_to('token-token-token-token-5', 'UTF8')), 'hex'));
    raise exception 'FAIL 4: a stranger asked for a change';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.cancel_household_email_change('00000000-0000-0000-0000-0000000000f1');
    raise exception 'FAIL 4: a stranger cancelled a change';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.household_email_changes (household_id, new_email, token_hash)
    values ('00000000-0000-0000-0000-0000000000f1', 'evil@example.test', repeat('a', 64));
    raise exception 'FAIL 4: a signed-in user wrote the table';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 4 strangers refused';
end $$;
rollback;

\echo ALL CONTACT EMAIL CHECKS PASSED
