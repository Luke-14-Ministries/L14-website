// The older landing route for emailed links. New emails point at the button
// page, /auth/confirm/ (see supabase/EMAIL-TEMPLATE-SNIPPETS.md); this route
// stays for links already sitting in inboxes and for any flow that arrives
// with a ?code=.
//
// Two shapes of link can arrive here, depending on how a Supabase email
// template is written:
//
//   ?code=...                     a PKCE code. Exchanged for a session here.
//   ?token_hash=...&type=signup   a one-time token. NOT spent here any more:
//                                 handed on to the /auth/confirm/ button page.
//
// WHY A TOKEN IS NO LONGER SPENT ON THIS GET (security review, 23 Nov 2026)
//
// Emailed links get fetched by things that are not the recipient. Mail
// scanners, link-safety services and browser preloading all follow the URL to
// see where it goes. When this route verified the token on the GET, following
// the link was enough to spend it, and the scanner, not the person, got the
// session (the auth log for 20 Aug 2026: a successful /verify, then "One-time
// token not found" a second later). The button page spends the token only on
// a POST, which scanners do not send. So a token that lands here is sent
// there, unspent, with the onward page carried in redirect_to the way the
// email templates carry it.
//
// A ?code= cannot be handed on the same way: it is tied to the browser that
// asked for it (PKCE) and has to be exchanged where the code verifier cookie
// is. That branch is unchanged.
//
// It has to be a route handler rather than a page, because only route
// handlers and server actions may write cookies (the ?code= exchange does).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/site';

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  // Only ever redirect to a path on this site. Taking a full URL from the
  // query string and redirecting to it is the open-redirect bug -- it lets
  // someone send out a link that looks like ours and lands somewhere else.
  const rawNext = searchParams.get('next');
  const next = safeNextPath(rawNext);

  if (tokenHash && type) {
    const confirm = new URL('/auth/confirm/', origin);
    confirm.searchParams.set('token_hash', tokenHash);
    confirm.searchParams.set('type', type);
    // The button page reads the onward page from redirect_to's own ?next=,
    // as it does for the email templates. Only when the link named one: with
    // none, the button page picks its own (the reset form for a recovery
    // link, the dashboard otherwise).
    if (rawNext) {
      confirm.searchParams.set('redirect_to', `${origin}/account/?next=${encodeURIComponent(next)}`);
    }
    return NextResponse.redirect(confirm);
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  // THE SECOND-REQUEST CASE -- read this before simplifying it away.
  //
  // A failed exchange does not mean the visitor is unauthenticated. If a
  // duplicate request came from this same browser, the request that succeeded
  // already set the session cookie, and it is sitting in this very request.
  // Check for it before apologising. getUser() verifies with Supabase rather
  // than trusting the cookie, so this cannot be spoofed by forging one.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) return NextResponse.redirect(`${origin}${next}`);

  // Genuinely expired, genuinely already used, or a ?code= link opened in a
  // different browser from the one that asked for it. All three are ordinary,
  // so the page says what to do rather than what went wrong.
  return NextResponse.redirect(`${origin}/account/link-expired/`);
}
