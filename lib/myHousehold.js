// "Is this mine?" for the family side of the site, asked one way everywhere
// (security review, 23 Nov 2026).
//
// CLAUDE.md: /account/* "my data" queries scope by household membership
// explicitly, never by RLS alone, because staff RLS is broad. A staff member
// who is also a parent reads every household's rows over the API, so an
// action that trusts "RLS let me read it" would let that login edit, pay for
// or withdraw another family's things from their own dashboard. Several
// actions asked the question themselves, a few in slightly different ways,
// and some not at all; this module is the one answer they now share.
//
// Every read error is reported, never treated as "not yours" or "not found"
// (a failed read must stop the action, not wave it through or hide why).
// The words are for families: the database's own message goes to the server
// log, not the page.

import 'server-only';

const NOT_MINE = 'That is not part of your household.';
const READ_FAILED = 'Your household could not be read just now. Please try again.';

// The households the signed-in person belongs to.
// Returns { ids, userId, error }: error is a sentence for the family, or null.
export async function myHouseholdIds(supabase) {
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user) return { ids: [], userId: null, error: 'Please log in again.' };
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id);
  if (error) {
    console.error('myHouseholdIds:', error.message);
    return { ids: [], userId: user.id, error: READ_FAILED };
  }
  return { ids: [...new Set((data ?? []).map((m) => m.household_id))], userId: user.id, error: null };
}

// Where each kind of thing keeps its household. A participant and a
// cancellation request hang off a registration, so they are read through it.
const LOOKUP = {
  household: null,
  person: { table: 'people', column: 'household_id' },
  registration: { table: 'registrations', column: 'household_id' },
  participant: { table: 'registration_participants', column: 'registrations ( household_id )' },
  cancellation: { table: 'registration_cancellation_requests', column: 'registrations ( household_id )' },
};

// Check that one thing belongs to the caller's household.
//   assertMine(supabase, { household: id })
//   assertMine(supabase, { registration: id })
//   assertMine(supabase, { person: id })
//   assertMine(supabase, { participant: id, registration: id })  -- the
//     participant must also be ON that registration
//   assertMine(supabase, { cancellation: id })
// Returns { error, householdId, ids }: error is null when it is the caller's.
// Something that does not exist and something that belongs to someone else
// get the same sentence, so the answer never says which.
export async function assertMine(supabase, what = {}) {
  const { ids, error: idsError } = await myHouseholdIds(supabase);
  if (idsError) return { error: idsError, householdId: null, ids };
  if (ids.length === 0) return { error: NOT_MINE, householdId: null, ids };

  const kind = ['participant', 'cancellation', 'person', 'registration', 'household'].find((k) => what[k]);
  if (!kind) return { error: NOT_MINE, householdId: null, ids };

  if (kind === 'household') {
    return ids.includes(what.household)
      ? { error: null, householdId: what.household, ids }
      : { error: NOT_MINE, householdId: null, ids };
  }

  const { table, column } = LOOKUP[kind];
  const extra = kind === 'participant' || kind === 'cancellation' ? ', registration_id' : '';
  const { data, error } = await supabase
    .from(table)
    .select(`id${extra}, ${column}`)
    .eq('id', what[kind])
    .maybeSingle();
  if (error) {
    console.error(`assertMine ${kind}:`, error.message);
    return { error: READ_FAILED, householdId: null, ids };
  }
  if (!data) return { error: NOT_MINE, householdId: null, ids };

  const householdId = extra ? data.registrations?.household_id : data.household_id;
  if (!householdId || !ids.includes(householdId)) return { error: NOT_MINE, householdId: null, ids };
  // A participant named with its registration must be on that registration:
  // the page sends both, and a mismatched pair is either a stale page or a
  // tampered form.
  if (kind === 'participant' && what.registration && data.registration_id !== what.registration) {
    return { error: 'That person is not on this registration.', householdId: null, ids };
  }
  return { error: null, householdId, ids };
}
