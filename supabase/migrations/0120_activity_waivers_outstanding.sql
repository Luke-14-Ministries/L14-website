-- 0120_activity_waivers_outstanding.sql
--
-- One answer to "which waivers are outstanding?", and a way for staff to log
-- the emails they send families about it.
--
-- 22 October 2026, Lawrence. An activity is added, families sign people up,
-- and LATER staff attach a waiver to it -- the ministry's own (the Waiver
-- block on the Activities editor, agreement_requirements.activity_id, 0116 /
-- 0117) or an outside provider's link (activities.provider_name /
-- provider_url, whose proof is an upload, 0087). Until now nobody already
-- signed up was told: the family's Activities page opens the signing box
-- only when a person is ticked, so an existing signup was never asked, and
-- the staff Activities page said "Waiver NOT signed" with nothing else
-- moving. This view is what every page now asks instead of re-deriving it.
--
-- 1. public.activity_waivers_outstanding
--
--    One row per ACTIVE signup still missing a waiver:
--      * the signup is interested or signed_up (not cancelled);
--      * the person's place is not cancelled (registration_participants);
--      * the activity is active -- a turned-off activity is not running, and
--        families cannot see it anyway (activities_select), so staff and
--        families would otherwise disagree about the same row.
--    kind = 'ours'     the activity carries a required internal_document
--                      agreement (agreement_requirements.activity_id,
--                      is_required) and there is no agreement_signatures row
--                      for (agreement, person, registration) -- any status:
--                      the Activities page's setActivityChoice() counts any
--                      row as signed, and so does this.
--    kind = 'provider' provider_name or provider_url is set and there is no
--                      activity_waiver_uploads row for (participant,
--                      activity).
--    A signup that needs both shows twice, once per kind.
--
--    SECURITY INVOKER, on purpose. Unlike program_roster / clearance_status /
--    registration_review (definer, each with its own where), this view needs
--    no filter of its own: every row comes through the caller's RLS on the
--    tables underneath, which already says exactly the right thing --
--      * a family: registration_participants via my_registration_ids(),
--        registrations via my_household_ids(), activity_signups and
--        activity_waiver_uploads via my_participant_ids(), activities only
--        when active on a published event; agreement_signatures for its own
--        household's people. So a family sees its own rows and nobody else's,
--        and its own signatures are visible to the NOT EXISTS, so a signed
--        waiver is never reported missing to the family that signed it;
--      * staff: is_staff() (strong session, 0106) on every one of those
--        tables -- every row;
--      * a program leader (not staff) holds no read on registration_
--        participants and sees nothing; anon has no grant.
--    agreements and agreement_requirements are readable by every signed-in
--    user (0001), which the join needs and which shows nothing private.
--    The harness checks a family sees only its own rows, that attaching a
--    waiver to an activity with an existing signup makes that signup appear,
--    and that signing (or uploading) removes it.
--
-- 2. Logging staff email to families: message_log.sent_by and
--    public.log_family_email()
--
--    /admin/email-families sends one email per household through Resend
--    (lib/email.js) when a staff member presses Send -- never automatically.
--    Each send is logged to message_log (0001: "We told you on the first" is
--    a claim the ministry needs to be able to make from a record). Since
--    0113 message_log is read-only for staff, because nothing in the site
--    wrote it as a staff member; now something does. Rather than reopening
--    INSERT on the table (a staffer could then write any template, any
--    address, any status), the one write goes through this definer function:
--      * Registration write only (the page's own gate);
--      * template_key 'family_update' or 'waiver_needed' only;
--      * status 'sent' or 'failed' only, with the provider's error text;
--      * the registration, when given, must be the household's;
--      * sent_at is now() and sent_by is the caller (auth.uid()) -- new
--        column, so the log says who pressed Send.
--    UPDATE and DELETE stay revoked: the record cannot be tidied afterwards.
--
-- Not applied to the production project yet; the lead applies.

-- ---------------------------------------------------------------------------
-- 1. The view
-- ---------------------------------------------------------------------------
drop view if exists public.activity_waivers_outstanding;
create view public.activity_waivers_outstanding
with (security_invoker = true)
as
with active_signups as (
  select s.registration_participant_id,
         rp.registration_id,
         r.household_id,
         rp.person_id,
         s.activity_id,
         act.name as activity_name,
         r.event_id,
         act.provider_name,
         act.provider_url
    from public.activity_signups s
    join public.registration_participants rp on rp.id = s.registration_participant_id
    join public.registrations r on r.id = rp.registration_id
    join public.activities act on act.id = s.activity_id
   where s.status in ('interested', 'signed_up')
     and rp.status <> 'cancelled'
     and act.active
)
select a.registration_participant_id,
       a.registration_id,
       a.household_id,
       a.person_id,
       a.activity_id,
       a.activity_name,
       a.event_id,
       'ours'::text as kind,
       ag.id        as agreement_id,
       ag.title     as agreement_title
  from active_signups a
  join public.agreement_requirements req
    on req.activity_id = a.activity_id and req.is_required
  join public.agreements ag
    on ag.id = req.agreement_id and ag.delivery = 'internal_document'
 where not exists (
         select 1 from public.agreement_signatures sig
          where sig.agreement_id = ag.id
            and sig.person_id = a.person_id
            and sig.registration_id = a.registration_id)
union all
select a.registration_participant_id,
       a.registration_id,
       a.household_id,
       a.person_id,
       a.activity_id,
       a.activity_name,
       a.event_id,
       'provider'::text as kind,
       null::uuid       as agreement_id,
       null::text       as agreement_title
  from active_signups a
 where (nullif(btrim(a.provider_name), '') is not null
        or nullif(btrim(a.provider_url), '') is not null)
   and not exists (
         select 1 from public.activity_waiver_uploads u
          where u.registration_participant_id = a.registration_participant_id
            and u.activity_id = a.activity_id);

comment on view public.activity_waivers_outstanding is
  'One row per active activity signup still missing its waiver: kind ours (no signature of the activity''s required internal agreement on this registration) or provider (no uploaded outfitter confirmation). Security invoker: families see their own rows, staff every row, through the tables'' RLS. 0120, 22 Oct 2026.';

revoke all on public.activity_waivers_outstanding from public, anon;
grant select on public.activity_waivers_outstanding to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who sent it, and the one way staff write the log
-- ---------------------------------------------------------------------------
alter table public.message_log
  add column if not exists sent_by uuid references public.profiles (id) on delete set null;

comment on column public.message_log.sent_by is
  'The staff member who pressed Send, for emails sent from /admin/email-families (0120). Null for automated mail.';

create or replace function public.log_family_email(
  p_household_id    uuid,
  p_registration_id uuid,
  p_to_email        text,
  p_template_key    text,
  p_subject         text,
  p_status          text,
  p_error           text default null
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
  -- answers for the caller inside a definer function (CLAUDE.md's trap is
  -- about current_user).
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
                                  subject, status, error, sent_by)
  values (btrim(p_to_email), p_household_id, p_registration_id, p_template_key,
          left(p_subject, 300), p_status, left(p_error, 1000), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.log_family_email(uuid, uuid, text, text, text, text, text) is
  'Registration write. Records one staff-sent email to a family (family_update / waiver_needed) in message_log, stamped with the sender. The only staff write to message_log (0113 made the table read-only). 0120, 22 Oct 2026.';

revoke execute on function public.log_family_email(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.log_family_email(uuid, uuid, text, text, text, text, text) to authenticated;
