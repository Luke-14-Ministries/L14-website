// A staff member editing a person's own details: the one set of rules, used by
// the registration page (updatePerson) and the staff person page
// (updatePersonFromPersonPage). Lawrence, 11 Nov 2026: staff could only edit
// someone through a registration, so a household member on none (an
// alpha-tester's son) could not be corrected at all. Two copies of these
// rules would drift, so they live here and need no registration id.
//
// Server side only: it takes the caller's request-scoped Supabase client, so
// RLS applies exactly as it does to the page that calls it. The caller checks
// the grant (write:registration) first.
//
// The change log needs nothing here: migration 0046's trigger on people logs
// identity edits whoever makes them, so a staff edit shows in Recent Changes.

import { dobProblem, formatPhone } from './format';
import { caregiverPhoneProblem, hasPhone } from './caregivers';

// Fields a staff member may edit on a person. Anything not listed is ignored
// rather than trusted: the client cannot widen the write surface.
export const PERSON_FIELDS = [
  'first_name',
  'last_name',
  'preferred_name',
  'date_of_birth',
  'gender',
  'email',
  'phone',
];

// Empty strings become NULL, so a cleared field reads back as "not provided".
function cleanPerson(fields) {
  const out = {};
  for (const k of PERSON_FIELDS) {
    if (k in fields) {
      const v = fields[k];
      out[k] = typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v;
    }
  }
  // Tidied as the family pages tidy it (lib/phone.js): a clean US number
  // becomes (423) 555-0123, keeping any extension; anything else as typed.
  if (out.phone) out.phone = formatPhone(out.phone);
  return out;
}

// { ok: true } | { ok: false, error, needsConfirm? }
export async function editPersonAsStaff(supabase, personId, fields, options = {}) {
  const patch = cleanPerson(fields || {});
  if (!patch.first_name && 'first_name' in patch) {
    return { ok: false, error: 'A first name is required.' };
  }
  {
    const bad = dobProblem(patch.date_of_birth);
    if (bad) return { ok: false, error: bad };
  }

  // A linked caregiver must have a phone (Lawrence, 26 Oct; lib/caregivers.js).
  // Staff create no caregiver links -- families do, on Manage Household -- so
  // the one way this could break the rule is CLEARING the number of someone
  // already linked. That is refused, in the family page's words. A caregiver
  // who never had a number is not blocked: staff fixing a name over the phone
  // should not be stopped by a gap they cannot fill.
  if ('phone' in patch && !hasPhone(patch.phone)) {
    const { data: before, error: beforeError } = await supabase
      .from('people')
      .select('first_name, phone')
      .eq('id', personId)
      .maybeSingle();
    if (beforeError) return { ok: false, error: `This person could not be read: ${beforeError.message}` };
    if (before && hasPhone(before.phone)) {
      const { data: links, error: linkError } = await supabase
        .from('person_caregivers')
        .select('person_id')
        .eq('caregiver_person_id', personId);
      if (linkError) return { ok: false, error: `Caregiver links could not be read: ${linkError.message}` };
      const ids = (links ?? []).map((l) => l.person_id);
      if (ids.length > 0) {
        const { data: deps, error: depError } = await supabase
          .from('people')
          .select('first_name')
          .in('id', ids)
          .order('created_at');
        if (depError) return { ok: false, error: `Caregiver links could not be read: ${depError.message}` };
        const bad = caregiverPhoneProblem({
          name: patch.first_name ?? before.first_name,
          phone: patch.phone,
          caresFor: (deps ?? []).map((d) => d.first_name),
        });
        if (bad) return { ok: false, error: bad };
      }
    }
  }

  // IDENTITY CHANGES ON A REGISTERED PERSON NEED A DELIBERATE YES.
  //
  // Families are blocked from this outright and told to ask staff (25 Aug).
  // Staff genuinely need it -- correcting a typo is the common case -- so it
  // is allowed, but not by accident: the caller passes confirmIdentityChange,
  // and the reply says exactly what is at stake. Someone on no live
  // registration needs no confirmation (nothing printed or signed uses them).
  const identityKeys = ['first_name', 'last_name', 'date_of_birth'];
  const touchingIdentity = identityKeys.some((k) => k in patch);

  if (touchingIdentity && !options.confirmIdentityChange) {
    const { data: before, error: beforeError } = await supabase
      .from('people')
      .select('first_name, last_name, date_of_birth')
      .eq('id', personId)
      .maybeSingle();
    if (beforeError) return { ok: false, error: `Their current details could not be read: ${beforeError.message}` };

    const changed = identityKeys.filter((k) => k in patch && (patch[k] ?? '') !== (before?.[k] ?? ''));

    if (changed.length > 0) {
      const { count, error: countError } = await supabase
        .from('registration_participants')
        .select('id', { count: 'exact', head: true })
        .eq('person_id', personId)
        .neq('status', 'cancelled');
      // A failed count must not skip the confirmation.
      if (countError) return { ok: false, error: `Their registrations could not be counted: ${countError.message}` };

      if ((count ?? 0) > 0) {
        return {
          ok: false,
          needsConfirm: true,
          error:
            `${before?.first_name ?? 'This person'} ${before?.last_name ?? ''}`.trim() +
            ' is on a live registration. Changing their name or date of birth changes ' +
            'rosters and check-in lists, but agreements already signed keep the old name. ' +
            'Returning families are matched by name and date of birth, so this could ' +
            'create a duplicate person the next time they register. The change is logged ' +
            'in Recent Changes.',
        };
      }
    }
  }

  const { error } = await supabase.from('people').update(patch).eq('id', personId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
