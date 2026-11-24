-- 0185_activity_description_wording.sql
--
-- 23 Nov 2026 (the family-area review, P17). The activity descriptions seeded
-- in 0039, 0050 and 0131 joined their sentences with em dashes, which WRITING.md
-- names as the biggest tell of machine-written copy. Families read these on
-- the Activities page.
--
-- Only a description that is still EXACTLY the seeded text is rewritten, so
-- anything staff have edited on the Activities page is left alone. Setup's
-- "create event" copies activities from an earlier event, so the same seeded
-- text can sit on several events; matching on the text catches every copy.
--
-- Checked on live the same day (read-only): the seeded text was still on
-- Swimming (both 2027 weeks), Arts and crafts (both 2027 weeks, 0131's
-- wording), Pontoon boat outing (Week 2) and White water rafting (Week 2, and
-- the archived 2026 retreat). Pontoon boat outing on Week 1 had been edited
-- by staff; it still has an em dash and is listed for staff to reword by hand
-- if they want.
--
-- Every UPDATE carries a WHERE (pg-safeupdate). Words only: no column, policy
-- or function changes, so no grants are needed.

begin;

update public.activities
   set description = 'Open all week down at the waterfront whenever it is staffed. No sign-up needed, just come. Listed here so you can plan your week.',
       updated_at = now()
 where description = 'Open all week down at the waterfront whenever it is staffed — no sign-up needed, just come. Listed here so you can plan your week.';

update public.activities
   set description = 'Running all week in the craft room. No sign-up needed, drop in whenever you like.',
       updated_at = now()
 where description = 'Running all week in the craft room — no sign-up needed, drop in whenever you like.';

-- 0131's wording for Arts and crafts, the one on the 2027 weeks.
update public.activities
   set description = 'Drop in, no sign-up needed. The craft room keeps set hours, so check the schedule when you arrive at camp.',
       updated_at = now()
 where description = 'Drop in — no sign-up needed. The craft room keeps set hours, so check the schedule when you arrive at camp.';

update public.activities
   set description = 'Usually the Wednesday of camp. Run by an outside outfitter, so there is a form of theirs to complete as well as this. Staff will send you the details. Everyone who wants to go is worth a conversation, so ask even if you are unsure it will work.',
       updated_at = now()
 where description = 'Usually the Wednesday of camp. Run by an outside outfitter, so there is a form of theirs to complete as well as this — staff will send you the details. Everyone who wants to go is worth a conversation; ask even if you are unsure it will work.';

update public.activities
   set description = 'Usually the Tuesday of camp. Boarding times are set closer to the week. For now, putting your name down tells staff you want a place on the water.',
       updated_at = now()
 where description = 'Usually the Tuesday of camp. Boarding times are set closer to the week — for now, putting your name down tells staff you want a place on the water.';

update public.activities
   set description = 'Open studio through the week. Drop in whenever it suits.',
       updated_at = now()
 where description = 'Open studio through the week — drop in whenever it suits.';

update public.activities
   set description = 'A guided half-day on the river with an outside outfitter. Their own waiver must be completed on their website before the day. The ministry cannot do this for you.',
       updated_at = now()
 where description = 'A guided half-day on the river with an outside outfitter. Their own waiver must be completed on their website before the day — the ministry cannot do this for you.';

commit;
