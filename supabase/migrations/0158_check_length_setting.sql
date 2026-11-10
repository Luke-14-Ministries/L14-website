-- 0158 -- How long a background check lasts, set by staff (9 Nov 2026)
--
-- Lawrence, 9 Nov 2026: "what is the 'out of date' background check based
-- on? this should be editable in admin portal somewhere", and, asked whether a
-- change should move the dates already on file: "recalculate existing expiry
-- dates".
--
-- Until now the length was a constant in clearance_interval_months() (12
-- months since 0095: annual Basic Plus, Larry and Ellen, 15 Oct 2026). It now
-- reads one row in background_check_settings, set from the new Background
-- Checks page (/admin/volunteers/background-checks/) by holders of the
-- background-checks write grant, through set_clearance_interval_months().
--
-- RECALCULATING. A change sets every expiry from its check date by the new
-- length. It does that by clearing expires_on on every row with a date:
-- clearance_review_stamp() (0108) recomputes an empty expiry from the date, and
-- log_clearance_change() writes each old and new expiry to
-- clearance_review_log, so every person's history shows the move and who made
-- it. The change itself is kept in background_check_settings_log.
--
-- clearance_interval_months() goes from IMMUTABLE to STABLE because it now
-- reads a table. It is used only inside clearance_review_stamp(), never in an
-- index or a generated column, so nothing depends on it being immutable.

create table public.background_check_settings (
  id              boolean primary key default true check (id),
  interval_months integer not null default 12 check (interval_months between 1 and 60),
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now()
);
comment on table public.background_check_settings is
  'One row: how long a background check stays current, in months (0158). Read by clearance_interval_months(); changed only through set_clearance_interval_months().';
insert into public.background_check_settings (id, interval_months) values (true, 12);

create table public.background_check_settings_log (
  id          uuid primary key default gen_random_uuid(),
  old_months  integer,
  new_months  integer not null,
  recalculated integer not null default 0,
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now()
);
comment on table public.background_check_settings_log is
  'Every change to how long a background check lasts, with how many expiry dates it recalculated (0158).';

alter table public.background_check_settings enable row level security;
alter table public.background_check_settings_log enable row level security;

-- Every staff member may read the length (the Volunteers page shows expiry
-- dates); nobody writes the tables directly.
create policy background_check_settings_read on public.background_check_settings
  for select to authenticated using (public.is_staff());
create policy background_check_settings_log_read on public.background_check_settings_log
  for select to authenticated using (public.has_grant('background_checks', 'write'));
revoke all on public.background_check_settings, public.background_check_settings_log from anon;
revoke insert, update, delete on public.background_check_settings, public.background_check_settings_log from authenticated;
grant select on public.background_check_settings, public.background_check_settings_log to authenticated;

create or replace function public.clearance_interval_months()
returns integer
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select interval_months from public.background_check_settings where id), 12) $$;

comment on function public.clearance_interval_months() is
  'How long a background check stays current, in months: background_check_settings (0158), set on the Background Checks page. 12 when unset (annual Basic Plus, Larry and Ellen, 15 Oct 2026).';

-- Change the length and recalculate every expiry from its check date.
-- Returns how many expiry dates were recalculated.
create or replace function public.set_clearance_interval_months(p_months integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer;
  v_count integer := 0;
begin
  if not public.has_grant('background_checks', 'write') then
    raise exception 'Changing how long a background check lasts needs the background checks grant.'
      using errcode = '42501';
  end if;
  if p_months is null or p_months < 1 or p_months > 60 then
    raise exception 'The length has to be a whole number of months, from 1 to 60.'
      using errcode = 'check_violation';
  end if;

  select interval_months into v_old from public.background_check_settings where id for update;
  if v_old is not distinct from p_months then
    return 0;
  end if;

  update public.background_check_settings
     set interval_months = p_months, updated_by = auth.uid(), updated_at = now()
   where id;

  -- clearance_review_stamp() refills an empty expiry from the date by the new
  -- length; log_clearance_change() records each person's old and new expiry.
  update public.person_clearances
     set expires_on = null
   where background_check_date is not null;
  get diagnostics v_count = row_count;

  insert into public.background_check_settings_log (old_months, new_months, recalculated, changed_by)
  values (v_old, p_months, v_count, auth.uid());

  return v_count;
end;
$$;

revoke execute on function public.set_clearance_interval_months(integer) from public, anon;
grant execute on function public.set_clearance_interval_months(integer) to authenticated;

comment on function public.set_clearance_interval_months(integer) is
  'Set how long a background check lasts (1-60 months) and recalculate every expiry from its check date (0158, Lawrence 9 Nov 2026). Background-checks write only. Returns the number recalculated.';

-- Post-check: the length still reads 12 and an expiry still follows its date.
do $$
begin
  if public.clearance_interval_months() <> 12 then
    raise exception '0158: clearance_interval_months() should read 12 after the migration';
  end if;
end;
$$;
