-- 0108_clearance_expiry_follows_date.sql
--
-- Script 5 (administrator run, 18 Oct 2026): clearing a background check's
-- date left its expiry behind. clearance_review_stamp() (0091) recomputed
-- expires_on whenever the date was set or changed, and on purpose left it
-- alone when the date was cleared -- so the row kept expires_on 2027-10-01
-- with no check date, and the Volunteers page went on saying "Expires ...
-- (12 months from the check date)" about a check with no date.
--
-- The expiry is policy arithmetic on the date (clearance_interval_months(),
-- 12 since 0095); nothing else sets it on its own -- the Checkr importer
-- writes the date with it. With no date there is nothing for it to follow,
-- so it is cleared with the date. Everything else in the function is 0091's,
-- restated in full (CLAUDE.md: a function rewritten in place is restated,
-- not patched).
--
-- Rows already carrying an expiry with no date are cleared below. The log
-- trigger records each as an expires_on change with no named actor, which is
-- what happened: a migration did it.

create or replace function public.clearance_review_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.background_check_on_file and new.background_check_date is null then
    raise exception 'A background check marked on file needs its check date.';
  end if;
  -- The expiry follows the date by policy: recomputed whenever the date is
  -- set or changes, or nothing has been set; cleared when the date is
  -- cleared (0108 -- it had been left alone, and outlived its date).
  if new.background_check_date is null then
    new.expires_on := null;
  elsif tg_op = 'INSERT'
        or new.background_check_date is distinct from old.background_check_date
        or new.expires_on is null then
    new.expires_on := new.background_check_date
                      + make_interval(months => public.clearance_interval_months());
  end if;
  if (tg_op = 'INSERT' and new.background_check_on_file)
     or (tg_op = 'UPDATE' and new.background_check_on_file is distinct from old.background_check_on_file) then
    new.paperwork_marked_by := auth.uid();
    new.paperwork_marked_at := now();
  end if;
  if (tg_op = 'INSERT' and new.verdict is not null)
     or (tg_op = 'UPDATE' and new.verdict is distinct from old.verdict) then
    new.verdict_by := auth.uid();
    new.verdict_at := now();
  end if;
  return new;
end;
$$;

-- The trigger itself is 0091's and unchanged (it calls the function by name).

update public.person_clearances
   set expires_on = null
 where background_check_date is null
   and expires_on is not null;

-- Post-check: the rewrite took, and no expiry is left without its date.
do $$
declare n int;
begin
  if position('new.expires_on := null' in pg_get_functiondef('public.clearance_review_stamp()'::regprocedure)) = 0 then
    raise exception '0108: clearance_review_stamp() was not rewritten';
  end if;
  select count(*) into n from public.person_clearances
   where background_check_date is null and expires_on is not null;
  if n > 0 then
    raise exception '0108: % background-check rows still have an expiry with no date', n;
  end if;
end $$;
