// GET /admin/buddies/export?event=<id> — every buddy pairing for one event as
// a CSV download (asked for 14 Oct 2026). Coordinator-gated, like the board;
// RLS is the backstop. Names, roles, household and the clearance word only —
// no support notes, because a spreadsheet travels further than a screen.

import { getStaff, can } from '@/lib/staff';
import { clearancePill } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request) {
  const staff = await getStaff();
  if (!can(staff, 'read:buddies')) {
    return new Response('Not permitted', { status: 403 });
  }

  const url = new URL(request.url);
  const eventId = url.searchParams.get('event') || '';
  if (!eventId) return new Response('Which event?', { status: 400 });

  const supabase = await createClient();
  const [{ data: event }, { data: assignments }, { data: participants }] = await Promise.all([
    supabase.from('events').select('id, name, starts_on').eq('id', eventId).maybeSingle(),
    supabase
      .from('buddy_assignments')
      .select('id, camper_participant_id, buddy_participant_id, note, started_at')
      .eq('event_id', eventId)
      .is('ended_at', null),
    supabase
      .from('registration_participants')
      .select(
        `id, camp_role, status,
         people ( id, first_name, last_name, preferred_name, date_of_birth ),
         registrations!inner ( event_id, households ( display_name ) )`
      )
      .eq('registrations.event_id', eventId)
      .neq('status', 'cancelled'),
  ]);

  const byId = new Map((participants ?? []).map((p) => [p.id, p]));
  const volunteerPersonIds = (participants ?? [])
    .filter((p) => p.camp_role === 'volunteer')
    .map((p) => p.people?.id)
    .filter(Boolean);
  // clearance_status (0091): on file, current, verdict -- the words the
  // board shows, so the sheet and the screen cannot disagree.
  const { data: clearances } = volunteerPersonIds.length
    ? await supabase
        .from('clearance_status')
        .select('person_id, on_file, expires_on, is_current, verdict')
        .in('person_id', volunteerPersonIds)
    : { data: [] };
  const clearanceWord = new Map((clearances ?? []).map((c) => [c.person_id, clearancePill(c).text]));

  const name = (p) =>
    p ? `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim() : '';

  const rows = [
    [
      'Event',
      'Camper',
      'Camper goes by',
      'Camper role',
      'Camper household',
      'Buddy',
      'Buddy household',
      'Buddy background check',
      'Paired since',
      'Note',
    ],
  ];
  const sorted = [...(assignments ?? [])].sort((a, b) =>
    name(byId.get(a.camper_participant_id)).localeCompare(name(byId.get(b.camper_participant_id)))
  );
  for (const a of sorted) {
    const c = byId.get(a.camper_participant_id);
    const v = byId.get(a.buddy_participant_id);
    rows.push([
      event?.name ?? '',
      name(c),
      c?.people?.preferred_name ?? '',
      c?.camp_role ?? '',
      c?.registrations?.households?.display_name ?? '',
      name(v),
      v?.registrations?.households?.display_name ?? '',
      v ? clearanceWord.get(v.people?.id) ?? 'no check on file' : '',
      a.started_at ? String(a.started_at).slice(0, 10) : '',
      a.note ?? '',
    ]);
  }

  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = (event?.name ?? 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="buddies-${slug}-${stamp}.csv"`,
    },
  });
}
