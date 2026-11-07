// Volunteer child (under 16) -- Lawrence, 6 Nov 2026 (migration 0155).
//
// A child under 16 who serves alongside the volunteers, usually with a
// volunteering parent; not a camper. Treated like a volunteer minus the adult
// parts: on the volunteer lists, lodged with staff, asked the volunteer
// application, the same fee. No background check (under 18 is not screened).
//
// Shared by the browser (the wizard's hint) and the server (the staff flags),
// so nothing here touches Supabase.

export const VOLUNTEER_ROLES = new Set(['volunteer', 'volunteer_child']);
export const isVolunteerRole = (role) => VOLUNTEER_ROLES.has(role);

// "Under 16": the age on the event's first day, as everywhere else on rosters.
export const VOLUNTEER_CHILD_UNDER = 16;

// Age in whole years on a day, from 'YYYY-MM-DD' strings read as calendar
// dates (no time zone, so a birthday never slips a day). null when unknown.
export function ageOnDay(dateOfBirth, onDay) {
  const dob = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth ?? '');
  const on = /^(\d{4})-(\d{2})-(\d{2})/.exec(onDay ?? '');
  if (!dob || !on) return null;
  let age = Number(on[1]) - Number(dob[1]);
  if (on[2] < dob[2] || (on[2] === dob[2] && on[3] < dob[3])) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// The three age checks, as flags for staff -- never a block (Lawrence: "flag
// to check based on person age"). Pass ONE registration's live people:
// { name, camp_role, date_of_birth } (cancelled rows left out), and the
// event's starts_on. Returns [{ name, text }], one per problem.
export function roleAgeFlags(people, startsOn) {
  const flags = [];
  const live = people ?? [];
  const hasAdultHelper = live.some(
    (p) =>
      (p.camp_role === 'volunteer' || p.camp_role === 'parent_guardian') &&
      (ageOnDay(p.date_of_birth, startsOn) ?? 18) >= 18
  );
  for (const p of live) {
    const age = ageOnDay(p.date_of_birth, startsOn);
    if (p.camp_role === 'volunteer_child') {
      if (age != null && age >= VOLUNTEER_CHILD_UNDER) {
        flags.push({ name: p.name, text: `${p.name} is ${age} at camp — registered as a volunteer child (under 16)` });
      }
      if (!hasAdultHelper) {
        flags.push({ name: p.name, text: `${p.name} is a volunteer child with no adult volunteer or parent on this registration` });
      }
    } else if (p.camp_role === 'volunteer' && age != null && age < VOLUNTEER_CHILD_UNDER) {
      flags.push({ name: p.name, text: `${p.name} is ${age} at camp — registered as a volunteer, not a volunteer child` });
    }
  }
  return flags;
}
