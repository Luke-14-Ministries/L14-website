-- 0170_vb_templates_and_family_adults.sql
--
-- Every adult 18+ is checked through VolunteerBadge by default (the board,
-- 14 Nov 2026; Lawrence: "keep families and volunteers segregated, but replace
-- the sex offender registry search flow with the VB flow ... keep that flow
-- (just deprecated/collapsed)"). The registry search stays as the fallback for
-- anyone who declines, and for adult campers until VolunteerBadge says how a
-- guardian completes one.
--
-- 1. Which VolunteerBadge application template each group gets: volunteers
--    and family adults (VB's "VOLUNTEER" and "CAMPERS" templates today, the
--    same for now). Two columns on the one-row background_check_settings
--    (0158), set only through set_vb_templates() by the Background checks
--    write grant, from the screening page. Null = VB's default template.
-- 2. confirm_volunteerbadge_clear() (0167) restated: the check is recorded
--    as screening_reason 'volunteer' for someone with a volunteer place on an
--    upcoming event, else 'adult_participant'. Everything else as 0167.

-- ---------------------------------------------------------------------------
-- 1. Templates per group
-- ---------------------------------------------------------------------------
alter table public.background_check_settings
  add column if not exists vb_template_volunteer text
    check (vb_template_volunteer is null or vb_template_volunteer ~ '^[A-Za-z0-9_-]{1,100}$'),
  add column if not exists vb_template_family text
    check (vb_template_family is null or vb_template_family ~ '^[A-Za-z0-9_-]{1,100}$');

comment on column public.background_check_settings.vb_template_volunteer is
  'VolunteerBadge application template id for volunteers (0170); null = VB''s default. Set with set_vb_templates().';
comment on column public.background_check_settings.vb_template_family is
  'VolunteerBadge application template id for family adults (0170); null = VB''s default. Set with set_vb_templates().';

create or replace function public.set_vb_templates(p_volunteer text, p_family text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_grant('background_checks', 'write') then
    raise exception 'Only staff with Background checks write can choose the templates.' using errcode = '42501';
  end if;
  update public.background_check_settings
     set vb_template_volunteer = nullif(btrim(coalesce(p_volunteer, '')), ''),
         vb_template_family    = nullif(btrim(coalesce(p_family, '')), ''),
         updated_by            = auth.uid(),
         updated_at            = now()
   where id;
end;
$$;

revoke all on function public.set_vb_templates(text, text) from public, anon;
grant execute on function public.set_vb_templates(text, text) to authenticated;

comment on function public.set_vb_templates(text, text) is
  'Which VolunteerBadge template volunteers and family adults get (0170). Background checks write.';

-- ---------------------------------------------------------------------------
-- 2. confirm_volunteerbadge_clear() (0167, restated)
-- ---------------------------------------------------------------------------
create or replace function public.confirm_volunteerbadge_clear(p_request_id uuid)
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
  v_reason text;
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

  -- 0170: a family adult's check (the board's 14 Nov 2026 decision) is an
  -- adult participant's screening; a volunteer's stays 'volunteer'.
  v_reason := case when exists (
      select 1 from public.registration_participants rp
        join public.registrations rg on rg.id = rp.registration_id
        join public.events ev on ev.id = rg.event_id
       where rp.person_id = r.person_id and rp.status <> 'cancelled'
         and rp.camp_role in ('volunteer', 'volunteer_child')
         and ev.ends_on >= v_today and ev.archived_at is null)
    then 'volunteer' else 'adult_participant' end;

  if v_note is null then
    insert into public.person_clearances
      (person_id, provider, screening_reason, background_check_on_file, background_check_date,
       expires_on, verdict, report_completed_at, last_synced_at)
    values
      (r.person_id, 'volunteerbadge', v_reason, true, v_date, null, 'ok', r.completed_at, now())
    on conflict (person_id) do update set
      provider                 = 'volunteerbadge',
      screening_reason         = excluded.screening_reason,
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
  'OK to serve from a clear VolunteerBadge result (0165, 0167, 0170): Background checks write; refuses a sandbox row, anything but a clear result, a completion date that doesn''t fit the invite, anyone marked Not permitted, and a newer check on file that is Follow up or undecided. Records a volunteer''s check as screening_reason volunteer and a family adult''s as adult_participant (0170).';

do $$
begin
  if has_function_privilege('anon', 'public.confirm_volunteerbadge_clear(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.confirm_volunteerbadge_clear(uuid)', 'execute')
     or has_function_privilege('anon', 'public.set_vb_templates(text, text)', 'execute') then
    raise exception '0170: grants are wrong';
  end if;
end;
$$;
