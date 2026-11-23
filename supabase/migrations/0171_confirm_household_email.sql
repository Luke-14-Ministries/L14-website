-- 0171 -- A family's new contact email is confirmed before it is used (23 Nov 2026)
--
-- Lawrence, 23 Nov 2026: the household contact email (households.email) saved
-- straight away, with only a format check. It is where the daily reminders and
-- staff emails go, and from now on where checkout sends receipts, so a typo
-- meant a family silently missed all of it. The login email already goes
-- through Supabase's own confirmation; this does the same for the contact one.
--
-- How it works:
--   * A family that asks for a new contact address gets a pending row here; the
--     old address stays in households.email, and keeps getting everything,
--     until the link sent to the new one is pressed.
--   * The family's own login email needs no link (Supabase confirmed it).
--   * The link carries a random token; only its SHA-256 hash is stored, and
--     nobody signed in can read that column.
--   * confirm_household_email_change() may be called without signing in (the
--     link may be opened on another device). Knowing the token is the proof.
--   * Staff with Registration write still set an address directly, as they do
--     today when a family phones in.
--   * guard_household_email() refuses a family's direct write of any other
--     address, so the confirmation cannot be skipped by writing the row.
--
-- Addresses on file before today are left as they are.

create table if not exists public.household_email_changes (
  household_id uuid primary key references public.households (id) on delete cascade,
  new_email text not null,
  token_hash text not null unique,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 days'
);

alter table public.household_email_changes enable row level security;

-- Families see their own pending change; staff who can read registrations see
-- any. Never the token hash: column grants leave it out.
create policy household_email_changes_select on public.household_email_changes
  for select to authenticated
  using (household_id in (select public.my_household_ids()) or public.has_grant('registration', 'read'));

revoke all on public.household_email_changes from public, anon, authenticated;
grant select (household_id, new_email, requested_at, expires_at) on public.household_email_changes to authenticated;
-- No signed-in insert, update or delete: the functions below are the only way.


-- The guard. SECURITY INVOKER on purpose (0105's lesson): it must see the
-- caller as `authenticated`, and inside the definer functions below it sees
-- their owner instead, which is how they get through.
create or replace function public.guard_household_email()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_login text := lower(nullif(trim((select auth.jwt()) ->> 'email'), ''));
  v_new text := lower(nullif(trim(new.email), ''));
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'UPDATE' and v_new is not distinct from lower(nullif(trim(old.email), '')) then
    return new;
  end if;
  if v_new is null or v_new = v_login then return new; end if;
  if public.has_grant('registration', 'write') then return new; end if;
  raise exception 'A new contact email has to be confirmed first. Save it on the Household page and press the link we email to it.';
end;
$$;

drop trigger if exists households_guard_email on public.households;
create trigger households_guard_email
  before insert or update of email on public.households
  for each row execute function public.guard_household_email();


-- Ask for a change. The site makes the token, emails the link and passes only
-- the hash. Returns 'unchanged', 'applied' (their own login email: set now) or
-- 'pending' (a link is needed).
create or replace function public.request_household_email_change(
  p_household_id uuid,
  p_email text,
  p_token_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(nullif(trim(p_email), ''));
  v_login text := lower(nullif(trim((select auth.jwt()) ->> 'email'), ''));
  v_current text;
  v_last timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.household_members hm
     where hm.household_id = p_household_id and hm.profile_id = v_uid
  ) then
    raise exception 'That is not your household.';
  end if;
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'That email address doesn''t look right. Please check it.';
  end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'bad token';
  end if;

  select lower(nullif(trim(h.email), '')) into v_current
    from public.households h where h.id = p_household_id;

  if v_email = v_current then
    delete from public.household_email_changes where household_id = p_household_id;
    return 'unchanged';
  end if;

  if v_email = v_login then
    update public.households set email = v_email where id = p_household_id;
    delete from public.household_email_changes where household_id = p_household_id;
    return 'applied';
  end if;

  -- One link a minute is plenty, and stops the button being used to send
  -- mail to a stranger over and over.
  select c.requested_at into v_last
    from public.household_email_changes c where c.household_id = p_household_id;
  if v_last is not null and v_last > now() - interval '1 minute' then
    raise exception 'We just sent a link. Please wait a minute before asking for another.';
  end if;

  insert into public.household_email_changes (household_id, new_email, token_hash, requested_by)
  values (p_household_id, v_email, p_token_hash, v_uid)
  on conflict (household_id) do update
    set new_email = excluded.new_email,
        token_hash = excluded.token_hash,
        requested_by = excluded.requested_by,
        requested_at = now(),
        expires_at = now() + interval '3 days';
  return 'pending';
end;
$$;

revoke all on function public.request_household_email_change(uuid, text, text) from public, anon;
grant execute on function public.request_household_email_change(uuid, text, text) to authenticated;


create or replace function public.cancel_household_email_change(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.household_members hm
     where hm.household_id = p_household_id and hm.profile_id = auth.uid()
  ) and not public.has_grant('registration', 'write') then
    raise exception 'That is not your household.';
  end if;
  delete from public.household_email_changes where household_id = p_household_id;
end;
$$;

revoke all on function public.cancel_household_email_change(uuid) from public, anon;
grant execute on function public.cancel_household_email_change(uuid) to authenticated;


-- Press the link. Returns the address now in use, or null when the link is
-- unknown, used or out of date.
create or replace function public.confirm_household_email_change(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.household_email_changes;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into v_row
    from public.household_email_changes c
   where c.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if not found then return null; end if;
  if v_row.expires_at < now() then
    delete from public.household_email_changes where household_id = v_row.household_id;
    return null;
  end if;
  update public.households set email = v_row.new_email where id = v_row.household_id;
  delete from public.household_email_changes where household_id = v_row.household_id;
  return v_row.new_email;
end;
$$;

revoke all on function public.confirm_household_email_change(text) from public;
grant execute on function public.confirm_household_email_change(text) to anon, authenticated;
