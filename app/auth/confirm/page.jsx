import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/site';

export const metadata = { title: 'Confirm' };

// The landing page for emailed links -- and the reason it exists is that it
// does NOT confirm anything by itself.
//
// THE PROBLEM THIS SOLVES
//
// An emailed link gets requested by more than the person it was sent to.
// Outlook's SafeLinks, spam filters, antivirus, and browser preloading all
// follow URLs to see where they lead -- and with the old design, where the
// link itself performed the confirmation, "following the URL" was enough to
// spend the one-time token. The auth log for 20 Aug 2026 shows the signature:
// a successful /verify, then "One-time token not found" one second later. The
// scanner got there first; the person's real click was the second request and
// landed on an error page.
//
// THE FIX
//
// Scanners send GET requests. They do not fill in forms. So the email link
// (a GET) lands here, on a page that renders a button and spends nothing.
// The button submits a form (a POST) to the server action below, and THAT is
// what verifies the token. A scanner can fetch this page a hundred times and
// the token is still unspent when the person arrives.
//
// The old /auth/callback route still exists and still works -- emails sent
// before the templates changed point there, and it also serves any future
// flow that arrives with a ?code=. New emails should point HERE; the Supabase
// email templates (dashboard -> Authentication -> Emails) are what decide.

// Where to send someone once the link has signed them in. An account with
// two-factor still owes its code (the link gives aal1), and the middleware
// would bounce the onward page to the code step -- but that bounce, after a
// server action's redirect, left the address bar on the onward page: the code
// step's "Remember this browser" then posted to the wrong page and failed, and
// the person landed on the dashboard instead of the reset form (Lawrence's
// reset, 21 Nov 2026). So go to the code step directly, with the onward page
// as its next. A remembered browser skips the code there, as at any login.
async function onward(supabase, next) {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2') {
    return `/account/?verify=1&next=${encodeURIComponent(next)}`;
  }
  return next;
}

// The link types Supabase's emails send. Anything else in ?type= is a
// mangled or hand-made link (23 Nov 2026: it went straight to verifyOtp).
const LINK_TYPES = ['email', 'signup', 'recovery', 'email_change', 'magiclink', 'invite'];

// A password-reset or email-change link that fails while someone is already
// signed in used to send them on as if it had worked: a reset link that had
// expired opened the reset form for whoever happened to be signed in, a
// different account from the one the email was for (security review,
// 23 Nov 2026). The courtesy below is meant for one case only: a second press
// of the same button, where the first press has just signed this browser in
// from the link. So it applies only when the session itself began from an
// emailed link in the last ten minutes. Supabase lists how the session was
// signed in (amr), with a time in seconds.
const LINK_METHODS = ['otp', 'magiclink', 'recovery', 'email_change', 'email/signup', 'invite'];
const RECENT_SECONDS = 10 * 60;
async function sessionBeganFromRecentLink(supabase) {
  const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return false;
  const now = Date.now() / 1000;
  return (aal?.currentAuthenticationMethods ?? []).some(
    (m) => LINK_METHODS.includes(m?.method) && now - Number(m?.timestamp ?? 0) < RECENT_SECONDS
  );
}

async function confirmAction(formData) {
  'use server';

  const tokenHash = formData.get('token_hash');
  const type = formData.get('type');
  // Path-only: never redirect off-site. See safeNextPath in lib/site.js.
  const next = safeNextPath(formData.get('next'));
  if (!LINK_TYPES.includes(type)) redirect('/account/link-expired/');

  const supabase = await createClient();

  if (tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      // An email change with both links needed: the first press confirms one
      // address and signs nobody in; the second finishes the change and does.
      if (type === 'email_change') {
        redirect(`/auth/confirm/changed/?step=${data?.session ? 'done' : 'half'}`);
      }
      redirect(await onward(supabase, next));
    }
    // The reason only (expired, already used); never the token.
    console.error('confirm link:', type, error.code ?? error.message);
  }

  // Same courtesy as the callback route: if a duplicate submit from this
  // browser already spent the token, the session it created is on this
  // request -- check before showing an error page. For a reset or an email
  // change, only when that session came from a link minutes ago (see above).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const strict = type === 'recovery' || type === 'email_change';
    if (strict && !(await sessionBeganFromRecentLink(supabase))) redirect('/account/link-expired/');
    if (type === 'email_change') redirect('/auth/confirm/changed/');
    redirect(await onward(supabase, next));
  }

  redirect('/account/link-expired/');
}

export default async function ConfirmPage({ searchParams }) {
  const params = await searchParams;
  const tokenHash = params?.token_hash ?? '';
  const type = params?.type ?? 'email';

  // The signup form passes its onward destination inside the redirect URL
  // (?next=/register/family/). The email template forwards that whole URL to
  // us as ?redirect_to=. Dig the path back out; anything unexpected falls
  // back to the dashboard.
  let next = type === 'recovery' ? '/account/reset-password/' : '/account/dashboard/';
  const redirectTo = params?.redirect_to;
  if (typeof redirectTo === 'string') {
    try {
      const embedded = new URL(redirectTo).searchParams.get('next');
      if (embedded) next = safeNextPath(embedded, next);
    } catch {
      /* not a URL -- keep the default */
    }
  }

  // No token in the URL at all: someone typed the address by hand, or a mail
  // client mangled the link. Nothing to verify, nothing to show but the door.
  if (!tokenHash || !LINK_TYPES.includes(type)) redirect('/account/link-expired/');

  const isRecovery = type === 'recovery';
  const isEmailChange = type === 'email_change';
  if (isEmailChange) next = '/auth/confirm/changed/';

  const heading = isEmailChange
    ? 'Confirm your new sign-in email'
    : isRecovery
      ? 'Reset your password'
      : 'Confirm your email address';
  const lead = isEmailChange
    ? 'We sent one link to your new address and one to your current address. Your sign-in email changes once both are pressed.'
    : isRecovery
      ? 'Press the button to choose a new password.'
      : 'One more click and your account is ready.';
  const button = isEmailChange
    ? 'Confirm the change'
    : isRecovery
      ? 'Continue to password reset'
      : 'Confirm my email address';

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <div className="rounded-lg border border-neutral-200 shadow-sm bg-white p-6 sm:p-8 text-center">
          <h1 className="text-3xl font-bold mb-3">{heading}</h1>
          <p className="text-neutral-700 mb-6">{lead}</p>
          <form action={confirmAction}>
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="next" value={next} />
            <button type="submit" className="btn-primary w-full">
              {button}
            </button>
          </form>
          {/* Said because it is true and can surprise: pressing the button on
              a computer where someone else is signed in replaces their
              session with the account the email was for (23 Nov 2026). The
              first press of an email change signs nobody in, so it is left
              out there. */}
          {!isEmailChange && (
            <p className="mt-3 text-sm text-neutral-600">
              You will be signed in to the account this email was sent to.
            </p>
          )}
          <p className="mt-5 text-sm text-neutral-500">
            Didn&rsquo;t expect this email? You can ignore it. Nothing happens
            unless you press the button.
          </p>
        </div>
      </div>
    </section>
  );
}
