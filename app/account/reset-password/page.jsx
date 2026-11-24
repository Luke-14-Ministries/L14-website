import { Suspense } from 'react';
import ResetPasswordForm from './ResetPasswordForm';
import BackLink, { TITLE_ROW } from '@/components/BackLink';

// One name per account page, in sentence case, the same in the heading,
// the dashboard's link and the browser tab (23 Nov 2026).
export const metadata = { title: 'Change password' };

// Reached from the link in a password-reset email: the button page at
// /auth/confirm/ verifies the emailed token (verifyOtp) and signs the person
// in, then sends them here. By the time anyone sees this page they are signed
// in -- proxy.js turns away anyone who is not. Also reached with
// ?reason=annual when a staff password is a year old. (Comment corrected
// 23 Nov 2026: it named /auth/callback, which reset links no longer use.)
export default function ResetPasswordPage() {
  return (
    // Everyone here is signed in (see above), so the page wears the account
    // pages' shell and title row with the Back pill, like Security and Delete
    // my data (23 Nov 2026).
    <section className="bg-neutral-50 py-12 min-h-[60vh]">
      <div className="container-site max-w-2xl mx-auto">
        <div className={`${TITLE_ROW} mb-6`}>
          <h1 className="text-3xl font-bold">Change password</h1>
          <BackLink />
        </div>
        {/* The form reads ?reason=annual, which needs a Suspense boundary. */}
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </section>
  );
}
