-- 0172 -- The newsletter goes to the household's contact email (23 Nov 2026)
--
-- Lawrence, 23 Nov 2026: one rule for families. Everything the ministry sends
-- goes to the household's contact email (households.email, confirmed before use
-- since 0171); the sign-in email is only for signing in and password resets.
-- The newsletter list (0085) still used each person's sign-in email, so a family
-- got camp email at one address and the newsletter at another.
--
-- admin_newsletter_list() keeps its columns; `email` is now the household's
-- contact email, falling back to the sign-in email for a login with no household
-- or a household with none. Restated in full, with 0101's grant check
-- (Registration read) written out rather than rewritten in place.
--
-- The preference itself stays per person (profiles.email_news): if one of two
-- parents ticks it, the shared contact address gets the newsletter.

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
         coalesce(
           (select nullif(trim(h.email), '')
              from public.household_members hm
              join public.households h on h.id = hm.household_id
             where hm.profile_id = p.id
             order by hm.household_id
             limit 1),
           u.email::text
         ) as email,
         p.email_news,
         coalesce(
           (select max(l.changed_at) from public.newsletter_preference_log l where l.profile_id = p.id),
           p.created_at
         ) as since
    from public.profiles p
    join auth.users u on u.id = p.id
   where public.has_grant('registration', 'read');
$$;

revoke all on function public.admin_newsletter_list() from public, anon;
grant execute on function public.admin_newsletter_list() to authenticated;
