// Household invite notes shared by the invite page, the dashboard and the
// registration page (23 Nov 2026, review findings S3-14, A5-07, A5-21).
// Server components only: they read lib/householdInvite.js (server-only).

import { inviteProblemText, householdPhrase, safeName } from '@/lib/householdInvite';

const OFFICE = 'registration@luke14ministries.net';

// The office address inside a fixed sentence, as a link.
function WithOfficeLink({ text }) {
  const parts = text.split(OFFICE);
  return parts.map((part, i) => (
    <span key={i}>
      {part}
      {i < parts.length - 1 && (
        <a href={`mailto:${OFFICE}`} className="underline">
          {OFFICE}
        </a>
      )}
    </span>
  ));
}

// Why an invite was not accepted. Only a code the site knows prints
// anything; any other value from the URL is ignored.
export function InviteProblem({ code, className = '' }) {
  const text = inviteProblemText(code);
  if (!text) return null;
  return (
    <p role="alert" className={`rounded-sm border border-red-300 bg-red-50 px-4 py-3 text-left text-red-800 ${className}`}>
      <WithOfficeLink text={text} />
    </p>
  );
}

// An invite waiting for this sign-in (my_open_household_invites(), 0179):
// for the relative who signed up on their own or lost the email, so they join
// the family's household instead of starting a second one. Names go through
// safeName(), as the invite emails do (23 Nov 2026, P99).
export function WaitingInvites({ invites = [], className = 'mb-8' }) {
  if (!invites.length) return null;
  return invites.map((inv) => (
    <div
      key={inv.invite_id}
      className={`rounded-lg border border-amber-300 bg-amber-50 p-5 flex flex-wrap items-center justify-between gap-3 ${className}`}
    >
      <p className="text-amber-900">
        <span className="font-semibold">{safeName(inv.inviter_name, 'Someone in your family')}</span> invited you to share the{' '}
        <span className="font-semibold">{householdPhrase(safeName(inv.household_name, ''))}</span>. Join it to see their
        registrations.
      </p>
      <form action="/auth/household-invite/accept/" method="post">
        <input type="hidden" name="invite_id" value={inv.invite_id} />
        <button type="submit" className="btn-primary py-2!">
          Join
        </button>
      </form>
    </div>
  ));
}
