-- 0092: retire the volunteer_clearances compatibility view (15 Oct 2026).
--
-- 0056 renamed volunteer_clearances to person_clearances and left a
-- security-invoker view under the old name "for one deploy cycle", to be
-- dropped once app/ had caught up. Forty-odd migrations later the Buddy board,
-- its CSV and the manual clearance record were still reading and writing
-- through it. 0091's commit moved every read to person_clearances or the
-- clearance_status view and the one write to person_clearances; this drops
-- the name so nothing can quietly start using it again.
--
-- Applied AFTER that commit was live (Vercel READY), not before -- the old
-- build would have lost its Buddy board for the minutes in between.

drop view if exists public.volunteer_clearances;
