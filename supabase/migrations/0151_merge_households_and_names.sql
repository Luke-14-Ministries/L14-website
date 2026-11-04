-- 0151 -- Merge two households; tell same-named households apart (4 Nov 2026)
--
-- Lawrence, 4 Nov 2026:
--   * Larry and Darlene are married, both with logins, and each could end up
--     with a household of their own. A staff tool merges one household into
--     another: its people, registrations, logins and records move across, and
--     the emptied household is deleted.
--   * Two households both called "LaPlue family" could not be told apart on
--     staff pages. When a name is shared, each such household carries its
--     head in brackets -- "LaPlue family (Darlene)" -- the head being the
--     household's primary contact (the first adult registered).
--
-- 1. admin_merge_households(p_keep, p_merge) -- administrators only.
--    Every column that points at a household (found from the catalogue, so a
--    table added later is covered) moves from p_merge to p_keep. Two clashes
--    are handled first:
--      * a login in both households keeps one membership (the kept one);
--      * both households registered for the SAME event is refused, naming
--        the event: two registrations, each with its own money, cannot be
--        folded into one without a person deciding which payments, plan and
--        signatures belong where. Cancel one first, then merge.
--    Blank contact details on the kept household are filled from the merged
--    one, and so is a missing primary contact. Then the merged household is
--    deleted (nothing points at it any more).

create or replace function public.admin_merge_households(p_keep uuid, p_merge uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_keep  public.households%rowtype;
  v_merge public.households%rowtype;
  v_clash text;
  r record;
  v_moved jsonb := '{}'::jsonb;
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can merge households.' using errcode = '42501';
  end if;
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'Choose two different households.';
  end if;
  select * into v_keep from public.households where id = p_keep;
  select * into v_merge from public.households where id = p_merge;
  if v_keep.id is null or v_merge.id is null then
    raise exception 'One of those households no longer exists.';
  end if;

  select string_agg(e.name, ', ' order by e.starts_on) into v_clash
    from public.registrations a
    join public.registrations b on b.event_id = a.event_id and b.household_id = p_merge
    join public.events e on e.id = a.event_id
   where a.household_id = p_keep;
  if v_clash is not null then
    raise exception 'Both households are registered for %. Cancel one of those registrations first, then merge.', v_clash;
  end if;

  -- A login in both: keep its membership in the kept household.
  delete from public.household_members m
   where m.household_id = p_merge
     and exists (select 1 from public.household_members k
                  where k.household_id = p_keep and k.profile_id = m.profile_id);

  for r in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.households'::regclass
       and c.conrelid <> 'public.households'::regclass
  loop
    execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_keep, p_merge;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_moved := v_moved || jsonb_build_object(r.tbl::text, v_n);
    end if;
  end loop;

  update public.households k set
    email         = coalesce(k.email, v_merge.email),
    phone         = coalesce(k.phone, v_merge.phone),
    address_line1 = coalesce(k.address_line1, v_merge.address_line1),
    address_line2 = coalesce(k.address_line2, v_merge.address_line2),
    city          = coalesce(k.city, v_merge.city),
    state         = coalesce(k.state, v_merge.state),
    postal_code   = coalesce(k.postal_code, v_merge.postal_code),
    home_church   = coalesce(k.home_church, v_merge.home_church),
    primary_contact_person_id = coalesce(k.primary_contact_person_id, v_merge.primary_contact_person_id)
   where k.id = p_keep;

  delete from public.households where id = p_merge;

  return jsonb_build_object('kept', p_keep, 'moved', v_moved);
end;
$$;

revoke all on function public.admin_merge_households(uuid, uuid) from public, anon;
grant execute on function public.admin_merge_households(uuid, uuid) to authenticated;

-- 2. Same-named households carry their head in brackets.
--    refresh_household_names(base) looks at every household whose name,
--    less any "(...)" at the end, is `base` (ignoring case). If there is more
--    than one, each with a primary contact is named "base (First)". A name
--    that is unique is left alone, brackets and all, since a family may have
--    chosen it.

create or replace function public.refresh_household_names(p_base text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_base text := btrim(p_base);
begin
  if v_base is null or v_base = '' then return; end if;
  if (select count(*) from public.households h
       where lower(btrim(regexp_replace(h.display_name, '\s*\([^)]*\)\s*$', ''))) = lower(v_base)) < 2 then
    return;
  end if;
  update public.households h
     set display_name = v_base || ' (' || p.first_name || ')'
    from public.people p
   where p.id = h.primary_contact_person_id
     and nullif(btrim(p.first_name), '') is not null
     and lower(btrim(regexp_replace(h.display_name, '\s*\([^)]*\)\s*$', ''))) = lower(v_base)
     and h.display_name is distinct from v_base || ' (' || p.first_name || ')';
end;
$$;

revoke all on function public.refresh_household_names(text) from public, anon, authenticated;

create or replace function public.trg_household_names()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  perform public.refresh_household_names(
    btrim(regexp_replace(coalesce(new.display_name, ''), '\s*\([^)]*\)\s*$', ''))
  );
  return null;
end;
$$;

drop trigger if exists households_same_name on public.households;
create trigger households_same_name
  after insert or update of display_name, primary_contact_person_id on public.households
  for each row
  when (pg_trigger_depth() < 1)
  execute function public.trg_household_names();

-- Today's duplicates, once.
do $$
declare b text;
begin
  for b in
    select btrim(regexp_replace(display_name, '\s*\([^)]*\)\s*$', ''))
      from public.households
     group by 1
    having count(*) > 1
  loop
    perform public.refresh_household_names(b);
  end loop;
end;
$$;
