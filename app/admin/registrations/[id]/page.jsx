import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import RegistrationManager from './RegistrationManager';
import StaffPlanPanel from './StaffPlanPanel';
import FeesPanel from './FeesPanel';
import { requiresPaymentChoice, planFailingSince } from '@/lib/plans';
import { dayInMorristown, balanceDueOn, todayInMorristown } from '@/lib/events';
import { signedPhotoUrls } from '@/lib/photos';
import { creedByRegistration, CREED_COLUMNS } from '@/lib/creed';
import { loadEmailLog } from '@/lib/emailLog';
import { rejectedOutsideView } from '@/lib/rejectedUploads';
import EmailLog from '@/components/EmailLog';
import Panel from './Panel';

export const metadata = { title: 'Registration — Staff Admin' };

// What a registration is waiting on staff for, as short phrases -- the amber
// marker on its week tab and the tab's tooltip (26 Oct 2026). The same rule
// for this registration and the household's others, from facts this page
// reads for all of them. "Submitted" counts only while the registration is
// not waiting on the family, as the nav's review badge counts it; deposit
// short is registration_review's flag, so it is there only for Payments read.
function staffAttention(r, { waiversOwed = false, depositShort = false, creedPending = false } = {}) {
  const out = [];
  const people = r.registration_participants ?? [];
  if (!r.awaiting_family_since && people.some((p) => p.status === 'submitted')) out.push('someone submitted');
  if (r.family_reply_unread) out.push('unread family reply');
  if (r.hold_since) out.push('on hold');
  if (waiversOwed) out.push('activity waiver outstanding');
  if (depositShort) out.push('deposit short');
  if (creedPending) out.push('Creed conversation');
  return out;
}

// One family's registration, for a registrar to review and manage. Everything
// read here comes back under row-level security as staff, so a registrar sees
// the whole ministry; the write actions live in ./actions.js.
export default async function RegistrationDetailPage({ params }) {
  // In Next.js 15 params is a promise.
  const { id } = await params;

  const staff = await getStaff();
  if (!staff) await bounceNonStaff(`/admin/registrations/${id}/`);
  if (!can(staff, 'read:registration')) redirect('/admin');

  const supabase = await createClient();

  const { data: reg, error: regError } = await supabase
    .from('registrations')
    .select(
      `id, family_notes, created_at, awaiting_family_since, awaiting_family_reason,
       family_replied_at, family_reply_seen_at, family_reply_unread,
       deposit_waived_at, deposit_waived_by, deposit_waived_reason,
       hold_since, hold_reason, hold_by,
       households ( id, display_name, email, phone,
                    address_line1, address_line2, city, state, postal_code,
                    home_church, how_did_you_hear, how_did_you_hear_from ),
       events ( id, name, event_type, starts_on, ends_on, deposit_cents, balance_due_on ),
       registration_participants (
         id, camp_role, status, confirmed_at,
         status_changed_at, status_changed_by, waitlist_reason,
         tshirt_size, first_time_attending,
         participant_money ( fee_cents, scholarship_cents, discount_cents, discount_reason ),
         people ( id, first_name, last_name, preferred_name, date_of_birth,
                  gender, email, phone )
       )`
    )
    .eq('id', id)
    .maybeSingle();

  // CLAUDE.md: never swallow a query error -- a dropped one read as a 404.
  if (regError) throw new Error(`Registration page: ${regError.message}`);
  if (!reg) notFound();

  // Money lives in participant_money (0114), one row per participant, and the
  // database shows it only to Payments readers and the family itself. For a
  // staff member without Payments read the embed is null -- not zero, not
  // "no fee", but "not yours to see". Every number below is read through this
  // helper so a null stays null all the way to the screen, where it is drawn
  // as "—". Defaulting it to 0 here would tell a reviewer the camp is free.
  const moneyOf = (p) => p?.participant_money ?? null;

  // Who put it on hold (0098), by name -- the family never sees this part.
  let holdBy = null;
  if (reg.hold_by) {
    const { data: hb, error: hbError } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', reg.hold_by)
      .maybeSingle();
    if (hbError) throw new Error(`On hold by: ${hbError.message}`);
    holdBy = hb ? `${hb.first_name ?? ''} ${hb.last_name ?? ''}`.trim() || null : null;
  }
  const hold = reg.hold_since
    ? { since: reg.hold_since, reason: reg.hold_reason ?? null, by: holdBy }
    : null;

  // Who last changed each person's status (0128), by name, for the Review
  // card's "Waitlisted: ... (when, by whom)" lines. Rows from before 0128
  // have no stamp; a server-side change has a time but no name.
  const changerIds = [
    ...new Set((reg.registration_participants ?? []).map((p) => p.status_changed_by).filter(Boolean)),
  ];
  let changerNames = new Map();
  if (changerIds.length) {
    const { data: changers, error: changersError } = await supabase
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', changerIds);
    if (changersError) throw new Error(`Status changed by: ${changersError.message}`);
    changerNames = new Map(
      (changers ?? []).map((c) => [c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || null])
    );
  }

  // Every registration this household holds, for the week tabs at the top
  // (15 Oct 2026; tabs 26 Oct): a family at two events is one family, and
  // the registrar moves between the two from here. One row per household per
  // event (unique in 0001), so this is the complete list. The waiting-on
  // columns feed each tab's amber marker (staffAttention above).
  const { data: familyRegs, error: familyRegsError } = reg.households?.id
    ? await supabase
        .from('registrations')
        .select(
          `id, awaiting_family_since, family_reply_unread, hold_since,
           events ( id, name, starts_on, ends_on ),
           registration_participants ( status, people ( id, first_name, last_name ) )`
        )
        .eq('household_id', reg.households.id)
    : { data: [], error: null };
  if (familyRegsError) throw new Error(`Family registrations lookup failed: ${familyRegsError.message}`);
  // This registration is always among them, even if the household lookup
  // above had nothing to go on.
  const familyRegIds = [...new Set([id, ...(familyRegs ?? []).map((r) => r.id)])];

  // The Apostles' Creed flag (0130), for this registration and the
  // household's others (the week tabs' markers): from creed_status, which
  // reads no money, so Registration read sees it (Lawrence, 26 Oct 2026). A
  // conversation with Larry covers the people it was about, under the names
  // they had then -- someone added or renamed since raises the flag again.
  const { data: creedRows, error: creedError } = await supabase
    .from('creed_status')
    .select(CREED_COLUMNS)
    .in('registration_id', familyRegIds);
  if (creedError) throw new Error(`Creed status: ${creedError.message}`);
  const creedByReg = creedByRegistration(creedRows);
  let creed = creedByReg.get(id) ?? null;
  if (creed?.covered.length) {
    const byIds = [...new Set(creed.covered.map((c) => c.byId).filter(Boolean))];
    let byName = new Map();
    if (byIds.length) {
      const { data: cbs, error: cbError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', byIds);
      if (cbError) throw new Error(`Creed conversation recorded by: ${cbError.message}`);
      byName = new Map((cbs ?? []).map((c) => [c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || null]));
    }
    creed = { ...creed, covered: creed.covered.map((c) => ({ ...c, by: byName.get(c.byId) ?? null })) };
  }

  // Every email the site has sent this household (message_log; 26 Oct 2026 --
  // the record existed but no staff page showed it). The family's emails, not
  // just this week's: each line names its event when they have more than one.
  const emails = reg.households?.id ? await loadEmailLog(supabase, { householdId: reg.households.id, limit: 50 }) : [];
  const eventNameByReg = new Map((familyRegs ?? []).map((r) => [r.id, r.events?.name ?? null]));
  const manyEvents = (familyRegs ?? []).length > 1;

  // Camp options for this event, so a staff member adding a person can pick the
  // one that sets the fee. Without an event there is nothing to ask for (and
  // an undefined id would come back as a uuid error).
  const { data: options, error: optionsError } = reg.events?.id
    ? await supabase
        .from('event_options')
        .select('id, name, participant_role, fee_cents')
        .eq('event_id', reg.events.id)
        .order('sort_order')
    : { data: [], error: null };
  if (optionsError) throw new Error(`Event options: ${optionsError.message}`);

  // Scholarships on this registration, in two piles.
  //
  // This query used to omit requested_cents entirely, which is why every
  // pending request on this page read "$0 requested" — the number was never
  // fetched, so the screen quietly reported that a family had asked for
  // nothing. Raised in testing, 25 Aug.
  //
  // The two piles are the point. A request WAITING on a decision and a record
  // of a decision already made are different objects: one is work, the other
  // is history. They were rendered as one light-grey list at the bottom of the
  // page, which is how a family's ask for help ended up looking like an
  // archived receipt.
  //
  // Reviewer names are looked up separately — nested joins with two FKs to
  // profiles are fragile, so keep the lookups simple.
  const partIds = (reg.registration_participants ?? []).map((p) => p.id);
  let adjustmentRecords = [];
  let scholarshipRequests = [];
  if (partIds.length) {
    const { data: schols, error: scholsError } = await supabase
      .from('scholarships')
      .select(
        'registration_participant_id, requested_cents, granted_cents, status, family_statement, staff_note, reviewed_by, reviewed_at, created_at, updated_at'
      )
      .in('registration_participant_id', partIds);
    if (scholsError) throw new Error(`Scholarships: ${scholsError.message}`);
    const reviewerIds = [...new Set((schols ?? []).map((s) => s.reviewed_by).filter(Boolean))];
    let names = new Map();
    if (reviewerIds.length) {
      const { data: profs, error: profsError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', reviewerIds);
      if (profsError) throw new Error(`Scholarship reviewers: ${profsError.message}`);
      names = new Map((profs ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()]));
    }
    const partById = new Map((reg.registration_participants ?? []).map((p) => [p.id, p]));

    adjustmentRecords = (schols ?? [])
      .filter((s) => s.status !== 'requested')
      .map((s) => ({
        participantId: s.registration_participant_id,
        grantedCents: s.granted_cents,
        status: s.status,
        // Kept apart since 0048: the family's words and the staff's reasoning
        // are different claims by different people, and the staff note used to
        // overwrite the family's statement.
        familyStatement: s.family_statement,
        staffNote: s.staff_note,
        grantedBy: names.get(s.reviewed_by) ?? null,
        at: s.reviewed_at ?? s.updated_at,
      }));

    scholarshipRequests = (schols ?? [])
      .filter((s) => s.status === 'requested')
      .map((s) => {
        const part = partById.get(s.registration_participant_id);
        return {
          participantId: s.registration_participant_id,
          registrationId: reg.id,
          name:
            `${part?.people?.first_name ?? ''} ${part?.people?.last_name ?? ''}`.trim() ||
            'Person',
          // The participant row below already carries the role badge.
          roleLabel: null,
          // null when this staffer may not read money (see moneyOf above);
          // the card then shows "—" instead of a $0 fee.
          feeCents: moneyOf(part)?.fee_cents ?? null,
          discountCents: moneyOf(part)?.discount_cents ?? null,
          requestedCents: s.requested_cents,
          grantedCents: s.granted_cents ?? 0,
          status: s.status,
          familyStatement: s.family_statement ?? '',
          staffNote: s.staff_note ?? '',
          requestedAt: s.created_at,
          // A family whose request was turned down may ask again, which flips
          // the same row back to 'requested'. Carrying the earlier decision
          // through means a registrar sees they are answering a SECOND time,
          // and what was said the first time.
          reviewedAt: s.reviewed_at,
          reviewedBy: names.get(s.reviewed_by) ?? null,
          cancelled: part?.status === 'cancelled',
        };
      })
      // Someone removed from the week has nothing left to decide.
      .filter((r) => !r.cancelled);
  }

  // The conversation with the family (0019; their replies since 0126): staff
  // notes and the family's replies, OLDEST first so it reads as a thread,
  // with author names looked up separately.
  const { data: msgs, error: msgsError } = await supabase
    .from('registration_family_messages')
    .select('id, body, created_by, created_at, author_kind')
    .eq('registration_id', id)
    .order('created_at', { ascending: true });
  if (msgsError) throw new Error(`Notes to the family: ${msgsError.message}`);
  const authorIds = [...new Set((msgs ?? []).map((m) => m.created_by).filter(Boolean))];
  let authorNames = new Map();
  if (authorIds.length) {
    const { data: authors, error: authorsError } = await supabase
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', authorIds);
    if (authorsError) throw new Error(`Note authors: ${authorsError.message}`);
    authorNames = new Map((authors ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`.trim()]));
  }
  const familyMessages = (msgs ?? []).map((m) => ({
    id: m.id,
    body: m.body,
    fromFamily: m.author_kind === 'family',
    author:
      authorNames.get(m.created_by) ?? (m.author_kind === 'family' ? 'The family' : 'Staff'),
    at: dayInMorristown(m.created_at),
    createdAt: m.created_at,
  }));
  // The family's latest reply (0126) and whether staff have read it since --
  // family_reply_unread is generated in the database, the one rule.
  const familyReply = reg.family_replied_at
    ? {
        at: reg.family_replied_at,
        unread: Boolean(reg.family_reply_unread),
        // What they wrote since staff last read (or the last reply).
        messages: familyMessages.filter(
          (m) =>
            m.fromFamily &&
            (!reg.family_reply_seen_at ||
              Date.parse(m.createdAt) > Date.parse(reg.family_reply_seen_at))
        ),
      }
    : null;

  // Current media / directory answers for these people, and the agreements
  // this household signed for this registration. Both are new surfaces: until
  // now a registrar could not see either, so a family could tell us something
  // at registration and nobody in the ministry would ever read it.
  const peopleIds = (reg.registration_participants ?? [])
    .map((p) => p.people?.id)
    .filter(Boolean);

  // The header number a registrar actually wants when opening a family:
  // what is still owed. Full payment history stays on Event Payments.
  // Without Payments read this is no row and no error (CLAUDE.md, Money), so
  // balanceRow stays null and the screen shows "—"; only a real error throws.
  const { data: balanceRow, error: balanceError } = await supabase
    .from('registration_balances')
    .select('fee_cents, discount_cents, scholarship_cents, coupon_cents, paid_cents, balance_cents, refund_pending_cents, early_discount_cents, family_discount_cents, fees_cents')
    .eq('registration_id', id)
    .maybeSingle();
  if (balanceError) throw new Error(`Balance: ${balanceError.message}`);

  // Payments on this registration, with any refunds already issued against
  // each. Refunds are per-PAYMENT (you refund a transaction, not a balance),
  // so the two have to arrive together or the UI cannot say how much of a
  // given payment is still refundable.
  // Row-level security leaves both empty for staff without Payments read.
  const [{ data: paymentRows, error: paymentsError }, { data: refundRows, error: refundsError }] = await Promise.all([
    supabase
      .from('payments')
      .select('id, amount_cents, fee_cover_cents, method, status, received_on, created_at, note, stripe_payment_intent_id, payer_email, payer_name')
      .eq('registration_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('payment_refunds')
      .select(
        'id, payment_id, amount_cents, fee_cover_cents, status, reason, note, method, refunded_on, created_at, stripe_refund_id'
      )
      .eq('registration_id', id)
      .order('created_at', { ascending: false }),
  ]);
  if (paymentsError) throw new Error(`Payments: ${paymentsError.message}`);
  if (refundsError) throw new Error(`Refunds: ${refundsError.message}`);
  const refundsByPayment = new Map();
  for (const rf of refundRows ?? []) {
    if (!refundsByPayment.has(rf.payment_id)) refundsByPayment.set(rf.payment_id, []);
    refundsByPayment.get(rf.payment_id).push(rf);
  }
  const payments = (paymentRows ?? []).map((p) => {
    const refunds = refundsByPayment.get(p.id) ?? [];
    // Only pending and succeeded refunds hold money; a failed or cancelled one
    // must not lock up the amount it was going to return.
    const refunded = refunds
      .filter((r) => r.status === 'pending' || r.status === 'succeeded')
      .reduce((s, r) => s + (r.amount_cents ?? 0), 0);
    return {
      ...p,
      refunds,
      refundedCents: refunded,
      // Only money that arrived can go back: a failed or still-clearing
      // payment offers no Refund (27 Oct 2026, a declined plan charge did).
      refundableCents: ['succeeded', 'refunded'].includes(p.status)
        ? Math.max(0, (p.amount_cents ?? 0) - refunded)
        : 0,
      isStripe: Boolean(p.stripe_payment_intent_id),
    };
  });

  // Where to look this up in Stripe. Derived from the key's own prefix rather
  // than configured separately, because a hardcoded /test/ link is wrong the
  // day the ministry goes live and nobody would notice until they clicked it.
  const stripeBase = (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live')
    ? 'https://dashboard.stripe.com'
    : 'https://dashboard.stripe.com/test';

  const [{ data: consentRows, error: consentsError }, { data: sigRows, error: sigsError }] = await Promise.all([
    peopleIds.length
      ? supabase
          .from('person_current_consents')
          .select('person_id, kind, granted, recorded_at, recorded_as')
          .in('person_id', peopleIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('agreement_signatures')
      .select('id, signed_at, signer_name, signer_role, status, person_id, agreements ( key, title, version ), people ( first_name, last_name )')
      .eq('registration_id', id)
      .order('signed_at', { ascending: true }),
  ]);
  if (consentsError) throw new Error(`Consents: ${consentsError.message}`);
  if (sigsError) throw new Error(`Agreement signatures: ${sigsError.message}`);

  const consentOf = new Map();
  for (const c of consentRows ?? []) consentOf.set(`${c.person_id}:${c.kind}`, c);

  // Faces beside names, as on Check-In (Ellen, Script 5 item 2.5; approved
  // 22 Oct 2026). Sensitive read, like the photos table and bucket; without
  // it the rows show names only. All links signed in one request.
  const photoUrlOf = await signedPhotoUrls(supabase, can(staff, 'read:sensitive'), peopleIds);

  const signatures = (sigRows ?? []).map((s) => ({
    id: s.id,
    title: s.agreements?.title ?? s.agreements?.key ?? 'Agreement',
    version: s.agreements?.version ?? null,
    signedAt: s.signed_at,
    signerName: s.signer_name,
    signerRole: s.signer_role,
    status: s.status,
    // Per-person signatures (30 Sep 2026) name who they were signed for.
    personName: s.people ? `${s.people.first_name} ${s.people.last_name}` : null,
  }));

  // Reshape the PostgREST nesting into the names the client component expects.
  const registration = {
    id: reg.id,
    family_notes: reg.family_notes,
    household: reg.households,
    event: reg.events,
    participants: (reg.registration_participants ?? [])
      .map((p) => ({
        id: p.id,
        camp_role: p.camp_role,
        status: p.status,
        // 0128: why they are waitlisted (the family reads it too), and who
        // last changed the status and when. Confirmed rows from before 0128
        // fall back to confirmed_at for the when.
        waitlist_reason: p.waitlist_reason ?? null,
        status_changed_at: p.status_changed_at ?? (p.status === 'confirmed' ? p.confirmed_at : null) ?? null,
        status_changed_by_name: changerNames.get(p.status_changed_by) ?? null,
        // Flattened from participant_money so the client component keeps
        // its column names; each is null when the money is not this
        // staffer's to see (canSeeMoney below is false in the same case).
        fee_cents: moneyOf(p)?.fee_cents ?? null,
        scholarship_cents: moneyOf(p)?.scholarship_cents ?? null,
        discount_cents: moneyOf(p)?.discount_cents ?? null,
        discount_reason: moneyOf(p)?.discount_reason ?? null,
        tshirt_size: p.tshirt_size,
        first_time_attending: p.first_time_attending,
        // null here means never asked. Kept distinct from false all the way
        // to the screen so staff never read silence as a refusal.
        media: consentOf.get(`${p.people?.id}:media`) ?? null,
        directory: consentOf.get(`${p.people?.id}:directory`) ?? null,
        photoUrl: photoUrlOf.get(p.people?.id) ?? null,
        person: p.people,
      }))
      .sort((a, b) =>
        `${a.person?.last_name} ${a.person?.first_name}`.localeCompare(
          `${b.person?.last_name} ${b.person?.first_name}`
        )
      ),
  };

  // Fees (0123): returned bank payments and staff-added fees. Payments read
  // sees them (RLS); the page shows them only to Payments read as well.
  let fees = [];
  if (can(staff, 'read:payments')) {
    const { data: feeRows, error: feeError } = await supabase
      .from('registration_fees')
      .select('id, kind, amount_cents, reason, created_at, created_by, waived_at, waived_by, waived_reason')
      .eq('registration_id', id)
      .order('created_at');
    if (feeError) throw new Error(`Fees: ${feeError.message}`);
    const feePeople = [...new Set((feeRows ?? []).flatMap((f) => [f.created_by, f.waived_by]).filter(Boolean))];
    let feeNames = new Map();
    if (feePeople.length) {
      const { data: who, error: whoError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', feePeople);
      if (whoError) throw new Error(`Fee names: ${whoError.message}`);
      feeNames = new Map((who ?? []).map((p) => [p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()]));
    }
    fees = (feeRows ?? []).map((f) => ({
      ...f,
      createdByName: feeNames.get(f.created_by) || null,
      waivedByName: feeNames.get(f.waived_by) || null,
    }));
  }

  // How it is being paid (0080). Errors are shown, never swallowed.
  const [
    { data: routeRow, error: routeError },
    { data: planRow, error: planError },
    { data: reviewRows, error: reviewError },
  ] = await Promise.all([
    supabase.from('registration_payment_routes').select('route').eq('registration_id', id).maybeSingle(),
    supabase
      .from('payment_plans')
      .select(
        `id, schedule, status, payment_method_label, keeps_early_discount, consent_text, consented_at, updated_at,
         cancelled_at, cancelled_by, payment_method_changed_at,
         payment_installments ( id, due_on, amount_cents, status, attempts, last_error, next_attempt_on, last_attempt_at )`
      )
      .eq('registration_id', id)
      .maybeSingle(),
    // The review class and flags (0081, Lawrence 30 Sep 2026), for this
    // registration and the household's others (their tabs' deposit-short
    // marker). No rows at all without Payments read (0103).
    supabase
      .from('registration_review')
      .select('registration_id, review_class, flags, confirmed_paid_cents, deposit_expected_cents')
      .in('registration_id', familyRegIds),
  ]);
  if (routeError || planError || reviewError) {
    throw new Error(`Payment plan lookup failed: ${(routeError ?? planError ?? reviewError).message}`);
  }
  const reviewRow = (reviewRows ?? []).find((r) => r.registration_id === id) ?? null;
  const planInstallments = [...(planRow?.payment_installments ?? [])].sort((a, b) =>
    a.due_on.localeCompare(b.due_on)
  );
  // Who stopped a cancelled plan: the family themselves (0135) or staff.
  let planCancelledByFamily = false;
  if (planRow?.cancelled_by && reg.households?.id) {
    const { data: member, error: memberError } = await supabase
      .from('household_members')
      .select('profile_id')
      .eq('household_id', reg.households.id)
      .eq('profile_id', planRow.cancelled_by)
      .maybeSingle();
    if (memberError) throw new Error(`Plan cancellation lookup failed: ${memberError.message}`);
    planCancelledByFamily = Boolean(member);
  }

  // Activity waivers still owed on this registration (0120): a waiver or an
  // outside provider staff added after the signup. A flag only -- a
  // confirmed place stays confirmed while the paperwork is chased. Read for
  // the household's other registrations too, for their tabs' marker.
  const { data: viewOwedRows, error: owedError } = await supabase
    .from('activity_waivers_outstanding')
    .select('registration_participant_id, registration_id, person_id, activity_id, activity_name, kind, agreement_title, upload_status, review_note')
    .in('registration_id', familyRegIds);
  if (owedError) throw new Error(`Outstanding waivers: ${owedError.message}`);
  // Plus a volunteer's or buddy's rejected outfitter confirmation, which the
  // view (built from signups) cannot see (26 Oct 2026).
  const familyOwedRows = [
    ...(viewOwedRows ?? []),
    ...(await rejectedOutsideView(supabase, viewOwedRows, { registrationIds: familyRegIds })),
  ];
  const owedRows = (familyOwedRows ?? []).filter((o) => o.registration_id === id);
  const personName = new Map(
    (reg.registration_participants ?? []).map((p) => [
      p.people?.id,
      `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
    ])
  );
  const owed = (owedRows ?? [])
    .map((o) => ({
      key: `${o.person_id}:${o.activity_name}:${o.kind}`,
      text:
        o.kind === 'ours'
          ? `${o.activity_name}: ${personName.get(o.person_id) || 'someone'} has not signed the ${o.agreement_title || 'waiver'}.`
          : o.upload_status === 'rejected'
            ? `${o.activity_name}: the outfitter's confirmation for ${personName.get(o.person_id) || 'someone'} was rejected (${o.review_note || 'no reason given'}) — the family needs to upload it again.`
            : `${o.activity_name}: no outfitter's confirmation uploaded for ${personName.get(o.person_id) || 'someone'}.`,
    }))
    .sort((a, b) => a.text.localeCompare(b.text));

  // The week tabs: one per registration of this household, oldest event
  // first, each with what it is waiting on staff for.
  const owedRegIds = new Set((familyOwedRows ?? []).map((o) => o.registration_id));
  const shortRegIds = new Set(
    (reviewRows ?? []).filter((r) => (r.flags ?? []).includes('deposit_short')).map((r) => r.registration_id)
  );
  const familyRegistrations = (familyRegs ?? [])
    .map((r) => ({
      id: r.id,
      event: r.events ?? null,
      participants: (r.registration_participants ?? []).map((p) => ({ status: p.status, person: p.people })),
      attention: staffAttention(r, {
        waiversOwed: owedRegIds.has(r.id),
        depositShort: shortRegIds.has(r.id),
        creedPending: (creedByReg.get(r.id)?.pending.length ?? 0) > 0,
      }),
    }))
    .sort((a, b) => String(a.event?.starts_on ?? '').localeCompare(String(b.event?.starts_on ?? '')));

  // Two money facts the Money card's open-or-folded rule needs that only the
  // server has: a balance still owed after the due date (today on the
  // ministry's calendar, worked out here so the browser's clock cannot draw
  // the card differently from the server's render), and a payment plan in
  // trouble (stopped after three failed tries -- status 'failed' -- or a
  // charge that failed and is waiting to retry -- planFailingSince(); the
  // same two rules as the review queue's Plan problems tab).
  const dueOn = balanceDueOn(reg.events);
  const moneyAlerts = {
    overdue: Boolean(dueOn) && dueOn < todayInMorristown() && (balanceRow?.balance_cents ?? 0) > 0,
    planTrouble: planRow?.status === 'failed' || planFailingSince(planRow) != null,
  };

  return (
    <RegistrationManager
      registration={registration}
      // Shown under the week tabs, above the Review card.
      waiverNotice={owed.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Activity waiver outstanding</p>
          <ul className="mt-1 space-y-0.5">
            {owed.map((o) => (
              <li key={o.key}>⚑ {o.text}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">
            The family sees this on their dashboard and Activities page. Their place is not affected.
            {can(staff, 'write:registration') && reg.events?.id && (
              <>
                {' '}
                <Link
                  href={`/admin/email-families/?event=${reg.events.id}&outstanding=1`}
                  className="font-semibold underline"
                >
                  Email the families with a waiver outstanding →
                </Link>
              </>
            )}
          </p>
        </div>
      ) : null}
      canSeeMoney={can(staff, 'read:payments')}
      canWrite={can(staff, 'write:registration')}
      canDecide={can(staff, 'decide:scholarships')}
      familyRegistrations={familyRegistrations}
      review={reviewRow}
      awaiting={{ since: reg.awaiting_family_since ?? null, reason: reg.awaiting_family_reason ?? null }}
      familyReply={familyReply}
      hold={hold}
      creed={creed}
      eventId={reg.events?.id ?? null}
      depositWaived={reg.deposit_waived_at ? { at: reg.deposit_waived_at, reason: reg.deposit_waived_reason ?? null } : null}
      depositCents={reg.events?.deposit_cents ?? 0}
      options={options ?? []}
      adjustmentRecords={adjustmentRecords}
      familyMessages={familyMessages}
      signatures={signatures}
      balance={balanceRow}
      emailsPanel={
        <Panel title="Emails sent" count={emails.length || 'none'} defaultOpen={false}>
          <EmailLog
            emails={emails}
            eventOf={manyEvents ? (rid) => eventNameByReg.get(rid) ?? null : null}
            empty="The site has not emailed this family yet."
          />
        </Panel>
      }
      canWritePayments={can(staff, 'write:payments')}
      feesPanel={
        can(staff, 'read:payments') ? (
          <FeesPanel
            registrationId={id}
            fees={fees}
            canWrite={can(staff, 'write:payments')}
            canWaive={can(staff, 'decide:scholarships')}
          />
        ) : null
      }
      payments={payments}
      stripeBase={stripeBase}
      scholarshipRequests={scholarshipRequests}
      moneyAlerts={moneyAlerts}
      // How it is being paid, drawn as the last section of the Money card.
      planPanel={
        can(staff, 'read:payments') ? (
          <StaffPlanPanel
            registrationId={id}
            route={routeRow?.route ?? null}
            plan={planRow ?? null}
            cancelledByFamily={planCancelledByFamily}
            installments={planInstallments}
            earlyDiscountCents={balanceRow?.early_discount_cents ?? 0}
            familyDiscountCents={balanceRow?.family_discount_cents ?? 0}
            requiresChoice={requiresPaymentChoice(reg.events)}
          />
        ) : null
      }
    />
  );
}
