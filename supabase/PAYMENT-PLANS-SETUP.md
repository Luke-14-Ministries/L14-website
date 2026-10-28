# Payment plans and the early-registration discount: switching them on

Built 30 September 2026 from Larry's rules. The site needs these steps before any of it
works. Everything stays in **Stripe test mode**. Do the Stripe steps again with live keys
at launch: test and live mode have separate webhooks and separate secrets.

## What families will see (camp weeks only)

- After registering, a **"choose how to pay"** step offering three options. (Since `0081` it is
  offered, not required: submitting needs nothing paid, and approval waits on the deposit.)
  - **Pay in full.**
  - **Payment plan:** the deposit now, then automatic charges monthly or twice a month
    until the due date (the event's `balance_due_on` — July 1 for the camp weeks, `0096`).
  - **Request a scholarship.**
- **Early registration:** $X off per person for anyone registered by the early date,
  once the family pays in full or starts a plan. A scholarship request alone does not
  earn it.
- On the dashboard, the plan's schedule and a **"Change card or bank account"** button.

Staff see a **"Paying by"** column on Event Payments, with **Not finished** in amber. Each
registration page shows the plan's schedule, with pause, resume, retry and cancel. Staff
also decide whether a family keeps the early discount when a plan fails or is cancelled.

## Switch it on: seven steps

1. **Run migration `0080_payment_plans_and_early_registration.sql`** in the Supabase SQL
   Editor, the usual way (`migrations/README.md`).
2. **Deploy the functions.** `_shared/` goes up with them automatically.
   ```
   supabase functions deploy stripe-webhook --no-verify-jwt
   supabase functions deploy stripe-plans-webhook --no-verify-jwt
   supabase functions deploy charge-payment-plans --no-verify-jwt
   ```
   `--no-verify-jwt` is correct for all three. Stripe and the timer do not send a Supabase
   login; each function checks its own signature or secret.
3. **Stripe (test mode): Developers → Webhooks → Add endpoint.**
   URL: `https://nnbcxqxwkivadzognpno.supabase.co/functions/v1/stripe-plans-webhook`
   Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `payment_intent.succeeded`,
   `payment_intent.payment_failed`.
   Leave the existing `stripe-webhook` endpoint exactly as it is.
4. **Supabase → Edge Functions → Secrets**, add:
   - `STRIPE_PLANS_WEBHOOK_SECRET`: the `whsec_…` signing secret from step 3.
   - `CRON_SECRET`: a long random string. Generate it in Bitwarden and keep it there.
   - `STAFF_ALERT_TO` *(optional)*: where failed-plan alerts go. The default is
     `registration@luke14ministries.net`.
5. **Supabase → Integrations → Cron → Create job**, to run the charger once a day:
   - Schedule: `45 9 * * *` as created 28 Oct 2026 (job `charge-payment-plans-daily`; 9:45 UTC, before the
     13:00 UTC reminders). The original suggestion was `45 10 * * *` (10:45 UTC, which is 6:45am Eastern in summer and 5:45am
     in winter).
   - Type: Supabase Edge Function, `charge-payment-plans`, method POST.
   - Header: `x-cron-secret` = the `CRON_SECRET` value.
6. **Setup page → each Camp Celebrate week → "Edit dates, capacity, price and early
   registration"**: set **Early registration ends** and **Early discount** ($50).
7. **Try it** with the test script below.

## The three live-mode webhook endpoints (gathered 28 Oct 2026)

Stripe → **Live mode** → Developers → Webhooks → **Add endpoint**, three times. Test-mode endpoints
do not carry over (none exist in live mode as of 28 Oct). Each takes **exactly** these events, read
from the functions' code and matching the three test-mode endpoints, which were checked against the
code the same day. Set each endpoint's **API version to `2023-10-16`**, the version the test
endpoints use and the functions were written against: a newer version changes the shape of what
Stripe sends.

| Endpoint URL (`https://nnbcxqxwkivadzognpno.supabase.co/functions/v1/…`) | Events | Its signing secret goes in |
|---|---|---|
| `stripe-webhook` (payments and donations) | `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` | `STRIPE_WEBHOOK_SECRET` |
| `stripe-refund-webhook` (refunds) | `charge.refunded`, `charge.refund.updated`, `refund.created`, `refund.updated`, `refund.failed` | `STRIPE_REFUND_WEBHOOK_SECRET` |
| `stripe-plans-webhook` (payment plans) | `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed` | `STRIPE_PLANS_WEBHOOK_SECRET` |

The checkout events go to **both** `stripe-webhook` and `stripe-plans-webhook` on purpose: each
function ignores the sessions that are not its own (by the session's `metadata.kind`). An event left
off an endpoint fails silently — the money moves in Stripe and the site never hears of it — so tick
them against this table, then send one test event per endpoint from Stripe's dashboard and look for
a 200 in its log.

## Test script (test mode)

Stripe test card `4242 4242 4242 4242` always succeeds. Card `4000 0000 0000 0341` saves
fine but every charge on it is declined -- including the deposit, which Checkout charges at
once, so a plan cannot be *started* with it (found 27 Oct 2026). Start the plan with 4242,
then switch the plan to 0341 with **Change card or bank account** (a setup page, no charge). Stripe's
test bank accounts are listed in the Stripe docs under ACH testing.

1. Register a test family for a Camp Celebrate week before the early date. The
   confirmation should say **"One last step: choose how you'll pay"**. The dashboard
   should show **Not finished**, and Event Payments should show **Not finished**.
2. Choose **Payment plan**, pick monthly, tick the agreement, and pay the deposit with
   4242. Back on the dashboard you should see the plan, the schedule, the $50-per-person
   discount in the balance, and **Paying by: Plan · Monthly** on Event Payments.
3. **Dry run of the charger** (charges nothing):
   ```
   curl -X POST "https://nnbcxqxwkivadzognpno.supabase.co/functions/v1/charge-payment-plans?dry=1" -H "x-cron-secret: <CRON_SECRET>"
   ```
   On a normal day it lists nothing, because no payment is due yet. To test a real
   charge, set the first installment's `due_on` to today in the Table Editor
   (`payment_installments`), then run the same command without `?dry=1`.
4. On the plan from step 2, press **Change card or bank account** on the dashboard and save
   card 0341 (nothing is charged). Bring a payment forward as in step 3 and run the
   charger. The family gets a "payment problem" email and the plan shows a retry date;
   staff with Payments read see it at once, in amber, under Awaiting review → *Plan
   problems*, on the Overview and on the plan card. After three failures the plan stops and staff get an alert, subject
   *[Payment plans] Plan stopped — <household> — <event>*, with what was owed, the
   remaining balance, the family's email and phone, and an *Open the registration*
   button; the registration's flag on Awaiting review → *Plan problems* turns red (and a red
   card on the Overview) for staff with Payments read. **Change card or bank
   account** on the dashboard starts it again. Every one of these emails, family and
   staff, is a row in `message_log` (template keys `plan_*`; migration `0121` grants the
   insert, so apply it before deploying the functions).
5. Register a second family early and choose **Pay in full**. The amount offered should
   already include the discount, and the balance should end at exactly $0.
6. Register a third and choose **Request a scholarship**. The registration counts as
   finished, with no early discount.

## Worth knowing

- The charger works each amount out **on the day** from what is still owed, divided by
  the charges left. A scholarship or extra payment partway through makes the rest
  smaller, and the last charge lands the balance on $0. The amounts shown in advance
  are estimates.
- Only one charge per plan per day. A failed charge is tried again 3 days later, 3
  tries in all.
- Automatic bank charges use the permission the family gives in Stripe's checkout when
  they save the account. The first off-session **bank** charge in test mode is the
  thing most worth watching: if Stripe asks for more, it will show up as an error on
  that installment.
- Staff never see or type card numbers. Only the family can change the payment method.
- The tests for all of this are in `supabase/tests/`.
- **Returned bank payment fee** (`0123`, 22 Oct 2026). Setup → the event → *Returned bank
  payment fee ($)*; $0 is off. When it is over $0, Ways to pay and the dashboard's pay panel
  say so beside the bank choice, and the plan agreement gains one sentence naming it. The
  amount the family saw rides in the Checkout metadata (`returned_fee_cents`) and is stored
  on the plan (`payment_plans.returned_payment_fee_cents`); only a bank debit the bank
  actually **returned** adds it (not a try Stripe refused at once after blocking the account),
  once per PaymentIntent and once per installment, and only that snapshot — a fee set or raised later never
  applies to a family who already agreed. It is owed in the balance, so a plan's remaining
  charges collect it and the plan still ends on $0. Staff waive or add fees on the
  registration page (add: Payments write; waive: Payments and Registration write). **Deploy `stripe-webhook`, `stripe-plans-webhook` and
  `charge-payment-plans` together after applying `0123`** — all three bundle
  `_shared/plans.ts`, which calls `record_returned_payment_fee()`. To test: set a fee, pay by
  test bank account with Stripe's failing test account number, and check the fee line on the
  dashboard and the payment-problem email.
