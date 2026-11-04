-- 0150 -- "N/A" as a program placement (4 Nov 2026)
--
-- Lawrence, 4 Nov 2026, on the Programs page: someone who belongs to no
-- program for the week -- staff, mostly -- could only be left "not yet
-- placed", which keeps the Programs badge and the "Not yet placed" pill
-- above zero for good. One more row in programs, marked not_a_program, is
-- the placement for them: it counts as placed, shows as "N/A" on rosters,
-- and the Programs page never offers it a leader (nobody leads "N/A", and
-- nobody's My Program is it).

alter table public.programs
  add column if not exists not_a_program boolean not null default false;

insert into public.programs (name, description, sort_order, active, not_a_program)
select 'N/A (e.g. staff)', 'Not in a program for the week — staff and others who are not placed with a group.', 1000, true, true
where not exists (select 1 from public.programs where not_a_program);
