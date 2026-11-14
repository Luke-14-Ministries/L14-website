-- 0166_volunteerbadge_match_facts.sql
--
-- Stronger same-person checks on a VolunteerBadge result (Lawrence, 13 Nov
-- 2026: "Yes, all four"). When the site ties an invite to a VB volunteer it
-- now also requires the last name to agree (suffixes aside) and compares the
-- date of birth inside lib/volunteerBadgeApi.js, so the date itself never
-- leaves that module. What is kept, for OK to serve to show beside our own
-- person's name:
--
--   vb_first_name, vb_last_name  VB's names on the record linked (names only)
--   vb_dob_agrees                true / false / null: whether VB's date of
--                                birth matched ours. Never the date.
--
-- Staff see them on Background screening; names that differ from ours in any
-- way need a second confirm before OK to serve.

alter table public.volunteerbadge_requests
  add column if not exists vb_first_name text check (vb_first_name is null or char_length(vb_first_name) <= 100),
  add column if not exists vb_last_name  text check (vb_last_name is null or char_length(vb_last_name) <= 100),
  add column if not exists vb_dob_agrees boolean;

comment on column public.volunteerbadge_requests.vb_first_name is
  'VolunteerBadge''s first name on the record this invite was tied to (0166). A name only.';
comment on column public.volunteerbadge_requests.vb_last_name is
  'VolunteerBadge''s last name on the record this invite was tied to (0166). A name only.';
comment on column public.volunteerbadge_requests.vb_dob_agrees is
  'Whether VolunteerBadge''s date of birth matched ours when the invite was tied (0166): yes / no / unknown. The date itself is never kept.';

comment on table public.volunteerbadge_requests is
  'One VolunteerBadge invite per row (0165): who, the address sent, VB''s ids and status words, who sent and confirmed it, and VB''s first and last name on the record it was tied to with a yes/no for whether VB''s date of birth matched ours (0166). Never the report, its links, an SSN or a date of birth. Background-checks write grant.';
