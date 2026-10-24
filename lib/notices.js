// Temporary notices to families, kept in one place so they are easy to find
// and easy to retire.
//
// THE WELCOME CARD (Lawrence, 24 Oct 2026): when the new site goes live,
// families are told it is new and asked for feedback -- a card on the family
// dashboard and at the start of the family registration wizard
// (components/WelcomeNotice.jsx). It is temporary by design: after the first
// camp season on the new site it stops being news, and a "welcome to our new
// site" card in year two reads as a site nobody looks after. So it switches
// itself off after WELCOME_NOTICE_UNTIL (inclusive, a Morristown date), with
// nobody having to remember to remove it. Moving the date is the one-line way
// to extend or end it early; deleting the component is the tidy-up for later.
export const WELCOME_NOTICE_UNTIL = '2027-08-31'; // after camp season 2027

// Per browser, in localStorage. Versioned, so a rewritten card (v2) is shown
// again to people who ticked "Don't show this again" on this one.
export const WELCOME_DISMISS_KEY = 'l14_welcome_v1_dismissed';

// Today in Morristown as YYYY-MM-DD ('en-CA' formats a date that way), so the
// card ends at midnight Eastern rather than at midnight UTC.
export function welcomeNoticeCurrent(now = new Date()) {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return today <= WELCOME_NOTICE_UNTIL;
}
