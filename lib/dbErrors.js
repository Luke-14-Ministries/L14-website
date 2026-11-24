// Why a save or a delete failed, for STAFF pages (Lawrence, 9 Nov 2026):
// "anytime an event can't be deleted / a change can't be saved, the editor
// should get a message indicating why: intelligible if possible, the raw
// Supabase words if not, which we can bring back to a code session."
//
// withReason('That could not be saved.', error) keeps the page's own first
// sentence and adds the reason. The common refusals are put in plain words;
// anything else is passed through as the database said it, with its code, so
// a screenshot is enough to find the cause. Our own triggers already raise in
// words meant for people (P0001, check_violation), so those pass as they are.
//
// Not for family pages: families keep the friendly "please try again" lines,
// and the detail goes to the server log there.
//
// Plain module, no server imports: safe in server actions and route handlers.

export function dbReason(error) {
  if (!error) return '';
  const code = error.code ?? '';
  const msg = String(error.message ?? '').trim();
  const details = String(error.details ?? '').trim();

  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'Your access does not allow this change. Ask an administrator to check your Staff & Access ticks.';
  }
  if (code === '23503') {
    return `Something else still refers to it, so it cannot be removed or changed this way. (Database: ${msg}${details ? ` ${details}` : ''})`;
  }
  if (code === '23505') {
    return `That would duplicate one that already exists. (Database: ${msg}${details ? ` ${details}` : ''})`;
  }
  if (code === '23502') {
    return `Something required is missing. (Database: ${msg})`;
  }
  // Our own triggers and checks speak to people already.
  if (code === 'P0001' || code === '23514') return msg;
  if (!msg) return code ? `(Database code ${code}.)` : '';
  return `Database said: ${msg}${details ? ` ${details}` : ''}${code ? ` [${code}]` : ''}`;
}

export function withReason(text, error) {
  const reason = dbReason(error);
  return reason ? `${text} ${reason}` : text;
}

// Why a save failed, for FAMILY pages (security review, 23 Nov 2026).
//
// familyError('updateHouseholdInfo', error, 'Your changes could not be saved.')
// logs the database's words with the action's name, then returns the page's
// own fallback sentence. Raw Postgres text ("new row violates row-level
// security policy for table people", a column name, a constraint) means
// nothing to a parent and tells a stranger how the tables are laid out, so it
// stays in the server log. Our own functions and triggers raise sentences
// written for families (raise exception '...' gives P0001; a few use 22023
// for a bad answer, or 42501 for "Enter your two-factor code first."), and
// those are passed through as they are. A 42501 that is Postgres's own
// refusal (row-level security, permission denied) is not.
const FAMILY_HELP = ' Please try again, or email registration@luke14ministries.net if it keeps happening.';

export function familyError(label, error, fallback) {
  if (!error) return fallback;
  const code = error.code ?? '';
  const msg = String(error.message ?? '').trim();
  console.error(`${label}:`, code, msg);
  if (/^not authenticated$/i.test(msg)) return 'You have been signed out. Please sign in again.';
  const ours =
    code === 'P0001' ||
    code === '22023' ||
    (code === '42501' && msg && !/row-level security|permission denied/i.test(msg));
  if (ours && msg) return msg;
  return `${fallback}${FAMILY_HELP}`;
}
