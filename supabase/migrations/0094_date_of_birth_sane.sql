-- 0094: a date of birth must be a real one (Lawrence, 15 Oct 2026).
--
-- A volunteer was on file as born 0014-02-24: a two-digit year typed into a
-- date box, which the browser accepted and every age check then read as
-- 2,012 years old -- an adult, so a background check was due for a child.
-- The database refuses it from every path (wizard, family page, staff edit);
-- the date boxes carry min/max as well, and the server actions say it in
-- plain words before the database has to.

create or replace function public.people_dob_sane()
returns trigger
language plpgsql
as $$
begin
  if new.date_of_birth is not null
     and (new.date_of_birth < date '1900-01-01' or new.date_of_birth > current_date) then
    raise exception 'Date of birth % is not a real date — check the year (four digits, e.g. 2014).',
      new.date_of_birth
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists people_dob_sane on public.people;
create trigger people_dob_sane
  before insert or update of date_of_birth on public.people
  for each row execute function public.people_dob_sane();

-- The one row that had it: Harper Hickman, 0014-02-24, corrected to 2014-02-24
-- by hand the same day (Lawrence: "Harper is under 18").
