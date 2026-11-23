-- Checks for migrations 0171 and 0178 (a new contact email is confirmed first;
-- five links a day, the notice to the old address, families logging their
-- own emails). Run on a
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
declare v text; prev text; hh uuid;
begin
  select c.new_email into v from public.confirm_household_email_change('wrong-token-wrong-token-1') c;
  if v is not null then raise exception 'FAIL 3: a wrong token confirmed'; end if;
  select c.new_email, c.previous_email, c.household_id into v, prev, hh
    from public.confirm_household_email_change('token-token-token-token-1') c;
  if v is distinct from 'new@example.test' then raise exception 'FAIL 3: the right token gave %', v; end if;
  -- 0178: it says what it replaced, for the notice to the old address.
  if prev is distinct from 'old@example.test' or hh is distinct from '00000000-0000-0000-0000-0000000000f1' then
    raise exception 'FAIL 3: previous address % / household %', prev, hh;
  end if;
  v := null;
  select c.new_email into v from public.confirm_household_email_change('token-token-token-token-1') c;
  if v is not null then raise exception 'FAIL 3: a used token confirmed again'; end if;
  -- The notice to the old address is logged once, only with the token.
  if public.log_contact_change_notice('wrong-token-wrong-token-1', 'sent') then
    raise exception 'FAIL 3: a wrong token logged a notice';
  end if;
  if not public.log_contact_change_notice('token-token-token-token-1', 'sent', 're_123') then
    raise exception 'FAIL 3: the notice was not logged';
  end if;
  if public.log_contact_change_notice('token-token-token-token-1', 'sent') then
    raise exception 'FAIL 3: the notice was logged twice';
  end if;
  raise notice 'PASS 3 confirm once, signed out; notice logged once';
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
  if exists (select 1 from public.confirm_household_email_change('token-token-token-token-9')) then
    raise exception 'FAIL 3: an expired link confirmed';
  end if;
  select count(*) into n from public.message_log
   where template_key = 'contact_email_changed' and to_email = 'old@example.test';
  if n <> 1 then raise exception 'FAIL 3: % notice rows to the old address', n; end if;
  raise notice 'PASS 3 expired link refused; one notice row';
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

\echo == 5 five links a day; Cancel does not reset the count (0178)
begin;
set local role postgres;
insert into public.household_email_change_requests (household_id, new_email, token_hash, requested_at)
select '00000000-0000-0000-0000-0000000000f1', 'n' || g || '@example.test', repeat('b', 64), now() - interval '2 hours'
  from generate_series(1, 5) g;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"fam@example.test"}', true) \g /dev/null
do $$
begin
  perform public.cancel_household_email_change('00000000-0000-0000-0000-0000000000f1');
  begin
    perform public.request_household_email_change('00000000-0000-0000-0000-0000000000f1', 'sixth@example.test',
              encode(sha256(convert_to('token-token-token-token-6', 'UTF8')), 'hex'));
    raise exception 'FAIL 5: a sixth link in a day was sent';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%enough confirmation links for today%' then raise exception 'FAIL 5: wrong refusal: %', sqlerrm; end if;
  end;
  -- The family's own login email still applies at once (no mail is sent).
  if public.request_household_email_change('00000000-0000-0000-0000-0000000000f1', 'fam@example.test',
       encode(sha256(convert_to('token-token-token-token-7', 'UTF8')), 'hex')) <> 'applied' then
    raise exception 'FAIL 5: the login email was refused';
  end if;
  begin
    perform 1 from public.household_email_change_requests;
    raise exception 'FAIL 5: a family read the request log';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 5 five a day, Cancel does not reset it, log not readable';
end $$;
rollback;

\echo == 6 a family logs its own household's emails, nothing else (0178)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"fam@example.test"}', true) \g /dev/null
do $$
declare i int;
begin
  perform public.log_own_household_email('00000000-0000-0000-0000-0000000000f1', null, 'x@example.test',
            'household_invite', 'Subject', 'sent');
  begin
    perform public.log_own_household_email('00000000-0000-0000-0000-0000000000f1', null, 'x@example.test',
              'family_update', 'Subject', 'sent');
    raise exception 'FAIL 6: a staff template was logged by a family';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.log_own_household_email('00000000-0000-0000-0000-0000000000f1', null, 'x@example.test',
              'household_invite', 'Subject', 'delivered');
    raise exception 'FAIL 6: a family set a delivery status';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- Feedback notes: five an hour.
  for i in 1..5 loop
    perform public.log_own_household_email(null, null, 'anything', 'website_feedback', 'Feedback', 'sent');
  end loop;
  if public.my_feedback_notes_this_hour() <> 5 then raise exception 'FAIL 6: feedback count wrong'; end if;
  begin
    perform public.log_own_household_email(null, null, 'anything', 'website_feedback', 'Feedback', 'sent');
    raise exception 'FAIL 6: a sixth note in an hour was logged';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- Families still read nothing in message_log (RLS: staff only).
  if exists (select 1 from public.message_log) then raise exception 'FAIL 6: a family read message_log'; end if;
  raise notice 'PASS 6 own household logged, staff templates and statuses refused, five notes an hour';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2","email":"other@example.test"}', true) \g /dev/null
do $$
begin
  begin
    perform public.log_own_household_email('00000000-0000-0000-0000-0000000000f1', null, 'x@example.test',
              'household_invite', 'Subject', 'sent');
    raise exception 'FAIL 6: a stranger logged into another family''s record';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS 6 stranger refused';
end $$;
set local role postgres;
do $$
declare n int;
begin
  select count(*) into n from public.message_log where template_key = 'website_feedback' and to_email = 'info@luke14ministries.net'
     and sent_by = '00000000-0000-0000-0000-0000000000e1';
  if n <> 5 then raise exception 'FAIL 6: feedback rows % (address not fixed?)', n; end if;
  raise notice 'PASS 6 feedback rows go to info@ and carry the sender';
end $$;
rollback;

\echo ALL CONTACT EMAIL CHECKS PASSED
