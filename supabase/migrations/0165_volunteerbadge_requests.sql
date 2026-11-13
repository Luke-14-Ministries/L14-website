-- 0165_volunteerbadge_requests.sql
--
-- Volunteer background checks move from Checkr's batch file to VolunteerBadge
-- (VB), through VB's API (Lawrence, 12-13 Nov 2026; Larry approved VB). The
-- ministry buys credits; staff send invites in batches from Background
-- screening; the volunteer signs VB's FCRA consent and types their own ID and
-- Social Security number on VB's site. Nothing about the person beyond the
-- address the invite went to ever leaves this site, and nothing from the
-- report comes back: pointers and words only (CLAUDE.md, "No Social Security
-- number, and no report content, ever enters this system").
--
-- Lawrence's three decisions:
--   1. Results come back by THIS SITE ASKING VB (a Refresh button). No webhook:
--      VB never calls us.
--   2. A "clear" result does not set OK to serve by itself. Staff with the
--      background-checks write grant confirm it with one click
--      (confirm_volunteerbadge_clear below). "Consider" is read in VB's portal
--      and decided with the existing verdict controls.
--   3. VB replaces the Checkr batch steps on the screen. Checkr results stay on
--      file and count until they expire; the Checkr columns stay.
--
-- volunteerbadge_requests: one row per invite, written BEFORE the API call
-- (status 'sending'), so a retry or a double click can't invite twice: the
-- partial unique indexes allow one open invite per person and per address.
--
-- TEST MODE IS NOT THE LIVE DATABASE'S BUSINESS -- EXCEPT IT IS. Vercel Preview
-- deployments run with a VB sandbox key against THIS database (there is one
-- Supabase project). A sandbox "clear" is simulated, so every row records
-- `sandbox`, the open-invite indexes count live and test rows apart, and the
-- confirm function refuses a sandbox row outright. The screen shows only the
-- rows of the mode its key is in.
--
-- Access: the background-checks write grant, the same as person_clearances
-- (can_view_background_checks(), 0058/0101). No delete: the row is the record
-- of who was invited when, and by whom.

-- ---------------------------------------------------------------------------
-- 1. The provider word
-- ---------------------------------------------------------------------------
alter table public.person_clearances
  drop constraint if exists person_clearances_provider_check;
alter table public.person_clearances
  add constraint person_clearances_provider_check
  check (provider in ('manual', 'checkr', 'registry_search', 'volunteerbadge'));

comment on column public.person_clearances.provider is
  'How the check on file was done: checkr / volunteerbadge / manual = a full background check; registry_search = a sex-offender registry search, which never clears a volunteer (0161/0162). volunteerbadge since 0165, written only by confirm_volunteerbadge_clear().';

-- ---------------------------------------------------------------------------
-- 2. The requests
-- ---------------------------------------------------------------------------
create table public.volunteerbadge_requests (
  id                  uuid primary key default gen_random_uuid(),
  person_id           uuid not null references public.people (id) on delete cascade,
  -- The address actually sent, frozen (the 0057 lesson): results are matched
  -- on it, and people.email is live.
  invited_email       text not null check (invited_email = lower(btrim(invited_email)) and invited_email like '%@%'),
  sandbox             boolean not null,
  status              text not null default 'sending' check (status in (
                        'sending',    -- row written, API call not answered yet
                        'invited',    -- VB accepted the invite
                        'applied',    -- the person is on VB's roster; no check linked yet
                        'processing', -- check running
                        'in_review',  -- VB's reviewer is checking possible records
                        'clear',      -- result clear (staff confirm OK to serve)
                        'consider',   -- records released: read in VB, decide here
                        'error',      -- check failed or refunded; credit returned
                        'expired',    -- the invite lapsed with no application
                        'not_sent',   -- VB refused the invite (the reason is kept)
                        'cancelled',  -- staff took it back here (not in VB)
                        'superseded'  -- replaced by a resend without the ID step
                      )),
  vb_application_id   text unique,
  vb_volunteer_id     text,
  vb_check_id         text,
  -- VB's own words, verbatim, for the record: check status and result.
  vb_check_status     text check (vb_check_status is null or char_length(vb_check_status) <= 40),
  vb_result           text check (vb_result is null or vb_result in ('clear', 'consider')),
  apply_expires_at    timestamptz,
  completed_at        timestamptz,
  -- Why VB refused an invite (its message about OUR request, e.g. a bad
  -- address), or why a check failed in its short words. Never report content.
  problem             text check (problem is null or char_length(problem) <= 300),
  -- Staff's per-person "Resend without the ID step" (Lawrence, 13 Nov 2026):
  -- VB's photo-ID-and-selfie step skipped for this invite only, with the
  -- reason sent to VB as idVerificationReason. Who and when are sent_by and
  -- sent_at. Every other invite leaves VB's account setting (ID step on).
  id_verification_waived boolean not null default false,
  id_verification_reason text check (id_verification_reason is null or char_length(id_verification_reason) between 10 and 300),
  sent_by             uuid references public.profiles (id) on delete set null,
  sent_at             timestamptz not null default now(),
  last_checked_at     timestamptz,
  confirmed_by        uuid references public.profiles (id) on delete set null,
  confirmed_at        timestamptz,
  updated_at          timestamptz not null default now(),
  check (confirmed_at is null or status = 'clear'),
  check (id_verification_waived = (id_verification_reason is not null)),
  -- A sandbox key still makes VB email a (test) invite: staff addresses only.
  check (not sandbox or invited_email like '%@luke14ministries.net')
);

comment on table public.volunteerbadge_requests is
  'One VolunteerBadge invite per row (0165): who, the address sent, VB''s ids and status words, and who sent and confirmed it. Pointers and words only: never the report, its links, an SSN or a date of birth. Background-checks write grant.';
comment on column public.volunteerbadge_requests.id_verification_waived is
  'Sent with VB''s ID step skipped (requireIdVerification false), by staff for this one person, with the reason in id_verification_reason. The check ran without ID verification.';
comment on column public.volunteerbadge_requests.sandbox is
  'Sent with a vb_test_ key: simulated, never clears anyone (confirm_volunteerbadge_clear refuses it).';

-- One open invite per person, and per address, in each mode.
create unique index volunteerbadge_requests_one_open_per_person
  on public.volunteerbadge_requests (person_id, sandbox)
  where status in ('sending', 'invited', 'applied', 'processing', 'in_review');
create unique index volunteerbadge_requests_one_open_per_email
  on public.volunteerbadge_requests (invited_email, sandbox)
  where status in ('sending', 'invited', 'applied', 'processing', 'in_review');
-- One VB check answers one invite: the same check can never be tied to two
-- people (review, 13 Nov 2026).
create unique index volunteerbadge_requests_one_check
  on public.volunteerbadge_requests (vb_check_id, sandbox)
  where vb_check_id is not null;
create index volunteerbadge_requests_person_idx
  on public.volunteerbadge_requests (person_id, sent_at desc);

alter table public.volunteerbadge_requests enable row level security;

create policy volunteerbadge_requests_select on public.volunteerbadge_requests
  for select to authenticated using (public.can_view_background_checks());
create policy volunteerbadge_requests_insert on public.volunteerbadge_requests
  for insert to authenticated with check (public.can_view_background_checks());
create policy volunteerbadge_requests_update on public.volunteerbadge_requests
  for update to authenticated
  using (public.can_view_background_checks())
  with check (public.can_view_background_checks());

grant select, insert, update on public.volunteerbadge_requests to authenticated;
-- The daily job (service role) reads and updates; it never invites.
grant select, update on public.volunteerbadge_requests to service_role;

-- ---------------------------------------------------------------------------
-- 3. The guard: who may be invited, and what never changes
-- ---------------------------------------------------------------------------
-- Invoker (the trigger asks about the caller's own request); it reads only
-- people and person_not_permitted(), both open to the staff who reach here.
create function public.guard_volunteerbadge_request()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_dob  date;
  v_name text;
begin
  if tg_op = 'INSERT' then
    select p.date_of_birth,
           coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'This person')
      into v_dob, v_name
      from public.people p where p.id = new.person_id;
    if public.person_not_permitted(new.person_id) then
      raise exception '% is marked Not permitted to attend, so no background check invite is sent.', v_name
        using errcode = 'P0001';
    end if;
    -- The 0056 rule: an unknown age is not an adult.
    if v_dob is null then
      raise exception 'Cannot invite % without a date of birth on file. Add it first.', v_name
        using errcode = 'check_violation';
    end if;
    if v_dob > (current_date - interval '18 years')::date then
      raise exception 'Cannot invite % -- they are under 18. Background checks are for adults.', v_name
        using errcode = 'check_violation';
    end if;
    new.status := 'sending';
    new.sent_at := now();
    new.sent_by := auth.uid();
    new.confirmed_at := null;
    new.confirmed_by := null;
  else
    if new.person_id is distinct from old.person_id
       or new.invited_email is distinct from old.invited_email
       or new.sandbox is distinct from old.sandbox
       or new.sent_at is distinct from old.sent_at
       or new.sent_by is distinct from old.sent_by
       or new.id_verification_waived is distinct from old.id_verification_waived
       or new.id_verification_reason is distinct from old.id_verification_reason then
      raise exception 'Who was invited, where, when, by whom and how can''t be changed on a VolunteerBadge request.'
        using errcode = 'P0001';
    end if;
    -- Confirming is the function's job (it checks the result first).
    if (new.confirmed_at is distinct from old.confirmed_at or new.confirmed_by is distinct from old.confirmed_by)
       and coalesce(current_setting('l14.vb_confirming', true), '') <> 'yes' then
      raise exception 'A VolunteerBadge result is confirmed only with the OK to serve button.'
        using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger volunteerbadge_requests_guard
  before insert or update on public.volunteerbadge_requests
  for each row execute function public.guard_volunteerbadge_request();

-- ---------------------------------------------------------------------------
-- 4. OK to serve, from a clear result (decision 2)
-- ---------------------------------------------------------------------------
-- Invoker: the caller's own RLS on both tables applies, and the stamps
-- (verdict_by, paperwork_marked_by) name them. The check date is VB's
-- completion day in ministry time; the expiry follows by the setting
-- (clearance_review_stamp, 0158) because expires_on is cleared.
create function public.confirm_volunteerbadge_clear(p_request_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r      public.volunteerbadge_requests;
  v_date date;
begin
  if not public.has_grant('background_checks', 'write') then
    raise exception 'Only staff with Background checks write can confirm a result.' using errcode = '42501';
  end if;
  select * into r from public.volunteerbadge_requests where id = p_request_id for update;
  if not found then
    raise exception 'That VolunteerBadge request wasn''t found.' using errcode = 'P0001';
  end if;
  if r.sandbox then
    raise exception 'This is a VolunteerBadge test result (sandbox key), so it can''t clear anyone.' using errcode = 'P0001';
  end if;
  if r.confirmed_at is not null then
    return;  -- already done: a second click changes nothing
  end if;
  if r.status <> 'clear' or r.vb_result is distinct from 'clear' or r.vb_check_id is null then
    raise exception 'Only a clear VolunteerBadge result can be confirmed here.' using errcode = 'P0001';
  end if;
  if r.completed_at is null then
    raise exception 'The result has no completion date yet. Check VolunteerBadge for updates first.' using errcode = 'P0001';
  end if;
  if public.person_not_permitted(r.person_id) then
    raise exception 'This person is marked Not permitted to attend. Change that on their Volunteers entry first if the ministry has decided otherwise.'
      using errcode = 'P0001';
  end if;

  v_date := (r.completed_at at time zone 'America/New_York')::date;

  insert into public.person_clearances
    (person_id, provider, screening_reason, background_check_on_file, background_check_date,
     expires_on, verdict, report_completed_at, last_synced_at)
  values
    (r.person_id, 'volunteerbadge', 'volunteer', true, v_date, null, 'ok', r.completed_at, now())
  on conflict (person_id) do update set
    provider                 = 'volunteerbadge',
    screening_reason         = 'volunteer',
    background_check_on_file = true,
    background_check_date    = excluded.background_check_date,
    expires_on               = null,
    verdict                  = 'ok',
    verdict_note             = null,
    report_completed_at      = excluded.report_completed_at,
    last_synced_at           = now();

  perform set_config('l14.vb_confirming', 'yes', true);
  update public.volunteerbadge_requests
     set confirmed_at = now(), confirmed_by = auth.uid()
   where id = r.id;
  perform set_config('l14.vb_confirming', '', true);
end;
$$;

comment on function public.confirm_volunteerbadge_clear(uuid) is
  'OK to serve from a clear VolunteerBadge result (0165): Background checks write; refuses a sandbox row, anything but a clear result, and anyone marked Not permitted. Writes person_clearances (provider volunteerbadge, the completion day, verdict ok; expiry by the setting).';

revoke all on function public.confirm_volunteerbadge_clear(uuid) from public, anon;
grant execute on function public.confirm_volunteerbadge_clear(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.confirm_volunteerbadge_clear(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.confirm_volunteerbadge_clear(uuid)', 'execute') then
    raise exception '0165: confirm_volunteerbadge_clear grants are wrong';
  end if;
end;
$$;
