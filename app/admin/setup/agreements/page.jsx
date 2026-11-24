import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { agreementText, eventDateRange, formatDay } from '@/lib/events';
import PrintSheetHeader from '@/components/PrintSheetHeader';
import EmptyState from '@/components/EmptyState';

export const metadata = { title: 'Agreements · Staff Admin' };

// The agreements one event asks families to sign, as a print sheet (23 Nov
// 2026 review, A4-20): the words exactly as families read them, {{event}}
// filled (agreementText), with each version and its date. Read-only, like the
// fold on Setup it comes from: a signature points at one exact version, so
// new wording is a new version, never an edit. Setup write, as the page.

// One agreement. Module level (CLAUDE.md: never a component inside one).
function AgreementBlock({ a }) {
  return (
    <section className="break-inside-avoid border-b border-neutral-300 py-4">
      <h2 className="text-lg font-bold">{a.title}</h2>
      <p className="text-xs text-neutral-600">
        Version {a.version}
        {a.createdOn ? ` · since ${formatDay(a.createdOn)}` : ''}
        {a.required ? '' : ' · optional'}
        {a.perPerson ? ' · signed for each person' : ' · signed once per family'}
      </p>
      {a.externalUrl ? (
        <p className="mt-2 text-sm">Signed on another site: {a.externalUrl}</p>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm">{a.text || 'No text on file.'}</p>
      )}
    </section>
  );
}

export default async function SetupAgreementsPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/setup/agreements/');
  if (!can(staff, 'write:setup')) redirect('/admin');

  const eventId = typeof params?.event === 'string' ? params.event : '';
  if (!eventId) redirect('/admin/setup');

  const supabase = await createClient();
  const [{ data: event, error: eventError }, { data: reqs, error: reqsError }] = await Promise.all([
    supabase.from('events').select('id, name, starts_on, ends_on').eq('id', eventId).maybeSingle(),
    supabase
      .from('agreement_requirements')
      .select('applies_to, is_required, agreements ( id, version, title, body, delivery, external_url, created_at )')
      .eq('event_id', eventId),
  ]);
  if (eventError) throw new Error(`Event: ${eventError.message}`);
  if (reqsError) throw new Error(`Agreements: ${reqsError.message}`);
  if (!event) redirect('/admin/setup');

  const list = (reqs ?? [])
    .filter((q) => q.agreements)
    .map((q) => ({
      id: q.agreements.id,
      title: q.agreements.title,
      version: q.agreements.version,
      createdOn: String(q.agreements.created_at ?? '').slice(0, 10),
      required: q.is_required !== false,
      perPerson: q.applies_to === 'participant',
      externalUrl: q.agreements.delivery === 'external_link' ? q.agreements.external_url : null,
      text: agreementText(q.agreements.body, event),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print-sheet print:text-[12px]">
      <PrintSheetHeader
        title="Agreements"
        back={{ href: `/admin/setup/#event-${event.id}`, label: 'Back to Setup' }}
        intro="What families sign for this event, word for word. Activity waivers are on each activity."
      />
      <h1 className="text-2xl font-bold">{event.name}</h1>
      <p className="mb-2 text-sm text-neutral-600">{eventDateRange(event.starts_on, event.ends_on)}</p>
      {list.length === 0 ? (
        <EmptyState>This event asks for no agreements.</EmptyState>
      ) : (
        list.map((a) => <AgreementBlock key={a.id} a={a} />)
      )}
    </div>
  );
}
