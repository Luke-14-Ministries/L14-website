-- 0090: placing people into programs is coordination (Lawrence, 15 Oct 2026).
--
-- Buddies, rooming and activities are the coordinator's; programs were the
-- odd one out. Placing somebody into a program writes
-- registration_participants.program_id, and that table's UPDATE policy is
-- is_registrar() -- so the Programs page was gated to registrars, and a
-- coordinator could not place anybody. Lawrence: "odd... coordinator role
-- makes sense."
--
-- Opening the participants table to coordinators would open EVERY column on
-- it (fees, status, role), which is not the ask. So the placement is a
-- function that writes exactly one column and checks the role itself.
-- Administrators qualify through is_coordinator(), as everywhere else.
--
-- Naming a program leader stays administrator-only (0061): it is a grant of
-- children's names, and grants are the administrator's. The policies below
-- bring the database into line with what the app already enforced -- both
-- tables were writable by any staff member at the database level.

create or replace function public.place_in_program(p_participant_ids uuid[], p_program_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.is_coordinator() then
    raise exception 'Placing people into programs needs coordinator or administrator access.';
  end if;
  if p_program_id is not null
     and not exists (select 1 from public.programs p where p.id = p_program_id and p.active) then
    raise exception 'That program does not exist or is not active.';
  end if;
  update public.registration_participants
     set program_id = p_program_id
   where id = any (coalesce(p_participant_ids, '{}'::uuid[]));
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.place_in_program(uuid[], uuid) is
  'Sets registration_participants.program_id for the given participants (null clears). Coordinator or administrator only; returns the number of rows changed.';

revoke all on function public.place_in_program(uuid[], uuid) from public;
grant execute on function public.place_in_program(uuid[], uuid) to authenticated;

-- Programs are a lookup list seeded by migration; only an administrator
-- changes it (what 0061's comment said, and the policy did not).
drop policy if exists programs_write on public.programs;
create policy programs_write on public.programs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Leaders are named and removed by administrators only (the app has always
-- said so; now the database does too).
drop policy if exists program_leaders_write on public.program_leaders;
create policy program_leaders_write on public.program_leaders
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
