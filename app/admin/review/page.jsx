import Link from 'next/link';
import EventFilter from '@/components/EventFilter';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { REVIEW_CLASS, REVIEW_FLAG, reviewClassLabel, planStoppedAt, planFailingSince, planFailingNext, PLAN_MAX_TRIES } from '@/lib/plans';
import { creedByRegistration, CREED_COLUMNS } from '@/lib/creed';
import { rejectedOutsideView } from '@/lib/rejectedUploads';
import { statusPill } from '@/lib/format';
import { dayInMorristown, isCurrentEventRow } from '@/lib/events';

export const metadata = { title: 'Awaiting Review — Staff Admin' };

// The review queue, as one page (14 Oct 2026, Lawrence).
//
// Until now "37 awaiting review" was a number on the Overview with the list
// underneath it, and the things a reviewer needs to know about each family --
// has the deposit arrived or a scholarship been asked for, is the photo
// permission declined, is the Creed unaffirmed -- were scattered: some on
// Event Payments, some on Volunteers, the rest inside each registration.
// Event Payments is about money again (its review column keeps only the
// deposit flag); THIS page carries every flag, by event, and links to the
// registration where the decision is actually made.
//
// Who is in the queue: any registration with at least one person still
// "submitted". ?show=all lists every live registration instead, for the
// reviewer who wants to see the whole picture rather than only what is
// outstanding.

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

export default async function ReviewQueuePage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/review/');
  if (!can(staff, 'read:registration')) redirect('/admin');

  // ?show=all lists every live registration; ?show=family lists the ones
  // staff sent back for more information (0089). The default is what is
  // actually waiting on STAFF.
  // ?show=nodeposit: the families still waiting on staff whose deposit is not
  // in and who have not asked for a full scholarship -- Larry (16 Oct 2026):
  // "grouped / filtered together", so a registrar can work that list and
  // waive where there is a reason to.
  // ?show=waiver (22 Oct 2026): every registration with an activity waiver
  // still outstanding (activity_waivers_outstanding, 0120) -- staff attached a
  // waiver or an outside provider after people signed up. CONFIRMED
  // registrations are listed too, and nothing here changes anyone's status:
  // a confirmed place is not undone for paperwork. It is a flag to follow
  // up (and to email the families from /admin/email-families), not a step
  // back in the review.
  // ?show=plan (22 Oct 2026, Lawrence): every registration whose payment
  // plan stopped after three failed payments (payment_plans.status 'failed';
  // a plan paused by staff is not listed). Built like the waiver tab:
  // confirmed registrations included, nobody's status changes. Plans are
  // money, so the tab exists only for Payments read -- the same grant
  // payment_plans_select asks (0101), read with the staff's own client.
  // Since 27 Oct 2026 (Lawrence, Testing Script 17.11: "flag after ONE
  // failure") the tab is *Plan problems* and lists the earlier case too: a
  // plan still running (active or paused) with a charge that failed and is
  // waiting to retry -- planFailingSince(), amber. The stopped plan keeps its
  // red flag. Same param (?show=plan), so links into the tab still work.
  // ?show=replied (0126, 26 Oct 2026): every registration whose family wrote
  // to staff in the app and nobody has read it yet (registrations.
  // family_reply_unread, generated in the database). A reply also clears
  // "waiting on the family", so those registrations are back under Waiting
  // on staff -- and an unread reply puts a registration there even when
  // nobody on it is still submitted, because the family is waiting on an
  // answer. Every event, not just current ones: an unread message never
  // hides.
  const seesMoney = can(staff, 'read:payments');
  const shows = ['all', 'family', 'replied', 'nodeposit', 'waiver', ...(seesMoney ? ['plan'] : [])];
  const show = shows.includes(params?.show) ? params.show : 'staff';
  const showAll = show === 'all';
  // One event, or every current one (the shared filter, 16 Oct 2026).
  const eventFilter = typeof params?.event === 'string' ? params.event : '';
  const supabase = await createClient();

  // Money only for those who may read it (0111): the balances view runs with
  // the caller's rights and shows $0 paid to everyone else, which reads as a
  // family that has not paid. (seesMoney is set above, with the tabs.)
  const [
    { data: regs, error: regsError },
    { data: parts, error: partsError },
    { data: reviews, error: reviewsError },
    { data: balances, error: balancesError },
    { data: viewOwed, error: owedError },
    { data: planRows, error: planError },
    { data: creedRows, error: creedError },
  ] =
    await Promise.all([
      supabase
        .from('registrations')
        .select(
          'id, created_at, awaiting_family_since, awaiting_family_reason, family_replied_at, family_reply_unread, households ( display_name ), events ( id, name, starts_on, ends_on, archived_at )'
        ),
      supabase
        .from('registration_participants')
        .select('registration_id, person_id, status, camp_role, people ( first_name, last_name )'),
      supabase
        .from('registration_review')
        .select('registration_id, review_class, flags, confirmed_paid_cents, deposit_expected_cents'),
      seesMoney
        ? supabase.from('registration_balances').select('registration_id, paid_cents, balance_cents, fee_cents')
        : Promise.resolve({ data: [] }),
      supabase
        .from('activity_waivers_outstanding')
        .select('registration_participant_id, registration_id, person_id, activity_id, activity_name, kind, upload_status'),
      seesMoney
        ? supabase
            .from('payment_plans')
            .select('registration_id, status, updated_at, payment_method_changed_at, payment_installments ( status, attempts, last_error, last_attempt_at )')
            .in('status', ['failed', 'active', 'paused'])
        : Promise.resolve({ data: [], error: null }),
      // The Creed flag without money (0130): every reviewer sees it.
      supabase.from('creed_status').select(CREED_COLUMNS),
    ]);
  if (regsError) throw new Error(`Registrations: ${regsError.message}`);
  // A failed read of the people would empty the queue ("nobody waiting"),
  // and of the review view would hide every class and flag.
  if (partsError) throw new Error(`People on registrations: ${partsError.message}`);
  if (reviewsError) throw new Error(`Review classes: ${reviewsError.message}`);
  if (balancesError) throw new Error(`Balances: ${balancesError.message}`);
  if (owedError) throw new Error(`Outstanding waivers: ${owedError.message}`);
  // Plus a volunteer's or buddy's rejected outfitter confirmation, which the
  // view (built from signups) cannot see (Lawrence, 26 Oct 2026).
  const owed = [...(viewOwed ?? []), ...(await rejectedOutsideView(supabase, viewOwed))];
  if (planError) throw new Error(`Payment plans: ${planError.message}`);
  if (creedError) throw new Error(`Creed status: ${creedError.message}`);
  const creedByReg = creedByRegistration(creedRows);
  // Two flags from the same rows, each from its one helper in lib/plans.js:
  // stopped (status 'failed', after the third try) and failing (a charge
  // failed, the plan is still running and will retry).
  const stoppedByReg = new Map(
    (planRows ?? []).filter((p) => p.status === 'failed').map((p) => [p.registration_id, planStoppedAt(p)])
  );
  const failingByReg = new Map();
  for (const p of planRows ?? []) {
    const failing = planFailingSince(p);
    if (failing) failingByReg.set(p.registration_id, failing);
  }

  const reviewByReg = new Map((reviews ?? []).map((r) => [r.registration_id, r]));
  const balanceByReg = new Map((balances ?? []).map((b) => [b.registration_id, b]));
  const owedByReg = new Map();
  for (const o of owed ?? []) {
    if (!owedByReg.has(o.registration_id)) owedByReg.set(o.registration_id, []);
    owedByReg.get(o.registration_id).push(o);
  }

  // People per registration, cancelled and draft left out of the counts the
  // same way the Overview leaves them out.
  const peopleByReg = new Map();
  for (const p of parts ?? []) {
    if (p.status === 'cancelled' || p.status === 'draft') continue;
    if (!peopleByReg.has(p.registration_id)) peopleByReg.set(p.registration_id, []);
    peopleByReg.get(p.registration_id).push(p);
  }

  const rows = (regs ?? [])
    .map((r) => {
      const people = peopleByReg.get(r.id) ?? [];
      const pending = people.filter((p) => p.status === 'submitted');
      return {
        id: r.id,
        household: r.households?.display_name ?? 'Household',
        event: r.events ?? null,
        people,
        pending,
        review: reviewByReg.get(r.id) ?? null,
        // The money view's flags, less its copy of the Creed flag: that comes
        // from creed_status (0130), so it shows without Payments read.
        flags: (reviewByReg.get(r.id)?.flags ?? []).filter((f) => f !== 'creed_not_affirmed'),
        balance: balanceByReg.get(r.id) ?? null,
        created: r.created_at,
        awaitingSince: r.awaiting_family_since ?? null,
        awaitingReason: r.awaiting_family_reason ?? null,
        familyReplied: Boolean(r.family_reply_unread),
        familyRepliedAt: r.family_replied_at ?? null,
        owed: owedByReg.get(r.id) ?? [],
        planStopped: stoppedByReg.has(r.id),
        planStoppedAt: stoppedByReg.get(r.id) ?? null,
        planFailing: failingByReg.get(r.id) ?? null,
        // The Creed (0130): who is still waiting on the conversation with
        // Larry, and who has had it under their current name.
        creed: creedByReg.get(r.id) ?? null,
      };
    })
    .filter((r) => {
      if (r.people.length === 0) return false;
      if (eventFilter && r.event?.id !== eventFilter) return false;
      if (show === 'all') return true;
      if (show === 'family') return Boolean(r.awaitingSince);
      if (show === 'replied') return r.familyReplied;
      // Every current event unless one is chosen, as the "All current
      // events" pill says -- a past camp's paperwork is not live work.
      if (show === 'waiver') return r.owed.length > 0 && (eventFilter || isCurrentEventRow(r.event));
      if (show === 'plan') return (r.planStopped || r.planFailing) && (eventFilter || isCurrentEventRow(r.event));
      if (show === 'nodeposit') {
        return r.pending.length > 0 && !r.awaitingSince && (r.review?.review_class ?? 'neither') === 'neither';
      }
      return (r.pending.length > 0 || r.familyReplied) && !r.awaitingSince;
    });

  // The events on the queue, for the filter's pills.
  const eventsForFilter = [
    ...new Map((regs ?? []).filter((r) => r.events?.id).map((r) => [r.events.id, r.events])).values(),
  ]
    .sort((a, b) => String(a.starts_on ?? '').localeCompare(String(b.starts_on ?? '')))
    .map((e) => ({ id: e.id, name: e.name, startsOn: e.starts_on, endsOn: e.ends_on, archivedAt: e.archived_at }));

  // Group by event, soonest first; registrations oldest first inside, so the
  // family that has waited longest is at the top.
  const byEvent = new Map();
  for (const r of rows) {
    const key = r.event?.id ?? 'none';
    if (!byEvent.has(key)) byEvent.set(key, { event: r.event, rows: [] });
    byEvent.get(key).rows.push(r);
  }
  const groups = [...byEvent.values()].sort((a, b) =>
    String(a.event?.starts_on ?? '9999').localeCompare(String(b.event?.starts_on ?? '9999'))
  );
  // An unread family reply goes to the top of its event (26 Oct 2026): it is
  // the family waiting on a person, not on a process.
  for (const g of groups) {
    g.rows.sort(
      (a, b) =>
        Number(b.familyReplied) - Number(a.familyReplied) ||
        String(a.created).localeCompare(String(b.created))
    );
  }
  // The same families, for the strip above the list (every event).
  const unreadReplies = (regs ?? [])
    .filter((r) => r.family_reply_unread)
    .sort((a, b) => String(a.family_replied_at).localeCompare(String(b.family_replied_at)));

  const totalPending = rows.reduce((s, r) => s + r.pending.length, 0);
  // How many families are parked with the family, so the "waiting on staff"
  // view can say where the rest went.
  const onFamily = (regs ?? []).filter((r) => r.awaiting_family_since).length;
  // For the Family replied tab's count (0126): unread replies, every event.
  const repliedRegs = (regs ?? []).filter((r) => r.family_reply_unread).length;
  const totalFlags = rows.reduce((s, r) => s + r.flags.length + (r.creed ? 1 : 0), 0);
  // For the tab's count: registrations at a current event with a waiver owed.
  const waiverRegs = (regs ?? []).filter(
    (r) => owedByReg.has(r.id) && isCurrentEventRow(r.events)
  ).length;
  // For the Plan problems tab's count: the same rule, current events only.
  // Stopped ones decide its colour (red); failing-only is amber.
  const stoppedRegs = (regs ?? []).filter(
    (r) => stoppedByReg.has(r.id) && isCurrentEventRow(r.events)
  ).length;
  const planProblemRegs = (regs ?? []).filter(
    (r) => (stoppedByReg.has(r.id) || failingByReg.has(r.id)) && isCurrentEventRow(r.events)
  ).length;
  const nameOf = new Map(
    (parts ?? []).map((p) => [`${p.registration_id}:${p.person_id}`, p.people?.first_name ?? ''])
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
        <h2 className="text-xl font-bold">Awaiting Review</h2>
        <div className="flex gap-2 text-sm">
          <Link
            href={`/admin/review/${eventFilter ? `?event=${eventFilter}` : ''}`}
            className={`rounded-full px-3 py-1 font-semibold border ${
              show === 'staff' ? 'bg-brand text-white border-brand' : 'border-neutral-300 text-neutral-700 hover:border-brand'
            }`}
          >
            Waiting on staff
          </Link>
          <Link
            href={`/admin/review/?show=nodeposit${eventFilter ? `&event=${eventFilter}` : ''}`}
            className={`rounded-full px-3 py-1 font-semibold border ${
              show === 'nodeposit' ? 'bg-brand text-white border-brand' : 'border-neutral-300 text-neutral-700 hover:border-brand'
            }`}
          >
            Deposit short
          </Link>
          <Link
            href={`/admin/review/?show=family${eventFilter ? `&event=${eventFilter}` : ''}`}
            className={`rounded-full px-3 py-1 font-semibold border ${
              show === 'family' ? 'bg-brand text-white border-brand' : 'border-neutral-300 text-neutral-700 hover:border-brand'
            }`}
          >
            Waiting on the family{onFamily > 0 && ` (${onFamily})`}
          </Link>
          <Link
            href={`/admin/review/?show=replied${eventFilter ? `&event=${eventFilter}` : ''}`}
            className={`rounded-full px-3 py-1 font-semibold border ${
              show === 'replied'
                ? 'bg-amber-600 text-white border-amber-600'
                : repliedRegs > 0
                  ? 'border-amber-400 bg-amber-50 text-amber-900 hover:border-amber-600'
                  : 'border-neutral-300 text-neutral-700 hover:border-brand'
            }`}
          >
            Family replied{repliedRegs > 0 && ` (${repliedRegs})`}
          </Link>
          <Link
            href={`/admin/review/?show=waiver${eventFilter ? `&event=${eventFilter}` : ''}`}
            className={`rounded-full px-3 py-1 font-semibold border ${
              show === 'waiver' ? 'bg-brand text-white border-brand' : 'border-neutral-300 text-neutral-700 hover:border-brand'
            }`}
          >
            Waiver outstanding{waiverRegs > 0 && ` (${waiverRegs})`}
          </Link>
          {seesMoney && (
            <Link
              href={`/admin/review/?show=plan${eventFilter ? `&event=${eventFilter}` : ''}`}
              className={`rounded-full px-3 py-1 font-semibold border ${
                show === 'plan'
                  ? stoppedRegs > 0
                    ? 'bg-red-700 text-white border-red-700'
                    : 'bg-amber-600 text-white border-amber-600'
                  : stoppedRegs > 0
                    ? 'border-red-300 text-red-700 hover:border-red-700'
                    : planProblemRegs > 0
                      ? 'border-amber-400 bg-amber-50 text-amber-900 hover:border-amber-600'
                      : 'border-neutral-300 text-neutral-700 hover:border-brand'
              }`}
            >
              Payment plan problems{planProblemRegs > 0 && ` (${planProblemRegs})`}
            </Link>
          )}
          <Link
            href={`/admin/review/?show=all${eventFilter ? `&event=${eventFilter}` : ''}`}
            className={`rounded-full px-3 py-1 font-semibold border ${
              showAll ? 'bg-brand text-white border-brand' : 'border-neutral-300 text-neutral-700 hover:border-brand'
            }`}
          >
            Every registration
          </Link>
        </div>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        Every family with somebody still <em>submitted</em>, with everything a reviewer needs in
        one row: whether the deposit is in or a scholarship was asked for, and any flag that wants
        a conversation first. Open the registration: its Review card approves or waitlists
        everyone at once, or sends the registration back to the family for more information.
        {' '}
        <strong>{totalPending}</strong> {totalPending === 1 ? 'person' : 'people'} waiting
        {totalFlags > 0 && (
          <>
            {' '}· <strong>{totalFlags}</strong> {totalFlags === 1 ? 'flag' : 'flags'}
          </>
        )}
        .
      </p>

      {/* Unread family replies first, on every tab but their own (26 Oct
          2026): with many families waiting, a reply was lost in the list. */}
      {unreadReplies.length > 0 && show !== 'replied' && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-amber-900">
            <span aria-hidden>✉</span>{' '}
            {unreadReplies.length === 1 ? 'A family wrote back' : `${unreadReplies.length} families wrote back`}
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {unreadReplies.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/registrations/${r.id}/#review`} className="font-semibold text-brand underline">
                  {r.households?.display_name ?? 'Household'}
                </Link>
                <span className="text-neutral-500"> · {r.events?.name ?? ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <EventFilter
        events={eventsForFilter}
        selected={eventFilter || null}
        basePath="/admin/review"
        extraParams={{ show: show === 'staff' ? '' : show }}
        allowAll
      />

      {show === 'waiver' && (
        <p className="mb-4 text-sm text-neutral-600">
          Families with someone on an activity whose waiver is still missing — a waiver or an
          outside provider added after they signed up. Confirmed families are listed too; nobody&rsquo;s
          status changes for this.{' '}
          {can(staff, 'write:registration') && (
          <Link
            href={`/admin/email-families/?outstanding=1${eventFilter ? `&event=${eventFilter}` : ''}`}
            className="font-semibold text-brand underline"
          >
            Email these families →
          </Link>
          )}
        </p>
      )}

      {show === 'plan' && (
        <p className="mb-4 text-sm text-neutral-600">
          Families whose payment plan has a problem: a payment failed and will be tried again
          (amber — three days later, {PLAN_MAX_TRIES} tries in all), or the plan stopped after{' '}
          {PLAN_MAX_TRIES} failed payments (red).
          Confirmed families are listed too; nobody&rsquo;s status changes for this. Open the
          registration to retry, pause or cancel the plan, and to decide whether the family keeps
          the early-registration discount.
        </p>
      )}

      {groups.length === 0 && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {show === 'family'
            ? 'Nothing is waiting on a family.'
            : show === 'replied'
              ? 'No family reply is waiting to be read.'
              : show === 'nodeposit'
              ? 'Everyone waiting on staff has a deposit in, a scholarship requested, or the deposit waived.'
              : show === 'waiver'
                ? 'Every activity waiver is signed or uploaded.'
                : show === 'plan'
                  ? 'No payment plan has a failed payment or has stopped.'
                  : 'Nothing waiting on staff.'}
        </p>
      )}

      {groups.map((g) => (
        <section key={g.event?.id ?? 'none'} className="mb-8">
          <h3 className="font-semibold text-neutral-700 mb-2">
            {g.event?.name ?? 'No event'}
            <span className="ml-2 text-sm font-normal text-neutral-500">
              {g.rows.length} {g.rows.length === 1 ? 'family' : 'families'}
            </span>
          </h3>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500">
                <tr className="border-b border-neutral-200">
                  <th className="px-3 py-2 text-left font-semibold">Family</th>
                  <th className="px-3 py-2 text-left font-semibold">People</th>
                  <th className="px-3 py-2 text-left font-semibold">Money</th>
                  <th className="px-3 py-2 text-left font-semibold">Flags</th>
                  <th className="px-3 py-2 text-right font-semibold">Paid / balance</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const cls = r.review ? REVIEW_CLASS[r.review.review_class] : null;
                  const flags = r.flags;
                  return (
                    <tr key={r.id} className="border-b border-neutral-100 align-top hover:bg-neutral-50">
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/admin/registrations/${r.id}/`}
                          className="font-medium text-brand-dark hover:underline"
                        >
                          {r.household}
                        </Link>
                        <div className="text-xs text-neutral-500">
                          registered {dayInMorristown(r.created)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">
                          {r.pending.length} of {r.people.length} waiting
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {r.people.map((p, i) => {
                            const pill = statusPill(p.status);
                            return (
                              <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span>
                                  {p.people?.first_name} {p.people?.last_name}
                                </span>
                                <span className="text-neutral-400">· {p.camp_role?.replace('_', '/')}</span>
                                <span className={`rounded-sm px-1.5 py-0.5 font-semibold ${pill.cls}`}>
                                  {pill.text}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                      <td className="px-3 py-2.5">
                        {cls ? (
                          <span
                            title={cls.hint}
                            className={`inline-block whitespace-nowrap rounded-sm px-1.5 py-0.5 text-xs font-semibold ${cls.cls}`}
                          >
                            {reviewClassLabel(r.review)}
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                        {r.review?.deposit_expected_cents > 0 && (
                          <div className="mt-1 text-xs text-neutral-500">
                            {money(r.review.confirmed_paid_cents)} of a{' '}
                            {money(r.review.deposit_expected_cents)} deposit
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {flags.length === 0 && !r.creed && !r.awaitingSince && r.owed.length === 0 && !r.planStopped && !r.planFailing && !r.familyReplied ? (
                          <span className="text-neutral-400">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {r.familyReplied && (
                              <li>
                                {/* Straight to the conversation (Lawrence, 28 Oct 2026). */}
                                <Link
                                  href={`/admin/registrations/${r.id}/#family-messages`}
                                  className="inline-block whitespace-nowrap rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-400 hover:bg-amber-200"
                                >
                                  ✉ Family replied
                                  {r.familyRepliedAt ? ` ${dayInMorristown(r.familyRepliedAt)}` : ''}
                                </Link>
                              </li>
                            )}
                            {r.planStopped && (
                              <li className="whitespace-nowrap text-xs font-semibold text-red-700">
                                ⚑ Payment plan stopped
                                {r.planStoppedAt ? ` ${dayInMorristown(r.planStoppedAt)}` : ''}
                              </li>
                            )}
                            {r.planFailing && (
                              <li className="whitespace-nowrap text-xs font-semibold text-amber-800">
                                ⚑ Plan payment failed
                                {r.planFailing.since ? ` ${dayInMorristown(r.planFailing.since)}` : ''} —{' '}
                                {planFailingNext(r.planFailing)}
                              </li>
                            )}
                            {r.creed?.pending.length > 0 && (
                              <li className="text-xs font-semibold text-amber-800">
                                ⚑ {REVIEW_FLAG.creed_not_affirmed}: {r.creed.pending.map((p) => p.name).join(', ')}
                              </li>
                            )}
                            {r.creed?.covered.length > 0 && (
                              // Talked through with Larry (0130): informs, no longer alarms.
                              <li className="text-xs text-neutral-600">
                                ✓ {REVIEW_FLAG.creed_not_affirmed}: {r.creed.covered.map((c) => c.name).join(', ')} —
                                talked with Larry
                              </li>
                            )}
                            {flags.map((f) => (
                              <li key={f} className="whitespace-nowrap text-xs font-semibold text-amber-800">
                                ⚑ {REVIEW_FLAG[f] ?? f}
                              </li>
                            ))}
                            {r.owed.map((o) => (
                              <li
                                key={`${o.person_id}:${o.activity_name}:${o.kind}`}
                                className="text-xs font-semibold text-amber-800"
                              >
                                ⚑ {o.activity_name}: {nameOf.get(`${r.id}:${o.person_id}`) || 'someone'}{' '}
                                {o.kind === 'ours'
                                  ? 'needs the waiver signed'
                                  : o.upload_status === 'rejected'
                                    ? "outfitter's confirmation rejected — needs a new upload"
                                    : "needs the outfitter's confirmation"}
                              </li>
                            ))}
                            {r.awaitingSince && (
                              <li className="text-xs text-neutral-700" title={r.awaitingReason ?? ''}>
                                <span className="font-semibold">Waiting on the family</span> since{' '}
                                {dayInMorristown(r.awaitingSince)}
                                {r.awaitingReason && (
                                  <span className="block max-w-xs truncate text-neutral-500">
                                    &ldquo;{r.awaitingReason}&rdquo;
                                  </span>
                                )}
                              </li>
                            )}
                          </ul>
                        )}
                      </td>
                      {/* The family name is the link to the registration; an
                          "Open →" beside it was the same link twice (15 Oct). */}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {seesMoney ? (
                          <>
                            <div>{money(r.balance?.paid_cents)}</div>
                            <div className="text-xs text-neutral-500">
                              {(r.balance?.balance_cents ?? 0) < 0
                                ? `${money(-r.balance.balance_cents)} credit`
                                : `${money(r.balance?.balance_cents)} owed`}
                            </div>
                          </>
                        ) : (
                          <span className="text-neutral-400" title="Payments read is needed to see money">
                            &mdash;
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
