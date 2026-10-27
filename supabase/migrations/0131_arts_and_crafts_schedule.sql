-- 0131_arts_and_crafts_schedule.sql
--
-- Arts and crafts is drop-in, but the craft room is not open all the time
-- (Lawrence, 26 Oct 2026: "something like 'Check the schedule when you arrive
-- at camp'"). 0050 seeded "Running all week in the craft room — no sign-up
-- needed, drop in whenever you like." Only rows still carrying that exact
-- seeded text change; a description staff have since edited on the
-- Activities page is left alone. Events copied from these carry the new text.

update public.activities
   set description = 'Drop in — no sign-up needed. The craft room keeps set hours, so check the schedule when you arrive at camp.'
 where description = 'Running all week in the craft room — no sign-up needed, drop in whenever you like.';

do $$
begin
  if exists (select 1 from public.activities
              where description = 'Running all week in the craft room — no sign-up needed, drop in whenever you like.') then
    raise exception '0131: an arts and crafts description still says "running all week"';
  end if;
end;
$$;
