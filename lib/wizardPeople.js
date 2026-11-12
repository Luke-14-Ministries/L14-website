// Who is on the registration form, and is anyone on it twice?
//
// Plain module, no imports: the wizard (app/register/family/FamilyWizard.jsx),
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
