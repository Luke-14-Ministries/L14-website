import BackLink from '@/components/BackLink';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import EventFilter from '@/components/EventFilter';
import { signedPhotoUrls } from '@/lib/photos';
import { isCurrentEventRow, eventDateRange } from '@/lib/events';

export const metadata = { title: "Photographer's List — Staff Admin" };

// The camp photographer's list (Lawrence, 26 Oct 2026: "need to still have
// photo flag maintained to give list to camp photographer").
//
// WHY A PAGE OF ITS OWN. The Rosters page already counts who declined, in a
// box on screen, and its print view marks "no photo" on each row -- but
// neither is something to hand a photographer: one is a comma-separated line
// on a screen, the other a whole roster with the answer in a column. This is
// one event's people whose family said NO to photos, on paper, with a face
// beside each name so the photographer can recognise them. It lives under
// Rosters because that is where the photo-permission answer already is, and
// the Review card's "Photographer's list" link brings staff here.
//
// WHAT COUNTS. The newest media answer per person (person_current_consents,
// 0030 -- the one place "the current answer" is resolved), granted = false.
// No answer on file is NOT a refusal and is not listed as one; the sheet
// says how many have none, so nobody reads silence as yes or as no.
// Everyone on the week who is not cancelled or still a draft, whatever their
// role -- a volunteer can decline too. A person on the week twice (a parent
// who also volunteers) is listed once with both roles.
//
// ACCESS. Registration read, like Rosters. The faces need Sensitive read --
// the database's rule for person_photos and the bucket, which
// signedPhotoUrls() mirrors; without it the sheet is names only and says so.

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

// Whole years on a given day, from YYYY-MM-DD; null when unknown.
function ageOn(dob, onDate) {
  if (!dob || !onDate) return null;
  const [by, bm, bd] = String(dob).slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = String(onDate).slice(0, 10).split('-').map(Number);
  if (!by || !ty) return null;
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export default async function PhotographerListPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/rosters/photos/');
  if (!can(staff, 'read:registration')) redirect('/admin');

  const supabase = await createClient();

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on, archived_at')
    .order('starts_on');
  // A failed read is an error page, never an empty list (CLAUDE.md).
  if (eventsError) throw new Error(`Photographer's list — events: ${eventsError.message}`);

  // ?event=<id>, else the first current event, as every staff page opens.
  const asked = typeof params?.event === 'string' ? params.event : '';
  const event =
    (events ?? []).find((e) => e.id === asked) ??
    (asked ? null : (events ?? []).find((e) => isCurrentEventRow(e)) ?? null);

  const { data: parts, error: partsError } = event
    ? await supabase
        .from('registration_participants')
        .select(
          `id, camp_role, status, program_id, registration_id,
           people ( id, first_name, last_name, preferred_name, date_of_birth ),
           registrations!inner ( event_id, households ( display_name ) )`
        )
        .eq('registrations.event_id', event.id)
        .not('status', 'in', '(cancelled,draft)')
    : { data: [], error: null };
  if (partsError) throw new Error(`Photographer's list — people: ${partsError.message}`);

  const personIds = [...new Set((parts ?? []).map((p) => p.people?.id).filter(Boolean))];

  const [{ data: consents, error: consentsError }, { data: programs, error: programsError }] =
    await Promise.all([
      personIds.length
        ? supabase
            .from('person_current_consents')
            .select('person_id, granted')
            .eq('kind', 'media')
            .in('person_id', personIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('programs').select('id, name'),
    ]);
  if (consentsError) throw new Error(`Photographer's list — photo permission: ${consentsError.message}`);
  if (programsError) throw new Error(`Photographer's list — programs: ${programsError.message}`);

  const answer = new Map((consents ?? []).map((c) => [c.person_id, c.granted]));
  const programName = new Map((programs ?? []).map((g) => [g.id, g.name]));

  // One entry per person (a parent who also volunteers is two rows).
  const byPerson = new Map();
  for (const p of parts ?? []) {
    const pe = p.people;
    if (!pe?.id) continue;
    const known = byPerson.get(pe.id);
    const role = ROLE_LABEL[p.camp_role] ?? p.camp_role;
    if (known) {
      if (!known.roles.includes(role)) known.roles.push(role);
      if (p.status === 'confirmed') known.confirmed = true;
      if (!known.program && p.program_id) known.program = programName.get(p.program_id) ?? '';
      continue;
    }
    byPerson.set(pe.id, {
      personId: pe.id,
      name: `${pe.first_name ?? ''} ${pe.last_name ?? ''}`.trim() || 'Unnamed',
      preferred: pe.preferred_name && pe.preferred_name !== pe.first_name ? pe.preferred_name : null,
      sortName: `${pe.last_name ?? ''} ${pe.first_name ?? ''}`,
      roles: [role],
      age: ageOn(pe.date_of_birth, event?.starts_on),
      program: p.program_id ? programName.get(p.program_id) ?? '' : '',
      household: p.registrations?.households?.display_name ?? '',
      confirmed: p.status === 'confirmed',
      status: p.status,
    });
  }
  const everyone = [...byPerson.values()];
  const declined = everyone
    .filter((r) => answer.get(r.personId) === false)
    .sort((a, b) => a.sortName.localeCompare(b.sortName));
  const unanswered = everyone.filter((r) => !answer.has(r.personId)).length;

  const seesPhotos = can(staff, 'read:sensitive');
  const photoUrlOf = await signedPhotoUrls(supabase, seesPhotos, declined.map((r) => r.personId));

  return (
    <div className="print-sheet mx-auto max-w-3xl bg-white p-8 print:text-[12px] text-neutral-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-xl font-bold">Photographer&rsquo;s list</h1>
        <span className="flex flex-wrap items-center gap-3">
          <PrintButton />
          <BackLink href="/admin/rosters/" label="Back to Rosters" />
        </span>
      </div>
      <p className="mb-3 text-sm text-neutral-500 print:hidden">
        Everyone at one event whose family asked us not to feature them in photos or video.
        Print it for whoever is photographing.
      </p>
      <div className="mb-6 print:hidden">
        <EventFilter
          events={(events ?? []).map((e) => ({
            id: e.id,
            name: e.name,
            startsOn: e.starts_on,
            endsOn: e.ends_on,
            archivedAt: e.archived_at,
          }))}
          selected={event?.id ?? null}
          basePath="/admin/rosters/photos"
        />
      </div>

      {!event ? (
        <p className="text-sm text-neutral-500">Choose an event above.</p>
      ) : (
        <>
          <div className="border-b-2 border-neutral-800 pb-2">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Please do not feature</p>
            <h2 className="text-2xl font-bold">{event.name}</h2>
            <p className="text-sm text-neutral-600">
              {eventDateRange(event.starts_on, event.ends_on)} · {declined.length}{' '}
              {declined.length === 1 ? 'person' : 'people'}
            </p>
          </div>

          {declined.length === 0 ? (
            <p className="mt-4 text-sm">Nobody at this event has asked us not to feature them.</p>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 print:grid-cols-2">
              {declined.map((r) => {
                const url = photoUrlOf.get(r.personId);
                return (
                  <li
                    key={r.personId}
                    className="flex break-inside-avoid items-center gap-3 rounded-sm border border-neutral-300 p-2"
                  >
                    {seesPhotos && (
                      url ? (
                        // A signed link into the private bucket, fresh each load
                        // (lib/photos.js) -- next/image would cache it.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt={`Photo of ${r.name}`}
                          className="h-20 w-20 shrink-0 rounded-sm object-cover"
                        />
                      ) : (
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-sm border border-dashed border-neutral-300 text-center text-xs text-neutral-400">
                          no photo on file
                        </div>
                      )
                    )}
                    <div className="min-w-0">
                      <p className="font-bold">
                        {r.preferred ?? r.name}
                        {r.preferred && <span className="font-normal text-neutral-600"> ({r.name})</span>}
                      </p>
                      <p className="text-sm text-neutral-700">
                        {r.roles.join(' · ')}
                        {r.age != null ? ` · ${r.age}` : ''}
                        {r.program ? ` · ${r.program}` : ''}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {r.household}
                        {!r.confirmed && ` · ${r.status === 'waitlisted' ? 'waitlisted' : 'not yet confirmed'}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-4 text-xs text-neutral-600">
            Not featuring someone means not making them the subject of a picture — nobody can
            promise absence from a wide group shot.
            {unanswered > 0 &&
              ` ${unanswered} ${unanswered === 1 ? 'other person has' : 'others have'} no answer on file.`}
            {!seesPhotos && ' Names only: photos need the Sensitive read permission.'}
            {' '}Hand this back at the end of camp.
          </p>
        </>
      )}
    </div>
  );
}
