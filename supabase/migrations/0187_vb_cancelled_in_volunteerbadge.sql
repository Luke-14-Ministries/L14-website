-- 0187_vb_cancelled_in_volunteerbadge.sql
--
-- 25 Nov 2026 (Lawrence). VolunteerBadge's API has no call to cancel an
-- invite, but staff can cancel one whose check hasn't started from VB's own
-- dashboard. Taking an invite back here (cancelled), or replacing it with a
-- resend (superseded), leaves VB's link working, so the row keeps holding a
-- credit until the link runs out (lib/volunteerBadgeCredits.js). Now the board
-- asks staff to cancel it in VolunteerBadge too, and a button records that
-- they did. From then on the row no longer holds a credit.
--
--   vb_cancelled_at  when staff said it was cancelled in VolunteerBadge
--   vb_cancelled_by  who said so
--
-- The stamp is set here, never by the caller: it needs the Background checks
-- write grant, a taken-back or replaced row, and a sign-in. It is set once
-- and can't be changed or cleared afterwards (a wrong press stays on record).

begin;

alter table public.volunteerbadge_requests
  add column vb_cancelled_at timestamptz,
  add column vb_cancelled_by uuid references public.profiles (id) on delete set null;

comment on column public.volunteerbadge_requests.vb_cancelled_at is
  'When staff recorded that this taken-back or replaced invite was also cancelled in VolunteerBadge (0187). Set once, by the guard; frees its credit.';
comment on column public.volunteerbadge_requests.vb_cancelled_by is
  'Who recorded vb_cancelled_at (0187). Set by the guard from the signed-in user.';

create function public.guard_volunteerbadge_vb_cancel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.vb_cancelled_at := null;
    new.vb_cancelled_by := null;
    return new;
  end if;
  if new.vb_cancelled_at is not distinct from old.vb_cancelled_at
     and new.vb_cancelled_by is not distinct from old.vb_cancelled_by then
    return new;
  end if;
  if old.vb_cancelled_at is not null then
    raise exception 'This invite is already recorded as cancelled in VolunteerBadge.'
      using errcode = 'P0001';
  end if;
  if new.vb_cancelled_at is null then
    raise exception 'Set when it was cancelled in VolunteerBadge, or leave both columns alone.'
      using errcode = 'P0001';
  end if;
  if auth.uid() is null or not public.has_grant('background_checks', 'write') then
    raise exception 'Only staff with Background checks write can record that an invite was cancelled in VolunteerBadge.'
      using errcode = '42501';
  end if;
  if new.status not in ('cancelled', 'superseded') then
    raise exception 'Only an invite taken back or replaced here can be recorded as cancelled in VolunteerBadge.'
      using errcode = 'P0001';
  end if;
  new.vb_cancelled_at := now();
  new.vb_cancelled_by := auth.uid();
  return new;
end;
$$;

create trigger volunteerbadge_requests_vb_cancel
  before insert or update on public.volunteerbadge_requests
  for each row execute function public.guard_volunteerbadge_vb_cancel();

commit;
