import { redirect } from 'next/navigation';
import { allergySummary } from '@/lib/support';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import { SearchSelectLinks } from '@/components/SearchSelect';
import { todayInMorristown } from '@/lib/events';

export const metadata = { title: 'Buddy Sheets — Staff Admin' };

// One sheet per buddy, to hand out at orientation (asked for 14 Oct 2026).
//
// WHAT IS ON IT, AND WHY. The buddy is the one adult who will be beside this
// camper all week, so this sheet carries what that adult needs in their
// pocket: who the camper is (name, what they go by, age, household, program,
// room once published), the pairing notes the coordinator already uses on
// the board (how they communicate, getting around, personal care, what is
// harder, what helps), and the safety facts a buddy must not be surprised by
// -- allergies with their severity and what they are, seizures, rescue
// medication. It does NOT carry medications, diagnoses, behaviour history or
// the emergency contact: those stay with the camp nurse and the office.
//
// It is paper, and paper gets left on a table. The footer says to hand it
// back at the end of camp. The decision to print allergy detail and the
// pairing notes at all is recorded in DECISIONS.md, 14 Oct 2026; if staff
// decide the sheet should carry less, the lines to remove are marked below.

const SEVERITY = { mild: 'MILD', severe: 'SEVERE', anaphylaxis: 'ANAPHYLAXIS' };

function ageOn(dob, onDate) {
  if (!dob) return null;
  const d = new Date(dob);
  const at = onDate ? new Date(onDate) : new Date();
  if (Number.isNaN(d.getTime()) || Number.isNaN(at.getTime())) return null;
  let age = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export default async function BuddyPrintPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/buddies/print/');
  if (!can(staff, 'read:buddies')) redirect('/admin');

  const supabase = await createClient();
  const eventId = typeof params?.event === 'string' ? params.event : '';
  const only = typeof params?.buddy === 'string' ? params.buddy : '';

  const { data: event, error: eventError } = eventId
    ? await supabase
        .from('events')
        .select('id, name, starts_on, ends_on, lodging_assignments_published_at')
        .eq('id', eventId)
        .maybeSingle()
    : { data: null, error: null };
  // A failed read is an error page, never an empty sheet (CLAUDE.md).
  if (eventError) throw new Error(`Buddy sheets — event: ${eventError.message}`);

  const [
    { data: assignments, error: assignError },
    { data: participants, error: partError },
    { data: programs, error: progError },
  ] = await Promise.all([
    eventId
      ? supabase
          .from('buddy_assignments')
          .select('id, camper_participant_id, buddy_participant_id, note')
          .eq('event_id', eventId)
          .is('ended_at', null)
      : Promise.resolve({ data: [] }),
    eventId
      ? supabase
          .from('registration_participants')
          .select(
            `id, camp_role, status, program_id,
             people ( id, first_name, last_name, preferred_name, date_of_birth,
               person_support ( communication, mobility, personal_care, behaviour_triggers,
                 redirection_strategies, has_allergies, allergens, allergy_other, allergy_detail, allergy_severity,
                 has_seizures, seizure_detail, has_rescue_medication, rescue_medication_detail ) ),
             registrations!inner ( event_id, households ( display_name, phone ) )`
          )
          .eq('registrations.event_id', eventId)
          .neq('status', 'cancelled')
      : Promise.resolve({ data: [] }),
    supabase.from('programs').select('id, name'),
  ]);
  if (assignError) throw new Error(`Buddy sheets — pairings: ${assignError.message}`);
  if (partError) throw new Error(`Buddy sheets — people: ${partError.message}`);
  if (progError) throw new Error(`Buddy sheets — programs: ${progError.message}`);
  const programName = new Map((programs ?? []).map((g) => [g.id, g.name]));
  const byId = new Map((participants ?? []).map((p) => [p.id, p]));

  // Rooms only once published to families -- the same rule the dashboard
  // follows, so a buddy never knows a room before the family does.
  const camperIds = (assignments ?? []).map((a) => a.camper_participant_id);
  const { data: lodgingRows, error: lodgingError } =
    event?.lodging_assignments_published_at && camperIds.length
      ? await supabase
          .from('lodging_assignments')
          .select('registration_participant_id, lodgings ( name, parent_id )')
          .in('registration_participant_id', camperIds)
      : { data: [], error: null };
  if (lodgingError) throw new Error(`Buddy sheets — rooms: ${lodgingError.message}`);
  const roomOf = new Map((lodgingRows ?? []).map((r) => [r.registration_participant_id, r.lodgings?.name]));

  // Group by buddy: one sheet per volunteer, every camper they are paired with.
  const byBuddy = new Map();
  for (const a of assignments ?? []) {
    if (!byBuddy.has(a.buddy_participant_id)) byBuddy.set(a.buddy_participant_id, []);
    byBuddy.get(a.buddy_participant_id).push(a);
  }
  const nameOf = (p) => `${p?.people?.first_name ?? ''} ${p?.people?.last_name ?? ''}`.trim();
  // One page per PAIRING (Larry, 16 Oct 2026): a buddy with two campers gets
  // two sheets, each about one camper, so a sheet can travel with the camper
  // and nothing about a second camper is on it.
  const camperOf = (a) => byId.get(a.camper_participant_id);
  const allSheets = [...byBuddy.entries()]
    .flatMap(([buddyId, list]) => list.map((a) => ({ buddy: byId.get(buddyId), list: [a] })))
    .filter((s) => s.buddy)
    .sort(
      (a, b) =>
        nameOf(a.buddy).localeCompare(nameOf(b.buddy)) ||
        nameOf(camperOf(a.list[0])).localeCompare(nameOf(camperOf(b.list[0])))
    );
  const sheets = only ? allSheets.filter((s) => s.buddy.id === only) : allSheets;

  // The picker (26 Oct 2026): one option per buddy, not per sheet, with their
  // camper(s) as the hint so a buddy can be found by the camper's name too.
  // Built from every sheet, not the filtered ones, so the other buddies are
  // still there to choose once one is chosen. The URL is unchanged
  // (?event=…&buddy=<participant id>), so links already handed round work.
  const listNames = (names) =>
    names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const buddyOptions = [];
  for (const s of allSheets) {
    const camper = nameOf(camperOf(s.list[0]));
    const known = buddyOptions.find((o) => o.value === s.buddy.id);
    if (known) known.campers.push(camper);
    else
      buddyOptions.push({
        value: s.buddy.id,
        label: nameOf(s.buddy) || 'Unnamed buddy',
        href: `/admin/buddies/print/?event=${eventId}&buddy=${s.buddy.id}`,
        campers: [camper],
      });
  }
  const pickerOptions = buddyOptions.map(({ campers, ...o }) => ({
    ...o,
    hint: `with ${listNames(campers.filter(Boolean)) || 'a camper'}`,
  }));

  const supportOf = (p) => {
    const s = p?.people?.person_support;
    return Array.isArray(s) ? s[0] ?? null : s ?? null;
  };

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print:p-0 print:text-[12px]">
      <div className="mb-2 flex items-center justify-between print:hidden">
        <h1 className="text-xl font-bold">Buddy Sheets</h1>
        <PrintButton />
      </div>
      <p className="mb-3 text-sm text-neutral-500 print:hidden">
        One page per pairing — the buddy, the camper, the pairing notes from the board, and the
        safety facts a buddy must not be surprised by. A buddy with two campers gets two pages.
        Hand them out at orientation and collect them at the end of camp.
      </p>
      {pickerOptions.length > 1 && (
        <div className="mb-6">
          <SearchSelectLinks
            label="Print"
            printPrefix="Printed for"
            noun={['buddy', 'buddies']}
            placeholder="Type a buddy's or a camper's name"
            pinned={[{ value: '', label: 'Every buddy', href: `/admin/buddies/print/?event=${eventId}` }]}
            options={pickerOptions}
            value={only}
          />
        </div>
      )}
      {!event && <p className="text-sm text-neutral-500">No event selected.</p>}
      {event && sheets.length === 0 && (
        <p className="text-sm text-neutral-500">No buddies are paired for {event.name} yet.</p>
      )}

      {sheets.map((s) => (
        <div key={s.list[0].id} className="mb-10 break-after-page last:break-after-auto">
          <div className="border-b-2 border-neutral-800 pb-2">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Buddy sheet</p>
            <h2 className="text-2xl font-bold">{nameOf(s.buddy)}</h2>
            <p className="text-sm text-neutral-600">
              {event.name} · {event.starts_on} – {event.ends_on}
              {' · with '}
              {nameOf(camperOf(s.list[0]))}
            </p>
          </div>

          {s.list.map((a) => {
            const c = byId.get(a.camper_participant_id);
            if (!c) return null;
            const sp = supportOf(c);
            const age = ageOn(c.people?.date_of_birth, event.starts_on);
            const notes = [
              ['Communicates', sp?.communication],
              ['Getting around', sp?.mobility],
              ['Personal care', sp?.personal_care],
              ['Harder when', sp?.behaviour_triggers],
              ['What helps', sp?.redirection_strategies],
            ].filter(([, v]) => v && String(v).trim());
            return (
              <div key={a.id} className="mt-5">
                <h3 className="text-xl font-bold">
                  {nameOf(c)}
                  {c.people?.preferred_name && c.people.preferred_name !== c.people.first_name && (
                    <span className="ml-2 text-base font-normal text-neutral-600">
                      goes by &ldquo;{c.people.preferred_name}&rdquo;
                    </span>
                  )}
                </h3>
                <p className="text-sm text-neutral-700">
                  {age != null ? `${age} at camp · ` : ''}
                  {c.camp_role === 'sibling' ? 'sibling' : 'camper'} ·{' '}
                  {c.registrations?.households?.display_name}
                  {c.program_id ? ` · ${programName.get(c.program_id) ?? ''}` : ''}
                  {roomOf.get(c.id) ? ` · staying in ${roomOf.get(c.id)}` : ''}
                </p>

                {/* Safety facts. The lines a future decision might remove are
                    the two detail lines (allergy detail, seizure detail). */}
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  {sp?.has_allergies && (
                    <span className="rounded-sm border border-red-700 px-2 py-0.5 font-semibold text-red-800">
                      ALLERGY{sp.allergy_severity ? ` — ${SEVERITY[sp.allergy_severity] ?? sp.allergy_severity}` : ' — severity not recorded'}
                      {allergySummary(sp) ? `: ${allergySummary(sp)}` : ''}
                    </span>
                  )}
                  {sp?.has_seizures && (
                    <span className="rounded-sm border border-red-700 px-2 py-0.5 font-semibold text-red-800">
                      SEIZURES{sp.seizure_detail ? `: ${sp.seizure_detail}` : ''}
                    </span>
                  )}
                  {sp?.has_rescue_medication && (
                    <span className="rounded-sm border border-red-700 px-2 py-0.5 font-semibold text-red-800">
                      RESCUE MEDICATION — the nurse holds it
                      {sp.rescue_medication_detail ? `: ${sp.rescue_medication_detail}` : ''}
                    </span>
                  )}
                  {!sp && (
                    <span className="rounded-sm border border-amber-600 px-2 py-0.5 font-semibold text-amber-800">
                      No support details on file — ask the coordinator before camp
                    </span>
                  )}
                </div>

                {notes.length > 0 && (
                  <dl className="mt-3 text-sm">
                    {notes.map(([k, v]) => (
                      <div key={k} className="flex gap-2 border-b border-neutral-200 py-1">
                        <dt className="w-32 shrink-0 font-semibold text-neutral-600">{k}</dt>
                        <dd className="min-w-0 flex-1">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {a.note && (
                  <p className="mt-2 text-sm">
                    <span className="font-semibold text-neutral-600">From the coordinator: </span>
                    {a.note}
                  </p>
                )}
              </div>
            );
          })}

          <p className="mt-6 border-t border-neutral-300 pt-2 text-xs text-neutral-500">
            Questions about anything here go to the coordinator or the camp nurse, not the family
            directly. This sheet is for you alone: keep it with you, and hand it back at the end of
            camp. Printed {todayInMorristown()} · Luke 14 Ministries.
          </p>
        </div>
      ))}
    </div>
  );
}
