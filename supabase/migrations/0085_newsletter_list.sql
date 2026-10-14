-- 0085: the newsletter list, for staff (14 Oct 2026, Lawrence).
--
-- Families opt in or out of "Ministry news & updates" on their contact page
-- (profiles.email_news, 0017). Staff had no way to see who is on the list or
-- who has recently joined or left it. This adds:
--
--   newsletter_preference_log   one row each time email_news changes
--   admin_newsletter_list()     name, login email and preference for every
--                               account, for registrars and above
--
-- The log is append-only and the trigger fires only when the value actually
-- changes, so a profile save that touches a phone number writes nothing.
-- The list function is SECURITY DEFINER because the login email lives in
-- auth.users, which staff cannot read directly; it checks is_registrar()
-- itself and returns nothing to anyone else. Newsletters themselves still go
-- out through Resend's own tools; this is the list, not the sender.

create table if not exists public.newsletter_preference_log (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  email_news  boolean not null,
  changed_at  timestamptz not null default now()
);
comment on table public.newsletter_preference_log is
  'One row each time a profile''s email_news preference changes. Append-only; written by trigger.';

alter table public.newsletter_preference_log enable row level security;

drop policy if exists newsletter_log_staff_read on public.newsletter_preference_log;
create policy newsletter_log_staff_read
  on public.newsletter_preference_log
  for select to authenticated
  using (public.is_registrar());

grant select on public.newsletter_preference_log to authenticated;

create or replace function public.log_newsletter_preference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_news is distinct from old.email_news then
    insert into public.newsletter_preference_log (profile_id, email_news)
    values (new.id, new.email_news);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_newsletter_log on public.profiles;
create trigger profiles_newsletter_log
  after update of email_news on public.profiles
  for each row execute function public.log_newsletter_preference();

create or replace function public.admin_newsletter_list()
returns table (
  profile_id  uuid,
  first_name  text,
  last_name   text,
  email       text,
  email_news  boolean,
  since       timestamptz
)
language sql
security definer
set search_path = public
as $$
  select p.id,
         p.first_name,
         p.last_name,
         u.email::text,
         p.email_news,
         coalesce(
           (select max(l.changed_at) from public.newsletter_preference_log l where l.profile_id = p.id),
           p.created_at
         ) as since
    from public.profiles p
    join auth.users u on u.id = p.id
   where public.is_registrar();
$$;

revoke all on function public.admin_newsletter_list() from public;
grant execute on function public.admin_newsletter_list() to authenticated;
