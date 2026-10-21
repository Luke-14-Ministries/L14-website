// GET /admin/exports/rosters — the full roster as a CSV download.
// Registrar-gated; RLS is the backstop. Data is never trapped in the app.

import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { csvCell } from '@/lib/csv';
import { todayInMorristown } from '@/lib/events';

// Quoting and spreadsheet-formula safety: lib/csv.js.
const esc = csvCell;

export async function GET(request) {
  const staff = await getStaff();
  if (!can(staff, 'read:registration')) {
    return new Response('Not permitted', { status: 403 });
  }

  // Filters mirror the on-screen roster browser, so the download always
  // matches what the person was looking at.
  const url = new URL(request.url);
  const fEvent = url.searchParams.get('event') || '';
  const fRole = url.searchParams.get('role') || '';
  const fStatus = url.searchParams.get('status') || '';

  const supabase = await createClient();
  const [regRes, consentRes, sigRes] = await Promise.all([
    supabase
      .from('registrations')
      .select(
        `id, event_id, family_notes, events ( name ),
         households ( display_name, email, phone, how_did_you_hear,
                      address_line1, city, state, postal_code ),
         registration_participants ( camp_role, status, submitted_at, created_at, checked_in_at,
           tshirt_size, first_time_attending,
           participant_money ( fee_cents ),
           people ( id, first_name, last_name, date_of_birth, gender ) )`
      ),
    supabase.from('person_current_consents').select('person_id, kind, granted'),
    supabase.from('agreement_signatures').select('registration_id, signed_at'),
  ]);
  // Never an empty file that looks like "no registrations" (CLAUDE.md: never
  // turn a query error into an empty list; audit L9).
  const failed = regRes.error ?? consentRes.error ?? sigRes.error;
  if (failed) {
    console.error('rosters export:', failed.message);
    return new Response('The roster could not be read. Nothing was exported; please try again.', { status: 500 });
  }
  const regs = regRes.data;
  const consents = consentRes.data;
  const sigs = sigRes.data;

  // Dates on the ministry's calendar, not UTC (an evening signature is not
  // tomorrow's).
  const day = (ts) => (ts ? todayInMorristown(Date.parse(ts)) : '');

  const consentOf = new Map();
  for (const c of consents ?? []) consentOf.set(`${c.person_id}:${c.kind}`, c.granted);

  // Earliest signature on a registration is the date the family signed.
  const signedOn = new Map();
  for (const s of sigs ?? []) {
    if (!s.registration_id) continue;
    const prev = signedOn.get(s.registration_id);
    if (!prev || s.signed_at < prev) signedOn.set(s.registration_id, s.signed_at);
  }

  // Blank vs "no" matters here as much as on screen: an empty cell means we
  // never asked. A spreadsheet that rendered both as "no" would be worse than
  // not exporting the column at all.
  const yn = (v) => (v === true ? 'yes' : v === false ? 'no' : '');

  const rows = [
    // Address columns are here because the household now stores the parts
    // separately (0036). One CSV is a mailing list, a roster, and a permissions
    // audit -- which is the point of exporting at all.
    ['Event', 'Household', 'Email', 'Phone', 'Street', 'City', 'State', 'ZIP',
     'First name', 'Last name', 'Date of birth',
     'Sex', 'Role', 'Status', 'T-shirt', 'First time', 'Photos OK', 'In directory',
     'Agreements signed', 'How they heard', 'Note from family', 'Fee', 'Submitted', 'Checked in'],
  ];
  for (const r of regs ?? []) {
    if (fEvent && r.event_id !== fEvent) continue;
    for (const p of r.registration_participants ?? []) {
      if (fRole && p.camp_role !== fRole) continue;
      if (fStatus && p.status !== fStatus) continue;
      rows.push([
        r.events?.name ?? '',
        r.households?.display_name ?? '',
        r.households?.email ?? '',
        r.households?.phone ?? '',
        r.households?.address_line1 ?? '',
        r.households?.city ?? '',
        r.households?.state ?? '',
        r.households?.postal_code ?? '',
        p.people?.first_name ?? '',
        p.people?.last_name ?? '',
        p.people?.date_of_birth ?? '',
        p.people?.gender ?? '',
        p.camp_role ?? '',
        p.status ?? '',
        p.tshirt_size ?? '',
        yn(p.first_time_attending),
        yn(p.people?.id ? consentOf.get(`${p.people.id}:media`) : undefined),
        yn(p.people?.id ? consentOf.get(`${p.people.id}:directory`) : undefined),
        day(signedOn.get(r.id)),
        r.households?.how_did_you_hear ?? '',
        r.family_notes ?? '',
        // The fee comes from participant_money (0114), which the database
        // shows only to Payments readers. This export is Registration-gated,
        // so for anyone else the embed is null and the cell is left blank --
        // the same "we cannot say" an empty consent cell means above, and
        // never 0.00, which a spreadsheet would add up as a free place.
        p.participant_money ? ((p.participant_money.fee_cents ?? 0) / 100).toFixed(2) : '',
        day(p.submitted_at ?? p.created_at),
        p.checked_in_at
          ? new Date(p.checked_in_at).toLocaleString('en-US', {
              timeZone: 'America/New_York',
              month: 'numeric',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : '',
      ]);
    }
  }

  // \ufeff is the UTF-8 byte-order mark. Without it Excel guesses the wrong
  // encoding and renders em-dashes as "â€"" gibberish.
  const csv = '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="luke14-rosters-${todayInMorristown()}.csv"`,
    },
  });
}
