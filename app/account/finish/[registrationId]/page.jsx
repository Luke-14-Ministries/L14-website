import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { balanceDueOn, formatDueDate, dateISO } from '@/lib/events';
import { registrationDepositCents } from '@/lib/payments';
import { planAvailable, planConsentText } from '@/lib/plans';
import FinishChoices from './FinishChoices';
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
export default async function FinishPage({ params }) {
  const { registrationId } = await params;
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
      `id, household_id, created_at,
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
  ]);
  // A failed balance read would show "nothing owed" and hide the ways to pay.
  if (balError) throw new Error(`Balance: ${balError.message}`);
  if (routeError) throw new Error(`Payment route: ${routeError.message}`);
  if (payInFullError) throw new Error(`Pay-in-full amount: ${payInFullError.message}`);

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
        <p className="text-neutral-600 mb-6">
          {ev.name}. Pay in full, set up a payment plan, or request help with the fee.
          {due && (
            <>
              {' '}The balance is due by <strong>{formatDueDate(due)}</strong>.
            </>
          )}
        </p>

        {done ? (
          <div className="rounded-sm border border-green-300 bg-green-50 px-4 py-3 text-green-900">
            <p className="font-semibold">You&rsquo;re all set.</p>
            <p className="mt-1 text-sm">
              {route.route === 'plan' && 'Your payment plan is in place. Its schedule is on your dashboard.'}
              {route.route === 'paid_in_full' && 'Your balance is paid in full. Thank you!'}
              {route.route === 'nothing_owed' && 'There is nothing to pay on this registration.'}
              {route.route === 'scholarship' &&
                'Your scholarship request is with camp staff. They will be in touch.'}
            </p>
            <Link href="/account/dashboard/" className="btn-primary mt-3 inline-block py-2!">
              Go to my dashboard
            </Link>
          </div>
        ) : (
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
          />
        )}
      </div>
    </section>
  );
}
