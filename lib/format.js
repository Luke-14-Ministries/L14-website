// Small shared formatters, importable from client or server components.
//
// House rule for everything here: TIDY, NEVER MANGLE. If the input isn't
// clearly the shape we expect, hand it back exactly as typed. A formatter that
// guesses turns "Apt 3B, rear" into nonsense, and a family who watches the site
// rewrite their own address stops trusting the rest of the form. All of these
// run on BLUR, never on keystrokes -- reformatting under a moving cursor is
// maddening.

import { todayInMorristown } from './events';

// Tidy a US phone number into (423) 200-6158. Only a clean 10-digit (or
// 1-plus-10) number is reformatted; anything else -- an extension, a foreign
// number, half-typed digits -- is returned exactly as entered.
// A US phone number with its area code: ten digits, or eleven starting with
// 1 (Lawrence, 26 Oct 2026: an emergency contact saved as "423200"). Any
// punctuation is fine; the digits are what is counted.
export function isFullPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

export function formatPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

// US states, DC, and the territories/military codes the Postal Service uses.
// A dropdown rather than a text box is the single highest-value address check
// there is: it makes the most common bad value -- a missing, misspelled or
// invented state -- impossible to enter, for free, with no third party.
export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'], ['GU', 'Guam'],
  ['AS', 'American Samoa'], ['MP', 'Northern Mariana Islands'],
  ['AA', 'Armed Forces Americas'], ['AE', 'Armed Forces Europe'],
  ['AP', 'Armed Forces Pacific'],
];

const STATE_CODES = new Set(US_STATES.map(([c]) => c));
const STATE_BY_NAME = new Map(US_STATES.map(([c, n]) => [n.toLowerCase(), c]));

// Accept what someone types and return the two-letter code when it is
// unambiguous: "tn", "TN", "Tennessee", "tennessee ". Anything else comes back
// untouched, so an odd value is preserved rather than silently blanked.
export function formatStateCode(raw) {
  const s = (raw || '').trim();
  if (!s) return raw;
  const up = s.toUpperCase();
  if (up.length === 2 && STATE_CODES.has(up)) return up;
  const byName = STATE_BY_NAME.get(s.toLowerCase());
  return byName ?? raw;
}

// ZIP: five digits, or ZIP+4 with the hyphen the Postal Service expects.
// "378141234" becomes "37814-1234"; "3781" (still typing) is left alone.
export function formatZip(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 5) return digits;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return raw;
}

// True when a ZIP looks postable. Used for a gentle inline hint, never to block
// a save -- an empty box is fine, a half-typed one is the family's business.
export function zipLooksValid(raw) {
  const s = (raw || '').trim();
  return s === '' || /^\d{5}(-\d{4})?$/.test(s);
}

// Gentle case repair for a city or a name typed with a stuck caps-lock or in a
// hurry: "MORRISTOWN" and "morristown" both become "Morristown", but anything
// already mixed-case is left exactly alone -- that rule is what keeps
// "McMinnville", "LaFollette" and "St. Louis" safe from being "corrected".
export function tidyCity(raw) {
  const s = (raw || '').trim();
  if (!s) return raw;
  const isAllUpper = s === s.toUpperCase();
  const isAllLower = s === s.toLowerCase();
  if (!isAllUpper && !isAllLower) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'.])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

// A deliberately LOOSE email check: something@something.tld, nothing more.
//
// Stricter validation is a trap. Real addresses contain apostrophes, plus
// signs, long new TLDs and single-character labels, and every "smart" regex
// eventually refuses one of them. The cost of a false refusal here is a family
// who cannot register; the cost of letting a typo through is one bounced
// email. Those are not close, so this only catches the shapes that are
// definitely wrong -- no @, nothing after the dot, spaces.
export function emailLooksValid(v) {
  if (!v) return true; // blank is handled by required-ness, not by format
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
}

// The allergy pill, in one place so every view agrees (E33/E42, 0064).
//
// Before this, every allergy got the same red pill, so a lactose intolerance
// and an anaphylaxis looked identical on the kitchen list — which is printed
// deliberately without names, so there is nobody to ask. Red everywhere is the
// same failure as red nowhere: if it always shouts, it stops being read.
//
// The colours run amber -> orange -> red, and the wording is the ACTION rather
// than the label, because the person reading it is holding a serving spoon.
//
// NOT RECORDED IS NOT MILD. Somebody with has_allergies and no severity gets a
// pill that says so, and it is deliberately conspicuous rather than quiet: the
// safe reading of "we never asked" is to treat it carefully, not to assume the
// best. Only a real "mild" earns the calm colour.
export function allergyPill(hasAllergies, severity) {
  if (!hasAllergies) return null;
  switch (severity) {
    case 'anaphylaxis':
      return { text: 'ANAPHYLAXIS', cls: 'bg-red-600 text-white', title: 'Life-threatening. Rescue medication; a reaction means adrenaline and an ambulance.' };
    case 'severe':
      return { text: 'severe allergy', cls: 'bg-orange-200 text-orange-900', title: 'Must be avoided properly. A reaction means finding the camp nurse.' };
    case 'mild':
      return { text: 'mild allergy', cls: 'bg-amber-100 text-amber-900', title: 'Avoid where easy. Discomfort rather than danger.' };
    default:
      return { text: 'allergy — severity not recorded', cls: 'bg-neutral-200 text-neutral-900 ring-1 ring-neutral-400', title: 'Nobody has said how serious this is. Treat it carefully until somebody has.' };
  }
}

// Registration status, in one place so every view says it the same way.
//
// These lived only in RosterTable, which is a client component, so the person
// page (a server component) could not reach them and printed a bare lower-case
// "confirmed" beside pills everywhere else. Shared here 31 Aug 2026 rather than
// copied — two colour maps for one set of statuses drift, and the drift shows
// up as staff mistrusting a colour.
//
// Safe to hold Tailwind classes now that lib/ is scanned; see the
// @source line in app/globals.css.
export const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Submitted',
  waitlisted: 'Waitlisted',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

const STATUS_CLS = {
  draft: 'bg-neutral-100 text-neutral-700',
  submitted: 'bg-amber-100 text-amber-800',
  waitlisted: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-neutral-200 text-neutral-500',
};

export function statusPill(status) {
  return {
    text: STATUS_LABEL[status] ?? status ?? 'Unknown',
    cls: STATUS_CLS[status] ?? STATUS_CLS.submitted,
  };
}

// Age in years, as a decimal (18.4), from a YYYY-MM-DD birth date; null when
// unknown. For threshold checks ("is this person an adult?"), not display --
// the accounts table has its own whole-years formatter for that. Lives here
// rather than inline in a page for the reason lib/events.js gives above its
// clock helpers: the caller is a server component, and the clock is read once
// per request.
export function yearsSince(iso, now = Date.now()) {
  if (!iso) return null;
  return (now - new Date(iso).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

// Background-check status, in one place, for every page that shows it (0091,
// 15 Oct 2026). Takes the clearance_status view's row (on_file, expires_on,
// verdict) or the person_clearances row (background_check_on_file …); either
// spelling works. The three verdict words are the ministry's, not Checkr's:
// green "ok", amber "follow up", red "not permitted" -- and red "no background
// check on file" (Lawrence, 15 Oct 2026: a volunteer nobody has screened is
// the same stop sign as one who failed). Expired and undecided are amber:
// something is on file, and somebody has to finish it. Always the two words
// "background check", never "check" alone: a check is also something a family
// mails for a fee (Lawrence, 15 Oct 2026).
export const CLEARANCE_VERDICT_LABEL = {
  ok: 'OK to serve',
  follow_up: 'Needs a follow-up conversation',
  not_permitted: 'Not permitted to attend',
};

// Is somebody under 18 today? null when the date of birth is unknown.
export function isMinor(dob, now = Date.now()) {
  if (!dob) return null;
  const d = new Date(`${String(dob).slice(0, 10)}T00:00:00Z`);
  const eighteen = new Date(d);
  eighteen.setUTCFullYear(eighteen.getUTCFullYear() + 18);
  return eighteen > new Date(now);
}

export function clearancePill(c, today = todayInMorristown()) {
  // Checkr does not screen under-18s and the ministry does not ask it to
  // (0056 refuses the order). A minor is not "missing" a background check;
  // they are simply not screened, and the pill and the counts say so
  // (Lawrence, 15 Oct 2026: "adults only -- 18 and older").
  if (c?.minor) {
    return { key: 'minor', text: 'Under 18 — not screened', cls: 'bg-neutral-100 text-neutral-600', title: 'Background checks are run on adults only; this volunteer is under 18.' };
  }
  if (!c) {
    return { key: 'none', text: 'No background check on file', cls: 'bg-red-100 text-red-800', title: 'No background check recorded for this person.' };
  }
  const onFile = c.on_file ?? c.background_check_on_file ?? false;
  const expiresOn = c.expires_on ?? null;
  const verdict = c.verdict ?? null;
  if (verdict === 'not_permitted') {
    return { key: 'not_permitted', text: 'Not permitted', cls: 'bg-red-600 text-white', title: 'The ministry decided this person may not attend.' };
  }
  if (!onFile) {
    return { key: 'none', text: 'No background check on file', cls: 'bg-red-100 text-red-800', title: 'No background check on file.' };
  }
  if (expiresOn && expiresOn < today) {
    return { key: 'expired', text: `Background check expired ${expiresOn}`, cls: 'bg-amber-100 text-amber-800', title: 'The background check on file has expired; a new one is due.' };
  }
  if (verdict === 'follow_up') {
    return { key: 'follow_up', text: 'Background check: needs follow-up', cls: 'bg-amber-200 text-amber-900', title: 'Check on file; a conversation is needed before this person serves.' };
  }
  if (verdict === 'ok') {
    return { key: 'ok', text: 'Background check OK', cls: 'bg-green-100 text-green-800', title: `Background check on file, current${expiresOn ? ` to ${expiresOn}` : ''}, and OK.` };
  }
  return { key: 'undecided', text: 'Background check on file — no verdict yet', cls: 'bg-amber-100 text-amber-800', title: 'Paperwork is on file but nobody has recorded a verdict yet.' };
}

// A date of birth the site will not accept (0094, 15 Oct 2026): the year is
// before 1900 or the date is in the future. "0014-02-24" -- a two-digit year
// typed into a date box -- made a child read as 2,012 years old. Returns the
// sentence to show, or null when the date is fine (or blank).
export const DOB_MIN = '1900-01-01';
export function dobProblem(iso, today = todayInMorristown()) {
  const v = (iso ?? '').trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < DOB_MIN || v > today) {
    return `${v} is not a real date of birth — check the year (four digits, e.g. 2014).`;
  }
  return null;
}

// Where an outside provider's waiver confirmation stands (0124): the staff
// pill on the Activities page and the print sheet's Waiver column. review is
// { status: 'pending' | 'accepted' | 'rejected', note }.
export function waiverReviewPill(review) {
  if (review?.status === 'accepted') {
    return { key: 'accepted', text: 'accepted ✓', cls: 'bg-green-100 text-green-800' };
  }
  if (review?.status === 'rejected') {
    return {
      key: 'rejected',
      text: `rejected — ${review.note || 'no reason given'}`,
      cls: 'bg-red-100 text-red-800',
    };
  }
  return { key: 'pending', text: 'awaiting check', cls: 'bg-blue-100 text-blue-800' };
}
