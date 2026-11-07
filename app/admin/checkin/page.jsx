import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { staffAssigns, isCurrentEventRow } from '@/lib/events';
import { signedPhotoUrls } from '@/lib/photos';
import { dollars } from '@/lib/payments';
import CheckinList from './CheckinList';
import MedicalContact from './MedicalContact';
import EventFilter from '@/components/EventFilter';

export const metadata = { title: 'Check-In — Staff Admin' };

// Day-of arrivals, built for a phone at the door. Registrars, coordinators and
// admins can mark people in (the set_check_in RPC is the real gate). Medical
// quick-flags appear only for staff holding the sensitive permission -- RLS
// simply returns nothing for anyone else.
export default async function CheckinPage({ searchParams }) {
  const params = await searchParams;

  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/checkin/');
  if (!can(staff, 'read:registration')) redirect('/admin');

  const supabase = await createClient();
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name, event_type, starts_on, ends_on, archived_at, event_medical_contacts ( name, phone )')
    .order('starts_on');
  // CLAUDE.md: never turn a query error into an empty list -- at the door it
  // would read as "nobody registered" or "everyone may be photographed".
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);
  // Current events only: nobody checks anyone in to last year's camp. WHICH
  // events are current is the same rule as everywhere else
  // (isCurrentEventRow: two weeks' grace, a year ahead, never an archived
  // one). Until 4 Nov 2026 this page kept its own dated pills rather than the
  // shared EventFilter; it uses the shared dropdown now, for one control on
  // every page (Lawrence), and the dropdown shows each event's dates under
  // its name -- at a door "Week 1" and "Week 2" look the same without them.
  const eventsList = (events ?? []).map(withMedicalContact).filter((e) => isCurrentEventRow(e));
  const eventId =
    typeof params?.event === 'string' && eventsList.some((e) => e.id === params.event)
      ? params.event
      : eventsList[0]?.id;

  // A retreat pairs buddies on arrival, so no buddy pills at its door (2 Oct 2026).
  const assignsBuddies = staffAssigns(eventsList.find((e) => e.id === eventId));

  let rows = [];
  if (eventId) {
    // Photo preference is read alongside the medical flags but kept SEPARATE
    // from them on purpose: the medical flags come back empty for staff
    // without the sensitive grant, whereas anyone working the door needs to
    // know who not to photograph. Bundling the two would hide it from most of
    // the people who need it.
    const [{ data: regs, error: regsError }, { data: consents, error: consentsError }] = await Promise.all([
      supabase
        .from('registrations')
        .select(
          `id, event_id,
           households ( display_name ),
           registration_participants ( id, camp_role, status, checked_in_at,
             people ( id, first_name, last_name,
               person_support ( buddy_required, has_allergies, has_seizures, has_rescue_medication ) ) )`
        )
        .eq('event_id', eventId),
      supabase.from('person_current_consents').select('person_id, granted').eq('kind', 'media'),
    ]);
    if (regsError) throw new Error(`Registrations: ${regsError.message}`);
    if (consentsError) throw new Error(`Photo permissions: ${consentsError.message}`);

    // Who is paired with whom. Staff see assignments whether or not they have
    // been published -- publication gates the FAMILY's view, not the door's.
    const { data: buddyRows, error: buddyError } = await supabase
      .from('buddy_assignments')
      .select(
        `camper_participant_id,
         buddy:registration_participants!buddy_assignments_buddy_participant_id_fkey (
           people ( first_name, last_name ) )`
      )
      .eq('event_id', eventId)
      .is('ended_at', null);
    if (buddyError) throw new Error(`Buddy pairings: ${buddyError.message}`);

    const buddyNamesOf = new Map();
    for (const b of buddyRows ?? []) {
      const n = `${b.buddy?.people?.first_name ?? ''} ${b.buddy?.people?.last_name ?? ''}`.trim();
      if (!n) continue;
      if (!buddyNamesOf.has(b.camper_participant_id)) {
        buddyNamesOf.set(b.camper_participant_id, []);
      }
      buddyNamesOf.get(b.camper_participant_id).push(n);
    }

    // What each family still owes, for the "Pay on your phone" QR (1 Nov
    // 2026). Money is Payments read: for anyone else registration_balances
    // returns no rows, and an absent balance is "not yours to see", never
    // "nothing owed" -- so it is not asked at all, and the row shows no
    // amount (the page-wide QR still works for them).
    const owedOf = new Map();
    if (can(staff, 'read:payments') && (regs ?? []).length > 0) {
      const { data: bals, error: balsError } = await supabase
        .from('registration_balances')
        .select('registration_id, balance_cents')
        .in('registration_id', regs.map((r) => r.id));
      if (balsError) throw new Error(`Balances: ${balsError.message}`);
      for (const b of bals ?? []) owedOf.set(b.registration_id, b.balance_cents);
    }

    const noPhotoIds = new Set(
      (consents ?? []).filter((c) => c.granted === false).map((c) => c.person_id)
    );

    // Identification thumbnails — the point of the photo. Since 0101/0105 the
    // rows and the private bucket need the Sensitive READ grant (0033 had let
    // any staff see them); the door presets, Operations lead and helper, carry
    // it. lib/photos.js mirrors that rule, signs only this event's people in
    // one request, and throws on a failed lookup instead of showing nobody.
    const photoUrlOf = await signedPhotoUrls(
      supabase,
      can(staff, 'read:sensitive'),
      (regs ?? []).flatMap((r) => (r.registration_participants ?? []).map((p) => p.people?.id))
    );

    for (const r of regs ?? []) {
      for (const p of r.registration_participants ?? []) {
        if (p.status === 'cancelled' || p.status === 'draft') continue;
        const s = p.people?.person_support ?? null;
        // Colour semantics, applied portal-wide (24 Aug): RED is a medical
        // alert -- something staff may need to act on in the moment. AMBER is
        // an operational note. "Needs buddy" is planning, not an emergency,
        // and the same pill was amber on Medical & Support -- one meaning,
        // one colour, everywhere.
        const flags = [];
        if (s?.has_allergies) flags.push({ t: 'allergies', tone: 'red' });
        if (s?.has_seizures) flags.push({ t: 'seizures', tone: 'red' });
        if (s?.has_rescue_medication) flags.push({ t: 'rescue med', tone: 'red' });
        // Buddy state is TWO pills, not one (agreed 24 Aug). An assigned
        // buddy is a fact worth knowing -- grey, carrying the name, because
        // "who?" is the question staff actually have. An unassigned one is
        // work outstanding -- amber. Sharing a colour is precisely what
        // would let a missing assignment hide among the finished ones.
        if (s?.buddy_required && assignsBuddies) {
          const names = buddyNamesOf.get(p.id) ?? [];
          if (names.length > 0) {
            flags.push({
              t: `Buddy: ${names.join(', ')}`,
              tone: 'neutral',
              title: 'The buddy assigned to this person for the week.',
            });
          } else {
            flags.push({
              t: 'no buddy assigned',
              tone: 'amber',
              title:
                'This person needs a one-to-one buddy and has none yet. Staff pair buddies on the Buddy Assignments page.',
            });
          }
        }
        rows.push({
          id: p.id,
          name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
          sortName: `${p.people?.last_name ?? ''} ${p.people?.first_name ?? ''}`,
          role: p.camp_role,
          household: r.households?.display_name ?? '',
          registrationId: r.id,
          owed: owedOf.get(r.id) > 0 ? dollars(owedOf.get(r.id)) : null,
          checkedInAt: p.checked_in_at,
          flags,
          noPhoto: p.people?.id ? noPhotoIds.has(p.people.id) : false,
          photoUrl: p.people?.id ? photoUrlOf.get(p.people.id) ?? null : null,
        });
      }
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Check-In</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Mark people as they arrive. Works on a phone. Red flags are quick alerts, and the full
        details are on the Medical &amp; Support page. A family paying at the door pays on their own
        phone. Show them the QR code.
      </p>

      {eventsList.length > 1 && (
        <EventFilter
          events={eventsList.map((e) => ({
            id: e.id,
            name: e.name,
            startsOn: e.starts_on,
            endsOn: e.ends_on,
            archivedAt: e.archived_at,
          }))}
          selected={eventId ?? null}
          basePath="/admin/checkin"
          className="mb-4 w-full max-w-sm"
        />
      )}

      {eventId && (
        <MedicalContact
          eventId={eventId}
          name={eventsList.find((e) => e.id === eventId)?.medical_contact_name}
          phone={eventsList.find((e) => e.id === eventId)?.medical_contact_phone}
          canEdit={can(staff, 'write:setup')}
        />
      )}

      {rows.length === 0 ? (
        <p className="text-neutral-500">Nobody to check in for this event yet.</p>
      ) : (
        <CheckinList rows={rows} />
      )}
    </div>
  );
}

// The medical contact lives in its own table since 0109 (readable only by
// staff, leaders and households registered for the event). Flattened back to
// the two names the page has always used.
function withMedicalContact(ev) {
  const mc = Array.isArray(ev.event_medical_contacts) ? ev.event_medical_contacts[0] : ev.event_medical_contacts;
  return { ...ev, medical_contact_name: mc?.name ?? null, medical_contact_phone: mc?.phone ?? null };
}
