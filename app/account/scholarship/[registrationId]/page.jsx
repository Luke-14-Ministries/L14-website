import BackLink, { TITLE_ROW } from '@/components/BackLink';
import { notFound, redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import ScholarshipForm from './ScholarshipForm';
import BackBar from '@/components/BackBar';
import { participantMoney } from '@/lib/payments';

export const metadata = { title: 'Scholarship Request — Luke 14 Ministries' };

// Families ask for help with the fee here. Everything behind it already
// existed: the scholarships table, its policies, and the staff review screen
// on /admin/registrations/[id]. What was missing was the asking.
//
// Access is row-level security again: the registration query returns nothing
// for a registration outside the caller's household, so the page 404s.
export default async function ScholarshipPage({ params }) {
  const { registrationId } = await params;

  const user = await getCurrentUser();
  if (!user) redirect(`/account/?next=/account/scholarship/${registrationId}/`);

  const supabase = await createClient();

  // Scoped to the caller's own households explicitly (CLAUDE.md: never rely
  // on RLS alone for "my data" reads) -- 21 Oct 2026.
  const { data: memberships, error: memberError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id);
  if (memberError) throw new Error(`Your household: ${memberError.message}`);
  const householdIds = (memberships ?? []).map((m) => m.household_id);
  if (householdIds.length === 0) notFound();

  const { data: reg, error: regError } = await supabase
    .from('registrations')
    .select(
      `id, household_id,
       events ( name, starts_on ),
       registration_participants ( id, status, camp_role,
         participant_money ( fee_cents ),
         people ( first_name, last_name ) )`
    )
    .eq('id', registrationId)
    .in('household_id', householdIds)
    .maybeSingle();
  // CLAUDE.md: never swallow a query error -- a dropped one read as a 404.
  if (regError) throw new Error(`Scholarship page: ${regError.message}`);
  if (!reg) notFound();

  // The scholarship agreement moved here from the registration form (24 Aug):
  // it is signed at the moment it starts to apply, by the family it binds,
  // instead of by everyone. Load the current version's text, and whether this
  // household has already signed it for this registration.
  const [{ data: agreement, error: agreementError }, { data: schAgSig, error: schAgSigError }] = await Promise.all([
    supabase
      .from('agreements')
      .select('key, title, body, version')
      .eq('key', 'scholarship_agreement')
      .eq('active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('agreement_signatures')
      .select('id, signed_at, signer_name, agreements!inner ( key )')
      .eq('registration_id', registrationId)
      .eq('agreements.key', 'scholarship_agreement')
      .limit(1),
  ]);
  // A failed read would offer the agreement for signing again as if unsigned.
  if (agreementError) throw new Error(`Scholarship agreement: ${agreementError.message}`);
  if (schAgSigError) throw new Error(`Scholarship agreement signature: ${schAgSigError.message}`);
  const agreementSigned = Boolean(schAgSig?.[0]);

  // Who the household says is responsible -- shown as the expected signer on
  // the agreement, the same rule the registration form applies.
  let contactName = '';
  {
    const { data: hh, error: hhError } = await supabase
      .from('households')
      .select('primary_contact_person_id')
      .eq('id', reg.household_id)
      .maybeSingle();
    if (hhError) throw new Error(`Household: ${hhError.message}`);
    if (hh?.primary_contact_person_id) {
      const { data: pc, error: pcError } = await supabase
        .from('people')
        .select('first_name, last_name')
        .eq('id', hh.primary_contact_person_id)
        .maybeSingle();
      if (pcError) throw new Error(`Primary contact: ${pcError.message}`);
      contactName = `${pc?.first_name ?? ''} ${pc?.last_name ?? ''}`.trim();
    }
  }

  const parts = (reg.registration_participants ?? []).filter((p) => p.status !== 'cancelled');

  const { data: schols, error: scholsError } = parts.length
    ? await supabase
        .from('scholarships')
        .select('registration_participant_id, requested_cents, granted_cents, status, family_statement')
        .in('registration_participant_id', parts.map((p) => p.id))
    : { data: [] };
  if (scholsError) throw new Error(`Scholarship requests: ${scholsError.message}`);
  const byPart = new Map((schols ?? []).map((s) => [s.registration_participant_id, s]));

  const rows = parts.map((p) => {
    const s = byPart.get(p.id);
    return {
      participantId: p.id,
      name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim() || 'Person',
      // Asked for 25 Aug: a card showing only a name and a fee does not say
      // who this person is on the registration, and a family with several
      // people has to guess.
      role: p.camp_role ?? null,
      // The fee is on participant_money (0114). null, never 0, when the row
      // is missing: the form then shows "—" rather than "Fee $0", which would
      // tell a family there is nothing to ask help with.
      feeCents: participantMoney(p, 'scholarship')?.fee_cents ?? null,
      requestedCents: s?.requested_cents ?? null,
      grantedCents: s?.granted_cents ?? 0,
      status: s?.status ?? null,
      statement: s?.family_statement ?? '',
    };
  });

  return (
    <section className="bg-neutral-50 py-12">
      <div className="container-site max-w-3xl mx-auto">
        <div className={TITLE_ROW}>
          <h1 className="text-3xl font-bold">Help with the fee</h1>
          <BackLink />
        </div>
        <p className="text-neutral-700 mt-2 mb-8">
          Luke 14 raises money so that cost is not the reason someone stays home. If the fee
          for {reg.events?.name ?? 'this event'} is difficult, please ask — it is an ordinary
          part of how camp works, and asking will not affect anyone&rsquo;s place.
        </p>

        <ScholarshipForm
          registrationId={reg.id}
          rows={rows}
          agreement={agreement}
          agreementSigned={agreementSigned}
          contactName={contactName}
          eventName={reg.events?.name ?? ''}
        />

        <p className="text-sm text-neutral-500 mt-8">
          Questions about paying? Email registration@luke14ministries.net or call the office.
        </p>

        <BackBar />
      </div>
    </section>
  );
}
