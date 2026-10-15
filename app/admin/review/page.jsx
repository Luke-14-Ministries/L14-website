import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { REVIEW_CLASS, REVIEW_FLAG } from '@/lib/plans';
import { statusPill } from '@/lib/format';

export const metadata = { title: 'Awaiting review — Staff Admin' };

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
  if (!can(staff, 'registrar')) redirect('/admin');

  const showAll = params?.show === 'all';
  const supabase = await createClient();

  const [{ data: regs }, { data: parts }, { data: reviews }, { data: balances }] =
    await Promise.all([
      supabase
        .from('registrations')
        .select('id, created_at, households ( display_name ), events ( id, name, starts_on )'),
      supabase
        .from('registration_participants')
        .select('registration_id, status, camp_role, people ( first_name, last_name )'),
      supabase
        .from('registration_review')
        .select('registration_id, review_class, flags, confirmed_paid_cents, deposit_expected_cents'),
      supabase.from('registration_balances').select('registration_id, paid_cents, balance_cents, fee_cents'),
    ]);

  const reviewByReg = new Map((reviews ?? []).map((r) => [r.registration_id, r]));
  const balanceByReg = new Map((balances ?? []).map((b) => [b.registration_id, b]));

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
        balance: balanceByReg.get(r.id) ?? null,
        created: r.created_at,
      };
    })
    .filter((r) => r.people.length > 0 && (showAll || r.pending.length > 0));

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
  for (const g of groups) g.rows.sort((a, b) => String(a.created).localeCompare(String(b.created)));

  const totalPending = rows.reduce((s, r) => s + r.pending.length, 0);
  const totalFlags = rows.reduce((s, r) => s + (r.review?.flags?.length ?? 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
        <h2 className="text-xl font-bold">Awaiting review</h2>
        <div className="flex gap-2 text-sm">
          <Link
            href="/admin/review/"
            className={`rounded-full px-3 py-1 font-semibold border ${
              !showAll ? 'bg-brand text-white border-brand' : 'border-neutral-300 text-neutral-700 hover:border-brand'
            }`}
          >
            Waiting on staff
          </Link>
          <Link
            href="/admin/review/?show=all"
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
        a conversation first. Open the registration to confirm, waitlist, or write to the family.
        {' '}
        <strong>{totalPending}</strong> {totalPending === 1 ? 'person' : 'people'} waiting
        {totalFlags > 0 && (
          <>
            {' '}· <strong>{totalFlags}</strong> {totalFlags === 1 ? 'flag' : 'flags'}
          </>
        )}
        .
      </p>

      {groups.length === 0 && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Nothing waiting on staff.
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
                  const flags = r.review?.flags ?? [];
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
                          registered {String(r.created ?? '').slice(0, 10)}
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
                                <span className={`rounded px-1.5 py-0.5 font-semibold ${pill.cls}`}>
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
                            className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${cls.cls}`}
                          >
                            {cls.label}
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
                        {flags.length === 0 ? (
                          <span className="text-neutral-400">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {flags.map((f) => (
                              <li key={f} className="whitespace-nowrap text-xs font-semibold text-amber-800">
                                ⚑ {REVIEW_FLAG[f] ?? f}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      {/* The family name is the link to the registration; an
                          "Open →" beside it was the same link twice (15 Oct). */}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <div>{money(r.balance?.paid_cents)}</div>
                        <div className="text-xs text-neutral-500">
                          {(r.balance?.balance_cents ?? 0) < 0
                            ? `${money(-r.balance.balance_cents)} credit`
                            : `${money(r.balance?.balance_cents)} owed`}
                        </div>
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
