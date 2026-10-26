-- 0124_waiver_upload_review.sql
--
-- Staff accept or reject an outside provider's waiver confirmation.
--
-- 26 October 2026, Lawrence. Families upload the outfitter's confirmation
-- (0087: activity_waiver_uploads, private bucket waiver-confirmations), and
-- until now staff saw only that a file exists. He uploaded a random picture
-- as a test and it counted. Now each upload carries a review:
--
--   pending   uploaded, camp staff have not looked yet (the default, and what
--             every existing row becomes);
--   accepted  a staff member opened it and it is the confirmation;
--   rejected  wrong file, unreadable, too small, not signed... -- with the
--             reason, which the family reads. The row is OUTSTANDING again and
--             the family uploads a new file over it.
--
-- This supersedes the 21/22 Oct decision "no staff verified mark" (DECISIONS
-- 21 Oct follow-ups; DO-THIS-NEXT W60).
--
-- 1. Columns on activity_waiver_uploads: review_status, reviewed_by,
--    reviewed_at, review_note (required for rejected -- a check constraint,
--    so no writer can leave a family without the reason).
--
-- 2. guard_waiver_upload_review(), an INVOKER trigger (CLAUDE.md: a definer
--    trigger sees its owner as current_user, and the "is this a signed-in
--    caller?" test would always step aside). Families can INSERT and UPDATE
--    their own row today (0087 "family writes own" / "family replaces own"),
--    and WaiverUpload.jsx upserts it on every upload. So:
--      * replacing the file (storage_path, content_type or uploaded_at
--        changes) RESETS the review to pending and clears reviewer, time and
--        note -- whoever does it: a new file has not been looked at;
--      * otherwise a signed-in caller (current_user authenticated / anon)
--        cannot change the review columns, and cannot insert a row that is
--        anything but pending. That covers staff too, on purpose: the one
--        way to review is review_waiver_upload() below, which runs as its
--        owner and so is not stopped here.
--
-- 3. review_waiver_upload(upload, status, note): definer, Registration
--    write -- the grant the staff Activities page already uses for the
--    family-facing side of activities (its "email the families" button, 0120
--    log_family_email) and the one that confirms an agreement signature
--    (0113). Activities write is about running the activity, not about a
--    family's paperwork. Stamps reviewed_by = the caller and reviewed_at =
--    now(); 'accepted' or 'rejected' only; the note is required to reject.
--
--    The record is the row itself (reviewed_by / reviewed_at / review_note).
--    money_change_log is money only (0111) and family_change_log records
--    FAMILY edits for staff to check off (0013); neither is the place for a
--    staff decision on paperwork. A re-upload clears the last review, so the
--    history of a rejected file is not kept -- the new file is what matters.
--
-- 4. activity_waivers_outstanding restated in full (0120): a provider row is
--    outstanding when there is NO upload or the upload is REJECTED; pending
--    and accepted are not outstanding. Two columns are added at the end:
--      upload_status  'missing' | 'rejected' for a provider row, null for ours;
--      review_note    the staff reason when rejected, else null.
--    Still security invoker, still the same grants.
--
-- Not applied to the production project yet; the lead applies.

-- ---------------------------------------------------------------------------
-- 1. The review columns
-- ---------------------------------------------------------------------------
alter table public.activity_waiver_uploads
  add column if not exists review_status text not null default 'pending',
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

alter table public.activity_waiver_uploads
  drop constraint if exists activity_waiver_uploads_review_status_check;
alter table public.activity_waiver_uploads
  add constraint activity_waiver_uploads_review_status_check
  check (review_status in ('pending', 'accepted', 'rejected'));

alter table public.activity_waiver_uploads
  drop constraint if exists activity_waiver_uploads_reject_needs_reason;
alter table public.activity_waiver_uploads
  add constraint activity_waiver_uploads_reject_needs_reason
  check (review_status <> 'rejected' or nullif(btrim(review_note), '') is not null);

comment on column public.activity_waiver_uploads.review_status is
  'pending (uploaded, not yet checked by staff), accepted, or rejected (outstanding again; the family uploads a new file). Set only through review_waiver_upload(); a new file resets it to pending. 0124.';
comment on column public.activity_waiver_uploads.reviewed_by is
  'The staff member who last accepted or rejected this upload. Cleared when the family replaces the file. 0124.';
comment on column public.activity_waiver_uploads.reviewed_at is
  'When this upload was last accepted or rejected. Cleared when the family replaces the file. 0124.';
comment on column public.activity_waiver_uploads.review_note is
  'The reason, shown to the family, when staff reject the upload (required then). Cleared when the family replaces the file. 0124.';

-- ---------------------------------------------------------------------------
-- 2. The guard (invoker)
-- ---------------------------------------------------------------------------
create or replace function public.guard_waiver_upload_review()
-- Runs with the CALLER's rights on purpose: inside a definer function
-- current_user is the owner, which is how review_waiver_upload() gets past
-- the second half of this guard (CLAUDE.md, 0105).
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.storage_path is distinct from old.storage_path
          or new.content_type is distinct from old.content_type
          or new.uploaded_at is distinct from old.uploaded_at) then
    -- A new file: nobody has looked at it yet.
    new.review_status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;
    return new;
  end if;

  if current_user not in ('authenticated', 'anon') then
    return new;   -- review_waiver_upload() (owner), service_role, migrations
  end if;

  if tg_op = 'INSERT' then
    if new.review_status <> 'pending' or new.reviewed_by is not null
       or new.reviewed_at is not null or new.review_note is not null then
      raise exception 'A new waiver confirmation starts as awaiting check; camp staff review it.'
        using errcode = '42501';
    end if;
  elsif new.review_status is distinct from old.review_status
        or new.reviewed_by is distinct from old.reviewed_by
        or new.reviewed_at is distinct from old.reviewed_at
        or new.review_note is distinct from old.review_note then
    raise exception 'A waiver confirmation is accepted or rejected by camp staff, through review_waiver_upload().'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_waiver_upload_review() is
  'Invoker trigger on activity_waiver_uploads: a replaced file resets the review to pending; otherwise a signed-in caller cannot set the review columns (only review_waiver_upload() does). 0124.';

drop trigger if exists activity_waiver_uploads_review_guard on public.activity_waiver_uploads;
create trigger activity_waiver_uploads_review_guard
  before insert or update on public.activity_waiver_uploads
  for each row execute function public.guard_waiver_upload_review();

-- ---------------------------------------------------------------------------
-- 3. The staff review
-- ---------------------------------------------------------------------------
create or replace function public.review_waiver_upload(
  p_upload_id uuid,
  p_status    text,
  p_note      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- has_grant() reads auth.uid() from the request, not current_user, so it
  -- answers for the caller inside a definer function.
  if not public.has_grant('registration', 'write') then
    raise exception 'Only staff with Registration write can accept or reject a waiver confirmation.'
      using errcode = '42501';
  end if;
  if p_status not in ('accepted', 'rejected') then
    raise exception 'A waiver confirmation is accepted or rejected, not %.', coalesce(p_status, 'nothing');
  end if;
  if p_status = 'rejected' and v_note is null then
    raise exception 'Say why it cannot be accepted; the family reads the reason.';
  end if;

  update public.activity_waiver_uploads
     set review_status = p_status,
         reviewed_by   = (select auth.uid()),
         reviewed_at   = now(),
         review_note   = left(v_note, 500)
   where id = p_upload_id;
  if not found then
    raise exception 'That upload no longer exists -- the family may have removed it.';
  end if;
end;
$$;

comment on function public.review_waiver_upload(uuid, text, text) is
  'Registration write. Accept or reject one outside-provider waiver confirmation, stamped with the reviewer and time; a rejection needs the reason, which the family reads. 0124, 26 Oct 2026.';

revoke execute on function public.review_waiver_upload(uuid, text, text) from public, anon;
grant execute on function public.review_waiver_upload(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. activity_waivers_outstanding, restated in full (0120 + rejected uploads)
-- ---------------------------------------------------------------------------
create or replace view public.activity_waivers_outstanding
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
       ag.title     as agreement_title,
       null::text   as upload_status,
       null::text   as review_note
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
       null::text       as agreement_title,
       case when u.id is null then 'missing' else 'rejected' end as upload_status,
       u.review_note    as review_note
  from active_signups a
  left join public.activity_waiver_uploads u
    on u.registration_participant_id = a.registration_participant_id
   and u.activity_id = a.activity_id
 where (nullif(btrim(a.provider_name), '') is not null
        or nullif(btrim(a.provider_url), '') is not null)
   and (u.id is null or u.review_status = 'rejected');

comment on view public.activity_waivers_outstanding is
  'One row per active activity signup still missing its waiver: kind ours (no signature of the activity''s required internal agreement on this registration) or provider (no uploaded outfitter confirmation, or one staff rejected -- upload_status missing | rejected, review_note the reason). Pending and accepted uploads are not outstanding. Security invoker: families see their own rows, staff every row, through the tables'' RLS. 0120, restated 0124 (26 Oct 2026).';

revoke all on public.activity_waivers_outstanding from public, anon;
grant select on public.activity_waivers_outstanding to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Post-checks: the restatements took
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_viewdef('public.activity_waivers_outstanding'::regclass);
begin
  if position('rejected' in v_def) = 0 or position('review_status' in v_def) = 0 then
    raise exception '0124: activity_waivers_outstanding was not rewritten';
  end if;
  if not exists (select 1 from pg_class c where c.oid = 'public.activity_waivers_outstanding'::regclass
                  and 'security_invoker=true' = any (c.reloptions)) then
    raise exception '0124: activity_waivers_outstanding lost security_invoker';
  end if;
  if (select attnum from pg_attribute where attrelid = 'public.activity_waivers_outstanding'::regclass and attname = 'review_note')
     <> (select max(attnum) from pg_attribute where attrelid = 'public.activity_waivers_outstanding'::regclass and attnum > 0) then
    raise exception '0124: review_note is not the last column of activity_waivers_outstanding';
  end if;
  if not has_table_privilege('authenticated', 'public.activity_waivers_outstanding', 'select')
     or has_table_privilege('anon', 'public.activity_waivers_outstanding', 'select') then
    raise exception '0124: activity_waivers_outstanding grants are wrong';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'activity_waiver_uploads'
         and column_name in ('review_status', 'reviewed_by', 'reviewed_at', 'review_note')) <> 4 then
    raise exception '0124: the review columns are missing';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.activity_waiver_uploads'::regclass
                  and tgname = 'activity_waiver_uploads_review_guard' and tgenabled <> 'D') then
    raise exception '0124: the review guard trigger is missing';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.guard_waiver_upload_review()'::regprocedure) then
    raise exception '0124: guard_waiver_upload_review must run with the caller''s rights';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.review_waiver_upload(uuid, text, text)'::regprocedure)
     or position('has_grant(''registration'', ''write'')' in
                 pg_get_functiondef('public.review_waiver_upload(uuid, text, text)'::regprocedure)) = 0 then
    raise exception '0124: review_waiver_upload is not the Registration-write definer function';
  end if;
  if not has_function_privilege('authenticated', 'public.review_waiver_upload(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.review_waiver_upload(uuid, text, text)', 'execute') then
    raise exception '0124: review_waiver_upload grants are wrong';
  end if;
  if not (has_table_privilege('authenticated', 'public.activity_waiver_uploads', 'select')
          and has_table_privilege('authenticated', 'public.activity_waiver_uploads', 'insert')
          and has_table_privilege('authenticated', 'public.activity_waiver_uploads', 'update')
          and has_table_privilege('authenticated', 'public.activity_waiver_uploads', 'delete')) then
    raise exception '0124: families lost their 0087 grants on activity_waiver_uploads';
  end if;
end;
$$;
