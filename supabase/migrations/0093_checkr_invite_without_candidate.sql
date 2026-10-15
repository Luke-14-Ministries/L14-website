-- 0093: a Checkr invitation sent by file has no candidate id yet (15 Oct 2026).
--
-- "Download CSV for 11 and mark as sent" has never written a row. 0029's
-- check constraint says a Checkr row past 'not_started' must carry a
-- checkr_candidate_id "or the webhook has nothing to match on" -- true for
-- the API flow it was written for, and false for the file flow 0057 built
-- instead: the site invites people by uploading Checkr's bulk template, no
-- candidate id exists until Checkr's export comes back, and the import
-- matches on the address we invited (invited_email). The batch insert
-- (status 'invited', no candidate id) tripped the constraint and the page
-- reported the failure under the button. Found by Lawrence pressing it.
--
-- The rule now: a Checkr row past 'not_started' must carry EITHER the
-- candidate id (API flow) OR the address it was invited at (file flow).

alter table public.person_clearances
  drop constraint if exists volunteer_clearances_checkr_needs_candidate;

alter table public.person_clearances
  add constraint person_clearances_checkr_needs_match
  check (
    provider <> 'checkr'
    or checkr_status = 'not_started'
    or checkr_candidate_id is not null
    or invited_email is not null
  );

comment on constraint person_clearances_checkr_needs_match on public.person_clearances is
  'A Checkr row that has moved past not_started must be matchable to a result: by candidate id (API) or by the email it was invited at (bulk file).';
