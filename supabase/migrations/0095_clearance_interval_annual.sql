-- 0095: a background check is current for a year (Larry and Ellen, 15 Oct 2026).
--
-- The read-through answered DO-THIS-NEXT W21: "every year, annual Basic Plus."
-- 0091 put the interval in one function so this is the whole change; the
-- importer's default (DEFAULT_INTERVAL_MONTHS in screening/actions.js) moves
-- with it in the same commit. Existing expiry dates are history and are not
-- rewritten -- there are none on file yet anyway.

create or replace function public.clearance_interval_months()
returns integer
language sql
immutable
as $$ select 12 $$;

comment on function public.clearance_interval_months() is
  'How long a background check stays current: 12 months (annual Basic Plus -- Larry and Ellen, 15 Oct 2026). The importer and the manual record both derive expires_on from it.';
