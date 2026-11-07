// The volunteer application's required answers -- the one rule, applied in
// the browser (app/register/volunteer/VolunteerApplication.jsx, so the person
// is told before a round trip) and again in submitVolunteerApplication
// (./actions.js there), which is the check that holds: a server action is a
// public endpoint whatever the form in front of it does. Until 22 Oct 2026
// only the browser checked, and the server saved blanks (Website Feedback
// list row 13).
//
// Every question except skills is required (Ellen & Katie; Lawrence,
// 14 Oct 2026). "None" is an answer; a blank is not. The Creed affirmation is
// asked but never required (board, 29 Sep 2026), and the accompanying adult
// for an under-18 is flagged to staff rather than refused -- neither is here
// on purpose.
//
// A volunteer child (under 16, 0155) is not asked where they would like to
// serve, their faith or the Creed (Lawrence, 6 Nov 2026): first time, home
// church, skills and experience stay. Picking Translation asks the languages
// they speak (same day), so that answer is required with it.
//
// Plain module: no 'use server', no 'use client'.

export const TRANSLATION_AREA = 'Translation';

// `a` is the payload the form sends: preferredAreas (the picked areas joined
// with ' · '), firstTime (true, false or null), church, faith, experience,
// languages. `child` is true for a volunteer child -- the server decides it
// from the person's role, never from the payload.
// Returns the sentence to show, or null when nothing is missing.
export function volunteerApplicationProblem(a, { child = false } = {}) {
  const v = a ?? {};
  const blank = (x) => typeof x !== 'string' || x.trim() === '';
  const missing = [];
  if (!child && blank(v.preferredAreas)) missing.push('where you would like to serve');
  if (
    !child &&
    String(v.preferredAreas ?? '').split(' · ').includes(TRANSLATION_AREA) &&
    blank(v.languages)
  ) {
    missing.push('the languages you speak (for translation)');
  }
  if (typeof v.firstTime !== 'boolean') missing.push('whether this is your first time');
  if (blank(v.church)) missing.push('home church ("none" is fine)');
  if (!child && blank(v.faith)) missing.push('a little about your faith');
  if (blank(v.experience)) {
    missing.push('experience with people with disabilities ("none" is fine)');
  }
  return missing.length > 0 ? `Please answer: ${missing.join('; ')}.` : null;
}
