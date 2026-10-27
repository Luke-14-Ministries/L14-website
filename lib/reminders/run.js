// The automatic emails, end to end (27 Oct 2026; draft and schedule in
// 01 Plans and Decisions\Luke14-Automatic-Emails-Draft.pdf).
//
//   loadReminderData()  reads every current registration once, with the
//                       service-role client (lib/supabase/admin.js): there is
//                       no signed-in person behind a daily job.
//   remindersForDay()   decides what is due on one day -- the rules are the
//                       dashboard's own (lib/familyNeeds.js, lib/payments.js,
//                       lib/plans.js) and the dates are lib/reminders/schedule.js.
//   withoutSent()       drops anything reminder_sends (0138) says was said.
//   runReminders()      the daily job: one email per family, logged to
//                       message_log (what it said, 0134) and reminder_sends.
//
// TEST MODE until go-live (REMINDERS_MODE unset or 'test'): only
// @luke14ministries.net addresses are emailed; every other family's email is
// recorded as 'skipped' and never sent, so the test families' made-up
// addresses get nothing. REMINDERS_MODE=live sends to everyone; =off stops
// the job. See DO-THIS-NEXT W51.

import 'server-only';
import { sendEmail } from '@/lib/email';
import { getStripe } from '@/lib/stripe/server';
import { dayInMorristown } from '@/lib/events';
import { registrationDepositCents, registrationHeads, fullScholarshipRequested } from '@/lib/payments';
import { planHasProblem, planStoppedAt } from '@/lib/plans';
import { depositDueNow, supportState, volunteerApplicationNeeded } from '@/lib/familyNeeds';
import { rejectedOutsideView } from '@/lib/rejectedUploads';
import {
  addDays,
  moneyReminderDay,
  pastDueDay,
  detailsReminderDay,
  notSubmittedStep,
  isMonday,
} from './schedule';
import { composeFamilyEmail, composeStaffSummary } from './templates';

const TEST_DOMAIN = '@luke14ministries.net';
// Kinds a staff "Pause reminders" stops. Confirmations and payment-plan
// notices still go: they tell a family something happened.
const PAUSABLE = new Set(['deposit', 'balance', 'past_due', 'missing_details', 'not_submitted']);

export function reminderMode() {
  const m = String(process.env.REMINDERS_MODE ?? 'test').trim().toLowerCase();
  return m === 'live' || m === 'off' ? m : 'test';
}

function fail(what, error) {
  // CLAUDE.md: never turn a failed read into an empty list -- here it would
  // read as "nobody owes anything" and send nothing, silently.
  throw new Error(`Reminders — ${what}: ${error.message}`);
}

// PostgREST takes ids in the URL, so long lists go in slices.
async function inSlices(ids, read) {
  const out = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await read(ids.slice(i, i + 150));
    if (error) return { data: null, error };
    out.push(...(data ?? []));
  }
  return { data: out, error: null };
}

const firstName = (p) => p?.people?.first_name || 'someone';
const andList = (xs) => (xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
export async function loadReminderData(admin, today) {
  const { data: regs, error: regError } = await admin
    .from('registrations')
    .select(
      `id, household_id, created_at, deposit_waived_at, awaiting_family_since, awaiting_family_reason,
       households ( id, display_name, email ),
       events!inner ( id, name, starts_on, ends_on, deposit_cents, balance_due_on, archived_at ),
       registration_participants ( id, person_id, status, status_before, status_changed_at, camp_role,
         people ( first_name, last_name ),
         participant_money ( fee_cents, discount_cents, early_discount_cents, family_discount_cents ) )`
    )
    .is('events.archived_at', null)
    .gte('events.ends_on', today);
  if (regError) fail('registrations', regError);

  const regIds = (regs ?? []).map((r) => r.id);
  const partIds = (regs ?? []).flatMap((r) => (r.registration_participants ?? []).map((p) => p.id));
  const personIds = [...new Set((regs ?? []).flatMap((r) => (r.registration_participants ?? []).map((p) => p.person_id)))];

  const [balances, clearing, scholarships, plans, support, photos, apps, waivers, pauses] = await Promise.all([
    inSlices(regIds, (ids) => admin.from('registration_balances').select('registration_id, balance_cents, paid_cents').in('registration_id', ids)),
    inSlices(regIds, (ids) =>
      admin.from('payments').select('registration_id, amount_cents').eq('status', 'processing').in('registration_id', ids)
    ),
    inSlices(partIds, (ids) =>
      admin
        .from('scholarships')
        .select('registration_participant_id, requested_cents, granted_cents, status')
        .in('registration_participant_id', ids)
    ),
    inSlices(regIds, (ids) =>
      admin
        .from('payment_plans')
        .select(
          `id, registration_id, status, updated_at, payment_method_kind, payment_method_label,
           stripe_payment_method_id, payment_method_changed_at,
           payment_installments ( id, due_on, amount_cents, status, attempts, last_error, last_attempt_at )`
        )
        .in('registration_id', ids)
    ),
    inSlices(personIds, (ids) => admin.from('person_support').select('*').in('person_id', ids)),
    inSlices(personIds, (ids) => admin.from('person_photos').select('person_id').in('person_id', ids)),
    inSlices(partIds, (ids) =>
      admin.from('volunteer_applications').select('registration_participant_id, status').in('registration_participant_id', ids)
    ),
    inSlices(regIds, (ids) =>
      admin
        .from('activity_waivers_outstanding')
        .select('registration_participant_id, registration_id, person_id, activity_id, activity_name, kind, upload_status, review_note')
        .in('registration_id', ids)
    ),
    inSlices(regIds, (ids) => admin.from('reminder_pauses').select('registration_id').in('registration_id', ids)),
  ]);
  for (const [what, res] of Object.entries({ balances, clearing, scholarships, plans, support, photos, apps, waivers, pauses })) {
    if (res.error) fail(what, res.error);
  }
  const rejected = regIds.length ? await rejectedOutsideView(admin, waivers.data, { registrationIds: regIds }) : [];

  const by = (rows, key) => {
    const m = new Map();
    for (const r of rows ?? []) {
      if (!m.has(r[key])) m.set(r[key], []);
      m.get(r[key]).push(r);
    }
    return m;
  };
  return {
    regs: regs ?? [],
    balance: new Map((balances.data ?? []).map((b) => [b.registration_id, b])),
    clearing: by(clearing.data, 'registration_id'),
    scholarships: scholarships.data ?? [],
    plan: new Map((plans.data ?? []).map((p) => [p.registration_id, p])),
    support: new Map((support.data ?? []).map((s) => [s.person_id, s])),
    photo: new Set((photos.data ?? []).map((p) => p.person_id)),
    app: new Map((apps.data ?? []).map((a) => [a.registration_participant_id, a.status])),
    waivers: by([...(waivers.data ?? []), ...rejected], 'registration_id'),
    paused: new Set((pauses.data ?? []).map((p) => p.registration_id)),
  };
}

// The card behind each active card plan: { planId: { label, expEnd } }, read
// from Stripe (we never store a card's expiry). Only for the real run.
export async function loadCardExpiries(data) {
  const stripe = getStripe();
  const out = new Map();
  if (!stripe) return out;
  for (const plan of data.plan.values()) {
    if (plan.status !== 'active' || plan.payment_method_kind !== 'card' || !plan.stripe_payment_method_id) continue;
    try {
      const pm = await stripe.paymentMethods.retrieve(plan.stripe_payment_method_id);
      const m = pm?.card?.exp_month;
      const y = pm?.card?.exp_year;
      if (!m || !y) continue;
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of the month
      const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
      out.set(plan.id, { pmId: pm.id, expEnd: last, expiryMonth: month });
    } catch (e) {
      console.error('reminders: card lookup failed for plan', plan.id, e?.message);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Decide
// ---------------------------------------------------------------------------
// Every item: { kind, keys: [item_key...], registrationId, householdId,
// household, eventName, ...the template's facts }.
export function remindersForDay(data, day, { origin, cards = new Map() } = {}) {
  const items = [];
  for (const r of data.regs) {
    const ev = r.events ?? {};
    const parts = r.registration_participants ?? [];
    const live = parts.filter((p) => p.status !== 'cancelled');
    if (live.length === 0) continue;
    const base = {
      registrationId: r.id,
      householdId: r.household_id,
      household: r.households ?? null,
      eventName: ev.name ?? 'your registration',
    };
    const paused = data.paused.has(r.id);
    const push = (item) => {
      if (paused && PAUSABLE.has(item.kind)) return;
      items.push({ ...base, ...item });
    };

    // §5.3 -- started but not submitted: everyone still a draft.
    if (live.every((p) => p.status === 'draft')) {
      const step = notSubmittedStep(day, dayInMorristown(r.created_at));
      if (step > 0) push({ kind: 'not_submitted', keys: [`${r.id}:${step}`] });
      continue;
    }

    // §3 -- money. Families on a plan get the plan's notices instead.
    const bal = data.balance.get(r.id) ?? null;
    const balanceCents = bal?.balance_cents ?? 0;
    const clearingCents = (data.clearing.get(r.id) ?? []).reduce((s, p) => s + (p.amount_cents ?? 0), 0);
    const liveIds = new Set(live.map((p) => p.id));
    const fullScholarship = fullScholarshipRequested(
      live,
      data.scholarships.filter((s) => liveIds.has(s.registration_participant_id))
    );
    const depositCents = registrationDepositCents({ perPersonCents: ev.deposit_cents, participants: parts, balanceCents });
    const depositDue = depositDueNow({ registration: r, balance: bal, clearingCents, depositCents, fullScholarship });
    const plan = data.plan.get(r.id) ?? null;
    const onPlan = plan && ['active', 'paused', 'failed'].includes(plan.status);
    const dueOn = ev.balance_due_on ?? null;
    if (depositDue) {
      if (moneyReminderDay(day, dueOn)) {
        push({
          kind: 'deposit',
          keys: [`${r.id}:${day}`],
          depositCents,
          perPersonCents: ev.deposit_cents ?? 0,
          heads: registrationHeads(parts),
        });
      }
    } else if (balanceCents > 0 && !onPlan && !fullScholarship) {
      if (pastDueDay(day, dueOn)) push({ kind: 'past_due', keys: [`${r.id}:${day}`], balanceCents, dueOn });
      else if (moneyReminderDay(day, dueOn)) push({ kind: 'balance', keys: [`${r.id}:${day}`], balanceCents, dueOn });
    }

    // §2 -- payment plans.
    if (plan) {
      const scheduled = (plan.payment_installments ?? []).filter((i) => i.status === 'scheduled');
      if (plan.status === 'active') {
        const left = scheduled.length;
        for (const inst of scheduled.filter((i) => i.due_on === addDays(day, 7))) {
          push({
            kind: 'plan_upcoming',
            keys: [`${inst.id}:${inst.due_on}`],
            dueOn: inst.due_on,
            amountCents: left > 0 ? Math.ceil(Math.max(0, balanceCents) / left) : inst.amount_cents,
            methodLabel: plan.payment_method_label ?? null,
          });
        }
        const card = cards.get(plan.id);
        const finalOn = scheduled.map((i) => i.due_on).sort().pop();
        if (card && finalOn && card.expEnd < finalOn && day >= addDays(card.expEnd, -30) && day <= card.expEnd) {
          push({
            kind: 'card_expiring',
            keys: [`${plan.id}:${card.pmId}`],
            cardLabel: plan.payment_method_label ?? 'your card',
            expiryMonth: card.expiryMonth,
            finalOn,
          });
        }
      }
      if (plan.status === 'completed' && dayInMorristown(plan.updated_at) >= addDays(day, -14)) {
        push({ kind: 'plan_finished', keys: [plan.id] });
      }
    }

    // §5.1 / §5.2 -- confirmed by staff in the last three days (a missed
    // run catches up; an old confirmation is never announced late).
    const recent = live.filter(
      (p) => p.status === 'confirmed' && p.status_changed_at && dayInMorristown(p.status_changed_at) >= addDays(day, -3)
    );
    for (const [kind, ps] of [
      ['off_waitlist', recent.filter((p) => p.status_before === 'waitlisted')],
      ['confirmed', recent.filter((p) => p.status_before !== 'waitlisted')],
    ]) {
      if (ps.length) {
        push({
          kind,
          keys: ps.map((p) => `${p.id}:${p.status_changed_at}`),
          names: ps.map(firstName),
          balanceCents,
          dueOn,
        });
      }
    }

    // §4 -- missing details, one line each.
    if (detailsReminderDay(day, ev.starts_on)) {
      const lines = [];
      const seen = new Set();
      for (const p of live) {
        if (seen.has(p.person_id)) continue;
        seen.add(p.person_id);
        const isCamper = live.some((q) => q.person_id === p.person_id && q.camp_role === 'camper');
        const s = supportState({ row: data.support.get(p.person_id), hasPhoto: data.photo.has(p.person_id), isCamper });
        if (s.state !== 'complete') {
          lines.push({
            personId: p.person_id,
            text:
              s.state === 'empty'
                ? `Support details for ${firstName(p)} — allergies, medications, what helps on a hard day, and an emergency contact`
                : `${firstName(p)}'s support details — still needed: ${andList(s.missing)}`,
            href: `${origin}/account/details/${p.person_id}/`,
            action: 'Fill in',
          });
        }
      }
      for (const p of live.filter((q) => q.camp_role === 'volunteer')) {
        if (volunteerApplicationNeeded(data.app.get(p.id))) {
          lines.push({ text: `${firstName(p)}'s volunteer application — a few questions about where you'd like to serve`, href: `${origin}/register/volunteer`, action: 'Complete it' });
        }
      }
      for (const w of data.waivers.get(r.id) ?? []) {
        const who = live.find((p) => p.id === w.registration_participant_id);
        const name = who ? firstName(who) : 'someone';
        lines.push({
          text:
            w.kind === 'ours'
              ? `The ${w.activity_name} waiver for ${name}, signed on the Activities page`
              : w.upload_status === 'rejected'
                ? `${w.activity_name}: the outfitter's confirmation for ${name} could not be accepted (${w.review_note || 'no reason given'}) — please upload it again`
                : `${w.activity_name}: the outfitter's own form for ${name}, uploaded on the Activities page`,
          href: `${origin}/account/activities/?registration=${r.id}#reg-${r.id}`,
          action: w.kind === 'ours' ? 'Sign it' : 'Upload it',
        });
      }
      if (r.awaiting_family_since) {
        lines.push({
          text: `A question from camp staff${r.awaiting_family_reason ? `: "${r.awaiting_family_reason}"` : ''}`,
          href: `${origin}/account/dashboard/`,
          action: 'Reply',
        });
      }
      if (lines.length) push({ kind: 'missing_details', keys: [`${r.id}:${day}`], lines });
    }
  }
  return items;
}

// Drop what reminder_sends already has, key by key (a confirmation of two
// people where one was already announced keeps only the other).
export async function withoutSent(admin, items) {
  const allKeys = [...new Set(items.flatMap((i) => i.keys))];
  const sent = new Set();
  const { data, error } = await inSlices(allKeys, (ks) => admin.from('reminder_sends').select('kind, item_key').in('item_key', ks));
  if (error) fail('what was already sent', error);
  for (const s of data ?? []) sent.add(`${s.kind}|${s.item_key}`);
  const out = [];
  for (const i of items) {
    const keep = i.keys.map((k, n) => [k, n]).filter(([k]) => !sent.has(`${i.kind}|${k}`));
    if (keep.length === 0) continue;
    out.push(i.names ? { ...i, keys: keep.map(([k]) => k), names: keep.map(([, n]) => i.names[n]) } : i);
  }
  return out;
}

// One family, one email: group a day's items by household, and list a
// person's support details once even across two weeks of camp.
export function byFamily(items) {
  const families = new Map();
  for (const i of items) {
    if (!families.has(i.householdId)) families.set(i.householdId, { household: i.household, items: [] });
    families.get(i.householdId).items.push(i);
  }
  for (const f of families.values()) {
    const listed = new Set();
    f.items = f.items
      .map((i) => {
        if (i.kind !== 'missing_details') return i;
        const lines = i.lines.filter((l) => !l.personId || !listed.has(l.personId));
        lines.forEach((l) => l.personId && listed.add(l.personId));
        return { ...i, lines };
      })
      .filter((i) => i.kind !== 'missing_details' || i.lines.length > 0);
  }
  return [...families.values()].filter((f) => f.items.length > 0);
}

// ---------------------------------------------------------------------------
// The staff summary's numbers (§5.6) -- the same questions the staff nav
// badges ask.
// ---------------------------------------------------------------------------
async function staffCounts(admin, data, today) {
  const tenDaysAgo = new Date(Date.parse(`${today}T12:00:00Z`) - 10 * 86400000).toISOString();
  const count = async (q, what) => {
    const { count: n, error } = await q;
    if (error) fail(what, error);
    return n ?? 0;
  };
  const [waitingOnStaff, familyReplies, waiversToCheck, scholarships, staleRefunds] = await Promise.all([
    count(
      admin
        .from('registration_participants')
        .select('id, registrations!inner ( awaiting_family_since )', { count: 'exact', head: true })
        .eq('status', 'submitted')
        .is('registrations.awaiting_family_since', null),
      'people waiting on staff'
    ),
    count(admin.from('registrations').select('id', { count: 'exact', head: true }).eq('family_reply_unread', true), 'family replies'),
    count(admin.from('activity_waiver_uploads').select('id', { count: 'exact', head: true }).eq('review_status', 'pending'), 'waivers to check'),
    count(admin.from('scholarships').select('id', { count: 'exact', head: true }).eq('status', 'requested'), 'scholarship requests'),
    count(
      admin.from('payment_refunds').select('id', { count: 'exact', head: true }).eq('status', 'pending').lt('created_at', tenDaysAgo),
      'pending refunds'
    ),
  ]);
  const planProblems = [...data.plan.values()].filter((p) => planHasProblem(p) || planStoppedAt(p)).length;
  return { waitingOnStaff, familyReplies, planProblems, waiversToCheck, scholarships, staleRefunds };
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------
async function logEmail(admin, row) {
  const { data, error } = await admin.from('message_log').insert(row).select('id').single();
  if (error) {
    console.error('reminders: message_log insert failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

async function recordSent(admin, rows) {
  if (!rows.length) return;
  const { error } = await admin.from('reminder_sends').upsert(rows, { onConflict: 'kind,item_key', ignoreDuplicates: true });
  if (error) console.error('reminders: reminder_sends insert failed:', error.message);
}

// The daily run. `today` is the ministry's date (a test run may pass another
// in test mode). Returns what it did, for the cron log and a test run.
export async function runReminders(admin, { today, origin, dry = false, mode = reminderMode() }) {
  if (mode === 'off') return { ok: true, mode, today, note: 'REMINDERS_MODE=off — nothing sent.' };
  const data = await loadReminderData(admin, today);
  const cards = await loadCardExpiries(data);
  const items = await withoutSent(admin, remindersForDay(data, today, { origin, cards }));
  const families = byFamily(items);
  const report = { ok: true, mode, today, dry, families: [], staffSummary: null };

  for (const f of families) {
    const to = f.household?.email?.trim() || null;
    const kinds = f.items.map((i) => i.kind);
    const entry = { household: f.household?.display_name ?? '(no name)', to, kinds };
    report.families.push(entry);
    if (dry) continue;
    const allowed = Boolean(to) && (mode === 'live' || to.toLowerCase().endsWith(TEST_DOMAIN));
    const rows = (status, messageLogId) =>
      f.items.flatMap((i) =>
        i.keys.map((k) => ({
          kind: i.kind,
          item_key: k,
          household_id: i.householdId,
          registration_id: i.registrationId,
          sent_on: today,
          status,
          message_log_id: messageLogId,
        }))
      );
    if (!allowed) {
      // Test mode (or no address): recorded, never sent.
      entry.result = to ? 'skipped (test mode)' : 'skipped (no email address)';
      await recordSent(admin, rows('skipped', null));
      continue;
    }
    const mail = composeFamilyEmail({ origin, householdName: f.household?.display_name ?? '', items: f.items });
    const sent = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    const logId = await logEmail(admin, {
      to_email: to,
      household_id: f.items[0].householdId,
      registration_id: f.items[0].registrationId,
      template_key: f.items.length === 1 ? `reminder_${f.items[0].kind}` : 'reminder_digest',
      subject: mail.subject.slice(0, 300),
      status: sent.ok ? 'sent' : 'failed',
      error: sent.ok ? null : String(sent.error ?? '').slice(0, 1000),
      provider_message_id: sent.id ?? null,
      body_text: mail.text.slice(0, 20000),
    });
    entry.result = sent.ok ? 'sent' : `failed: ${sent.error}`;
    // A failed send is not recorded as said, so a one-time notice tries
    // again tomorrow; message_log keeps the failure.
    if (sent.ok) await recordSent(admin, rows('sent', logId));
  }

  // §5.6 -- Mondays, to the shared mailbox.
  if (isMonday(today)) {
    const staffKey = `staff:${today}`;
    const { data: already, error: alreadyError } = await admin
      .from('reminder_sends')
      .select('id')
      .eq('kind', 'staff_summary')
      .eq('item_key', staffKey)
      .maybeSingle();
    if (alreadyError) fail('the staff summary record', alreadyError);
    if (!already) {
      const counts = await staffCounts(admin, data, today);
      let upcoming = 0;
      for (let d = 1; d <= 7; d++) upcoming += byFamily(await withoutSent(admin, remindersForDay(data, addDays(today, d), { origin }))).length;
      report.staffSummary = { counts, upcoming };
      if (!dry) {
        const to = process.env.STAFF_SUMMARY_TO || 'registration@luke14ministries.net';
        const mail = composeStaffSummary({ origin, counts, upcoming });
        const sent = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
        const logId = await logEmail(admin, {
          to_email: to,
          template_key: 'reminder_staff_summary',
          subject: mail.subject,
          status: sent.ok ? 'sent' : 'failed',
          error: sent.ok ? null : String(sent.error ?? '').slice(0, 1000),
          provider_message_id: sent.id ?? null,
          body_text: mail.text,
        });
        if (sent.ok) await recordSent(admin, [{ kind: 'staff_summary', item_key: staffKey, sent_on: today, status: 'sent', message_log_id: logId }]);
        report.staffSummary.result = sent.ok ? 'sent' : `failed: ${sent.error}`;
      }
    }
  }
  return report;
}

// The next `days` days, for staff (Email Families): who would hear what, and
// when. No Stripe lookups (a card's expiry is checked on the day), nothing
// sent. Returns [{ day, household, kinds }].
export async function upcomingReminders(admin, { today, origin, days = 7 }) {
  const data = await loadReminderData(admin, today);
  const out = [];
  for (let d = 0; d < days; d++) {
    const day = addDays(today, d);
    for (const f of byFamily(await withoutSent(admin, remindersForDay(data, day, { origin })))) {
      out.push({
        day,
        household: f.household?.display_name ?? '(no name)',
        registrationId: f.items[0].registrationId,
        events: [...new Set(f.items.map((i) => i.eventName))],
        kinds: f.items.map((i) => i.kind),
      });
    }
  }
  return out;
}
