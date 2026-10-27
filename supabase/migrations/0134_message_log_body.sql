-- 0134_message_log_body.sql
--
-- Keep what an email actually said (Lawrence, 26 Oct 2026: "is it reasonable
-- to keep email text sent for a season ... so that we can look up what was
-- actually sent?"). message_log recorded who, when, the subject and the
-- status, never the words, so "what did we tell the Pratts?" could not be
-- answered from the record.
--
-- 1. message_log.body_text: the plain-text version of the email as sent, up
--    to 20,000 characters. Plain text, not the HTML shell -- it is what was
--    said, and the shell is the same for every email. Staff read it through
--    message_log_staff (is_staff(), 0113); families do not read message_log.
--    Kept with the rest of the row: a few KB an email is nothing next to the
--    database's size, and the test-data purge or a later retention rule can
--    clear old rows if that ever matters.
-- 2. log_family_email() gains p_body_text (restated in full; the 0132
--    eight-argument signature is dropped so there is one). Every 0120/0132
--    rule is unchanged.
-- The plan edge functions write message_log as service_role and set body_text
-- themselves (_shared/plans.ts).

alter table public.message_log
  add column body_text text
    check (body_text is null or char_length(body_text) <= 20000);

comment on column public.message_log.body_text is
  'The plain-text version of the email as sent (0134). Staff read it; families do not read message_log.';

drop function if exists public.log_family_email(uuid, uuid, text, text, text, text, text, text);

create function public.log_family_email(
  p_household_id        uuid,
  p_registration_id     uuid,
  p_to_email            text,
  p_template_key        text,
  p_subject             text,
  p_status              text,
  p_error               text default null,
  p_provider_message_id text default null,
  p_body_text           text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- has_grant() reads auth.uid() from the request, not current_user, so it
  -- answers for the caller inside a definer function.
  if not public.has_grant('registration', 'write') then
    raise exception 'Only staff with Registration write can log an email to a family.'
      using errcode = '42501';
  end if;
  if p_template_key not in ('family_update', 'waiver_needed') then
    raise exception 'Unknown family email template: %', p_template_key;
  end if;
  if p_status not in ('sent', 'failed') then
    raise exception 'An email to a family is logged as sent or failed, not %', p_status;
  end if;
  if p_household_id is null or nullif(btrim(coalesce(p_to_email, '')), '') is null then
    raise exception 'A family email is logged with its household and the address it went to.';
  end if;
  if p_registration_id is not null and not exists (
       select 1 from public.registrations r
        where r.id = p_registration_id and r.household_id = p_household_id) then
    raise exception 'That registration is not this household''s.';
  end if;

  insert into public.message_log (to_email, household_id, registration_id, template_key,
                                  subject, status, error, sent_by, provider_message_id, body_text)
  values (btrim(p_to_email), p_household_id, p_registration_id, p_template_key,
          left(p_subject, 300), p_status, left(p_error, 1000), (select auth.uid()),
          left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200),
          left(nullif(btrim(coalesce(p_body_text, '')), ''), 20000))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.log_family_email(uuid, uuid, text, text, text, text, text, text, text) is
  'Registration write. Records one staff-sent email to a family (family_update / waiver_needed) in message_log, stamped with the sender, with the mail provider''s message id and the plain text as sent. The only staff write to message_log (0113 made the table read-only). 0120, restated 0132, 0134 (26 Oct 2026).';

revoke execute on function public.log_family_email(uuid, uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.log_family_email(uuid, uuid, text, text, text, text, text, text, text) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'message_log' and column_name = 'body_text') then
    raise exception '0134: message_log.body_text is missing';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'log_family_email') <> 1 then
    raise exception '0134: log_family_email should have exactly one signature';
  end if;
  if position('body_text' in
       pg_get_functiondef('public.log_family_email(uuid, uuid, text, text, text, text, text, text, text)'::regprocedure)) = 0
     or position('has_grant(''registration'', ''write'')' in
       pg_get_functiondef('public.log_family_email(uuid, uuid, text, text, text, text, text, text, text)'::regprocedure)) = 0 then
    raise exception '0134: log_family_email was not written as intended';
  end if;
  if has_function_privilege('anon', 'public.log_family_email(uuid, uuid, text, text, text, text, text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.log_family_email(uuid, uuid, text, text, text, text, text, text, text)', 'execute') then
    raise exception '0134: log_family_email grants are wrong';
  end if;
  if has_table_privilege('authenticated', 'public.message_log', 'INSERT')
     or has_table_privilege('authenticated', 'public.message_log', 'UPDATE') then
    raise exception '0134: message_log must stay read-only for signed-in callers';
  end if;
end;
$$;
