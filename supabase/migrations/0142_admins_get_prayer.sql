-- 0142_admins_get_prayer.sql
--
-- Every administrator holds the Prayer list area at write (Lawrence, 28 Oct
-- 2026: "give all (current AND future) admins the grant"). Future ones get it
-- from the Administrator tick, which sets every area in lib/grants.js at
-- write (app/admin/staff/actions.js); 0141 added the area after today's
-- administrators were ticked, so this gives it to them. Logged by 0100's
-- trigger as grant:prayer, granted by nobody (a migration).

insert into public.staff_grants (profile_id, area, level, granted_by)
select s.profile_id, 'prayer', 'write', null
  from public.staff s
 where s.role = 'admin'
   and s.active
on conflict (profile_id, area) do update set level = 'write';
