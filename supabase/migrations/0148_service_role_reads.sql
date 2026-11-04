-- 0148 -- The server's own key can read every table (4 Nov 2026)
--
-- Found when REMINDERS_MODE went live: Email Families' "Automatic emails due"
-- said "Reminders — registrations: permission denied for table people". The
-- automatic-email job (0138, lib/reminders/run.js) reads registrations, the
-- people on them, support details, photos, waivers and plans with the
-- service-role client (lib/supabase/admin.js) -- and in this project
-- service_role was only ever granted table by table, for what the Stripe
-- functions write (0006, 0008, 0054, 0080, 0114 ...). 45 tables, people and
-- households' members among them, were never readable by it, so the job has
-- failed on its first query every morning since A1 (28 Oct). Nothing was ever
-- sent (reminder_sends is empty); the local test harness runs as the owner,
-- which is why the tests did not catch it.
--
-- service_role is the server's key: it already bypasses row-level security,
-- lives only in Vercel and the edge functions, and Supabase grants it every
-- table by default. Giving it SELECT on all of public (and on tables made
-- later) is that default for reading. Writes stay granted one table at a time.

grant select on all tables in schema public to service_role;

alter default privileges in schema public grant select on tables to service_role;

do $$
begin
  if not has_table_privilege('service_role', 'public.people', 'select')
     or not has_table_privilege('service_role', 'public.person_support', 'select')
     or not has_table_privilege('service_role', 'public.activity_waivers_outstanding', 'select') then
    raise exception '0148: service_role still cannot read the reminder tables';
  end if;
end;
$$;
