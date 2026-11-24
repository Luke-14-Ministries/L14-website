// Runs on every matching request, before the page does.
//
// All it does is call updateSession, which refreshes the Supabase login
// cookie and redirects anonymous visitors away from the signed-in area. The
// reasoning lives in lib/supabase/middleware.js.
//
// This file must sit at the repository root, beside package.json. Next.js
// finds it by location, not by import -- move it into app/ or lib/ and it
// silently stops running, with no error anywhere.
//
// WHY THIS FILE IS CALLED proxy.js AND NOT middleware.js
//
// It was middleware.js until 16 September 2026. Next.js 16 renamed the
// convention: the file is proxy.js and the exported function is `proxy`.
// The old name still loads in 16 but is deprecated, and the point of the
// upgrade was to stop carrying deprecated things. Nothing about what it does
// changed. Older comments and DECISIONS.md entries that say "the middleware"
// mean this file; the helper it calls kept its name because that name is
// ours, not a Next.js convention.
//
// One consequence worth knowing: `proxy` always runs on the Node.js runtime.
// The old middleware ran on the Edge runtime. That is fine here -- nothing in
// updateSession needed Edge, and Node has crypto.subtle -- but it means a
// future reader should not expect Edge-runtime limits (or speed) from it.

import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // 1. Every server action, wherever it is posted. A server action can be
    //    POSTed to ANY path -- an image path included -- and the two-factor
    //    gate in updateSession refuses actions from a session still owing its
    //    code. With only the page matcher below, an action posted to a path
    //    it skips (it used to skip anything ending .png, .jpg and so on) ran
    //    with no gate at all (security review, 23 Nov 2026). This entry
    //    catches every request carrying a Next-Action header, whatever its
    //    path.
    { source: '/:path*', has: [{ type: 'header', key: 'next-action' }] },
    // 2. Pages. Skipped: Next's own build output, the site icons, robots.txt,
    //    security.txt, the photos under images/ and the PDFs under resources/
    //    (never the /resources/ page itself). Those are static files: an auth
    //    check on them is an extra round-trip to Supabase for every logo.
    //    Until 23 Nov 2026 this skipped ANY path ending in an image extension,
    //    so /admin/people/x.png was never sent to the sign-in screen, and the
    //    page below it rendered without the gate's redirect. Now only the real
    //    static folders are skipped, by name.
    '/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|robots\\.txt|\\.well-known/|images/|resources/[^/]+\\.pdf).*)',
  ],
};
