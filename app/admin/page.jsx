import Link from 'next/link';
import { isCurrentEventRow, whenInMorristown } from '@/lib/events';
import EventJump from './EventJump';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { planFailingSince, planFailingNext } from '@/lib/plans';

export const metadata = { title: 'Overview — Staff Admin' };

// The Overview reads in plain language: how many FAMILIES have signed up, how
// many PEOPLE are coming, and what needs staff attention. One per-event table
// carries the detail; nothing is shown twice. (A "registration" is one
// family's sign-up for one event — the labels here avoid assuming staff know
// that vocabulary.)
// One headline number on the Overview. Module level rather than inside the
// page function: this is a server component, so nothing remounts, but the
// lint (react-hooks/static-components) cannot tell, and the habit is worth
// not having.
function Stat({ label, sub, value, tone, href }) {
  const number = tone === 'amber' ? 'text-amber-700' : tone === 'red' ? 'text-red-700' : '';
  const body = (
    <>
      <div className={`text-3xl font-bold ${number}`}>
        {value}
      </div>
      <div className="text-sm font-semibold text-neutral-700">{label}</div>
      <div className="text-xs text-neutral-500">{sub}</div>
    </>
  );
  const cls = `block rounded-lg bg-white border shadow-xs p-5 ${
    tone === 'amber' ? 'border-amber-300' : tone === 'red' ? 'border-red-300 bg-red-50!' : 'border-neutral-200'
  }`;
  // A number that is also the way to the work (14 Oct 2026): "37 awaiting
  // review" opens the review queue.
  return href ? (
    <Link href={href} className={`${cls} hover:shadow-md hover:border-brand`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// The amber card for payment plans with a failed payment still being retried
// (Lawrence, 27 Oct 2026: flag after ONE failure). Not a Stat: it names the
// families, each linked to their registration's plan (#plan opens the Money
// card), so the card itself cannot also be one link. Module level, like Stat.
function FailingPlansCard({ plans }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-white p-5 shadow-xs">
      <div className="text-3xl font-bold text-amber-700">{plans.length}</div>
      <div className="text-sm font-semibold text-neutral-700">
        {plans.length === 1 ? 'Plan payment failed' : 'Plan payments failed'} — retrying
      </div>
      <ul className="mt-1 space-y-0.5 text-xs">
        {plans.map((p) => (
          <li key={p.registrationId}>
            <Link href={`/admin/registrations/${p.registrationId}/#plan`} className="font-semibold text-brand underline">
              {p.household}
            </Link>
            <span className="text-neutral-500"> · {p.next}</span>
          </li>
        ))}
      </ul>
      <Link href="/admin/review/?show=plan" className="mt-1 inline-block text-xs text-neutral-500 underline">
        All payment plan problems
      </Link>
    </div>
  );
}

export default async function AdminOverview({ searchParams }) {
  const params = await searchParams;
  const showPast = params?.past === '1';
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/');

  const supabase = await createClient();

  // As staff, row-level security returns the whole ministry, not one household.
  // Stopped payment plans (22 Oct 2026): money, so only for Payments read --
  // the grant payment_plans_select asks (0101) -- and the card links to the
  // review queue's Plan problems tab, which counts the same way. Since
  // 27 Oct 2026 the same read also feeds the amber card for plans still
  // running with a failed payment (planFailingSince()).
  // The tab is on Awaiting review, which needs Registration read as well.
  const seesStoppedPlans = can(staff, 'read:payments') && can(staff, 'read:registration');
  const [
    { data: regs, error: regsError },
    { data: parts, error: partsError },
    { data: planRows, error: planError },
  ] = await Promise.all([
    supabase.from('registrations').select('id, households ( display_name ), events ( id, name, starts_on, ends_on, archived_at )'),
    supabase
      .from('registration_participants')
      .select('status, registration_id, people ( first_name, last_name )'),
    seesStoppedPlans
      ? supabase
          .from('payment_plans')
          .select('registration_id, status, payment_method_changed_at, payment_installments ( status, attempts, last_error, last_attempt_at )')
          .in('status', ['failed', 'active', 'paused'])
      : Promise.resolve({ data: [], error: null }),
  ]);
  // CLAUDE.md: never turn a query error into an empty list -- the Overview
  // would read as "no registrations".
  if (regsError) throw new Error(`Registrations: ${regsError.message}`);
  if (partsError) throw new Error(`People registered: ${partsError.message}`);
  if (planError) throw new Error(`Payment plans: ${planError.message}`);

  const registrations = regs ?? [];
  const participants = parts ?? [];

  const regById = new Map();
  // The event behind each name, for the current/past split and the jump pills.
  const eventMeta = new Map();
  for (const r of registrations) {
    regById.set(r.id, {
      household: r.households?.display_name ?? 'Household',
      event: r.events?.name ?? 'Unassigned',
    });
    if (r.events?.id) eventMeta.set(r.events.name, r.events);
  }

  // Per-event rollup: families, people coming (not cancelled/draft),
  // confirmed, pending review. Cancelled/draft are counted once for the
  // footnote, not mixed into the headline numbers.
  const byEvent = new Map();
  const eventRow = (ev) => {
    if (!byEvent.has(ev)) {
      byEvent.set(ev, {
        families: new Set(),
        people: 0,
        confirmed: 0,
        pending: 0,
        waitlisted: 0,
      });
    }
    return byEvent.get(ev);
  };
  let cancelled = 0;
  let draft = 0;
  const needsReview = new Map();

  for (const p of participants) {
    const meta = regById.get(p.registration_id);
    const ev = meta?.event ?? 'Unassigned';
    if (p.status === 'cancelled') {
      cancelled += 1;
      continue;
    }
    if (p.status === 'draft') {
      draft += 1;
      continue;
    }
    const row = eventRow(ev);
    row.families.add(p.registration_id);
    row.people += 1;
    if (p.status === 'confirmed') row.confirmed += 1;
    // Waitlisted is a decision staff have ALREADY made, not work outstanding.
    // Counting it as "awaiting review" (as this did until 25 Aug) put a
    // number on the page that no amount of reviewing could ever clear, and
    // made the headline disagree with the list underneath it, which only ever
    // showed 'submitted'. Same rule as the nav badges: an amber number has to
    // be reachable by doing the work.
    if (p.status === 'submitted') row.pending += 1;
    if (p.status === 'waitlisted') row.waitlisted += 1;

    if (p.status === 'submitted') {
      const cur = needsReview.get(p.registration_id) ?? {
        household: meta?.household ?? 'Household',
        event: ev,
        count: 0,
      };
      cur.count += 1;
      needsReview.set(p.registration_id, cur);
    }
  }

  const totalFamilies = new Set(
    participants
      .filter((p) => p.status !== 'cancelled' && p.status !== 'draft')
      .map((p) => p.registration_id)
  ).size;
  const totalPeople = [...byEvent.values()].reduce((s, r) => s + r.people, 0);
  const totalConfirmed = [...byEvent.values()].reduce((s, r) => s + r.confirmed, 0);
  const totalPending = [...byEvent.values()].reduce((s, r) => s + r.pending, 0);
  const totalWaitlisted = [...byEvent.values()].reduce((s, r) => s + r.waitlisted, 0);

  const reviewList = [...needsReview.entries()];

  // Families who wrote back in the app and nobody has read it (0126). First on
  // the page (Lawrence, 26 Oct 2026): a reply sat unseen among the sign-ups.
  // Each shows the start of the family's latest message.
  let replies = [];
  if (can(staff, 'read:registration')) {
    const { data: replyRegs, error: replyError } = await supabase
      .from('registrations')
      .select('id, family_replied_at, households ( display_name ), events ( name )')
      .eq('family_reply_unread', true)
      .order('family_replied_at', { ascending: true });
    if (replyError) throw new Error(`Family replies: ${replyError.message}`);
    const ids = (replyRegs ?? []).map((r) => r.id);
    const { data: msgs, error: msgError } = ids.length
      ? await supabase
          .from('registration_family_messages')
          .select('registration_id, body, created_at')
          .in('registration_id', ids)
          .eq('author_kind', 'family')
          .order('created_at', { ascending: false })
      : { data: [], error: null };
    if (msgError) throw new Error(`Family replies: ${msgError.message}`);
    const latest = new Map();
    for (const m of msgs ?? []) if (!latest.has(m.registration_id)) latest.set(m.registration_id, m.body);
    replies = (replyRegs ?? []).map((r) => ({
      id: r.id,
      family: r.households?.display_name ?? 'Household',
      event: r.events?.name ?? '',
      at: r.family_replied_at,
      body: latest.get(r.id) ?? '',
    }));
  }

  // Registrations at a current event whose plan stopped after three failed
  // payments -- the same rule as the review queue's tab -- and, amber, those
  // whose plan is still running with a failed payment waiting to retry.
  const eventOfReg = new Map(registrations.map((r) => [r.id, r.events]));
  const currentPlans = (planRows ?? []).filter((p) => {
    const ev = eventOfReg.get(p.registration_id);
    return ev ? isCurrentEventRow(ev) : false;
  });
  const plansStopped = currentPlans.filter((p) => p.status === 'failed').length;
  const plansFailing = currentPlans
    .map((p) => ({ plan: p, failing: planFailingSince(p) }))
    .filter((x) => x.failing)
    .sort((a, b) => String(a.failing.since ?? '').localeCompare(String(b.failing.since ?? '')))
    .map(({ plan, failing }) => ({
      registrationId: plan.registration_id,
      household: regById.get(plan.registration_id)?.household ?? 'Household',
      next: planFailingNext(failing),
    }));
  const extraCards = (plansStopped > 0 ? 1 : 0) + (plansFailing.length > 0 ? 1 : 0);

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Overview</h2>

      <div
        className={`grid grid-cols-1 gap-4 mb-8 ${
          extraCards === 2 ? 'sm:grid-cols-2 lg:grid-cols-5' : extraCards === 1 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'
        }`}
      >
        <Stat
          label="Families signed up"
          sub="each family registers once per event"
          value={totalFamilies}
        />
        <Stat
          label="People coming"
          sub={`across those families · ${totalConfirmed} confirmed`}
          value={totalPeople}
        />
        <Stat
          label="Awaiting Review"
          sub={
            totalPending > 0
              ? 'needs staff action below'
              : totalWaitlisted > 0
                ? `nothing waiting on staff · ${totalWaitlisted} waitlisted`
                : 'nothing waiting on staff'
          }
          value={totalPending}
          tone={totalPending > 0 ? 'amber' : undefined}
          href="/admin/review/"
        />
        {seesStoppedPlans && plansStopped > 0 && (
          <Stat
            label="Payment plans stopped"
            sub="three failed payments · call the family"
            value={plansStopped}
            tone="red"
            href="/admin/review/?show=plan"
          />
        )}
        {seesStoppedPlans && plansFailing.length > 0 && <FailingPlansCard plans={plansFailing} />}
      </div>

      {replies.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 shadow-xs p-6 mb-8">
          <h3 className="font-bold mb-1">
            <span aria-hidden>✉</span> {replies.length === 1 ? 'A family wrote back' : `${replies.length} families wrote back`}
          </h3>
          <p className="text-sm text-neutral-600 mb-3">
            Replies in the app that nobody has read yet, oldest first. Open one to read it; writing
            back, or <em>Mark as read</em>, clears it.
          </p>
          <ul className="divide-y divide-amber-100">
            {replies.map((r) => (
              <li key={r.id} className="py-2">
                <Link href={`/admin/registrations/${r.id}/#review`} className="font-semibold text-brand underline">
                  {r.family}
                </Link>
                <span className="text-sm text-neutral-500">
                  {' '}· {r.event} · {whenInMorristown(r.at)}
                </span>
                {r.body && (
                  <span className="block text-sm text-neutral-700">
                    &ldquo;{r.body.length > 160 ? `${r.body.slice(0, 160)}…` : r.body}&rdquo;
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The work queue: families with someone still pending review.
          Given an id (25 Aug) because other pages point at it in words --
          Recent Changes says new people "land in the Awaiting Review queue on
          the Overview" -- and a page you have to hunt for is not really a
          queue. That sentence is now a link to this card. */}
      {can(staff, 'read:registration') && reviewList.length > 0 && (
        <div
          id="awaiting-review"
          className="scroll-mt-4 rounded-lg bg-white border border-amber-200 shadow-xs p-6 mb-8"
        >
          <h3 className="font-bold mb-1">New registrations awaiting review</h3>
          <p className="text-sm text-neutral-500 mb-3">
            Families with someone marked &ldquo;submitted — pending review&rdquo; — new sign-ups,
            newly added people, or a changed role. Open one to confirm, waitlist, or edit.
            (Edits to existing info live on the Recent Changes page instead.)
          </p>
          <ul className="divide-y divide-neutral-100">
            {reviewList.map(([id, r]) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/admin/registrations/${id}`} className="text-brand underline font-medium">
                    {r.household}
                  </Link>
                  <span className="text-neutral-500"> — {r.event}</span>
                </span>
                <span className="rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-semibold">
                  {r.count} pending
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg bg-white border border-neutral-200 shadow-xs p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="font-bold">By event</h3>
          <Link href="/admin/rosters" className="btn-outline py-1.5! text-sm">
            View full rosters
          </Link>
        </div>
        {/* Every CURRENT event at once (16 Oct 2026): the table is the point
            of this page, so the shared filter's pills JUMP to a row rather
            than hide the others. Past events are one link away. */}
        {(() => {
          const rowsAll = [...byEvent.entries()];
          const isCur = (name) => {
            const m = eventMeta.get(name);
            return m ? isCurrentEventRow(m) : false;
          };
          const shownRows = showPast ? rowsAll : rowsAll.filter(([name]) => isCur(name));
          const pastCount = rowsAll.length - rowsAll.filter(([name]) => isCur(name)).length;
          const pills = shownRows
            .map(([name]) => eventMeta.get(name))
            .filter(Boolean)
            .map((e) => ({ id: e.id, name: e.name, startsOn: e.starts_on, endsOn: e.ends_on, archivedAt: e.archived_at }));
          return (
            <>
              {pills.length > 1 && <EventJump events={pills} />}
              {byEvent.size === 0 ? (
                <p className="text-neutral-500">No sign-ups yet.</p>
              ) : shownRows.length === 0 ? (
                <p className="text-neutral-500">
                  No current events have sign-ups.{' '}
                  {pastCount > 0 && (
                    <Link href="/admin?past=1" className="text-brand underline">
                      Show past events ({pastCount})
                    </Link>
                  )}
                </p>
              ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-500">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Event</th>
                  <th className="py-2 pr-4 font-semibold text-right">Families</th>
                  <th className="py-2 pr-4 font-semibold text-right">People</th>
                  <th className="py-2 pr-4 font-semibold text-right">Confirmed</th>
                  <th className="py-2 pr-4 font-semibold text-right">Waitlisted</th>
                  <th className="py-2 font-semibold text-right">Awaiting Review</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.map(([ev, r]) => (
                  <tr key={ev} id={eventMeta.get(ev)?.id ? `event-${eventMeta.get(ev).id}` : undefined} className="border-t border-neutral-100 target:bg-brand-light">
                    <td className="py-2 pr-4 font-medium">{ev}</td>
                    <td className="py-2 pr-4 text-right">{r.families.size}</td>
                    <td className="py-2 pr-4 text-right">{r.people}</td>
                    <td className="py-2 pr-4 text-right text-green-700 font-semibold">{r.confirmed}</td>
                    <td className="py-2 pr-4 text-right text-neutral-600">{r.waitlisted}</td>
                    <td className={`py-2 text-right font-semibold ${r.pending > 0 ? 'text-amber-700' : 'text-neutral-400'}`}>
                      {r.pending}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pastCount > 0 && !showPast && (
              <p className="mt-2 text-xs text-neutral-500">
                <Link href="/admin?past=1" className="underline">
                  Show past events ({pastCount})
                </Link>
              </p>
            )}
            {showPast && (
              <p className="mt-2 text-xs text-neutral-500">
                <Link href="/admin" className="underline">
                  Back to current events
                </Link>
              </p>
            )}
          </div>
              )}
            </>
          );
        })()}
        {(cancelled > 0 || draft > 0) && (
          <p className="mt-3 text-xs text-neutral-400">
            Not counted above:
            {cancelled > 0 ? ` ${cancelled} cancelled` : ''}
            {cancelled > 0 && draft > 0 ? ' ·' : ''}
            {draft > 0 ? ` ${draft} unfinished (draft)` : ''}
            .
          </p>
        )}
      </div>
    </div>
  );
}
