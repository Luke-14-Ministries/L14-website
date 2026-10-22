-- 0118_volunteer_first_time_disability_ministry.sql
--
-- A tick on the volunteer application: "This is my first time serving in
-- disability ministry".
--
-- 22 October 2026. Katie's suggestion (Website Feedback list): beside the
-- experience question, let a volunteer say plainly that this is their first
-- time, so the camp team can pair and prepare them. It is optional and does
-- not replace the experience answer, which stays required ("none" is an
-- answer -- lib/volunteer.js).
--
-- Access is unchanged. The table's grants are table-level (0001 section 17),
-- so the new column is readable and writable wherever the row already is; the
-- family guard (guard_family_decision_columns(), 0105/0111) resets only the
-- review columns and leaves every answer column alone; log_family_change()
-- does not watch volunteer_applications.

alter table public.volunteer_applications
  add column if not exists first_time_disability_ministry boolean not null default false;

comment on column public.volunteer_applications.first_time_disability_ministry is
  'The applicant ticked "This is my first time serving in disability ministry" on the volunteer application. Optional; false when not ticked and on applications saved before the question (0118).';
