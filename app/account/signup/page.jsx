import { Suspense } from 'react';
import SignupForm from './SignupForm';
import { NEW_SITE_NOTE, newSiteNoteShowing } from '@/lib/site';
import { todayInMorristown } from '@/lib/events';

export const metadata = { title: 'Create Account' };

// The new-site note below ends on its own on 1 Aug 2027 (NEW_SITE_NOTE_UNTIL
// in lib/site.js). This page is otherwise static, so it is rebuilt hourly:
// the note is gone within the hour of the date passing.
export const revalidate = 3600;

export default function SignupPage() {
  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-lg mx-auto">
        <h1 className="text-4xl font-bold text-center mb-3">
          Create Your Account
        </h1>
        <p className="text-center text-neutral-600 mb-8">
          One account for camp registration and giving, for families and
          volunteers alike.
        </p>
        {newSiteNoteShowing(todayInMorristown()) && (
          <p className="mb-6 rounded-lg border border-brand/30 bg-white px-4 py-3 text-center text-sm text-neutral-700">
            {NEW_SITE_NOTE}
          </p>
        )}
        {/* Suspense is required, not decorative: SignupForm reads the ?next=
            query string, and Next.js refuses to prerender a page that does that
            without a boundary. Same pattern as app/account/page.jsx. */}
        <Suspense fallback={<div className="h-96 rounded-lg bg-white/60" />}>
          <SignupForm />
        </Suspense>
      </div>
    </section>
  );
}
