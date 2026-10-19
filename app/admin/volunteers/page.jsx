import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import VolunteerManager from './VolunteerManager';
import EventFilter from '@/components/EventFilter';

export const metadata = { title: 'Volunteers — Staff Admin' };

// Every registered volunteer, by event: application status, the application
// itself, and the background-check record. Registrar-gated; RLS is the
// backstop. Clearances live in volunteer_clearances (a yes/no and dates
// only) — the paperwork itself stays in the restricted SharePoint folder,
// never here. That is a board-level rule, not a preference.
export default async function AdminVolunteersPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/volunteers/');
  if (!can(staff, 'read:registration')) redirect('/admin');

  // Background-check records are their own grant (migration 0058). A registrar
  // without it still runs the volunteers page -- applications, review, the lot --
  // and simply does not see clearance state. The rows are not fetched at all
  // rather than fetched and hidden, so there is nothing to leak.
  const maySeeChecks = can(staff, 'background_checks');

  const supabase = await createClient();

  const [{ data: regs }, { data: events }] = await Promise.all([
    supabase
      .from('registrations')
      .select(
        `id, event_id,
         households ( display_name, email, phone ),
         registration_participants ( id, camp_role, status,
           people ( id, first_name, last_name, date_of_birth, gender, email, phone ) )`
      ),
    supabase.from('events').select('id, name, starts_on, ends_on, archived_at').order('starts_on', { ascending: false }),
  ]);

  // Flatten to volunteer participants only.
  const vols = [];
  for (const r of regs ?? []) {
    for (const p of r.registration_participants ?? []) {
      if (p.camp_role !== 'volunteer' || p.status === 'cancelled') continue;
      vols.push({
        participantId: p.id,
        registrationId: r.id,
        eventId: r.event_id,
        participantStatus: p.status,
        person: p.people,
        household: r.households,
      });
    }
  }

  const partIds = vols.map((v) => v.participantId);
  const personIds = [...new Set(vols.map((v) => v.person?.id).filter(Boolean))];

  const [{ data: apps }, { data: clearances }] = await Promise.all([
    partIds.length
      ? supabase
          .from('volunteer_applications')
          .select(
            'registration_participant_id, first_time_volunteering, preferred_areas, church_attendance, faith_statement, relevant_skills, disability_experience, accompanying_adult_person_id, status, reviewed_at, updated_at, creed_affirmed'
          )
          .in('registration_participant_id', partIds)
      : Promise.resolve({ data: [] }),
    // With the grant: the whole record. Without it: the three facts every
    // staff member may know (on file, current, verdict) from clearance_status
    // (0091) -- until 15 Oct this column read "hidden" for anyone without the
    // grant, and the Buddy board read "no check on file" for everybody.
    personIds.length
      ? maySeeChecks
        ? supabase
            .from('person_clearances')
            .select(
              `person_id, background_check_on_file, background_check_date, expires_on,
               verdict, verdict_note, verdict_by, verdict_at, paperwork_marked_by, paperwork_marked_at,
               provider, checkr_status, checkr_package, adjudication,
               invitation_sent_at, report_completed_at`
            )
            .in('person_id', personIds)
        : supabase
            .from('clearance_status')
            .select('person_id, on_file, check_date, expires_on, is_current, verdict')
            .in('person_id', personIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Names for the stamps on the record, and the recent log lines, only when
  // the record itself is shown.
  let nameOf = new Map();
  let logByPerson = new Map();
  if (maySeeChecks && (clearances ?? []).length) {
    const stampIds = [
      ...new Set((clearances ?? []).flatMap((c) => [c.verdict_by, c.paperwork_marked_by]).filter(Boolean)),
    ];
    const [{ data: stampProfiles }, { data: logRows }] = await Promise.all([
      stampIds.length
        ? supabase.from('profiles').select('id, first_name, last_name').in('id', stampIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from('clearance_review_log')
        .select('person_id, field, old_value, new_value, changed_by, changed_at')
        .in('person_id', personIds)
        .order('changed_at', { ascending: false })
        .limit(200),
    ]);
    nameOf = new Map((stampProfiles ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()]));
    const logIds = [...new Set((logRows ?? []).map((l) => l.changed_by).filter(Boolean))].filter((id) => !nameOf.has(id));
    if (logIds.length) {
      const { data: more } = await supabase.from('profiles').select('id, first_name, last_name').in('id', logIds);
      for (const p of more ?? []) nameOf.set(p.id, `${p.first_name} ${p.last_name}`.trim());
    }
    for (const l of logRows ?? []) {
      if (!logByPerson.has(l.person_id)) logByPerson.set(l.person_id, []);
      if (logByPerson.get(l.person_id).length < 8) {
        logByPerson.get(l.person_id).push({ ...l, by: nameOf.get(l.changed_by) ?? 'staff' });
      }
    }
  }

  // Accompanying adults' names, looked up separately (simple lookups over
  // nested joins, as everywhere in the admin).
  const adultIds = [
    ...new Set((apps ?? []).map((a) => a.accompanying_adult_person_id).filter(Boolean)),
  ];
  const { data: adultPeople } = adultIds.length
    ? await supabase.from('people').select('id, first_name, last_name').in('id', adultIds)
    : { data: [] };
  const adultName = new Map(
    (adultPeople ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()])
  );

  // Who has affirmed the Apostles' Creed. The affirmation is asked of every
  // volunteer but does not block the form (board decision, 29 Sep 2026):
  // somebody not comfortable with it is told to speak with Larry, and the
  // omission is made conspicuous HERE, at review, so nobody is approved
  // without that conversation having happened.
  // EVERY version of the Creed agreement, not only the active one. Version 2
  // shipped on 30 Sep 2026 (0081); anyone who affirmed before that holds a
  // version-1 signature, and filtering to the active version made their
  // history invisible -- so an untick read as "never affirmed" instead of
  // "affirmation withdrawn". Found by the 14 Oct round (Script 4 §5.3).
  const { data: creedRows } = await supabase
    .from('agreements')
    .select('id')
    .eq('key', 'apostles_creed');
  const creedIds = (creedRows ?? []).map((c) => c.id);
  const { data: creedSigs } =
    creedIds.length && personIds.length
      ? await supabase
          .from('agreement_signatures')
          .select('person_id')
          .in('agreement_id', creedIds)
          .in('person_id', personIds)
      : { data: [] };
  const creedAffirmedBy = new Set((creedSigs ?? []).map((s) => s.person_id));

  const appByPart = new Map((apps ?? []).map((a) => [a.registration_participant_id, a]));
  const clearanceByPerson = new Map((clearances ?? []).map((c) => [c.person_id, c]));

  const rows = vols.map((v) => {
    const app = appByPart.get(v.participantId) ?? null;
    return {
      ...v,
      app: app
        ? { ...app, accompanyingAdultName: adultName.get(app.accompanying_adult_person_id) ?? null }
        : null,
      clearance: (() => {
        const c = clearanceByPerson.get(v.person?.id) ?? null;
        if (!c) return null;
        return {
          ...c,
          verdictByName: nameOf.get(c.verdict_by) ?? null,
          paperworkByName: nameOf.get(c.paperwork_marked_by) ?? null,
          log: logByPerson.get(v.person?.id) ?? [],
        };
      })(),
      // Three states (0075): affirmed on the last save; withdrawn (a signature
      // exists but the last save left the box unticked -- re-flagged, per
      // Lawrence 29 Sep); never affirmed. The answer on the application wins;
      // the signature only fills in for applications saved before the column.
      creedAffirmed: app?.creed_affirmed ?? creedAffirmedBy.has(v.person?.id),
      creedWithdrawn: app?.creed_affirmed === false && creedAffirmedBy.has(v.person?.id),
    };
  });

  // Group by event, newest first; events without volunteers are omitted.
  const groups = (events ?? [])
    .map((ev) => ({ event: ev, rows: rows.filter((r) => r.eventId === ev.id) }))
    .filter((g) => g.rows.length > 0);
  const unassigned = rows.filter((r) => !(events ?? []).some((ev) => ev.id === r.eventId));
  if (unassigned.length) groups.push({ event: { id: 'none', name: 'Unassigned' }, rows: unassigned });

  // ?event=<id> narrows to one event (Ellen's "drop-down per event", 14 Oct
  // 2026); the print view carries the same filter.
  const eventFilter = typeof params?.event === 'string' ? params.event : '';
  const shownGroups = eventFilter ? groups.filter((g) => g.event.id === eventFilter) : groups;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <EventFilter
          events={(events ?? []).map((e) => ({ id: e.id, name: e.name, startsOn: e.starts_on, endsOn: e.ends_on, archivedAt: e.archived_at }))}
          selected={eventFilter || null}
          basePath="/admin/volunteers"
          allowAll
          allLabel="All events"
        />
        <a
          href={`/admin/volunteers/print/${eventFilter ? `?event=${eventFilter}` : ''}`}
          className="btn-outline !py-2 text-sm"
          title="The volunteer list as a printable sheet: who, which event, where they want to serve, and where their application stands."
        >
          Print volunteer list
        </a>
      </div>
      <VolunteerManager
          canReview={can(staff, 'write:registration')} groups={shownGroups} maySeeChecks={maySeeChecks} />
    </div>
  );
}
