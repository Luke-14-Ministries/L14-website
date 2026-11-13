// VolunteerBadge's API, and what its answers mean here (0165, 13 Nov 2026).
//
// Plain module with no imports, so `npm run test:lib` can load it with a
// mocked fetch. The site reaches it only through lib/volunteerBadge.js, which
// is server-only and holds the key.
//
// WHAT THIS MODULE MAY DO, AND NOTHING ELSE (CLAUDE.md: no Social Security
// number and no report content ever enters this system):
//   GET  /templates        which application to send
//   POST /applications     the consent-first invite: VB emails the volunteer,
//                          who signs the FCRA consent and types their own ID
//                          and SSN on VB's site
//   GET  /credits          the balance
//   GET  /volunteers[/id]  find the applicant (by the address invited) and
//                          their checks
//   GET  /checks/{id}      a check's status and result word
// Never POST /checks, /checks/instant or /volunteers: each takes an SSN or a
// date of birth from us. There is no general "call" export on purpose.
//
// VB's check JSON carries reportUrl and reportDownloadUrl (signed PDF links).
// They are stripped from EVERY answer here, before anything else sees it, so
// no caller can store, log or show them by accident.

export const VB_BASE = 'https://www.volunteerbadge.com/api/v1';
// Where staff read a "consider" result: VB's own dashboard, never a report link.
export const VB_DASHBOARD = 'https://www.volunteerbadge.com/dashboard';

// Any key that is, or looks like, a link to the report.
const isReportKey = (k) => /report/i.test(k) && /(url|link|download|pdf)/i.test(k);

export function stripReportLinks(value) {
  if (Array.isArray(value)) return value.map(stripReportLinks);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isReportKey(k)) continue;
      out[k] = stripReportLinks(v);
    }
    return out;
  }
  return value;
}

// ONLY THESE FIELDS EVER LEAVE THIS MODULE (13 Nov 2026). VB's single-volunteer
// record (GET /volunteers/{id}, the one way to find a person's check without a
// webhook) also returns their date of birth, the last four digits of their
// SSN and their home address; the roster carries phone numbers. Each answer is
// cut down to an allow-list here, the moment it is parsed, so nothing else in
// the site can store, log or show what we never asked for.
const pick = (o, keys) => {
  const out = {};
  for (const k of keys) if (o && o[k] !== undefined) out[k] = o[k];
  return out;
};
// Last name since 13 Nov 2026 (Lawrence): Background screening flags a
// possible match on name at a different address. A name, never the date of
// birth, SSN digits, address or phone.
export const pickRosterRow = (v) =>
  pick(v, ['id', 'email', 'first_name', 'firstName', 'last_name', 'lastName', 'created_at', 'createdAt']);
export const pickCheck = (c) =>
  pick(c, ['checkId', 'id', 'volunteerId', 'status', 'result', 'type', 'completedAt', 'completed_at', 'createdAt', 'created_at']);
export const pickVolunteer = (v) => ({
  ...pick(v, ['id', 'firstName', 'first_name', 'createdAt', 'created_at']),
  checks: Array.isArray(v?.checks) ? v.checks.map(pickCheck) : [],
});

export class VolunteerBadgeError extends Error {
  // status: HTTP status (0 = never answered). uncertain: VB may have acted
  // even though we got no clean answer (no reply, a 5xx), so nobody should
  // assume the invite did NOT go out.
  constructor(message, { status = 0, code = null, uncertain = false } = {}) {
    super(message);
    this.name = 'VolunteerBadgeError';
    this.status = status;
    this.code = code;
    this.uncertain = uncertain;
  }
}

const short = (s, n = 200) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// VB's error in plain words.
export function errorWords(status, body, { keepTheirs = false } = {}) {
  // VB's own words are kept only where they describe OUR request: a refused
  // invite (POST, 400 or 422: a bad address, a bad template). Anywhere else
  // they could be about a person, so fixed words are used.
  const theirs = keepTheirs ? short(body?.error ?? body?.message ?? '') : '';
  const code = String(body?.code ?? '').toLowerCase();
  if (status === 401) return 'VolunteerBadge refused the key. Check VOLUNTEERBADGE_API_KEY in Vercel.';
  if (status === 402) return 'VolunteerBadge is out of credits. Buy more in VolunteerBadge (Billing), then try again.';
  if (status === 403 && code.includes('identity')) {
    return 'VolunteerBadge needs the account owner to finish its identity check (Settings → Account) first.';
  }
  if (status === 403 && code.includes('suspended')) return 'VolunteerBadge has paused API access for this key. Email support@volunteerbadge.com.';
  if (status === 403) return 'VolunteerBadge refused the request. Its agreement may need accepting again (Settings → API).';
  if (status === 404) return theirs ? `VolunteerBadge: ${theirs}` : 'VolunteerBadge couldn’t find that.';
  if (status === 429) return 'VolunteerBadge asked us to slow down. Wait a minute and try again.';
  if (status >= 500) return 'VolunteerBadge had a problem on its side. Check its dashboard before trying again.';
  return theirs ? `VolunteerBadge: ${theirs}` : `VolunteerBadge answered ${status}.`;
}

// The balance, from GET /credits. The field name isn't documented, so the
// likely spellings are read and anything else is "unknown" (null), never 0.
export function creditsFrom(body) {
  for (const k of ['credits', 'balance', 'remaining', 'creditBalance', 'available']) {
    const v = body?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v && typeof v === 'object') {
      const inner = creditsFrom(v);
      if (inner != null) return inner;
    }
  }
  return null;
}

const UUIDISH = /^[A-Za-z0-9_-]{1,100}$/;
const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The client. `key` is read by the caller (lib/volunteerBadge.js) and never
// returned, logged or put in an error. `gapMs` keeps one client's calls under
// VB's 100 a minute.
export function makeVolunteerBadge({ key, fetchImpl = globalThis.fetch, base = VB_BASE, gapMs = 650, timeoutMs = 20000 } = {}) {
  if (!key) return null;
  const sandbox = String(key).startsWith('vb_test_');
  let last = 0;

  async function call(method, path, body) {
    const wait = last + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch {
      throw new VolunteerBadgeError('VolunteerBadge didn’t answer. Check its dashboard before trying again.', {
        status: 0,
        uncertain: true,
      });
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    data = stripReportLinks(data);
    if (!res.ok) {
      throw new VolunteerBadgeError(errorWords(res.status, data, { keepTheirs: method === 'POST' && (res.status === 400 || res.status === 422) }), {
        status: res.status,
        code: data?.code ?? null,
        uncertain: res.status >= 500,
      });
    }
    return data;
  }

  return {
    sandbox,
    async templates() {
      const d = await call('GET', '/templates');
      return Array.isArray(d?.templates) ? d.templates.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault === true })) : [];
    },
    async credits() {
      return creditsFrom(await call('GET', '/credits'));
    },
    // The invite. volunteerPays false: the ministry spends one credit
    // (Lawrence). The apply link VB returns is the volunteer's own and is not
    // passed back: nothing here needs it.
    // waiveIdReason: only for staff's per-person "Resend without the ID step"
    // (Lawrence, 13 Nov 2026). Every other invite leaves requireIdVerification
    // out, so VB's account setting (ID step ON) applies.
    async sendApplication({ templateId, email, waiveIdReason = null }) {
      if (!UUIDISH.test(String(templateId ?? ''))) throw new VolunteerBadgeError('No VolunteerBadge template to send.', { status: 0 });
      const to = String(email ?? '').trim().toLowerCase();
      if (!EMAILISH.test(to)) throw new VolunteerBadgeError('That email address doesn’t look complete.', { status: 0 });
      const body = { templateId, email: to, volunteerPays: false };
      if (waiveIdReason != null) {
        const why = String(waiveIdReason).replace(/\s+/g, ' ').trim();
        if (why.length < 10) throw new VolunteerBadgeError('The reason for skipping the ID step needs at least 10 characters.', { status: 0 });
        body.requireIdVerification = false;
        body.idVerificationReason = why.slice(0, 300);
      }
      const d = await call('POST', '/applications', body);
      if (!d?.applicationId) {
        throw new VolunteerBadgeError('VolunteerBadge answered without an application id. Check its dashboard before trying again.', {
          status: 200,
          uncertain: true,
        });
      }
      return {
        applicationId: String(d.applicationId),
        expiresAt: d.expiresAt ?? null,
        sandbox: sandbox || d.sandbox === true || d.mode === 'test',
      };
    },
    async volunteersPage(page = 1, limit = 100) {
      const d = await call('GET', `/volunteers?page=${Number(page) || 1}&limit=${Number(limit) || 100}`);
      const total = Number(d?.pagination?.totalPages);
      return {
        volunteers: Array.isArray(d?.volunteers) ? d.volunteers.map(pickRosterRow) : [],
        // null when VB doesn't say: loadRoster then reads on until a short page.
        totalPages: Number.isFinite(total) && total > 0 ? total : null,
      };
    },
    async volunteer(id) {
      if (!UUIDISH.test(String(id ?? ''))) throw new VolunteerBadgeError('Not a VolunteerBadge volunteer id.', { status: 0 });
      return pickVolunteer(await call('GET', `/volunteers/${encodeURIComponent(id)}`));
    },
    async check(id) {
      if (!UUIDISH.test(String(id ?? ''))) throw new VolunteerBadgeError('Not a VolunteerBadge check id.', { status: 0 });
      return pickCheck(await call('GET', `/checks/${encodeURIComponent(id)}`));
    },
  };
}

// ---------------------------------------------------------------------------
// What VB's words mean here
// ---------------------------------------------------------------------------
// Our status from a check. "clear" ONLY from a finished check whose result is
// clear; anything unknown stays "processing", never clear. VB documents:
// processing, pending, pending_auto_release (running); complete (clear);
// pending_adjudication, hits_found (VB's reviewer is looking); adjudicated
// (done: clear or consider); error, refunded (no result, credit returned).
export function statusFromCheck(check) {
  const s = String(check?.status ?? '').toLowerCase();
  const raw = check?.result;
  const r = raw === 'null' || raw == null ? null : String(raw).toLowerCase();
  if (s === 'error' || s === 'refunded') return 'error';
  if (s === 'complete' || s === 'adjudicated') {
    if (r === 'clear') return 'clear';
    if (r === 'consider') return 'consider';
    return s === 'adjudicated' ? 'in_review' : 'processing';
  }
  if (s === 'pending_adjudication' || s === 'hits_found') return 'in_review';
  return 'processing';
}

const idOf = (c) => String(c?.checkId ?? c?.id ?? '') || null;
const createdOf = (c) => c?.createdAt ?? c?.created_at ?? null;
const GRACE_MS = 10 * 60 * 1000;

// The check that answers THIS invite: on the volunteer's record, started no
// earlier than the invite (a few minutes' clock grace), newest first. When VB
// says what kind of check each is, only a "full" one (produced by a signed
// application) counts; a direct or instant check on the same record isn't
// the invite's. A check without a date is never guessed at: an older one on
// the same record could be someone else's year.
export function checkForInvite(checks, sentAt, graceMs = GRACE_MS) {
  const since = new Date(sentAt).getTime() - graceMs;
  let list = (Array.isArray(checks) ? checks : []).filter(
    (c) => idOf(c) && createdOf(c) && new Date(createdOf(c)).getTime() >= since
  );
  if (list.some((c) => c.type != null)) list = list.filter((c) => c.type === 'full');
  list.sort((a, b) => new Date(createdOf(b)) - new Date(createdOf(a)));
  return list[0] ?? null;
}

const emailOf = (v) => String(v?.email ?? v?.Email ?? '').trim().toLowerCase();
const firstWord = (s) => String(s ?? '').trim().toLowerCase().split(/[\s-]+/)[0] ?? '';

// Does VB's record carry this person's first name? Their own first name or
// preferred name, first word; a prefix of three letters or more counts either
// way round ("Sam" and "Samantha" agree; "Al" and "Alex" don't; "Pat" and
// "Lee" don't). Returns null when there is nothing to compare (no name on
// one side): the caller then trusts the record only if it was made since
// the invite.
export function namesAgree(vbVolunteer, person) {
  const theirs = firstWord(vbVolunteer?.firstName ?? vbVolunteer?.first_name);
  const ours = [firstWord(person?.first_name), firstWord(person?.preferred_name)].filter(Boolean);
  if (!theirs || ours.length === 0) return null;
  const prefix = (a, b) => a.length >= 3 && b.startsWith(a);
  return ours.some((o) => o === theirs || prefix(o, theirs) || prefix(theirs, o));
}

const madeOf = (v) => v?.createdAt ?? v?.created_at ?? null;
// Made no earlier than the invite (with the clock grace)?
const madeSince = (v, sentAt) => {
  const made = madeOf(v);
  return Boolean(made) && new Date(made).getTime() >= new Date(sentAt).getTime() - GRACE_MS;
};

// VB's roster, read once per refresh or batch. `complete` is false when it
// was cut short; `hasEmails` false when its rows carry no address at all
// (VB's docs don't promise one), in which case nothing can be matched and
// nothing must be expired on the strength of "not found".
export async function loadRoster(api, maxPages = 10) {
  const LIMIT = 100;
  const rows = [];
  let page = 1;
  let complete = false;
  while (page <= maxPages) {
    const r = await api.volunteersPage(page, LIMIT);
    rows.push(...r.volunteers);
    // Complete when VB's page count says so, or (with no count) on a short page.
    if (r.totalPages != null ? page >= r.totalPages : r.volunteers.length < LIMIT) {
      complete = true;
      break;
    }
    page += 1;
  }
  return {
    rows,
    complete,
    hasEmails: rows.length === 0 || rows.some((v) => emailOf(v) !== ''),
    find: (email) => volunteersAtEmail(rows, email),
  };
}

// VB roster rows that may be this person under another address: the same
// last name (suffixes like Jr. or III and punctuation set aside) and a first
// name that agrees (namesAgree). A hint for staff to look, never a link.
const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
export const lastNameKey = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[.,'’`]/g, '')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SUFFIX.has(w))
    .join(' ');
export function possibleNameMatches(rows, person) {
  const ours = lastNameKey(person?.last_name);
  if (!ours) return [];
  return (Array.isArray(rows) ? rows : []).filter(
    (v) => lastNameKey(v?.last_name ?? v?.lastName) === ours && namesAgree(v, person) === true
  );
}

// Volunteers on VB's roster whose address is the one invited.
export function volunteersAtEmail(volunteers, email) {
  const want = String(email ?? '').trim().toLowerCase();
  if (!want) return [];
  return (Array.isArray(volunteers) ? volunteers : []).filter((v) => emailOf(v) === want);
}

export const OPEN_STATUSES = ['sending', 'invited', 'applied', 'processing', 'in_review'];

const NO_EMAILS = 'VolunteerBadge’s volunteer list shows no email addresses, so this invite can’t be matched to its result yet. Ask VolunteerBadge.';
const TWO_AT_ADDRESS = 'More than one VolunteerBadge volunteer has this address. Check it in VolunteerBadge and record the result by hand.';
const NOT_THE_INVITES = 'The newest check on this person’s VolunteerBadge record isn’t one from this invite. Check it in VolunteerBadge and record the result by hand.';
const OTHER_NAME = 'VolunteerBadge has this address under a different (or no) first name. Check it in VolunteerBadge, and record the result by hand if it is theirs.';

// One request's next state, asking VB only what it must. `api` is a client
// from makeVolunteerBadge; `roster` is loadRoster()'s answer (read once per
// refresh). `req` carries the person's first_name and preferred_name.
// Returns the columns to change, or null for "nothing new". Never touches
// confirmed_* (the button's).
//
// HOW AN INVITE IS TIED TO ITS RESULT (no webhook, Lawrence's decision 1):
// VB has no "get an application" call, so the volunteer is found on VB's
// roster by the address invited, and nothing is saved until a FULL check
// started after the invite is on that record AND the record's first name
// agrees with the person's. A record that was already there (someone
// screened in VB's dashboard, a household address) is never taken as "they
// applied"; it only answers once a new check appears on it.
export async function refreshRequest(req, api, roster, now = new Date()) {
  const patch = {};
  let checkId = req.vb_check_id;

  if (!checkId) {
    const expired = req.apply_expires_at && new Date(req.apply_expires_at) < now;
    if (!roster.hasEmails) return req.problem === NO_EMAILS ? null : { problem: NO_EMAILS };
    const found = roster.find(req.invited_email);
    if (found.length > 1) return req.problem === TWO_AT_ADDRESS ? null : { problem: TWO_AT_ADDRESS };
    if (found.length === 1) {
      const id = String(found[0].id ?? found[0].volunteerId ?? '') || null;
      if (!id) return null;
      if (namesAgree(found[0], req) === false) return req.problem === OTHER_NAME ? null : { problem: OTHER_NAME };
      const v = await api.volunteer(id);
      const agree = namesAgree(v, req) ?? namesAgree(found[0], req);
      if (agree === false || (agree === null && !madeSince(v, req.sent_at) && !madeSince(found[0], req.sent_at))) {
        return req.problem === OTHER_NAME ? null : { problem: OTHER_NAME };
      }
      const chosen = checkForInvite(v?.checks, req.sent_at);
      if (chosen) {
        checkId = idOf(chosen);
        patch.vb_volunteer_id = id;
        patch.vb_check_id = checkId;
      } else {
        // A record made since the invite means they applied; an older one
        // tells us nothing.
        const newRecord = madeSince(v, req.sent_at) || madeSince(found[0], req.sent_at);
        if (newRecord && req.status === 'invited') return { status: 'applied', problem: null };
        if (!newRecord && req.status === 'invited' && expired) return { status: 'expired' };
        return null;
      }
    } else {
      // Not on the roster. Expire only on a full roster read: a list cut
      // short proves nothing.
      if (req.status === 'invited' && expired && roster.complete) return { status: 'expired' };
      return null;
    }
  }

  const c = await api.check(checkId);
  // The check must be this volunteer's, and (when VB says the kind) one made
  // by a signed application: a direct or instant check on the same record is
  // not the invite's answer (review, 13 Nov 2026).
  const owner = patch.vb_volunteer_id ?? req.vb_volunteer_id ?? null;
  // A volunteerId in the answer that isn't the linked volunteer refuses it,
  // null included: VB gives a direct check volunteerId null.
  const saysOwner = c && Object.prototype.hasOwnProperty.call(c, 'volunteerId');
  if ((saysOwner && owner && String(c.volunteerId ?? '') !== String(owner)) || (c?.type != null && c.type !== 'full')) {
    return req.problem === NOT_THE_INVITES ? null : { problem: NOT_THE_INVITES };
  }
  const status = statusFromCheck(c);
  const raw = c?.result === 'null' ? null : c?.result ?? null;
  patch.status = status;
  patch.vb_check_status = String(c?.status ?? '').slice(0, 40) || null;
  patch.vb_result = raw === 'clear' || raw === 'consider' ? raw : null;
  patch.completed_at = c?.completedAt ?? c?.completed_at ?? null;
  // Our words, not VB's errorMessage: it is about the person's check, and
  // nothing about the check beyond its status word is kept here.
  patch.problem =
    status === 'error'
      ? String(c?.status).toLowerCase() === 'refunded'
        ? 'VolunteerBadge refunded this check. No result will come.'
        : 'VolunteerBadge couldn’t complete this check. The credit was returned.'
      : null;

  const changed = Object.entries(patch).some(([k, v]) => (req[k] ?? null) !== (v ?? null));
  return changed ? patch : null;
}
