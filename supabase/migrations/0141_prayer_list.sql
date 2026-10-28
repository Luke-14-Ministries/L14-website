-- 0141_prayer_list.sql
--
-- The prayer list (Lawrence, 28 Oct 2026): people sign up on the Pray page
-- to receive the ministry's prayer emails, and the prayer team writes those
-- emails on a staff page that sends one to each person on the list. Every
-- email carries an unsubscribe link. Replaces the Google Form the Pray page
-- linked to. Prayer REQUESTS are not taken here: the page points at
-- pray@luke14ministries.net, which the prayer team receives.
--
-- 1. staff_grants gains the area 'prayer'. Read: who is on the list and what
--    was sent. Write: send to the list. Like Giving, presets leave it alone
--    (lib/grants.js); it is ticked by hand for the people on the prayer team.
--
-- 2. prayer_list_subscribers: one row per email address. A sign-up is pending
--    until the person presses the link in the confirmation email (so nobody
--    can put someone else on the list); unsubscribing stamps unsubscribed_at
--    and keeps the row, so the address is not mailed again unless the person
--    signs up and confirms afresh.
--
--    No signed-in person writes it, and no anonymous visitor reaches it at
--    all: sign-up, confirm and unsubscribe run server-side with the service
--    role (lib/supabase/admin.js), because each needs the row's token, and a
--    function that handed the token to an anonymous caller would let anyone
--    confirm anyone. Staff with Prayer read see every column EXCEPT the
--    token (column grants): a token is the person's own key to their row.
--
-- 3. prayer_list_sends: what was sent, when, by whom, to how many. Prayer
--    read sees it; Prayer write records a send as themselves. The text is
--    kept, so the team can see what went out last time.

-- 1. The area.
alter table public.staff_grants drop constraint staff_grants_area_check;
alter table public.staff_grants add constraint staff_grants_area_check check (area in (
  'registration', 'payments', 'giving', 'background_checks', 'sensitive',
  'setup', 'activities', 'rooming', 'buddies', 'programs', 'prayer'));

-- 2. Who is on the list.
create table public.prayer_list_subscribers (
  id               uuid primary key default gen_random_uuid(),
  email            text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  name             text check (name is null or length(name) <= 120),
  token            uuid not null default gen_random_uuid() unique,
  created_at       timestamptz not null default now(),
  confirm_sent_at  timestamptz,
  confirmed_at     timestamptz,
  unsubscribed_at  timestamptz,
  unique (email)
);

comment on table public.prayer_list_subscribers is
  'The prayer list (0141). Written only server-side with the service role (sign-up, confirm, unsubscribe). Prayer read sees every column but token. On the list = confirmed_at set and unsubscribed_at null.';

alter table public.prayer_list_subscribers enable row level security;

create policy prayer_list_subscribers_select on public.prayer_list_subscribers
  for select to authenticated
  using (public.has_grant('prayer', 'read'));

grant select (id, email, name, created_at, confirm_sent_at, confirmed_at, unsubscribed_at)
  on public.prayer_list_subscribers to authenticated;
grant select, insert, update, delete on public.prayer_list_subscribers to service_role;

-- 3. What was sent.
create table public.prayer_list_sends (
  id               uuid primary key default gen_random_uuid(),
  subject          text not null check (length(btrim(subject)) between 1 and 200),
  body             text not null check (length(btrim(body)) between 1 and 20000),
  sent_by          uuid not null references public.profiles (id) on delete restrict
                     default auth.uid(),
  sent_at          timestamptz not null default now(),
  recipient_count  integer not null check (recipient_count >= 0),
  failed_count     integer not null default 0 check (failed_count >= 0),
  error            text
);

comment on table public.prayer_list_sends is
  'Each prayer email sent to the list (0141): the text, who, when, how many. Prayer read sees it; Prayer write records a send as themselves.';

alter table public.prayer_list_sends enable row level security;

create policy prayer_list_sends_select on public.prayer_list_sends
  for select to authenticated
  using (public.has_grant('prayer', 'read'));

create policy prayer_list_sends_insert on public.prayer_list_sends
  for insert to authenticated
  with check (public.has_grant('prayer', 'write') and sent_by = (select auth.uid()));

grant select, insert on public.prayer_list_sends to authenticated;
grant select, insert, update, delete on public.prayer_list_sends to service_role;

do $$
begin
  if has_table_privilege('anon', 'public.prayer_list_subscribers', 'select')
     or has_table_privilege('anon', 'public.prayer_list_sends', 'select')
     or has_column_privilege('authenticated', 'public.prayer_list_subscribers', 'token', 'select')
     or has_table_privilege('authenticated', 'public.prayer_list_subscribers', 'insert') then
    raise exception '0141: prayer list grants are wrong';
  end if;
end;
$$;
