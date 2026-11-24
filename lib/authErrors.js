// Supabase Auth's refusals, in words a family can act on (23 Nov 2026).
//
// The sign-up form showed Supabase's own message as it came ("Password should
// contain at least one character of each: ..."), and the reset form had its
// own copy of a few of these. One place now, used by both. The original is
// logged to the browser console so a report can still be traced; the person
// sees only the plain sentence.
//
// Never add a branch that says whether an address has an account: the
// sign-up, reset and contact forms are careful not to (security audit,
// 20 Oct 2026), and a message here would undo that.

export function authErrorWords(err, fallback = 'That did not go through. Please try again.') {
  if (!err) return fallback;
  const code = err.code ?? '';
  const msg = String(err.message ?? '');
  const reasons = Array.isArray(err.reasons) ? err.reasons : [];
  console.error('Supabase Auth:', code || err.status || '', msg);

  if (code === 'captcha_failed' || /captcha/i.test(msg)) {
    return 'The "I am human" check did not go through. Please try it again.';
  }
  if (code === 'current_password_invalid' || code === 'current_password_mismatch') {
    return 'Your current password was not right. Please try it again.';
  }
  if (code === 'same_password' || /different from the old/i.test(msg)) {
    return 'That is your current password. Please choose a different one.';
  }
  if (code === 'weak_password' || /weak|pwned|known to be/i.test(msg)) {
    if (reasons.includes('pwned') || /pwned|known to be|breach/i.test(msg)) {
      return 'That password has appeared in a data breach on another website, so it is easy for others to guess. Please choose another.';
    }
    if (reasons.includes('length') || /at least \d+ characters|too short/i.test(msg)) {
      return 'Passwords need at least 10 characters.';
    }
    return 'That password is too easy to guess. Please choose a longer one, or one with a mix of words and numbers.';
  }
  if (code === 'email_address_invalid' || /invalid.*email|email.*invalid/i.test(msg)) {
    return 'That email address doesn’t look right. Please check it.';
  }
  if (code === 'over_email_send_rate_limit' || /email rate limit|only request this/i.test(msg)) {
    return 'An email went to this address a moment ago. Wait a minute or two, then try again.';
  }
  if (code === 'over_request_rate_limit' || err.status === 429 || /rate limit/i.test(msg)) {
    return 'Too many tries in a short time. Wait a few minutes, then try again.';
  }
  if (code === 'signup_disabled') {
    return 'New accounts cannot be made just now. Please email info@luke14ministries.net.';
  }
  return fallback;
}
