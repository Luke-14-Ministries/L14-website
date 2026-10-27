-- 0132_log_family_email_provider_id.sql
--
-- log_family_email() (0120) records a staff-sent family email in message_log
-- but had nowhere to put Resend's id for the message, so a logged email could
-- not be looked up at Resend -- delivered, bounced, or sent to a mistyped
-- address (Lawrence, 26 Oct 2026: his test went to luke14ministries.com and
-- "sent" was all the record could say). The plan edge functions already store
-- it (_shared/plans.ts). This adds p_provider_message_id, optional.
--
-- Restated in full rather than patched (CLAUDE.md: a rewrite in place must be
-- checked). The old seven-argument signature is dropped first: adding a
-- defaulted eighth argument with CREATE OR REPLACE would leave two overloads
-- and an ambiguous call. Every rule from 0120 is unchanged.

drop function if exists public.log_family_email(uuid, uuid, text, text, text, text, text);

create function public.log_family_email(
  p_household_id        uuid,
  p_registration_id     uuid,
  p_to_email            text,
  p_template_key        text,
  p_subject             text,
  p_status              text,
  p_error               text default null,
  p_provider_message_id text default null
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
                                  subject, status, error, sent_by, provider_message_id)
  values (btrim(p_to_email), p_household_id, p_registration_id, p_template_key,
          left(p_subject, 300), p_status, left(p_error, 1000), (select auth.uid()),
          left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.log_family_email(uuid, uuid, text, text, text, text, text, text) is
  'Registration write. Records one staff-sent email to a family (family_update / waiver_needed) in message_log, stamped with the sender, with the mail provider''s message id when there is one. The only staff write to message_log (0113 made the table read-only). 0120, restated 0132 (26 Oct 2026).';

revoke execute on function public.log_family_email(uuid, uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.log_family_email(uuid, uuid, text, text, text, text, text, text) to authenticated;

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'log_family_email') <> 1 then
    raise exception '0132: log_family_email should have exactly one signature';
  end if;
  if position('provider_message_id' in
       pg_get_functiondef('public.log_family_email(uuid, uuid, text, text, text, text, text, text)'::regprocedure)) = 0
     or position('has_grant(''registration'', ''write'')' in
       pg_get_functiondef('public.log_family_email(uuid, uuid, text, text, text, text, text, text)'::regprocedure)) = 0 then
    raise exception '0132: log_family_email was not written as intended';
  end if;
  if has_function_privilege('anon', 'public.log_family_email(uuid, uuid, text, text, text, text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.log_family_email(uuid, uuid, text, text, text, text, text, text)', 'execute') then
    raise exception '0132: log_family_email grants are wrong';
  end if;
end;
$$;
