// The VolunteerBadge balance, said one way on Background Checks and on
// Background screening (Lawrence, 13 Nov 2026): what a check costs first,
// then what we have, coloured by whether it covers anyone, then where to buy
// more. No hooks and no 'use client', so the server page and the client board
// both render it.
import { VB_DASHBOARD } from '@/lib/volunteerBadgeApi';

// Red when nothing is free to send, amber when only a few are, green otherwise.
function tone(free) {
  if (free == null) return 'text-neutral-800';
  if (free <= 0) return 'text-red-700';
  if (free < 5) return 'text-amber-700';
  return 'text-green-700';
}

export default function CreditLine({ mode, credits, outstanding = 0, problem = null }) {
  if (mode === 'off') return <>VolunteerBadge isn&rsquo;t connected yet.</>;
  if (problem) return <span className="text-red-800">{problem}</span>;
  const free = credits == null ? null : Math.max(0, credits - outstanding);
  return (
    <>
      {mode === 'test' && <strong>Test mode: no credits are used. </strong>}
      One check uses one credit. We have{' '}
      <strong className={tone(free)}>
        {credits == null ? 'an unknown number of credits' : `${credits} ${credits === 1 ? 'credit' : 'credits'}`}
      </strong>
      {outstanding > 0 && (
        <>
          {' '}({outstanding} {outstanding === 1 ? 'is' : 'are'} held for invites already out, so{' '}
          <strong className={tone(free)}>{free}</strong> free)
        </>
      )}
      . Buy more at{' '}
      <a href={VB_DASHBOARD} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">
        VolunteerBadge
      </a>{' '}
      (sign in, then Credits &amp; Billing).
    </>
  );
}
