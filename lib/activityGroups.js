// Activity groups (0125): rafts for white water rafting, boats for the
// pontoon. Plain module -- no server imports -- so the board (client), its
// server actions, the print sheet and the CSV all form units the same way.
//
// THE UNIT is what staff pick up and put in a group. Lawrence, 26 Oct 2026:
// anyone signed up for the activity can go, and a camper's paired buddy goes
// with them automatically -- a buddy goes wherever their camper goes.
//
//   * A signed-up person who is the CAMPER side of a live buddy pairing
//     (buddy_assignments, ended_at null) is one unit with their buddy or
//     buddies -- whether or not the buddy signed up.
//   * The duplicate-buddy rule: a buddy who ALSO signed up is not listed a
//     second time; they are in their camper's unit. A buddy paired with two
//     signed-up campers joins the two campers into one unit, because the
//     buddy cannot be in two rafts.
//   * A buddy who signed up whose camper did NOT is a single unit: the camper
//     is not going, so there is nobody to follow.
//   * Everyone else signed up (siblings, parents, volunteers without a
//     camper) is a unit of one.
//
// Placement is stored per PERSON (activity_group_members); placing a unit
// writes every member, and the server works the unit out again from the
// database rather than trusting the browser's copy.

// signedUpIds: participant ids with an active signup on the activity.
// pairs: [{ camperId, buddyId }] -- live pairings on the event, both people
// on a non-cancelled registration.
// Returns [[participantId, ...], ...], each person in exactly one unit.
export function buildUnits(signedUpIds, pairs) {
  const going = new Set(signedUpIds);
  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c);
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const add = (x) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a, b) => {
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (const id of going) add(id);
  for (const p of pairs) {
    if (p.camperId && p.buddyId && going.has(p.camperId)) union(p.camperId, p.buddyId);
  }

  const units = new Map();
  for (const id of parent.keys()) {
    const r = find(id);
    if (!units.has(r)) units.set(r, []);
    units.get(r).push(id);
  }
  return [...units.values()];
}

// The unit holding one person, or just that person.
export function unitOf(participantId, units) {
  return units.find((u) => u.includes(participantId)) ?? [participantId];
}

// What one group is called. Since 0153 it is the activity's own setting
// (activities.group_label: "Raft", "Boat", "Table"), set in the editor; it
// used to be guessed from the name ("raft" in it meant rafts), which made the
// pontoon's boats "Groups". With no setting it is "Group".
function plural(word) {
  return /(s|x|z|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`;
}
export function groupNoun(groupLabel) {
  const One = String(groupLabel ?? '').trim() || 'Group';
  const Many = plural(One);
  return { one: One.toLowerCase(), One, many: Many.toLowerCase(), Many };
}

// How many go in one group by default (0153: activities.group_size; null is 6).
export const DEFAULT_GROUP_SIZE = 6;

// The next default name: the lowest "Raft N" not already taken, so deleting
// Raft 2 and adding again gives Raft 2, not a clash with Raft 3.
export function nextGroupName(groupLabel, existingNames) {
  const { One } = groupNoun(groupLabel);
  const taken = new Set((existingNames ?? []).map((n) => String(n).trim().toLowerCase()));
  let i = 1;
  while (taken.has(`${One} ${i}`.toLowerCase())) i += 1;
  return `${One} ${i}`;
}

export const GROUP_ROLE_LABEL = {
  camper: 'camper',
  parent_guardian: 'parent',
  sibling: 'sibling',
  caregiver: 'caregiver',
  volunteer: 'volunteer',
  childcare: 'childcare',
  support_team: 'support',
};

// The minimum-age pill's words, from the activity's min_age (0125).
export function underAgeWords(minAge) {
  return `Under ${minAge} — check with camp staff`;
}
