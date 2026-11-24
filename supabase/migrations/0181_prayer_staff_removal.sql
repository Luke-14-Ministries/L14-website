-- 0181_prayer_staff_removal.sql
--
-- Staff removal from the prayer list sticks (security review, 23 Nov 2026).
--
-- Until now "Take off the list" on the Prayer List page set the same
-- unsubscribed_at stamp a person's own unsubscribe sets. Anyone could then put
-- that address straight back: sign it up again on the Pray page, or press an
-- old confirmation link still sitting in the inbox, and confirmPrayerList()
-- cleared unsubscribed_at. When the prayer team takes someone off because
-- they asked by email, that request should hold.
--
-- removed_by_staff_at marks it. The site (service role) sets it in
-- removeFromPrayerList(); confirmPrayerList() and a fresh public sign-up refuse
-- such a row and point to pray@. "Let them sign up again" on the staff page
-- clears it, so the way back runs through the prayer team. A person's own
-- unsubscribe never sets it, so they can always rejoin by themselves.
--
-- Access is unchanged: nobody signed in writes the list (0141). Prayer read
-- may see the new column, so the page can say "Taken off by staff"; the token
-- stays unreadable.

alter table public.prayer_list_subscribers
  add column removed_by_staff_at timestamptz;

comment on column public.prayer_list_subscribers.removed_by_staff_at is
  'Set when staff took this address off the list (0181). Sign-up and confirm refuse the row while it is set; staff clear it to let the person rejoin.';

grant select (removed_by_staff_at) on public.prayer_list_subscribers to authenticated;

do $$
begin
  if not has_column_privilege('authenticated', 'public.prayer_list_subscribers', 'removed_by_staff_at', 'select')
     or has_column_privilege('authenticated', 'public.prayer_list_subscribers', 'removed_by_staff_at', 'update')
     or has_column_privilege('authenticated', 'public.prayer_list_subscribers', 'token', 'select')
     or has_table_privilege('authenticated', 'public.prayer_list_subscribers', 'insert') then
    raise exception '0181: prayer list grants are wrong';
  end if;
end;
$$;
