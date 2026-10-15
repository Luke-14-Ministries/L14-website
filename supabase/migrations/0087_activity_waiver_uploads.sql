-- 0087: proof that an outside provider's waiver was completed (14 Oct 2026).
--
-- Lawrence: "Do not accept word of mouth confirmation of rafting waiver."
-- Until now a provider-run activity (rafting, horseback) recorded only that
-- we TOLD the family the outfitter has a form of their own
-- (activity_signups.waiver_acknowledged_at). It never recorded that the
-- form was done. Now the family -- and a volunteer who goes along as a buddy
-- -- can upload the outfitter's confirmation (a screenshot, a photo, a PDF),
-- and staff see who has one and open it.
--
-- One file per person per activity, in a PRIVATE bucket, at
--   <registration_participant_id>/<activity_id>.<ext>
-- The first path segment is the participant, so the storage policy is the
-- same household check as every other family-facing table, through
-- my_participant_ids(). Staff read all; nobody but the family writes. The
-- table row beside it is what the pages query; the file is what they open.
-- Never the waiver's contents in a column: a signed outfitter form is theirs,
-- we only hold the proof it exists.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('waiver-confirmations', 'waiver-confirmations', false, 8388608,
        array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_touch_waiver_file(p_path text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when split_part(p_path, '/', 1) !~ '^[0-9a-fA-F-]{36}$' then false
    else (split_part(p_path, '/', 1))::uuid in (select public.my_participant_ids())
  end;
$$;

comment on function public.can_touch_waiver_file(text) is
  'A waiver confirmation lives at <registration_participant_id>/<activity_id>.<ext>; the first segment is the participant, checked against the caller''s own household registrations.';

drop policy if exists "waiver files: family reads own" on storage.objects;
create policy "waiver files: family reads own"
  on storage.objects for select to authenticated
  using (bucket_id = 'waiver-confirmations' and public.can_touch_waiver_file(name));

drop policy if exists "waiver files: staff read all" on storage.objects;
create policy "waiver files: staff read all"
  on storage.objects for select to authenticated
  using (bucket_id = 'waiver-confirmations' and public.is_staff());

drop policy if exists "waiver files: family writes own" on storage.objects;
create policy "waiver files: family writes own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'waiver-confirmations' and public.can_touch_waiver_file(name));

drop policy if exists "waiver files: family replaces own" on storage.objects;
create policy "waiver files: family replaces own"
  on storage.objects for update to authenticated
  using (bucket_id = 'waiver-confirmations' and public.can_touch_waiver_file(name))
  with check (bucket_id = 'waiver-confirmations' and public.can_touch_waiver_file(name));

drop policy if exists "waiver files: family deletes own" on storage.objects;
create policy "waiver files: family deletes own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'waiver-confirmations' and public.can_touch_waiver_file(name));

create table if not exists public.activity_waiver_uploads (
  id                          uuid primary key default gen_random_uuid(),
  activity_id                 uuid not null references public.activities (id) on delete cascade,
  registration_participant_id uuid not null
                                references public.registration_participants (id) on delete cascade,
  storage_path                text not null,
  content_type                text,
  uploaded_at                 timestamptz not null default now(),
  uploaded_by                 uuid references public.profiles (id) on delete set null,
  unique (activity_id, registration_participant_id)
);
comment on table public.activity_waiver_uploads is
  'One uploaded proof per person per provider-run activity. The file itself is in the waiver-confirmations bucket; this row is what pages query.';

alter table public.activity_waiver_uploads enable row level security;

drop policy if exists "waiver uploads: family reads own" on public.activity_waiver_uploads;
create policy "waiver uploads: family reads own"
  on public.activity_waiver_uploads for select to authenticated
  using (registration_participant_id in (select public.my_participant_ids()));

drop policy if exists "waiver uploads: staff read all" on public.activity_waiver_uploads;
create policy "waiver uploads: staff read all"
  on public.activity_waiver_uploads for select to authenticated
  using (public.is_staff());

drop policy if exists "waiver uploads: family writes own" on public.activity_waiver_uploads;
create policy "waiver uploads: family writes own"
  on public.activity_waiver_uploads for insert to authenticated
  with check (registration_participant_id in (select public.my_participant_ids()));

drop policy if exists "waiver uploads: family replaces own" on public.activity_waiver_uploads;
create policy "waiver uploads: family replaces own"
  on public.activity_waiver_uploads for update to authenticated
  using (registration_participant_id in (select public.my_participant_ids()))
  with check (registration_participant_id in (select public.my_participant_ids()));

drop policy if exists "waiver uploads: family deletes own" on public.activity_waiver_uploads;
create policy "waiver uploads: family deletes own"
  on public.activity_waiver_uploads for delete to authenticated
  using (registration_participant_id in (select public.my_participant_ids()));

grant select, insert, update, delete on public.activity_waiver_uploads to authenticated;
