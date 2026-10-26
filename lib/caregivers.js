// Linked caregivers and the phone rule (Lawrence, 26 Oct 2026).
//
// A person linked as a caregiver for someone (person_caregivers, 0012) MUST
// have a phone number: the link exists so staff can reach that adult during
// camp, and a link with no number reaches nobody. Everyone else's own phone
// stays optional.
//
// One rule, one wording, used in the browser (Manage Household) and in the
// server actions that save a person or create a link -- so the family reads
// the same sentence whichever side refuses. Existing rows that break the rule
// are not rewritten; the page flags them ("Needs: phone") and the next save of
// that person asks for the number.

// "A phone number" means something staff can dial: at least seven digits.
// Loose on purpose (formatting, extensions and international numbers all
// pass); it only refuses a blank or a note like "ask Mum".
export function hasPhone(phone) {
  return String(phone ?? '').replace(/\D/g, '').length >= 7;
}

// "Sam", "Sam and Pip", "Sam, Pip and Lou".
export function nameList(names) {
  const list = (names ?? []).filter(Boolean);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// The hint under the phone box of someone who is a linked caregiver.
export function caregiverPhoneHint(name, caresFor) {
  return `Required — ${name} is a linked caregiver for ${nameList(caresFor)}.`;
}

// Saving a person: null when fine, else the sentence to show.
// `caresFor` is the first names of the people they are a linked caregiver for.
export function caregiverPhoneProblem({ name, phone, caresFor }) {
  if (!caresFor || caresFor.length === 0) return null;
  if (hasPhone(phone)) return null;
  return `A phone number is required — ${name} is a linked caregiver for ${nameList(caresFor)}.`;
}

// Creating a link: null when fine, else the sentence to show. Only NEW links
// are asked this; a link already on file is left as it is (flagged, not
// rewritten).
export function caregiverLinkProblem({ name, phone }) {
  if (hasPhone(phone)) return null;
  return `Add a phone number for ${name} first — caregivers must be reachable.`;
}
