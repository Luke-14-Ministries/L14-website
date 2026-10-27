import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import RosterTable from './RosterTable';

export const metadata = { title: 'Rosters — Staff Admin' };

// Server side just loads the data; RosterTable (client) owns filtering,
// sorting, and building the CSV/print links so the download always matches
// exactly what's on screen.
export default async function RostersPage() {
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/rosters/');
  if (!can(staff, 'read:registration')) redirect('/admin');
  const seesMoney = can(staff, 'read:payments');

  const supabase = await createClient();

  const [
    { data: events, error: eventsError },
    { data: regs, error: regsError },
    { data: consents, error: consentsError },
    { data: sigs, error: sigsError },
    { data: balances, error: balancesError },
    { data: programs, error: programsError },
  ] =
    await Promise.all([
    supabase
      .from('events')
      .select('id, name, starts_on, ends_on, archived_at, deposit_cents')
      .order('starts_on'),
    supabase
      .from('registrations')
      .select(
        `id, event_id, created_at, family_notes,
         households ( display_name, email, phone ),
         registration_participants ( id, camp_role, status, submitted_at, created_at,
           tshirt_size, first_time_attending, program_id,
           participant_money ( fee_cents ),
           people ( id, first_name, last_name, gender ) )`
      )
      .order('created_at'),
    // person_consents is append-only, so "the current answer" is the newest
    // row. The view (migration 0030) resolves that once; every consumer used
    // to re-derive it by hand.
    supabase.from('person_current_consents').select('person_id, kind, granted'),
    // We only need to know WHETHER a registration has been signed for; the
    // detail page shows which agreements and when.
    supabase.from('agreement_signatures').select('registration_id'),
    // What each family has actually paid. The roster is where staff look
    // before a week starts, and "has this family held their places?" was not
    // answerable from it (25 Aug) -- a family of three showing one $50 deposit
    // looked settled.
    supabase.from('registration_balances').select('registration_id, paid_cents'),
    // E21. The roster knew everything about a person except which program they
    // are in — the one thing a program leader's week is organised around. Read
    // as a small lookup rather than a nested join: PostgREST joins through two
    // FKs to the same table are fragile here (a working rule from CLAUDE.md),
    // and this is three rows.
    supabase.from('programs').select('id, name, sort_order').order('sort_order'),
  ]);
  // CLAUDE.md: never turn a query error into an empty list -- a failed read
  // here would show a roster with nobody on it.
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);
  if (regsError) throw new Error(`Registrations: ${regsError.message}`);
  if (consentsError) throw new Error(`Consents: ${consentsError.message}`);
  if (sigsError) throw new Error(`Agreement signatures: ${sigsError.message}`);
  if (balancesError) throw new Error(`Balances: ${balancesError.message}`);
  if (programsError) throw new Error(`Programs: ${programsError.message}`);

  const consentOf = new Map();
  for (const c of consents ?? []) consentOf.set(`${c.person_id}:${c.kind}`, c.granted);
  const signedRegs = new Set((sigs ?? []).map((s) => s.registration_id).filter(Boolean));
  const paidByReg = new Map((balances ?? []).map((b) => [b.registration_id, b.paid_cents ?? 0]));
  const depositByEvent = new Map((events ?? []).map((e) => [e.id, e.deposit_cents ?? 0]));

  const programNameById = new Map((programs ?? []).map((g) => [g.id, g.name]));

  const rows = [];
  for (const r of regs ?? []) {
    // Per REGISTRATION, not per person: the deposit holds places, so three
    // people coming means three deposits.
    const live = (r.registration_participants ?? []).filter((p) => p.status !== 'cancelled')
      .length;
    const each = depositByEvent.get(r.event_id) ?? 0;
    const due = each * live;
    // Only judged by someone who can see payments (0111): the balances view
    // shows $0 to everyone else, which would flag every family as short.
    const paid = paidByReg.get(r.id) ?? 0;
    const depositShort = seesMoney && each > 0 && live > 0 && paid < due;

    for (const p of r.registration_participants ?? []) {
      const pid = p.people?.id;
      rows.push({
        eventId: r.event_id,
        registrationId: r.id,
        // Carried so a volunteer's row can link across to their application
        // and background check. The trip back the other way has always
        // existed; this one did not (25 Aug).
        participantId: p.id,
        household: r.households?.display_name ?? 'Household',
        contact: [r.households?.email, r.households?.phone].filter(Boolean).join(' · '),
        person: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
        // E04/E05: the person cell links to their own page.
        personId: pid ?? null,
        sex: p.people?.gender ?? '',
        role: p.camp_role,
        status: p.status,
        // From participant_money (0114): the database hands it only to
        // Payments readers, so for anyone else the embed is null and the
        // table draws "—". Never defaulted to 0 -- a $0 fee is a claim.
        fee: p.participant_money?.fee_cents ?? null,
        submitted: p.submitted_at ?? p.created_at ?? '',
        tshirt: p.tshirt_size ?? '',
        programId: p.program_id ?? '',
        program: p.program_id ? programNameById.get(p.program_id) ?? 'Unknown program' : '',
        firstTime: p.first_time_attending,
        // null means never asked, which is NOT a refusal and must never be
        // displayed as one -- the photographers' list has to distinguish
        // "they said no" from "we don't know".
        media: pid ? consentOf.get(`${pid}:media`) ?? null : null,
        directory: pid ? consentOf.get(`${pid}:directory`) ?? null : null,
        agreementsSigned: signedRegs.has(r.id),
        // A note the family typed on the last card of the registration form.
        // Carried onto the roster (24 Aug) because until now nothing told
        // staff a note EXISTED without opening each registration -- which is
        // the same as not collecting it.
        familyNote: r.family_notes ?? '',
        depositShort,
        depositPaid: paid,
        depositDue: due,
      });
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Rosters</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Everyone registered, by event — filter below, click a column heading to sort. The CSV
        download matches whatever is filtered on screen. Select a household to review it, change
        a status, or add and edit people.
      </p>

      <RosterTable
        events={(events ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          startsOn: e.starts_on,
          endsOn: e.ends_on, archivedAt: e.archived_at
        }))}
        programs={(programs ?? []).map((g) => ({ id: g.id, name: g.name }))}
        rows={rows}
      />
    </div>
  );
}
