import { Suspense } from 'react';
import ResetPasswordForm from './ResetPasswordForm';

export const metadata = { title: 'Set a New Password' };

// Reached from the link in a password-reset email: the button page at
// /auth/confirm/ verifies the emailed token (verifyOtp) and signs the person
// in, then sends them here. By the time anyone sees this page they are signed
// in -- proxy.js turns away anyone who is not. Also reached with
// ?reason=annual when a staff password is a year old. (Comment corrected
// 23 Nov 2026: it named /auth/callback, which reset links no longer use.)
export default function ResetPasswordPage() {
  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <h1 className="text-3xl font-bold text-center mb-8">New Password</h1>
        {/* The form reads ?reason=annual, which needs a Suspense boundary. */}
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </section>
  );
}
