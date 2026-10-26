import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import { SearchSelectLinks } from '@/components/SearchSelect';
import { dayInMorristown } from '@/lib/events';
import { waiverReviewPill } from '@/lib/format';

export const metadata = { title: 'Activity Sheets — Staff Admin' };

// E51: one printable sheet per activity, for the area leader.
//
// The kitchen has a printout and the roster has one; the person running archery
// had to read a screen and remember. This is the register they carry: who is
// signed up, for which sitting, with a box to tick them off.
//
// WHAT IT DELIBERATELY DOES NOT CARRY. No allergy text, no medications, no
// behaviour notes — a FLAG, and "ask the coordinator". That is the line 0061
// drew for program leaders and it holds here for the same two reasons: an area
// leader needs to know there is something to ask about rather than to read a
// child's medical history, and this sheet is paper. Paper gets left on a table.
//
// The columns holding the actual detail are not selected at all, so they cannot
// reach the page by accident later.
//
// Guarded on `coordinator`, matching the Activities page it prints from. Not
// `sensitive`: there is nothing here beyond names and a flag, and requiring it
// would put the register out of reach of the people who run the activities.

export default async function ActivityPrintPage({ searchParams }) {
  const params = await searchParams;

  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/activities/print/');
  if (!can(staff, 'read:activities')) redirect('/admin');

  const supabase = await createClient();

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on')
    .order('starts_on');
  // A failed read is an error page, never an empty register (CLAUDE.md).
  if (eventsError) throw new Error(`Activity sheets — events: ${eventsError.message}`);

  const selected =
    (typeof params?.event === 'string' && params.event) || events?.[0]?.id || null;
  const event = (events ?? []).find((e) => e.id === selected) ?? null;

  const { data: activities, error: activitiesError } = selected
    ? await supabase
        .from('activities')
        .select('id, name, description, capacity, active, sort_order, provider_name, provider_url')
        .eq('event_id', selected)
        .eq('active', true)
        .order('sort_order')
    : { data: [], error: null };
  if (activitiesError) throw new Error(`Activity sheets — activities: ${activitiesError.message}`);

  // ?activity=<id> prints one sheet. Asked for 14 Oct 2026: the leader of
  // one activity wants their own register, not the whole booklet.
  const only = typeof params?.activity === 'string' ? params.activity : '';
  const shown = only ? (activities ?? []).filter((a) => a.id === only) : activities ?? [];

  const activityIds = (activities ?? []).map((a) => a.id);

  const { data: slotRows, error: slotsError } = activityIds.length
    ? await supabase
        .from('activity_slots')
        .select('id, activity_id, slot_date, start_time, end_time, label, capacity')
        .in('activity_id', activityIds)
        .order('slot_date')
        .order('start_time')
    : { data: [], error: null };
  if (slotsError) throw new Error(`Activity sheets — times: ${slotsError.message}`);

  const { data: signups, error: signupsError } = activityIds.length
    ? await supabase
        .from('activity_signups')
        .select(
          `activity_id, slot_id, status,
           registration_participants ( id, camp_role, person_id, registration_id,
             people ( first_name, last_name, preferred_name,
               person_support ( has_allergies, has_seizures, has_rescue_medication, buddy_required ) ),
             registrations ( households ( display_name ) ) )`
        )
        .in('activity_id', activityIds)
    : { data: [], error: null };
  if (signupsError) throw new Error(`Activity sheets — sign-ups: ${signupsError.message}`);

  // Provider confirmations (0087): on a provider-run activity the sheet says
  // who has one and who has not, so the day starts with the list, not a hunt.
  // Since 0124 it says what staff made of it -- awaiting check, accepted, or
  // rejected with the reason -- the same three states as the Activities page.
  // A provider named only by its link counts, as in activity_waivers_outstanding.
  const providerIds = new Set(
    (activities ?? [])
      .filter((a) => (a.provider_name ?? '').trim() || (a.provider_url ?? '').trim())
      .map((a) => a.id)
  );
  const { data: waiverRows, error: waiverError } = activityIds.length
    ? await supabase
        .from('activity_waiver_uploads')
        .select('activity_id, registration_participant_id, review_status, review_note')
        .in('activity_id', activityIds)
    : { data: [], error: null };
  if (waiverError) throw new Error(`Waiver confirmations: ${waiverError.message}`);
  const uploadByKey = new Map(
    (waiverRows ?? []).map((w) => [
      `${w.activity_id}:${w.registration_participant_id}`,
      { status: w.review_status, note: w.review_note },
    ])
  );

  // The ministry's own waiver (0116, horseback): on an activity that carries
  // one the sheet gets a Waiver column -- signed on the site, with the date,
  // or NOT signed -- so the riding staff know before anyone is on a horse.
  const { data: reqRows, error: reqError } = activityIds.length
    ? await supabase
        .from('agreement_requirements')
        .select('activity_id, agreements ( id, active, delivery )')
        .in('activity_id', activityIds)
        .eq('is_required', true)
    : { data: [], error: null };
  if (reqError) throw new Error(`Activity agreements: ${reqError.message}`);
  const agreementIdByActivity = new Map();
  for (const r of reqRows ?? []) {
    const a = r.agreements;
    if (!a?.active || a.delivery !== 'internal_document') continue;
    if (!agreementIdByActivity.has(r.activity_id)) agreementIdByActivity.set(r.activity_id, a.id);
  }
  const agreementIds = [...new Set(agreementIdByActivity.values())];
  const { data: sigRows, error: sigError } = agreementIds.length
    ? await supabase
        .from('agreement_signatures')
        .select('agreement_id, person_id, registration_id, signed_at')
        .in('agreement_id', agreementIds)
        .not('person_id', 'is', null)
    : { data: [], error: null };
  if (sigError) throw new Error(`Activity waiver signatures: ${sigError.message}`);
  const signedAtByKey = new Map(
    (sigRows ?? []).map((s) => [`${s.agreement_id}:${s.person_id}:${s.registration_id}`, s.signed_at])
  );

  const shape = (g) => {
    const rp = g.registration_participants;
    const agreementId = agreementIdByActivity.get(g.activity_id);
    const pe = rp?.people;
    const s = Array.isArray(pe?.person_support) ? pe.person_support[0] : pe?.person_support;
    const base = `${pe?.first_name ?? ''} ${pe?.last_name ?? ''}`.trim();
    const preferred =
      pe?.preferred_name && pe.preferred_name !== pe.first_name ? pe.preferred_name : null;
    return {
      name: base || 'Unnamed',
      // The nametag name, shown beside the legal one rather than instead of it:
      // the leader is calling this person by name all afternoon (E45).
      preferred,
      household: rp?.registrations?.households?.display_name ?? '',
      role: rp?.camp_role,
      ask: Boolean(
        s?.has_allergies || s?.has_seizures || s?.has_rescue_medication || s?.buddy_required
      ),
      // The provider's confirmation: null where the activity has no outside
      // provider, 'missing' with no upload, else the upload's review.
      provider: providerIds.has(g.activity_id)
        ? uploadByKey.get(`${g.activity_id}:${rp?.id}`) ?? 'missing'
        : null,
      // The site's own waiver: the day it was signed, '' for not signed, null
      // where the activity has none (the column is then left off the sheet).
      signed: agreementId
        ? dayInMorristown(signedAtByKey.get(`${agreementId}:${rp?.person_id}:${rp?.registration_id}`) ?? '')
        : null,
    };
  };

  const bySlot = new Map();
  const byActivityNoSlot = new Map();
  for (const g of signups ?? []) {
    if (g.status === 'cancelled') continue;
    const row = shape(g);
    if (g.slot_id) {
      if (!bySlot.has(g.slot_id)) bySlot.set(g.slot_id, []);
      bySlot.get(g.slot_id).push(row);
    } else {
      if (!byActivityNoSlot.has(g.activity_id)) byActivityNoSlot.set(g.activity_id, []);
      byActivityNoSlot.get(g.activity_id).push(row);
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);

  const slotsByActivity = new Map();
  for (const sl of slotRows ?? []) {
    if (!slotsByActivity.has(sl.activity_id)) slotsByActivity.set(sl.activity_id, []);
    slotsByActivity.get(sl.activity_id).push(sl);
  }

  // "12:00:00–17:00:00" printed raw on the sheet (29 Sep, §18). Clock times
  // read as a person would say them; a value that is not HH:MM[:SS] is
  // shown as it came.
  const clock = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
    if (!m) return t ?? '';
    const h = Number(m[1]);
    const suffix = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m[2]} ${suffix}`;
  };
  const timeOf = (sl) =>
    [sl.slot_date, [sl.start_time, sl.end_time].filter(Boolean).map(clock).join('–')]
      .filter(Boolean)
      .join(' · ');

  // waiverColumn: the activity carries the site's own waiver (0116) or an
  // outside provider's (0087/0124), so the sheet says per rider where each
  // stands. Left off every other sheet.
  const Register = ({ rows, waiverColumn = false }) =>
    rows.length === 0 ? (
      <p className="text-sm text-neutral-500">Nobody signed up.</p>
    ) : (
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-400">
            <th className="w-8 py-1">✓</th>
            <th className="py-1 pr-3">Name</th>
            <th className="py-1 pr-3">Family</th>
            <th className="py-1">Support</th>
            {waiverColumn && <th className="py-1 pl-3">Waiver</th>}
          </tr>
        </thead>
        <tbody>
          {[...rows].sort(byName).map((r, i) => (
            <tr key={i} className="border-b border-neutral-200">
              <td className="py-1.5">
                <span className="inline-block h-3.5 w-3.5 border border-neutral-500" />
              </td>
              <td className="py-1.5 pr-3 font-medium">
                {r.name}
                {r.preferred && (
                  <span className="font-normal text-neutral-600"> &ldquo;{r.preferred}&rdquo;</span>
                )}
              </td>
              <td className="py-1.5 pr-3 text-neutral-600">{r.household}</td>
              <td className="py-1.5">
                {r.ask ? (
                  <span className="font-semibold">ask the coordinator</span>
                ) : (
                  <span className="text-neutral-400">&mdash;</span>
                )}
              </td>
              {waiverColumn && (
                <td className="py-1.5 pl-3">
                  {r.signed !== null && (
                    r.signed ? (
                      <span className="block text-xs">signed {r.signed}</span>
                    ) : (
                      <span className="block text-xs font-semibold">NOT signed</span>
                    )
                  )}
                  {r.provider === 'missing' && (
                    <span className="block text-xs font-semibold">NO provider confirmation</span>
                  )}
                  {r.provider && r.provider !== 'missing' && (
                    <span
                      className={`block text-xs ${r.provider.status === 'accepted' ? '' : 'font-semibold'}`}
                    >
                      provider form: {waiverReviewPill(r.provider).text}
                    </span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    );

  // The picker (26 Oct 2026, the same searchable dropdown as Buddy Sheets):
  // "All activities" pinned and the default, one option per activity with
  // how many are signed up. URL unchanged: ?event=…&activity=<id>.
  const signedUp = new Map();
  for (const g of signups ?? []) {
    if (g.status === 'cancelled') continue;
    signedUp.set(g.activity_id, (signedUp.get(g.activity_id) ?? 0) + 1);
  }
  const pickerOptions = (activities ?? []).map((a) => {
    const n = signedUp.get(a.id) ?? 0;
    const sittings = (slotsByActivity.get(a.id) ?? []).length;
    return {
      value: a.id,
      label: a.name,
      href: `/admin/activities/print/?event=${selected ?? ''}&activity=${a.id}`,
      hint: [
        `${n} signed up`,
        sittings > 1 ? `${sittings} sittings` : '',
        (a.provider_name ?? '').trim(),
      ]
        .filter(Boolean)
        .join(' · '),
    };
  });

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print:p-0 print:text-[12px]">
      <div className="mb-2 flex items-center justify-between print:hidden">
        <h1 className="text-xl font-bold">Activity sheets</h1>
        <PrintButton />
      </div>
      <p className="mb-3 text-sm text-neutral-500 print:hidden">
        One register per activity, per sitting. Names and a flag only &mdash; the detail behind
        &ldquo;ask the coordinator&rdquo; stays on the Medical &amp; Support page, because this
        sheet is paper and paper gets left on a table. The <strong>Support</strong> column is
        about the person, not the activity: it reads the same on every sheet they appear on.
      </p>
      {pickerOptions.length > 1 && (
        <div className="mb-6">
          <SearchSelectLinks
            label="Print"
            printPrefix="Printed for"
            noun={['activity', 'activities']}
            placeholder="Type an activity's name"
            pinned={[
              { value: '', label: 'All activities', href: `/admin/activities/print/?event=${selected ?? ''}` },
            ]}
            options={pickerOptions}
            value={only}
          />
        </div>
      )}

      <p className="mb-6 text-sm font-semibold">
        {event ? `${event.name} · ${event.starts_on} – ${event.ends_on}` : 'No event selected'}
      </p>

      {(activities ?? []).length === 0 && (
        <p className="text-sm text-neutral-500">No activities are open for this event.</p>
      )}

      {/* Each activity starts a new page: the leader carries one sheet, not a
          booklet with three other activities on the back of theirs. */}
      {shown.map((a) => {
        const slots = slotsByActivity.get(a.id) ?? [];
        const loose = byActivityNoSlot.get(a.id) ?? [];
        return (
          <div key={a.id} className="mb-10 break-after-page last:break-after-auto">
            <h2 className="mb-1 border-b-2 border-neutral-800 pb-1 text-lg font-bold">{a.name}</h2>
            {a.description && <p className="mb-3 text-sm text-neutral-600">{a.description}</p>}

            {slots.length === 0 ? (
              <Register rows={loose} waiverColumn={agreementIdByActivity.has(a.id) || providerIds.has(a.id)} />
            ) : (
              slots.map((sl) => (
                <div key={sl.id} className="mb-5 break-inside-avoid">
                  <p className="mb-1 text-sm font-semibold">
                    {sl.label ? `${sl.label} — ` : ''}
                    {timeOf(sl)}
                    <span className="ml-2 font-normal text-neutral-500">
                      {(bySlot.get(sl.id) ?? []).length}
                      {sl.capacity ? ` of ${sl.capacity}` : ''} signed up
                    </span>
                  </p>
                  <Register rows={bySlot.get(sl.id) ?? []} waiverColumn={agreementIdByActivity.has(a.id) || providerIds.has(a.id)} />
                </div>
              ))
            )}

            {/* Somebody signed up to the activity but not to a sitting. They
                would otherwise appear on no sheet at all, which is the failure
                mode a paper register is meant to prevent. */}
            {slots.length > 0 && loose.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-sm font-semibold">No sitting chosen</p>
                <Register rows={loose} waiverColumn={agreementIdByActivity.has(a.id) || providerIds.has(a.id)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
