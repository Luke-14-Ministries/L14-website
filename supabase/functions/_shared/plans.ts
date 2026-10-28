// Payment plans: what the Stripe webhook and the daily charger both do.
//
// One module so the two can never disagree about what a successful or failed
// charge means. Everything here is IDEMPOTENT -- Stripe retries webhooks, the
// charger and the webhook can both see the same PaymentIntent, and each
// transition happens once because every update is conditional on the row
// still being in the state it expects. An email is sent only by whoever
// actually made the transition, so a family never gets the same notice twice.
//
// Rules (Larry, 30 Sep 2026; migration 0080):
//   * the deposit is the plan's first payment and is what activates it
//   * each later charge = what is still owed / charges left, the last one
//     taking whatever remains, so the plan ends on exactly $0
//   * a failed charge is tried again 3 days later, 3 tries in all; after the
//     third the plan stops as 'failed' and staff are told
//   * staff decide whether a failed or cancelled plan keeps the early discount

import Stripe from 'npm:stripe@23.0.0';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const MAX_ATTEMPTS = 3;
export const RETRY_DAYS = 3;
// The site's address for links in emails. From the SITE_URL secret
// (Supabase -> Edge Functions -> Secrets) since 28 Oct 2026, so the address
// switch at go-live is a setting, not a code change and a redeploy; the
// preview address until it is set.
export const SITE = (Deno.env.get('SITE_URL') ?? 'https://luke14-ministries.vercel.app').replace(/\/$/, '');

// The ministry's calendar day (Morristown), YYYY-MM-DD.
export function ministryToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

// A provider's error as a phrase in our sentence: "(your card was declined)",
// not "(Your card was declined.)." -- lib/plans.js declineReason(), the same rule.
export function declineReason(message: string | null | undefined): string {
  const s = String(message ?? '').trim().replace(/[.\s]+$/, '');
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

// "Visa ending 4242" / "Bank account ending 6789" -- shown on pages so nobody
// has to ask Stripe what a plan will charge.
export function methodLabel(pm: Stripe.PaymentMethod | null): string | null {
  if (!pm) return null;
  if (pm.type === 'card' && pm.card) {
    const brand = pm.card.brand ? pm.card.brand[0].toUpperCase() + pm.card.brand.slice(1) : 'Card';
    return `${brand} ending ${pm.card.last4}`;
  }
  if (pm.type === 'us_bank_account' && pm.us_bank_account) {
    return `${pm.us_bank_account.bank_name ?? 'Bank account'} ending ${pm.us_bank_account.last4}`;
  }
  return pm.type;
}

// ---------------------------------------------------------------------------
// Email. Fire-and-tolerate: a failed email never fails a money write.
//
// Every plan email -- the family's receipt and payment-problem notices, and
// every staff alert -- is sent through sendEmail() and logged there, in one
// place, to message_log (0001; Lawrence, 22 Oct 2026: "We told you on the
// first" must be answerable from a record). The edge functions use the
// service-role client, which RLS does not apply to, so they insert directly;
// log_family_email() (0120) is the STAFF path and is not used here. A
// logging failure is printed and the run carries on: the charge is already
// recorded, and a missing log row must never undo or block it.
// ---------------------------------------------------------------------------

// Family-entered words (a household name) and provider error text go into
// HTML, so they are escaped first.
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shell(title: string, body: string): string {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222">
  <div style="background:#14606a;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">Luke 14 Ministries</h1>
    <p style="margin:4px 0 0;font-size:13px;opacity:.85">${title}</p>
  </div>
  <div style="border:1px solid #dde3e4;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px;font-size:14px">
    ${body}
    <p style="font-size:12px;color:#888">Registration payments cover event costs and are not tax-deductible. Questions? Email <a href="mailto:registration@luke14ministries.net" style="color:#14606a">registration@luke14ministries.net</a> or call (423) 748-4954.</p>
  </div>
</div>`;
}

// A link that looks like a button (table-based, so mail clients keep it).
function button(href: string, text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="border-radius:6px;background:#14606a">
  <a href="${href}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none">${text}</a>
</td></tr></table>`;
}

// The message_log template keys used here. message_log.template_key is free
// text (no check constraint, 0001), so this list is the vocabulary.
export type PlanTemplate =
  | 'plan_receipt'
  | 'plan_payment_problem'
  | 'plan_stopped_family'
  | 'plan_stopped_staff'
  | 'plan_reopened_staff'
  | 'plan_deposit_failed_staff'
  // A pay-in-full (or deposit, or part) bank payment that came back, with a
  // returned-payment fee added (0123). Sent by stripe-webhook.
  | 'bank_payment_returned_family';

export type Sent = { ok: boolean; id: string | null; error: string | null };

export async function sendEmail(
  admin: SupabaseClient,
  m: {
    to: string | null;
    subject: string;
    title: string;
    body: string;
    templateKey: PlanTemplate;
    householdId?: string | null;
    registrationId?: string | null;
  }
): Promise<Sent> {
  // No address: nothing to send and nothing to log (to_email is required).
  if (!m.to) {
    console.warn(`[plans] no address for ${m.templateKey} on registration ${m.registrationId ?? '?'}: not sent`);
    return { ok: false, id: null, error: 'No email address on file.' };
  }

  let sent: Sent;
  try {
    const key = Deno.env.get('RESEND_API_KEY');
    if (!key) {
      sent = { ok: false, id: null, error: 'RESEND_API_KEY is not set, so nothing was sent.' };
    } else {
      const from =
        Deno.env.get('RECEIPT_FROM') ?? 'Luke 14 Ministries <registration@luke14ministries.net>';
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: shell(m.title, m.body) }),
      });
      const text = await resp.text();
      if (!resp.ok) {
        sent = { ok: false, id: null, error: `The mail provider refused it (${resp.status}): ${text.slice(0, 500)}` };
      } else {
        let id: string | null = null;
        try {
          id = (JSON.parse(text) as { id?: string }).id ?? null;
        } catch {
          id = null;
        }
        sent = { ok: true, id, error: null };
      }
    }
  } catch (e) {
    sent = { ok: false, id: null, error: `The mail provider could not be reached: ${String((e as Error)?.message ?? e)}` };
  }
  if (!sent.ok) console.error(`[plans] email ${m.templateKey} failed: ${sent.error}`);

  // The record. Never thrown: the money write it follows has already happened.
  try {
    const { error: logErr } = await admin.from('message_log').insert({
      to_email: m.to,
      household_id: m.householdId ?? null,
      registration_id: m.registrationId ?? null,
      template_key: m.templateKey,
      subject: m.subject.slice(0, 300),
      status: sent.ok ? 'sent' : 'failed',
      error: sent.error ? sent.error.slice(0, 1000) : null,
      provider_message_id: sent.id,
      // What it said (0134): the body as plain text, tags stripped -- the
      // shell around it is the same for every email.
      body_text: `${m.title}\n\n${m.body}`
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 20000),
    });
    if (logErr) console.error(`[plans] message_log insert failed (${m.templateKey}): ${logErr.message}`);
  } catch (e) {
    console.error(`[plans] message_log insert error (${m.templateKey}): ${String((e as Error)?.message ?? e)}`);
  }
  return sent;
}

// Staff are told at the shared registration mailbox (override: STAFF_ALERT_TO).
export async function alertStaff(
  admin: SupabaseClient,
  m: {
    subject: string;
    body: string;
    templateKey: PlanTemplate;
    householdId?: string | null;
    registrationId?: string | null;
  }
): Promise<Sent> {
  const to = Deno.env.get('STAFF_ALERT_TO') ?? 'registration@luke14ministries.net';
  return await sendEmail(admin, {
    to,
    subject: `[Payment plans] ${m.subject}`,
    title: 'Payment plan alert',
    body: m.body,
    templateKey: m.templateKey,
    householdId: m.householdId,
    registrationId: m.registrationId,
  });
}

// Who a plan email is about: the household's name, email and phone, and the
// event. Staff alerts used to name the registration only by its UUID; now they
// carry the family's name, how to reach them and a link (22 Oct 2026). A
// failed lookup is printed and the email still goes with what is known -- an
// email never fails a money write.
export type PlanContext = {
  householdId: string | null;
  household: string;
  email: string | null;
  phone: string | null;
  eventName: string | null;
};

export async function planContext(admin: SupabaseClient, registrationId: string): Promise<PlanContext> {
  const fallback: PlanContext = { householdId: null, household: 'A family', email: null, phone: null, eventName: null };
  try {
    const { data, error } = await admin
      .from('registrations')
      .select('household_id, events ( name ), households ( display_name, email, phone )')
      .eq('id', registrationId)
      .maybeSingle();
    if (error) {
      console.error(`[plans] could not look up registration ${registrationId} for an email: ${error.message}`);
      return fallback;
    }
    if (!data) return fallback;
    const h = (data.households ?? null) as { display_name?: string; email?: string; phone?: string } | null;
    const ev = (data.events ?? null) as { name?: string } | null;
    return {
      householdId: (data.household_id as string) ?? null,
      household: h?.display_name?.trim() || 'A family',
      email: h?.email?.trim() || null,
      phone: h?.phone?.trim() || null,
      eventName: ev?.name ?? null,
    };
  } catch (e) {
    console.error(`[plans] registration lookup error for ${registrationId}: ${String((e as Error)?.message ?? e)}`);
    return fallback;
  }
}

// The block every staff alert ends with: the money, how to reach the family,
// and the way to the registration. Remaining balance is registration_balances
// (via settledBalance), the figure the staff registration page shows.
async function staffFacts(
  admin: SupabaseClient,
  registrationId: string,
  ctx: PlanContext,
  owedNowCents: number | null
): Promise<string> {
  let remaining = 'unknown (the balance could not be read; see the function log)';
  try {
    const { owed, inFlight } = await settledBalance(admin, registrationId);
    remaining = `${dollars(owed)}${inFlight > 0 ? ` (counting ${dollars(inFlight)} still clearing the bank as paid)` : ''}`;
  } catch (e) {
    console.error(`[plans] balance for alert on ${registrationId}: ${String((e as Error)?.message ?? e)}`);
  }
  const row = (k: string, v: string) =>
    `<tr><td style="padding:3px 12px 3px 0;color:#555;vertical-align:top">${k}</td><td style="padding:3px 0">${v}</td></tr>`;
  const tel = ctx.phone ? ctx.phone.replace(/[^0-9+]/g, '') : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0;font-size:14px">
  ${owedNowCents != null ? row('Owed this time', `<strong>${dollars(owedNowCents)}</strong>`) : ''}
  ${row('Remaining balance', remaining)}
  ${row('Family email', ctx.email ? `<a href="mailto:${esc(ctx.email)}" style="color:#14606a">${esc(ctx.email)}</a>` : 'none on file')}
  ${row('Family phone', ctx.phone ? `<a href="tel:${esc(tel)}" style="color:#14606a">${esc(ctx.phone)}</a>` : 'none on file')}
</table>
${button(`${SITE}/admin/registrations/${registrationId}/`, 'Open the registration')}`;
}

// ---------------------------------------------------------------------------
// The returned-bank-payment fee (0123; Lawrence, 22 Oct 2026)
//
// When a bank debit fails Stripe charges the ministry a fee, and the ministry
// passes on the fee the family was SHOWN before they chose a bank payment --
// a snapshot, never the event's current setting: a plan carries it on
// payment_plans.returned_payment_fee_cents, a checkout in its metadata
// (returned_fee_cents). record_returned_payment_fee() (service role only)
// does the deciding: a debit the bank actually RETURNED (bankDebitReturned),
// a FAILED BANK payment on file for this PaymentIntent, a snapshot over $0,
// one fee per PaymentIntent (each plan try and each checkout is its own
// PaymentIntent, so a Stripe retry, or the charger and the webhook both
// seeing one failure, add it once) and at most one per plan installment.
// Card declines cost the ministry nothing and never add a fee.
//
// The fee is owed in registration_balances. A plan's stored schedule is not
// rewritten; because every charge is worked out on the day from the live
// balance, the remaining charges collect it and the plan still ends on $0
// (settledBalance includes it, so a plan never closes with a fee unpaid).
// A failed read or write THROWS: the webhook answers 500 and Stripe retries,
// which is safe because the whole path is idempotent.
// ---------------------------------------------------------------------------

export type ReturnedFee = { feeCents: number; added: boolean };

// Did the bank actually RETURN this debit? Only then does Stripe charge the
// ministry a return fee (review, 22 Oct 2026). After a return such as R02
// (account closed) Stripe blocks the account, and the next tries fail the
// moment they are made -- each a new PaymentIntent, never submitted to the
// bank, so no charge with a failure code. Counting those would make one
// returned debit three fees. A failed read throws (the webhook answers 500 and
// Stripe retries).
export async function bankDebitReturned(stripe: Stripe, piId: string): Promise<boolean> {
  const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
  const charge = (typeof pi.latest_charge === 'object' ? pi.latest_charge : null) as Stripe.Charge | null;
  return Boolean(charge && charge.status === 'failed' && charge.failure_code);
}

export async function recordReturnedFee(
  admin: SupabaseClient,
  args: {
    registrationId: string;
    piId: string;
    installmentId?: string | null;
    disclosedCents?: number;
    // From bankDebitReturned(): the database refuses the fee without it.
    returned: boolean;
  }
): Promise<ReturnedFee> {
  const { data, error } = await admin.rpc('record_returned_payment_fee', {
    p_registration_id: args.registrationId,
    p_payment_intent_id: args.piId,
    p_installment_id: args.installmentId ?? null,
    p_disclosed_cents: Math.max(0, Math.round(args.disclosedCents ?? 0)),
    p_returned: args.returned === true,
  });
  if (error) throw new Error(`returned-fee: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { fee_cents?: number; added?: boolean } | null;
  return { feeCents: row?.fee_cents ?? 0, added: row?.added === true };
}

// The fee on file for one PaymentIntent, read only (for a staff alert that
// another writer's fee may or may not have reached yet).
export async function returnedFeeOnFile(admin: SupabaseClient, piId: string | null | undefined): Promise<number> {
  if (!piId) return 0;
  const { data, error } = await admin
    .from('registration_fees')
    .select('amount_cents')
    .eq('stripe_payment_intent_id', piId)
    .is('waived_at', null)
    .maybeSingle();
  if (error) throw new Error(`returned-fee-read: ${error.message}`);
  return (data?.amount_cents as number | undefined) ?? 0;
}

// The family's paragraph (Lawrence's wording, 22 Oct 2026). On a plan that
// will keep charging, it says plainly where the fee is collected.
export function returnedFeeParagraph(feeCents: number, onPlan: boolean): string {
  if (!(feeCents > 0)) return '';
  return `<p>Because the bank returned this payment, a ${dollars(feeCents)} returned-payment fee has been added to your balance.${
    onPlan ? ' Your remaining scheduled payments will include it.' : ''
  } If this was a mistake on our side or you&rsquo;d like to talk about it, reply to this email.</p>`;
}

// The line for a staff alert.
export function returnedFeeStaffLine(feeCents: number): string {
  if (!(feeCents > 0)) return '';
  return `<p>Because the bank returned the payment, a <strong>${dollars(feeCents)}</strong> returned-payment fee was added to the family&rsquo;s balance (the amount they were shown when they agreed). It can be waived on the registration page.</p>`;
}

// ---------------------------------------------------------------------------
// Activating a plan from its deposit (webhook, kind = plan_deposit)
// ---------------------------------------------------------------------------

export async function activatePlanFromDeposit(
  admin: SupabaseClient,
  stripe: Stripe,
  s: Stripe.Checkout.Session,
  depositStatus: 'processing' | 'succeeded' | 'failed'
) {
  const md = s.metadata ?? {};
  const registrationId = md.registration_id;
  const piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
  const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null;

  const { data: existing } = await admin
    .from('payment_plans')
    .select('id, status, activated_at, deposit_payment_intent_id')
    .eq('registration_id', registrationId)
    .maybeSingle();

  if (depositStatus === 'failed') {
    // A bank-transfer deposit that bounced (it arrived as 'processing', so the
    // plan was activated). The plan never really started: undo it completely
    // -- back to 'pending' with no activation, no schedule -- so it neither
    // keeps the early discount nor counts as "finished", and the family can
    // start again from "choose how to pay". Found in review, 30 Sep.
    // Only the deposit that activated THIS plan can undo it; a bounce from a
    // second checkout the family opened in another tab cannot.
    if (existing && existing.activated_at && existing.deposit_payment_intent_id === piId) {
      await admin
        .from('payment_plans')
        .update({ status: 'pending', activated_at: null })
        .eq('id', existing.id);
      await admin
        .from('payment_installments')
        .update({ status: 'cancelled' })
        .eq('payment_plan_id', existing.id)
        .in('status', ['scheduled', 'failed']);
      await admin.rpc('recalc_early_registration_discount', { p_registration_id: registrationId });
      const ctx = await planContext(admin, registrationId);
      const ev = md.event_name || ctx.eventName || 'Camp registration';
      // The deposit's fee (0123) is recorded by stripe-webhook, which records
      // the deposit payment itself; here it is only read, so the two
      // webhooks can never both add it. It may not have landed yet, and a
      // failed read only leaves the line out of an email.
      let depositFee = 0;
      try {
        depositFee = await returnedFeeOnFile(admin, piId);
      } catch (e) {
        console.error(`[plans] ${String((e as Error)?.message ?? e)}`);
      }
      await alertStaff(admin, {
        subject: `Plan deposit failed — ${ctx.household} — ${ev}`,
        body: `<p>The payment-plan deposit for <strong>${esc(ctx.household)}</strong> (${esc(ev)}) did not clear, so the plan was undone. The registration shows as not finished until the family chooses again.</p>
         ${returnedFeeStaffLine(depositFee)}
         ${await staffFacts(admin, registrationId, ctx, null)}`,
        templateKey: 'plan_deposit_failed_staff',
        householdId: ctx.householdId,
        registrationId,
      });
    }
    return;
  }

  // Already active (Stripe sends completed, then async_payment_succeeded for
  // a bank transfer), or this very deposit already handled: nothing to do.
  // The schedule is built once. A CANCELLED plan is different: a deposit from
  // a new checkout starts it again (27 Oct 2026, Testing Script 17.11 -- the
  // restart after a family cancelled was ignored, and the deposit sat on the
  // balance with no plan). A repeat delivery of the old deposit never revives it.
  if (
    existing?.activated_at &&
    (existing.status !== 'cancelled' || existing.deposit_payment_intent_id === piId)
  ) {
    return;
  }

  let pmId: string | null = null;
  let pm: Stripe.PaymentMethod | null = null;
  if (piId) {
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['payment_method'] });
    pm = (typeof pi.payment_method === 'object' ? pi.payment_method : null) as Stripe.PaymentMethod | null;
    pmId = pm?.id ?? (typeof pi.payment_method === 'string' ? pi.payment_method : null);
  }

  const row = {
    registration_id: registrationId,
    schedule: md.plan_schedule === 'semi_monthly' ? 'semi_monthly' : 'monthly',
    status: 'active',
    stripe_customer_id: customerId,
    stripe_payment_method_id: pmId,
    payment_method_kind: pm?.type === 'us_bank_account' ? 'us_bank_account' : 'card',
    payment_method_label: methodLabel(pm),
    consent_text: md.consent_text ?? null,
    consented_by: md.consented_by || null,
    consented_at: md.consented_at || new Date().toISOString(),
    activated_at: new Date().toISOString(),
    deposit_payment_intent_id: piId ?? null,
    // 0123: the returned-payment fee the family was shown when they agreed
    // (Ways to pay put it in the consent text and the metadata). A failed
    // bank charge on this plan adds exactly this; 0 or absent = never.
    returned_payment_fee_cents: Math.max(0, parseInt(md.returned_fee_cents ?? '0', 10) || 0),
    note:`Started online (${md.consent_version ?? 'consent'}).`,
    // A restarted plan clears the old cancellation. keeps_early_discount is
    // left out on purpose (Lawrence, 27 Oct 2026): a staff decision to remove
    // the discount carries over to the restarted plan until staff change it;
    // a brand-new plan gets the column's default, true.
    cancelled_at: null,
    cancelled_by: null,
  };
  const { data: plan, error } = await admin
    .from('payment_plans')
    .upsert(row, { onConflict: 'registration_id' })
    .select('id')
    .single();
  if (error) throw new Error(`plan-upsert: ${error.message}`);

  const { error: bErr } = await admin.rpc('build_plan_installments', {
    p_plan_id: plan.id,
    p_today: ministryToday(),
  });
  if (bErr) throw new Error(`build-installments: ${bErr.message}`);
  console.log(`[plans] plan ${plan.id} active for registration ${registrationId}`);
}

// ---------------------------------------------------------------------------
// A new card / bank account (webhook, setup-mode checkout, kind = plan_method_update)
// ---------------------------------------------------------------------------

export async function applyNewPaymentMethod(
  admin: SupabaseClient,
  stripe: Stripe,
  s: Stripe.Checkout.Session
) {
  const md = s.metadata ?? {};
  const siId = typeof s.setup_intent === 'string' ? s.setup_intent : s.setup_intent?.id;
  if (!siId || !md.plan_id) return;
  const si = await stripe.setupIntents.retrieve(siId, { expand: ['payment_method'] });
  const pm = (typeof si.payment_method === 'object' ? si.payment_method : null) as Stripe.PaymentMethod | null;
  if (!pm) return;

  const { data: plan } = await admin
    .from('payment_plans')
    .select('id, status')
    .eq('id', md.plan_id)
    .maybeSingle();
  if (!plan) return;

  const update: Record<string, unknown> = {
    stripe_payment_method_id: pm.id,
    payment_method_kind: pm.type === 'us_bank_account' ? 'us_bank_account' : 'card',
    payment_method_label: methodLabel(pm),
  };
  // A plan that stopped on failures starts again with the new method: its
  // failed charges get a fresh set of tries, starting tomorrow morning.
  if (plan.status === 'failed') update.status = 'active';
  await admin.from('payment_plans').update(update).eq('id', plan.id);
  if (plan.status === 'failed') {
    await admin
      .from('payment_installments')
      .update({ attempts: 0, next_attempt_on: ministryToday() })
      .eq('payment_plan_id', plan.id)
      .eq('status', 'failed');
  }
  console.log(`[plans] plan ${plan.id} payment method updated`);
}

// What is owed once money still clearing the bank is set aside. The balance
// view counts 'processing' payments as paid (right for what the family sees),
// but a plan must not be closed on money that might still bounce. The balance
// includes any unwaived returned-payment fee (0123), so a plan never closes
// with a fee unpaid.
export async function settledBalance(admin: SupabaseClient, registrationId: string) {
  const [{ data: bal, error: balErr }, { data: clearing, error: clearErr }] = await Promise.all([
    admin.from('registration_balances').select('balance_cents').eq('registration_id', registrationId).maybeSingle(),
    admin.from('payments').select('amount_cents').eq('registration_id', registrationId).eq('status', 'processing'),
  ]);
  // A failed read must never look like $0 owed: that would close a plan
  // (CLAUDE.md: never turn a query error into an empty answer).
  if (balErr) throw new Error(`balance: ${balErr.message}`);
  if (clearErr) throw new Error(`clearing-payments: ${clearErr.message}`);
  const inFlight = (clearing ?? []).reduce((t: number, p: { amount_cents: number }) => t + (p.amount_cents ?? 0), 0);
  return { owed: bal?.balance_cents ?? 0, settled: (bal?.balance_cents ?? 0) + inFlight, inFlight };
}

// ---------------------------------------------------------------------------
// The outcome of one automatic charge (charger AND webhook)
// ---------------------------------------------------------------------------

export type Outcome = 'processing' | 'succeeded' | 'failed';

export async function recordInstallmentOutcome(
  admin: SupabaseClient,
  args: {
    installmentId: string;
    registrationId: string;
    piId: string;
    amountCents: number;
    method: 'card' | 'bank_transfer';
    outcome: Outcome;
    error?: string | null;
    payerEmail?: string | null;
    eventName?: string | null;
    // The charger passes its own "today" so a run and its retry dates agree.
    today?: string;
    // Which try this PaymentIntent was (its metadata.attempt). An installment
    // with no PaymentIntent tied yet is only claimed by the CURRENT try, never
    // by a late Stripe retry of an earlier one.
    attempt?: number;
    // 0123: the bank RETURNED this debit (bankDebitReturned(), the webhook's
    // check). The charger passes false: a bank debit cannot come back at the
    // moment it is made, and one refused then never reached the bank. The
    // return arrives later as payment_intent.payment_failed.
    returned?: boolean;
  }
) {
  const today = args.today ?? ministryToday();

  // The payment row, keyed on the PaymentIntent (unique, 0005), so Stripe's
  // retries and the charger's own write land on the same row.
  const { error: payErr } = await admin.from('payments').upsert(
    {
      registration_id: args.registrationId,
      installment_id: args.installmentId,
      amount_cents: args.amountCents,
      method: args.method,
      status: args.outcome,
      received_on: args.outcome === 'succeeded' ? today : null,
      stripe_payment_intent_id: args.piId,
      payer_email: args.payerEmail ?? null,
      note: 'Payment plan — automatic payment.',
    },
    { onConflict: 'stripe_payment_intent_id' }
  );
  if (payErr) throw new Error(`payment-upsert: ${payErr.message}`);

  // A returned BANK debit: the plan's agreed returned-payment fee (0123), once
  // for this PaymentIntent and once for this installment. Before the transition below, so a failure here
  // throws (and Stripe retries) before anything is half-done. Whichever of
  // charger and webhook records it, the one that moves the installment sends
  // the email, and the fee is on file by then.
  const fee: ReturnedFee =
    args.outcome === 'failed' && args.method === 'bank_transfer'
      ? await recordReturnedFee(admin, {
          registrationId: args.registrationId,
          piId: args.piId,
          installmentId: args.installmentId,
          returned: args.returned === true,
        })
      : { feeCents: 0, added: false };

  const { data: inst } = await admin
    .from('payment_installments')
    .select('id, status, attempts, payment_plan_id, due_on')
    .eq('id', args.installmentId)
    .maybeSingle();
  if (!inst) return;

  const newStatus = args.outcome === 'succeeded' ? 'paid' : args.outcome === 'processing' ? 'processing' : 'failed';

  // Conditional transition: only if this installment is tied to THIS
  // PaymentIntent -- or to none yet, which is the charger's state between
  // "about to charge" and "charged" (so if the charger dies in that gap, the
  // webhook still claims the installment and tomorrow's run cannot charge it
  // again) -- and not already in the new state. `moved` is false for the
  // second of two writers, charger and webhook, which then sends nothing.
  //
  // Two plain updates rather than one .or() filter: PostgREST rejects an
  // or= filter on an UPDATE (42703, found in testing 30 Sep).
  const retryOn = addDays(today, RETRY_DAYS);
  const change = {
    status: newStatus,
    stripe_payment_intent_id: args.piId,
    amount_cents: args.amountCents,
    last_error: args.outcome === 'failed' ? args.error ?? 'Payment failed' : null,
    next_attempt_on: args.outcome === 'failed' ? retryOn : null,
  };
  let transitioned = false;
  for (const tie of ['this', 'none'] as const) {
    if (tie === 'none' && (args.attempt == null || args.attempt !== inst.attempts)) continue;
    let q = admin.from('payment_installments').update(change).eq('id', inst.id).neq('status', newStatus);
    q = tie === 'this' ? q.eq('stripe_payment_intent_id', args.piId) : q.is('stripe_payment_intent_id', null);
    const { data: moved, error: moveErr } = await q.select('id');
    if (moveErr) throw new Error(`installment-update: ${moveErr.message}`);
    if ((moved ?? []).length > 0) {
      transitioned = true;
      break;
    }
  }

  await admin.rpc('recalc_early_registration_discount', { p_registration_id: args.registrationId });
  if (!transitioned) return;

  const { data: plan, error: planErr } = await admin
    .from('payment_plans')
    .select('id, status, payment_method_label')
    .eq('id', inst.payment_plan_id)
    .maybeSingle();
  if (planErr) throw new Error(`plan-read: ${planErr.message}`);

  // Who this is about, for the emails (22 Oct 2026): the household's name,
  // contact and event. The family's address is the one Stripe has for the
  // payer, else the household's own.
  const ctx = await planContext(admin, args.registrationId);
  const eventName = args.eventName ?? ctx.eventName ?? 'Camp registration';
  const familyTo = args.payerEmail ?? ctx.email ?? null;
  const hello = ctx.household !== 'A family' ? `<p>Hello ${esc(ctx.household)},</p>` : '';
  const family = { householdId: ctx.householdId, registrationId: args.registrationId };

  if (args.outcome === 'succeeded') {
    await sendEmail(admin, {
      to: familyTo,
      subject: `Receipt: ${dollars(args.amountCents)} received — ${eventName}`,
      title: 'Payment received — thank you!',
      body: `${hello}
       <p>Your scheduled payment of <strong>${dollars(args.amountCents)}</strong> for ${esc(eventName)} was received on ${today}${plan?.payment_method_label ? ` (${esc(plan.payment_method_label)})` : ''}.</p>
       <p>Your remaining schedule is on your <a href="${SITE}/account/dashboard/" style="color:#14606a">family dashboard</a>.</p>`,
      templateKey: 'plan_receipt',
      ...family,
    });
    // Done? Cancel what is left and close the plan -- but only on SETTLED
    // money, never on a bank transfer that is still clearing.
    const { settled } = await settledBalance(admin, args.registrationId);
    if (settled <= 0 && plan) {
      await admin
        .from('payment_installments')
        .update({ status: 'cancelled' })
        .eq('payment_plan_id', plan.id)
        .in('status', ['scheduled', 'failed']);
      await admin.from('payment_plans').update({ status: 'completed' }).eq('id', plan.id);
    }
    return;
  }

  if (args.outcome === 'failed') {
    // A clearing bank payment that bounced after the plan was closed on it
    // (or after staff completed it): reopen, so it is retried, and say so.
    if (plan && plan.status === 'completed') {
      await admin.from('payment_plans').update({ status: 'active' }).eq('id', plan.id);
      plan.status = 'active';
      await alertStaff(admin, {
        subject: `Completed plan reopened — ${ctx.household} — ${eventName}`,
        body: `<p>A payment of ${dollars(args.amountCents)} from <strong>${esc(ctx.household)}</strong> (${esc(eventName)}) failed after the plan had closed, so the plan was reopened and will retry.${args.error ? ` The error: ${esc(declineReason(args.error))}.` : ''}</p>
         ${returnedFeeStaffLine(fee.feeCents)}
         ${await staffFacts(admin, args.registrationId, ctx, args.amountCents)}`,
        templateKey: 'plan_reopened_staff',
        ...family,
      });
    }
    const outOfTries = (inst.attempts ?? 0) >= MAX_ATTEMPTS;
    if (outOfTries && plan && plan.status === 'active') {
      await admin.from('payment_plans').update({ status: 'failed' }).eq('id', plan.id);
      // Lawrence, 22 Oct 2026: the family's name in the subject, what was
      // owed and what is left, how to reach them, and a link -- the alert
      // named the registration only by its UUID before.
      await alertStaff(admin, {
        subject: `Plan stopped — ${ctx.household} — ${eventName}`,
        body: `<p>The payment plan for <strong>${esc(ctx.household)}</strong> (${esc(eventName)}) could not collect ${dollars(args.amountCents)} after ${MAX_ATTEMPTS} tries. Last error: ${esc(declineReason(args.error) || 'unknown')}.</p>
         ${returnedFeeStaffLine(fee.feeCents)}
         ${await staffFacts(admin, args.registrationId, ctx, args.amountCents)}
         <p>The plan is stopped. On the registration page you can retry, pause or cancel it, and decide whether the family keeps the early-registration discount.</p>`,
        templateKey: 'plan_stopped_staff',
        ...family,
      });
    }
    await sendEmail(admin, {
      to: familyTo,
      subject: `Payment problem — ${eventName}`,
      title: 'We could not take your scheduled payment',
      body: `${hello}
       <p>Your scheduled payment of <strong>${dollars(args.amountCents)}</strong> for ${esc(eventName)} did not go through${args.error ? ` (${esc(declineReason(args.error))})` : ''}.</p>
       ${returnedFeeParagraph(fee.feeCents, !outOfTries)}
       ${outOfTries
         ? `<p>We have tried ${MAX_ATTEMPTS} times, so your payment plan is paused and camp staff will be in touch.</p>`
         : `<p>We will try again on ${retryOn}. To use a different card or bank account, open your <a href="${SITE}/account/dashboard/" style="color:#14606a">family dashboard</a> and choose &ldquo;Change card or bank account&rdquo;.</p>`}`,
      // The out-of-tries notice is its own record: "we told them the plan
      // stopped" is a different claim from "we told them a payment failed".
      templateKey: outOfTries ? 'plan_stopped_family' : 'plan_payment_problem',
      ...family,
    });
  }
}
