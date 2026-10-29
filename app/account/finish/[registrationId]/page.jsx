import { notFound, redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { balanceDueOn, formatDueDate, formatDueDateShort, dateISO } from '@/lib/events';
import { dollars, registrationDepositCents } from '@/lib/payments';
import { planAvailable, planConsentText } from '@/lib/plans';
import FinishChoices from './FinishChoices';
import Link from 'next/link';
import BackLink from '@/components/BackLink';

export const metadata = { title: 'Finish Registering — Luke 14 Ministries' };

// The last step of registering for a camp week (Larry, 30 Sep 2026): the
// family chooses how the balance will be paid, and the registration is not
// finished until they do.
//
//   * Pay in full now      -- earns the early-registration discount if early
//   * Payment plan         -- deposit now, the rest charged automatically;
//                             also earns the early discount
//   * Request a scholarship -- the existing scholarship page
//
// Whether a family has finished is not stored as a flag: it is worked out by
// the registration_payment_routes view from what actually happened (a plan
// that got past its deposit, a paid balance, a scholarship request). A flag
// could say "plan" while no plan exists.
//
// Since 27 Oct 2026 this is where EVERY payment starts (the dashboard has one
// "Ways to pay" button): the deposit alone or any amount, in full, a plan, a
// scholarship request, a mailed check -- and the statement, one click away.
export default async function FinishPage({ params, searchParams }) {
  const { registrationId } = await params;
  // Stripe's cancel page lands here (both checkouts, since 27 Oct 2026).
  const payCancelled = (await searchParams)?.pay === 'cancelled';
  const user = await getCurrentUser();
  if (!user) redirect(`/account/?next=/account/finish/${registrationId}/`);

  const supabase = await createClient();

  // Scoped to the caller's own household EXPLICITLY -- staff RLS is broad,
  // and a staff member's own "finish registering" page must never open
  // somebody else's family (CLAUDE.md working rules).
  const { data: memberships, error: memberError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id);
  if (memberError) throw new Error(`Your household: ${memberError.message}`);
  const householdIds = (memberships ?? []).map((m) => m.household_id);
  if (householdIds.length === 0) notFound();

  const { data: reg, error: regError } = await supabase
    .from('registrations')
    .select(
      `id, household_id, created_at, deposit_waived_at,
       events ( id, name, event_type, starts_on, ends_on, deposit_cents, balance_due_on,
                early_registration_ends_on, early_registration_discount_cents, returned_payment_fee_cents ),
       registration_participants ( id, person_id, status, camp_role )`
    )
    .eq('id', registrationId)
    .in('household_id', householdIds)
    .maybeSingle();
  // CLAUDE.md: never swallow a query error -- a dropped one read as a 404.
  if (regError) throw new Error(`Finish registration: ${regError.message}`);
  if (!reg) notFound();

  const [
    { data: bal, error: balError },
    { data: route, error: routeError },
    { data: payInFull, error: payInFullError },
    { data: payRows, error: payRowsError },
  ] = await Promise.all([
    supabase
      .from('registration_balances')
      .select('balance_cents, paid_cents, fee_cents, early_discount_cents')
      .eq('registration_id', registrationId)
      .maybeSingle(),
    supabase
      .from('registration_payment_routes')
      .select('route, plan_status')
      .eq('registration_id', registrationId)
      .maybeSingle(),
    supabase.rpc('pay_in_full_amount', { p_registration_id: registrationId }),
    // Money mid-flight (a bank payment not yet settled): the balance already
    // counts it, so it is named as "clearing", never left to look missing.
    supabase.from('payments').select('amount_cents, status').eq('registration_id', registrationId),
  ]);
  // A failed balance read would show "nothing owed" and hide the ways to pay.
  if (balError) throw new Error(`Balance: ${balError.message}`);
  if (routeError) throw new Error(`Payment route: ${routeError.message}`);
  if (payInFullError) throw new Error(`Pay-in-full amount: ${payInFullError.message}`);
  if (payRowsError) throw new Error(`Payments: ${payRowsError.message}`);
  const clearing = (payRows ?? [])
    .filter((p) => p.status === 'processing')
    .reduce((sum, p) => sum + (p.amount_cents ?? 0), 0);

  const ev = reg.events ?? {};
  const balance = bal?.balance_cents ?? 0;
  const full = Math.min(balance, payInFull ?? balance);
  const earlySaving = Math.max(0, balance - full);
  const due = balanceDueOn(ev);
  const today = dateISO(0);
  const canPlan = planAvailable(ev) && balance > 0;
  const deposit = registrationDepositCents({
    perPersonCents: ev.deposit_cents,
    participants: reg.registration_participants,
    balanceCents: balance,
  });

  // The plan's charge dates for both schedules, from the database's own rule,
  // so the preview is exactly what the charger will do.
  let preview = null;
  if (canPlan) {
    const [{ data: monthly, error: monthlyError }, { data: semi, error: semiError }] = await Promise.all([
      supabase.rpc('plan_charge_dates', { p_today: today, p_due: due, p_schedule: 'monthly' }),
      supabase.rpc('plan_charge_dates', { p_today: today, p_due: due, p_schedule: 'semi_monthly' }),
    ]);
    if (monthlyError || semiError) {
      throw new Error(`Plan dates: ${(monthlyError || semiError).message}`);
    }
    const afterDeposit = Math.max(0, full - deposit);
    const build = (dates) => {
      const list = [...(dates ?? [])].map((d) => (typeof d === 'string' ? d : d?.plan_charge_dates)).sort();
      return {
        dates: list,
        each: list.length ? Math.ceil(afterDeposit / list.length) : afterDeposit,
      };
    };
    const dueLabel = formatDueDate(due);
    // 0123: the agreement names the returned-payment fee only when there is one.
    const returnedFeeCents = ev.returned_payment_fee_cents ?? 0;
    preview = {
      monthly: { ...build(monthly), consent: planConsentText({ schedule: 'monthly', dueLabel, returnedFeeCents }) },
      semi_monthly: {
        ...build(semi),
        consent: planConsentText({ schedule: 'semi_monthly', dueLabel, returnedFeeCents }),
      },
    };
  }

  const done = route?.route && route.route !== 'none';
  // The deposit is what is asked for now while nothing is paid or clearing
  // (the dashboard pill's rule, depositDueNow; waived by staff, nothing is
  // asked; a scholarship request is a route, so done).
  const depositDue = !done && !reg.deposit_waived_at && deposit > 0 && (bal?.paid_cents ?? 0) === 0 && clearing === 0;

  return (
    <section className="section">
      <div className="max-w-2xl mx-auto">
        {/* Retitled 30 Sep 2026: choosing is optional now -- a registration
            is complete when submitted; the deposit is what staff need to
            approve it (Lawrence). This page is simply the ways to pay. The
            header matches the other account pages: title left, the Back to
            dashboard pill right (26 Oct 2026). */}
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
          <h1 className="text-3xl font-bold">Ways to pay</h1>
          <BackLink />
        </div>
        <p className="text-neutral-600 mb-2">
          {ev.name}. Pay the deposit or any amount, pay in full, set up a payment plan, or request
          help with the fee.
          {/* Once the date has passed, "due by" a day gone reads wrong
              (29 Oct 2026); the dashboard says "balance past due". */}
          {due && due < today && balance > 0 ? (
            <>
              {' '}The balance was due on <strong>{formatDueDate(due)}</strong>, so it is due now.
            </>
          ) : due && due >= today ? (
            <>
              {' '}The balance is due by <strong>{formatDueDate(due)}</strong>.
            </>
          ) : null}
        </p>
        {/* The dashboard card's pills, the same words and colours (Lawrence,
            27 Oct 2026: "should also feature the deposit due amber pill"),
            and the statement beside the money it explains. */}
        <p className="mb-6 flex flex-wrap items-center gap-2 text-sm text-neutral-700">
          {balance > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
              {dollars(balance)} balance{due ? ` · due ${formatDueDateShort(due)}` : ''}
            </span>
          )}
          {depositDue && (
            <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-semibold text-white">
              {dollars(deposit)} deposit due now
            </span>
          )}
          {clearing > 0 && <span>{dollars(clearing)} clearing the bank ⏳</span>}
          <Link href={`/account/statement/${reg.id}`} className="font-semibold text-brand underline">
            See the statement
          </Link>
        </p>

        {payCancelled && (
          <div className="mb-6 rounded-sm border border-neutral-300 bg-white px-4 py-3">
            <p className="font-semibold">That payment wasn&rsquo;t completed.</p>
            <p className="mt-1 text-sm text-neutral-600">
              Nothing was charged and your balance is unchanged. You can try again whenever
              you&rsquo;re ready. If a card was declined, your bank can usually say why.
            </p>
          </div>
        )}

        {done && (
          <div className="mb-6 rounded-sm border border-green-300 bg-green-50 px-4 py-3 text-green-900">
            <p className="font-semibold">You&rsquo;re all set.</p>
            <p className="mt-1 text-sm">
              {route.route === 'plan' && 'Your payment plan is in place. Its schedule, and the button to change the card or bank account it charges, are on your dashboard.'}
              {route.route === 'paid_in_full' && 'Your balance is paid in full. Thank you!'}
              {route.route === 'nothing_owed' && 'There is nothing to pay on this registration.'}
              {route.route === 'scholarship' &&
                'Your scholarship request is with camp staff. They will be in touch.'}
            </p>
          </div>
        )}
        {/* With a route chosen, one-off payments are still here: an extra
            payment on a plan, or part of what a scholarship leaves. */}
        {done && balance > 0 && <h2 className="mb-3 text-lg font-semibold">Make a payment</h2>}
        {balance > 0 && (
          <FinishChoices
            registrationId={reg.id}
            balanceCents={balance}
            payInFullCents={full}
            earlySavingCents={earlySaving}
            earlyEndsOn={ev.early_registration_ends_on ?? null}
            depositCents={deposit}
            canPlan={canPlan}
            preview={preview}
            planPending={route?.plan_status === 'pending'}
            returnedFeeCents={ev.returned_payment_fee_cents ?? 0}
            depositDue={depositDue}
            routesOpen={!done}
          />
        )}

        {balance > 0 && (
          <div className="mt-6 space-y-2 text-sm">
            {/* Instructions, not an agreement (24 Aug): shown to the people who
                need them, signed by nobody. Moved here from the dashboard's
                pay panel, 27 Oct 2026. */}
            <details>
              <summary className="fold-summary cursor-pointer font-semibold text-brand">
                Prefer to mail a check?
              </summary>
              <div className="mt-2 rounded-sm border border-neutral-200 bg-white p-3 text-neutral-700">
                <p>
                  Make it payable to <strong>Luke 14 Ministries</strong> and mail it to:
                </p>
                <p className="mt-1 font-semibold">
                  Luke 14 Ministries
                  <br />
                  2348 W. Andrew Johnson Hwy, #140
                  <br />
                  Morristown, TN 37814
                </p>
                <p className="mt-2 text-xs text-neutral-500">
                  Please put the family name and event in the memo line. Staff record the check when
                  it arrives, and your balance updates then.
                </p>
              </div>
            </details>
            <p className="text-xs text-neutral-500">
              Payments are handled securely by Stripe. Card and bank details never touch this site.
              Registration payments cover event costs (food, lodging and activities) and are{' '}
              <strong>not tax-deductible</strong>.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
