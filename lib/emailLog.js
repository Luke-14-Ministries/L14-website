// Reading message_log for staff (26 Oct 2026). Every email the site sends a
// family is recorded there (0001; staff sends through log_family_email(),
// 0120/0132; the plan edge functions as service role, 0121), but no staff page
// showed it, so once the "2 emails sent" card on Email Families was gone the
// record could only be read from the database. Two places read it now: each
// registration page (the household's emails, loadEmailLog) and Email Families
// (every family, searchEmailLog: filtered, then grouped by send and by event
// with groupEmailsBySend / groupSendsByEvent -- 27 Oct 2026). Staff read the
// table through message_log_staff (is_staff()).
//
// A plain module, no 'use client': the server pages call these functions
// (CLAUDE.md -- a server component never calls a helper from a client file).

import { sinceISO, todayInMorristown } from './events';

// What each template_key means, in staff words. Keys not listed print as
// they are -- message_log.template_key is free text.
export const EMAIL_KIND = {
  family_update: 'Email from staff',
  waiver_needed: 'Waiver reminder',
  plan_receipt: 'Payment plan receipt',
  refund_receipt: 'Refund sent',
  plan_payment_problem: 'Payment plan problem',
  plan_stopped: 'Payment plan stopped',
  plan_stopped_family: 'Payment plan stopped',
  // The automatic emails (0138, lib/reminders/): one key per kind when a
  // family's email that day had one thing in it, reminder_digest for several.
  reminder_digest: 'Automatic reminder',
  reminder_plan_upcoming: 'Payment plan: coming payment',
  reminder_plan_finished: 'Payment plan: paid in full',
  reminder_card_expiring: 'Payment plan: card expiring',
  reminder_deposit: 'Deposit reminder',
  reminder_balance: 'Balance reminder',
  reminder_past_due: 'Balance past due',
  reminder_missing_details: 'Missing details reminder',
  reminder_confirmed: 'Confirmed',
  reminder_off_waitlist: 'Off the waitlist',
  reminder_not_submitted: 'Registration not submitted',
  reminder_staff_summary: 'Staff weekly summary',
};

// The kind filter on Email Families: a URL value -> which template keys.
// "plan" is every payment-plan email (plan_*, 0121), the family's and the
// staff alerts alike.
export const KIND_FILTERS = {
  staff: { label: 'Email from staff', keys: ['family_update'] },
  waiver: { label: 'Waiver reminder', keys: ['waiver_needed'] },
  plan: { label: 'Payment-plan emails', prefix: 'plan_' },
  reminder: { label: 'Automatic reminders', prefix: 'reminder_' },
};

// How far back Email Families looks when no date is chosen, and the most
// rows one page reads. A staff send is one row per family, so 300 rows is
// several sends to a full camp week plus the plan emails.
export const DEFAULT_DAYS = 90;
export const MAX_ROWS = 300;
// More households than this matching a search by family name is a search too
// broad to be useful; the page says so rather than sending a huge id list.
export const MAX_FAMILY_MATCHES = 100;
// A staff send goes one family at a time with a short pause (600 ms, plus the
// mail service's own time -- email-families/actions.js), so its rows are
// seconds apart. Two rows with the same subject, sender, kind and event no
// more than this far apart are one send; the gap is between neighbours, so a
// long list that takes several minutes still reads as one send.
export const SEND_GAP_MS = 2 * 60 * 1000;

// Resend's own page for one message: delivered, bounced, opened.
export const resendUrl = (id) => `https://resend.com/emails/${encodeURIComponent(id)}`;

const fullName = (p) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || null;

const COLUMNS =
  'id, to_email, household_id, registration_id, template_key, subject, status, provider_message_id, error, sent_at, sent_by, body_text';

// Names for the rows: who pressed Send, and (unless the caller already knows
// the family) the household. Throws on a failed read.
async function decorate(supabase, rows, { knownHousehold = false } = {}) {
  const senderIds = [...new Set(rows.map((r) => r.sent_by).filter(Boolean))];
  const householdIds = [...new Set(rows.map((r) => r.household_id).filter(Boolean))];
  const [senders, households] = await Promise.all([
    senderIds.length
      ? supabase.from('profiles').select('id, first_name, last_name').in('id', senderIds)
      : Promise.resolve({ data: [], error: null }),
    householdIds.length && !knownHousehold
      ? supabase.from('households').select('id, display_name').in('id', householdIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (senders.error) throw new Error(`Emails sent — who sent them: ${senders.error.message}`);
  if (households.error) throw new Error(`Emails sent — households: ${households.error.message}`);
  const senderName = new Map((senders.data ?? []).map((p) => [p.id, fullName(p)]));
  const householdName = new Map((households.data ?? []).map((h) => [h.id, h.display_name]));

  return rows.map((r) => ({
    id: r.id,
    sentAt: r.sent_at,
    to: r.to_email,
    householdId: r.household_id,
    household: householdName.get(r.household_id) ?? null,
    registrationId: r.registration_id,
    // The registration's event, when the read embedded it (searchEmailLog).
    eventId: r.registrations?.event_id ?? null,
    templateKey: r.template_key,
    kind: EMAIL_KIND[r.template_key] ?? r.template_key,
    subject: r.subject,
    status: r.status,
    error: r.error,
    // Staff-pressed sends carry a name; the plan emails are the site's own.
    sentById: r.sent_by ?? null,
    by: r.sent_by ? senderName.get(r.sent_by) ?? 'staff' : 'the site',
    providerId: r.provider_message_id,
    // What it said (0134); null for emails sent before it was kept.
    body: r.body_text ?? null,
  }));
}

// The rows, newest first, with who pressed Send and the household's name.
// `householdId` narrows to one family; `limit` caps the list. Throws on a
// failed read (CLAUDE.md: never an empty list for an error).
export async function loadEmailLog(supabase, { householdId = null, limit = 50 } = {}) {
  let q = supabase.from('message_log').select(COLUMNS).order('sent_at', { ascending: false }).limit(limit);
  if (householdId) q = q.eq('household_id', householdId);
  const { data: rows, error } = await q;
  if (error) throw new Error(`Emails sent: ${error.message}`);
  return decorate(supabase, rows ?? [], { knownHousehold: Boolean(householdId) });
}

// ---------------------------------------------------------------------------
// Email Families' filters (27 Oct 2026, Lawrence: "should be collapsible and
// filterable; grouped by event, date, etc" -- and searchable).
// ---------------------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v) => (typeof v === 'string' ? v : '');

// The filters from the page's search params. Unknown or malformed values are
// dropped, so a hand-edited URL shows everything rather than an error.
// Param names start with sent_ because ?event= already belongs to the send
// form at the top of the page.
export function emailFiltersFrom(params) {
  const kind = str(params?.sent_kind);
  const from = str(params?.sent_from);
  const to = str(params?.sent_to);
  const eventId = str(params?.sent_event);
  return {
    // Checked, so a mangled id is "all events" rather than a uuid error.
    eventId: UUID_RE.test(eventId) ? eventId : '',
    kind: KIND_FILTERS[kind] ? kind : '',
    q: str(params?.q).trim().slice(0, 100),
    from: DAY_RE.test(from) ? from : '',
    to: DAY_RE.test(to) ? to : '',
  };
}

export const hasEmailFilters = (f) => Boolean(f.eventId || f.kind || f.q || f.from || f.to);

// Midnight in Morristown at the start of a calendar day, as a UTC instant.
// Morristown is four or five hours behind UTC; midnight is never inside a
// clock change (those happen at 2 AM), so one of the two is right.
function morristownMidnightISO(day) {
  const [y, m, d] = day.split('-').map(Number);
  const hourOf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
  for (const offset of [4, 5]) {
    const t = Date.UTC(y, m - 1, d, offset);
    if (Number(hourOf.format(t)) === 0 && todayInMorristown(t) === day) return new Date(t).toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d, 5)).toISOString();
}
const nextDay = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

// A search word as an ILIKE pattern: % and _ (and the escape character
// itself) match only themselves, and the whole is wrapped in % for
// "contains". Postgres's default LIKE escape is the backslash.
const likeContains = (s) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;
// A value inside PostgREST's or=(...) list, in double quotes so commas,
// dots and parentheses in it are not read as syntax; inside the quotes a
// backslash escapes the next character, so " and \ are escaped once more.
const orValue = (s) => `"${s.replace(/["\\]/g, '\\$&')}"`;

// Every family's emails for Email Families, filtered on the server, newest
// first: { emails, total, capped, windowDays, familyMatchesCapped }.
//   eventId -- the registration's event (embedded with !inner, so rows with
//              no registration drop out when an event is chosen);
//   kind    -- a KIND_FILTERS key;
//   q       -- free text, case-insensitive, in the subject, what it said
//              (body_text), the to-address, or the family's name (households
//              looked up first; their ids join the same OR);
//   from/to -- Morristown days, inclusive. With neither, the last
//              DEFAULT_DAYS days (`windowDays` says so).
// `total` is the full count of matching rows; at most MAX_ROWS are read.
// Throws on any failed read.
export async function searchEmailLog(supabase, filters) {
  const f = filters ?? {};
  const embed = f.eventId ? 'registrations!inner ( event_id )' : 'registrations ( event_id )';
  let q = supabase
    .from('message_log')
    .select(`${COLUMNS}, ${embed}`, { count: 'exact' })
    .order('sent_at', { ascending: false })
    .limit(MAX_ROWS);

  if (f.eventId) q = q.eq('registrations.event_id', f.eventId);

  const kind = KIND_FILTERS[f.kind];
  if (kind?.keys) q = q.in('template_key', kind.keys);
  if (kind?.prefix) q = q.like('template_key', `${kind.prefix.replace(/[\\%_]/g, '\\$&')}%`);

  const windowDays = !f.from && !f.to ? DEFAULT_DAYS : null;
  if (windowDays) q = q.gte('sent_at', sinceISO(windowDays));
  if (f.from) q = q.gte('sent_at', morristownMidnightISO(f.from));
  if (f.to) q = q.lt('sent_at', morristownMidnightISO(nextDay(f.to)));

  let familyMatchesCapped = false;
  if (f.q) {
    const pattern = likeContains(f.q);
    const { data: hh, error: hhError } = await supabase
      .from('households')
      .select('id')
      .ilike('display_name', pattern)
      .limit(MAX_FAMILY_MATCHES + 1);
    if (hhError) throw new Error(`Emails sent — family names: ${hhError.message}`);
    const ids = (hh ?? []).map((h) => h.id);
    familyMatchesCapped = ids.length > MAX_FAMILY_MATCHES;
    const value = orValue(pattern);
    const parts = [`subject.ilike.${value}`, `body_text.ilike.${value}`, `to_email.ilike.${value}`];
    if (ids.length && !familyMatchesCapped) parts.push(`household_id.in.(${ids.join(',')})`);
    q = q.or(parts.join(','));
  }

  const { data: rows, error, count } = await q;
  if (error) throw new Error(`Emails sent: ${error.message}`);
  const emails = await decorate(supabase, rows ?? []);
  const total = count ?? emails.length;
  return { emails, total, capped: total > emails.length, windowDays, familyMatchesCapped };
}

// ---------------------------------------------------------------------------
// Grouping (27 Oct 2026): one staff send to three families was three
// near-identical lines.
// ---------------------------------------------------------------------------

const FAILED = new Set(['failed', 'bounced']);
const byHousehold = (a, b) =>
  (a.household ?? a.to ?? '').localeCompare(b.household ?? b.to ?? '', 'en', { sensitivity: 'base' });

// One group per staff send: the same subject, sender, kind and event, each
// row within SEND_GAP_MS of the next. The site's own emails (payment plans,
// sent_by null) are one group each -- each is its own family's news. Takes
// and returns newest first; inside a group the families are in name order.
// Each group: { id, subject, kind, templateKey, by, sentAt (its first
// email), lastAt, eventId, emails, sent, failed }.
export function groupEmailsBySend(emails, { gapMs = SEND_GAP_MS } = {}) {
  const groups = [];
  const open = new Map(); // send key -> the group still collecting rows
  for (const m of emails ?? []) {
    const t = Date.parse(m.sentAt);
    const key = m.sentById
      ? [m.sentById, m.templateKey, m.subject ?? '', m.eventId ?? ''].join('|')
      : null;
    const g = key ? open.get(key) : null;
    // Newest first, so this row is older than everything in g so far.
    if (g && Date.parse(g.sentAt) - t <= gapMs) {
      g.emails.push(m);
      g.sentAt = m.sentAt;
      continue;
    }
    const fresh = {
      id: m.id,
      subject: m.subject,
      kind: m.kind,
      templateKey: m.templateKey,
      by: m.by,
      sentAt: m.sentAt,
      lastAt: m.sentAt,
      eventId: m.eventId,
      emails: [m],
    };
    groups.push(fresh);
    if (key) open.set(key, fresh);
  }
  for (const g of groups) {
    g.emails.sort(byHousehold);
    g.failed = g.emails.filter((m) => FAILED.has(m.status)).length;
    g.sent = g.emails.length - g.failed;
  }
  return groups;
}

// The sends under event headings: [{ eventId, name, sends }], the event with
// the newest send first; rows with no registration go under "No event".
// `eventName(id)` names an event (the page has the events list).
export function groupSendsByEvent(sends, eventName = () => null) {
  const byEvent = new Map();
  for (const s of sends ?? []) {
    const id = s.eventId ?? '';
    if (!byEvent.has(id)) {
      byEvent.set(id, { eventId: id || null, name: id ? eventName(id) ?? 'An event' : 'No event', sends: [] });
    }
    byEvent.get(id).sends.push(s);
  }
  // Sends arrive newest first, so each event's first send is its newest and
  // insertion order is already "most recent event first".
  return [...byEvent.values()];
}
