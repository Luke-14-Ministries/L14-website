// Who is on the registration form, and is anyone on it twice?
import { ageOnDay } from './roles.js';
//
// Plain module (its one import, lib/roles.js, has none): the wizard (app/register/family/FamilyWizard.jsx),
// its server action and `npm run test:lib` all load it.
//
// Alpha feedback, 12 Nov 2026: a parent's role "didn't stick". The form
// matched "I'm coming too" to her card by NAME against the contact fields in
// "Your family", so any difference between the two (a name tidied in one
// place, an autofilled contact) unticked the box while her card stayed on
// the form. Ticking it again added a second, empty card with her name: no
// role, no date of birth, no sex. The chip then asked for "a role for
// Laurie" while the card she could see already had one. These helpers match
// by the saved person first, then by name, and find anyone listed twice.

export const normName = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Both names given, and equal once tidied (case and spacing ignored).
export function sameName(a, b) {
  const af = normName(a?.firstName);
  const al = normName(a?.lastName);
  return af !== '' && al !== '' && af === normName(b?.firstName) && al === normName(b?.lastName);
}

// The form row that is the primary contact, or -1. The saved person wins
// (the household's primary contact, `contactPersonId`), then the card that
// "I'm coming too" added (marked isContact, form state only: the server
// ignores it), then the name. So editing the contact's name in "Your family"
// no longer makes their card a stranger, saved household or not.
export function selfRowIndex(members, contact, contactPersonId = null) {
  const list = members || [];
  if (contactPersonId) {
    const byId = list.findIndex((m) => m.personId && m.personId === contactPersonId);
    if (byId >= 0) return byId;
  }
  const marked = list.findIndex((m) => m.isContact === true);
  if (marked >= 0) return marked;
  const asPerson = { firstName: contact?.contactFirst, lastName: contact?.contactLast };
  return list.findIndex((m) => sameName(m, asPerson));
}

// People on the form more than once: the same saved person, or the same
// first and last name. Each group lists the rows (indexes), first row first.
export function duplicatePeople(members) {
  const groups = new Map();
  (members || []).forEach((m, i) => {
    const first = (m.firstName || '').trim();
    const last = (m.lastName || '').trim();
    if (!first || !last) return;
    const key = `name:${normName(first)}|${normName(last)}`;
    if (!groups.has(key)) groups.set(key, { name: `${first} ${last}`, indexes: [], ids: new Set() });
    const g = groups.get(key);
    g.indexes.push(i);
    if (m.personId) g.ids.add(m.personId);
  });
  // The same saved person under two different spellings is still one person.
  const byId = new Map();
  (members || []).forEach((m, i) => {
    if (!m.personId || !(m.firstName || '').trim() || !(m.lastName || '').trim()) return;
    if (!byId.has(m.personId)) byId.set(m.personId, []);
    byId.get(m.personId).push(i);
  });
  const out = [...groups.values()]
    .filter((g) => g.indexes.length > 1)
    .map((g) => ({ name: g.name, indexes: g.indexes }));
  for (const idx of byId.values()) {
    if (idx.length < 2) continue;
    if (out.some((g) => idx.every((i) => g.indexes.includes(i)))) continue;
    const m = members[idx[0]];
    out.push({ name: `${m.firstName.trim()} ${m.lastName.trim()}`, indexes: idx });
  }
  return out.sort((a, b) => a.indexes[0] - b.indexes[0]);
}

// ---- An email of their own, for adult volunteers (Lawrence, 13 Nov 2026) ----
// VolunteerBadge emails each adult volunteer the background check's consent
// form and keeps one record per address, so two volunteers on one household
// address can't both be screened, and a volunteer with no own email is
// invited at the household's (which may not be theirs). So someone 18 or
// older on the event's first day with the Volunteer role gives an email of
// their own. A volunteer child (under 16) and a 16- or 17-year-old aren't
// screened and aren't asked. An unknown birth date counts as an adult, as
// the approval rule does (volunteer_clearance_ok, 0152).

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const tidyEmail = (v) => String(v ?? '').trim().toLowerCase();
// One age rule (CLAUDE.md, one function one answer): lib/roles.js's, which
// the screening queue uses too.
export { ageOnDay };

export function needsOwnEmail(m, startsOn) {
  if (m?.role !== 'Volunteer') return false;
  if (!String(m.firstName ?? '').trim() || !String(m.lastName ?? '').trim()) return false;
  const age = ageOnDay(m.dob, startsOn);
  return age == null || age >= 18;
}

// What is wrong with the adult volunteers' emails on this form, one entry per
// problem, first person first: missing, not an address, or the same address
// as another adult volunteer here.
export function ownEmailProblems(members, startsOn) {
  const out = [];
  const seen = new Map();
  (members || []).forEach((m, index) => {
    if (!needsOwnEmail(m, startsOn)) return;
    const name = `${String(m.firstName).trim()} ${String(m.lastName).trim()}`;
    const email = tidyEmail(m.email);
    const ageKnown = ageOnDay(m.dob, startsOn) != null;
    if (!email) {
      out.push({ index, name, kind: 'missing', ageKnown });
    } else if (email.length > 254 || !EMAIL_SHAPE.test(email)) {
      out.push({ index, name, kind: 'invalid' });
    } else if (seen.has(email)) {
      out.push({ index, name, kind: 'shared', with: seen.get(email) });
    } else {
      seen.set(email, name);
    }
  });
  return out;
}

// The words, the same in the browser and on the server.
export function ownEmailMessage(p) {
  if (p.kind === 'missing' && p.ageKnown === false) {
    return `${p.name} is volunteering. Please add their date of birth in “Who's coming”: if they are 18 or older, they also need an email of their own for the background check.`;
  }
  if (p.kind === 'missing') {
    return `${p.name} is volunteering and is 18 or older, so they need an email of their own for the background check (in “Who's coming”). VolunteerBadge, the company that runs our checks, sends the consent form there.`;
  }
  if (p.kind === 'invalid') return `${p.name}: that email address doesn’t look complete (in “Who's coming”).`;
  return `${p.name} and ${p.with} have the same email. Each adult volunteer needs their own address for the background check (in “Who's coming”).`;
}
