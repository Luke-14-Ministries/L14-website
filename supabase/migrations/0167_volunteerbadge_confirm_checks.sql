-- 0167_volunteerbadge_confirm_checks.sql
--
-- OK to serve from a VolunteerBadge result checks VB's completion date and
-- doesn't overwrite a better record (Lawrence, 14 Nov 2026: "Yes, have the
-- website session do 0167"). confirm_volunteerbadge_clear() (0165) is
-- restated in full. It keeps everything 0165 refused: the write grant, a
-- sandbox row, anything but a clear result, no completion date, Not
-- permitted, and a second click changing nothing. New:
--
--   1. The completion date must fit the invite: no earlier than the invite
--      was sent (less the same 10 minutes of clock grace as GRACE_MS in
--      lib/volunteerBadgeApi.js), and no later than a day from now.
--   2. A check already on file with a LATER date than VB's completion day
--      (ministry time) wins over this one:
--        - current, verdict ok, a full check: left alone (date, provider,
--          verdict, expiry); the request is still stamped confirmed, and the
--          function returns words for staff saying the newer date was kept;
--        - verdict follow_up, or on file with no decision yet: refused, and
--          never turned into ok. Staff decide it on the person's entry.
--      An older or same-day check, an expired one, or a registry search
--      (never a volunteer's check, 0161/0162) is overwritten as before.
--
-- The return type changes from void to text (null, or the words above), so
-- the function is dropped and created again, with its grants.

drop function if exists public.confirm_volunteerbadge_clear(uuid);

create function public.confirm_volunteerbadge_clear(p_request_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  r      public.volunteerbadge_requests;
  c      public.person_clearances;
  v_date date;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_note text := null;
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
    return null;  -- already done: a second click changes nothing
  end if;
  if r.status <> 'clear' or r.vb_result is distinct from 'clear' or r.vb_check_id is null then
    raise exception 'Only a clear VolunteerBadge result can be confirmed here.' using errcode = 'P0001';
  end if;
  if r.completed_at is null then
    raise exception 'The result has no completion date yet. Check VolunteerBadge for updates first.' using errcode = 'P0001';
  end if;
  -- 1. The completion date must fit this invite.
  if r.completed_at < r.sent_at - interval '10 minutes' or r.completed_at > now() + interval '1 day' then
    raise exception 'VolunteerBadge''s completion date doesn''t fit this invite. Check it in VolunteerBadge and record the result by hand.'
      using errcode = 'P0001';
  end if;
  if public.person_not_permitted(r.person_id) then
    raise exception 'This person is marked Not permitted to attend. Change that on their Volunteers entry first if the ministry has decided otherwise.'
      using errcode = 'P0001';
  end if;

  v_date := (r.completed_at at time zone 'America/New_York')::date;

  -- 2. A newer check already on file.
  select * into c from public.person_clearances where person_id = r.person_id for update;
  if found
     and c.background_check_on_file
     and c.background_check_date is not null
     and c.background_check_date > v_date
     and c.provider is distinct from 'registry_search' then
    if c.verdict = 'follow_up' then
      raise exception 'A newer check (%) is on file and marked Follow up. Decide it on their Volunteers entry; this result wasn''t recorded.',
        to_char(c.background_check_date, 'FMMonth FMDD, YYYY') using errcode = 'P0001';
    end if;
    if c.verdict is null then
      raise exception 'A newer check (%) is on file with no decision yet. Decide it on their Volunteers entry; this result wasn''t recorded.',
        to_char(c.background_check_date, 'FMMonth FMDD, YYYY') using errcode = 'P0001';
    end if;
    if c.verdict = 'ok' and (c.expires_on is null or c.expires_on >= v_today) then
      v_note := format('A newer check (%s) is already on file, so its date was kept.',
                       to_char(c.background_check_date, 'FMMonth FMDD, YYYY'));
    end if;
  end if;

  if v_note is null then
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
  end if;

  perform set_config('l14.vb_confirming', 'yes', true);
  update public.volunteerbadge_requests
     set confirmed_at = now(), confirmed_by = auth.uid()
   where id = r.id;
  perform set_config('l14.vb_confirming', '', true);
  return v_note;
end;
$$;

comment on function public.confirm_volunteerbadge_clear(uuid) is
  'OK to serve from a clear VolunteerBadge result (0165, 0167): Background checks write; refuses a sandbox row, anything but a clear result, a completion date that doesn''t fit the invite (before it was sent less 10 minutes, or over a day ahead), anyone marked Not permitted, and a newer check on file that is Follow up or undecided. A newer current ok full check is kept and the words saying so are returned; otherwise writes person_clearances (provider volunteerbadge, the completion day, verdict ok; expiry by the setting) and returns null.';

revoke all on function public.confirm_volunteerbadge_clear(uuid) from public, anon;
grant execute on function public.confirm_volunteerbadge_clear(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.confirm_volunteerbadge_clear(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.confirm_volunteerbadge_clear(uuid)', 'execute') then
    raise exception '0167: confirm_volunteerbadge_clear grants are wrong';
  end if;
end;
$$;

notify pgrst, 'reload schema';
