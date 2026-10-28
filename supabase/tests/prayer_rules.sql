-- Checks for migration 0141 (the prayer list). Run after supabase_stubs.sql,
-- every migration, and payment_plans_seed.sql:
--   L14_DB=l14_pray bash supabase/tests/run_rls_local.sh supabase/tests/payment_plans_seed.sql
--   psql ... -d l14_pray -f supabase/tests/prayer_rules.sql
-- Raises on failure; ends ALL PRAYER CHECKS PASSED.
\set ON_ERROR_STOP on
\pset footer off

-- Two people on the list (written as the service role would: here, postgres).
insert into public.prayer_list_subscribers (email, name, confirmed_at)
values ('one@example.org', 'One', now()), ('two@example.org', 'Two', null);

\echo == 1 nobody signed in writes the list; a family reads nothing
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.prayer_list_subscribers;
  if n <> 0 then raise exception 'FAIL 1: a family reads % list rows', n; end if;
  begin
    insert into public.prayer_list_subscribers (email) values ('three@example.org');
    raise exception 'FAIL 1: a family wrote the list';
  exception when insufficient_privilege then raise notice 'PASS 1 a family cannot write the list';
  end;
  begin
    insert into public.prayer_list_sends (subject, body, recipient_count) values ('x', 'y', 0);
    raise exception 'FAIL 1: a family recorded a send';
  exception when insufficient_privilege then raise notice 'PASS 1 a family cannot record a send';
  end;
end $$;
rollback;

\echo == 2 staff without the grant read nothing
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.prayer_list_subscribers;
  if n <> 0 then raise exception 'FAIL 2: staff without Prayer read see % rows', n; end if;
  raise notice 'PASS 2 no grant, no list';
end $$;
rollback;

\echo == 3 Prayer read sees the list but never a token, and cannot send
insert into public.staff_grants (profile_id, area, level) values ('00000000-0000-0000-0000-00000000000b', 'prayer', 'read');
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.prayer_list_subscribers;
  if n <> 2 then raise exception 'FAIL 3: Prayer read sees % rows', n; end if;
  begin
    perform token from public.prayer_list_subscribers;
    raise exception 'FAIL 3: Prayer read read a token';
  exception when insufficient_privilege then raise notice 'PASS 3 the token column is refused';
  end;
  begin
    insert into public.prayer_list_sends (subject, body, recipient_count) values ('x', 'y', 0);
    raise exception 'FAIL 3: Prayer read recorded a send';
  exception when insufficient_privilege then raise notice 'PASS 3 Prayer read cannot record a send';
  end;
  begin
    update public.prayer_list_subscribers set unsubscribed_at = now() where true;
    raise exception 'FAIL 3: Prayer read changed the list';
  exception when insufficient_privilege then raise notice 'PASS 3 Prayer read cannot change the list';
  end;
end $$;
rollback;

\echo == 4 Prayer write records a send as themselves only
update public.staff_grants set level = 'write' where profile_id = '00000000-0000-0000-0000-00000000000b' and area = 'prayer';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare who uuid;
begin
  insert into public.prayer_list_sends (subject, body, recipient_count) values ('Pray for camp', 'Text', 1)
  returning sent_by into who;
  if who is distinct from '00000000-0000-0000-0000-00000000000b' then raise exception 'FAIL 4: send stamped %', who; end if;
  begin
    insert into public.prayer_list_sends (subject, body, recipient_count, sent_by)
    values ('x', 'y', 0, '00000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL 4: a send was recorded as someone else';
  exception when insufficient_privilege then raise notice 'PASS 4 a send is recorded only as yourself';
  end;
  raise notice 'PASS 4 Prayer write records a send';
end $$;
rollback;

\echo == 5 an anonymous visitor reaches nothing
begin;
set local role anon;
do $$
begin
  begin
    perform 1 from public.prayer_list_subscribers;
    raise exception 'FAIL 5: anon read the list';
  exception when insufficient_privilege then raise notice 'PASS 5 anon cannot read the list';
  end;
end $$;
rollback;

\echo ALL PRAYER CHECKS PASSED
