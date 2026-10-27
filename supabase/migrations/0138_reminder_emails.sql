-- 0138_reminder_emails.sql
--
-- The automatic emails (Lawrence, 27 Oct 2026: "build all the rest of the
-- email drafts and triggers as proposed"; the wording and schedule are
-- 01 Plans and Decisions\Luke14-Automatic-Emails-Draft.pdf). The daily job is
-- the website's own (app/api/cron/reminders, Vercel Cron, lib/reminders/), so
-- it reads the same rules the dashboard reads. What the database adds:
--
-- 1. reminder_sends -- one row per thing the job has told a family (or staff)
--    about, keyed (kind, item_key), so nothing is said twice: a one-time
--    notice carries a key of its own (a participant's confirmation, a plan
--    installment's coming payment), a recurring reminder carries the date in
--    its key. Written only by the job (service_role); staff with Registration
--    read see them. status 'skipped' = the job's test mode held it back.
-- 2. reminder_pauses -- "Pause reminders" on a registration, for a family
--    staff are already talking to. Written only through set_reminder_pause()
--    (Registration write; who and when stamped here); Registration read sees
--    it. A pause stops the deposit, balance, past-due, missing-details and
--    not-submitted reminders; confirmations and payment-plan notices still go.
-- 3. registration_participants.status_before -- the status a person had
--    before the last change, so "off the waitlist" can be told from "newly
--    confirmed". Set by its own trigger, never by hand. 0128's
--    stamp_participant_status() is not restated; this trigger sorts after it.

-- ---------------------------------------------------------------------------
-- 1. reminder_sends
-- ---------------------------------------------------------------------------
create table public.reminder_sends (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in (
                    'plan_upcoming', 'plan_finished', 'card_expiring',
                    'deposit', 'balance', 'past_due', 'missing_details',
                    'confirmed', 'off_waitlist', 'not_submitted',
                    'staff_summary')),
  item_key        text not null check (char_length(item_key) between 1 and 200),
  household_id    uuid references public.households (id) on delete set null,
  registration_id uuid references public.registrations (id) on delete set null,
  sent_on         date not null,
  status          text not null check (status in ('sent', 'skipped')),
  message_log_id  uuid references public.message_log (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (kind, item_key)
);

comment on table public.reminder_sends is
  'What the automatic-email job has said, once per (kind, item_key) (0138). Written by the job only (service_role); Registration read sees it.';

alter table public.reminder_sends enable row level security;
create policy reminder_sends_select on public.reminder_sends
  for select to authenticated
  using (public.has_grant('registration', 'read'));
grant select on public.reminder_sends to authenticated;
grant select, insert, update, delete on public.reminder_sends to service_role;

create index reminder_sends_registration_idx on public.reminder_sends (registration_id);

-- ---------------------------------------------------------------------------
-- 2. reminder_pauses and set_reminder_pause()
-- ---------------------------------------------------------------------------
create table public.reminder_pauses (
  registration_id uuid primary key references public.registrations (id) on delete cascade,
  paused_by       uuid references public.profiles (id) on delete set null,
  paused_at       timestamptz not null default now(),
  note            text check (note is null or char_length(note) <= 500)
);

comment on table public.reminder_pauses is
  'Reminders paused for a registration (0138): no deposit, balance, past-due, missing-details or not-submitted reminders. Written only through set_reminder_pause().';

alter table public.reminder_pauses enable row level security;
create policy reminder_pauses_select on public.reminder_pauses
  for select to authenticated
  using (public.has_grant('registration', 'read'));
grant select on public.reminder_pauses to authenticated;
grant select on public.reminder_pauses to service_role;

create function public.set_reminder_pause(p_registration_id uuid, p_paused boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- has_grant() reads auth.uid() from the request, so it answers for the
  -- caller inside a definer function (0134's note).
  if not public.has_grant('registration', 'write') then
    raise exception 'Only staff with Registration write can pause reminders.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.registrations where id = p_registration_id) then
    raise exception 'No such registration.' using errcode = '22023';
  end if;
  if p_paused then
    insert into public.reminder_pauses (registration_id, paused_by, paused_at, note)
    values (p_registration_id, (select auth.uid()), clock_timestamp(), nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (registration_id) do update
      set paused_by = excluded.paused_by,
          paused_at = excluded.paused_at,
          note      = excluded.note;
  else
    delete from public.reminder_pauses where registration_id = p_registration_id;
  end if;
end;
$$;

comment on function public.set_reminder_pause(uuid, boolean, text) is
  'Registration write. Pauses or resumes the automatic reminders for one registration, stamping who and when (0138).';

revoke execute on function public.set_reminder_pause(uuid, boolean, text) from public, anon;
grant execute on function public.set_reminder_pause(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. registration_participants.status_before
-- ---------------------------------------------------------------------------
alter table public.registration_participants
  add column status_before text;

comment on column public.registration_participants.status_before is
  'The status before the last change (0138), so a confirmation can say "off the waitlist". Set by trigger only.';

create function public.stamp_participant_status_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.status_before := null;
  elsif new.status is distinct from old.status then
    new.status_before := old.status;
  else
    new.status_before := old.status_before;
  end if;
  return new;
end;
$$;

-- "zzz" sorts after 0128's registration_participants_zz_status_stamp, so this
-- sees the status that will be stored.
create trigger registration_participants_zzz_status_before
  before insert or update on public.registration_participants
  for each row execute function public.stamp_participant_status_before();

do $$
begin
  if has_function_privilege('anon', 'public.set_reminder_pause(uuid, boolean, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_reminder_pause(uuid, boolean, text)', 'execute') then
    raise exception '0138: set_reminder_pause grants are wrong';
  end if;
  if has_table_privilege('authenticated', 'public.reminder_sends', 'INSERT')
     or has_table_privilege('authenticated', 'public.reminder_pauses', 'INSERT') then
    raise exception '0138: reminder tables must stay read-only for signed-in callers';
  end if;
end;
$$;
