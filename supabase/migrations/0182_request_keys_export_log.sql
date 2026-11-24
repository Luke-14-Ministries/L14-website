-- 0182_request_keys_export_log.sql
--
-- Two small records for staff money and staff downloads (security review,
-- 23 Nov 2026).
--
-- 1. A request key on hand-recorded payments and gifts.
--    The Record payment and Record gift forms sent nothing that tied a press
--    of the button to one row, so a slow connection and a second press (or
--    the same form submitted from two tabs) recorded the same check twice.
--    Refunds solved this in 0107: the form makes a one-time key when it
--    opens, and the database keeps it unique. The same now holds for
--    payments.request_key and gifts.request_key. The column is nullable, so
--    Stripe's webhook rows (which never carry one) and every row already on
--    file are untouched, and the index only covers rows that have a key.
--    A repeat answers 23505, which the actions turn into "This was already
--    recorded. Refresh the page." Staff already insert these rows through
--    payments_manual_insert / gifts_manual_insert; table-level INSERT covers
--    the new column, so no grant changes. Every payment write still lands in
--    money_change_log (0111), key included.
--
-- 2. export_log: who downloaded which CSV, when, with which filters.
--    Eight staff exports (balances, giving, event payments, rosters, buddies,
--    the newsletter list, activity groups, a program leader's roster) hand a
--    file of family details to whoever presses the link, and until now
--    nothing recorded that it happened. log_export() is the only writer: a
--    definer function that stamps the caller, refuses anyone who is neither
--    staff (strong session, is_staff()) nor an active program leader (the
--    my-program export), and takes only the eight kinds. The filters are the
--    export's own URL choices (event, status, dates, format), never names.
--    Administrators read it, like staff_access_log (0058): it is shown on the
--    Access Changes page. No signed-in INSERT, UPDATE or DELETE.

-- ---- 1. request keys -------------------------------------------------------

alter table public.payments add column if not exists request_key text;
alter table public.gifts add column if not exists request_key text;

comment on column public.payments.request_key is
  'One-time key from the staff Record payment form (0182); unique when set, so a doubled press records one payment.';
comment on column public.gifts.request_key is
  'One-time key from the staff Record gift form (0182); unique when set, so a doubled press records one gift.';

create unique index if not exists payments_request_key_unique
  on public.payments (request_key) where request_key is not null;
create unique index if not exists gifts_request_key_unique
  on public.gifts (request_key) where request_key is not null;

-- ---- 2. export_log ---------------------------------------------------------

create table if not exists public.export_log (
  id          bigint generated always as identity primary key,
  -- Kept when a login is deleted: the download still happened.
  profile_id  uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in (
                'balances', 'giving', 'payments', 'rosters',
                'buddies', 'newsletter', 'activity_groups', 'program_roster')),
  filters     jsonb not null default '{}'::jsonb,
  exported_at timestamptz not null default now()
);

comment on table public.export_log is
  'Each staff CSV download: who, when, which export, its URL filters (0182). Written only by log_export(); administrators read it.';

create index if not exists export_log_recent_idx on public.export_log (exported_at desc);

alter table public.export_log enable row level security;

drop policy if exists export_log_admin_read on public.export_log;
create policy export_log_admin_read on public.export_log
  for select to authenticated
  using (public.is_admin());

-- Read for the policy above; no signed-in writes (log_export() is the door).
-- The revoke first, in case a project's default privileges handed more out.
revoke all on public.export_log from anon, authenticated;
grant select on public.export_log to authenticated;
grant select, insert on public.export_log to service_role;

create or replace function public.log_export(p_kind text, p_filters jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;
  -- Staff (is_staff() already asks for a strong session), or a program
  -- leader holding an active grant (the my-program export), held to the
  -- same two-factor rule as leads_program().
  if not (
    public.is_staff()
    or (public.session_is_strong() and exists (
          select 1 from public.program_leaders pl
          where pl.profile_id = v_uid and pl.active))
  ) then
    raise exception 'Only staff can download an export.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in (
       'balances', 'giving', 'payments', 'rosters',
       'buddies', 'newsletter', 'activity_groups', 'program_roster') then
    raise exception 'Unknown export.' using errcode = '22023';
  end if;
  if p_filters is not null and jsonb_typeof(p_filters) <> 'object' then
    raise exception 'The filters must be a list of choices.' using errcode = '22023';
  end if;
  -- URL choices are short; anything longer is not a filter.
  if length(coalesce(p_filters, '{}'::jsonb)::text) > 2000 then
    raise exception 'Those filters are too long to record.' using errcode = '22023';
  end if;
  insert into public.export_log (profile_id, kind, filters)
  values (v_uid, p_kind, coalesce(p_filters, '{}'::jsonb));
end;
$$;

revoke all on function public.log_export(text, jsonb) from public, anon;
grant execute on function public.log_export(text, jsonb) to authenticated, service_role;

-- Post-checks: the grants are what the comments say.
do $$
begin
  if not has_table_privilege('authenticated', 'public.export_log', 'select')
     or has_table_privilege('authenticated', 'public.export_log', 'insert')
     or has_table_privilege('authenticated', 'public.export_log', 'update')
     or has_table_privilege('authenticated', 'public.export_log', 'delete')
     or has_function_privilege('anon', 'public.log_export(text, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.log_export(text, jsonb)', 'execute') then
    raise exception '0182: export_log grants are wrong';
  end if;
end;
$$;
