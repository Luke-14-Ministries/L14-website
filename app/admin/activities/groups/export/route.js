// GET /admin/activities/groups/export/?activity=<id> — the groups of one
// activity as a CSV (0125). Activities read, like the board; RLS is the
// backstop. One row per person: Group, Name, Role, Paired with, Age, Under
// min age, Waiver on file. No support detail -- a spreadsheet travels
// further than a screen. People not yet in a group are listed with the
// group "(not placed)" so the file accounts for everyone going.

import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { csvCell } from '@/lib/csv';
import { todayInMorristown } from '@/lib/events';
import { GROUP_ROLE_LABEL } from '@/lib/activityGroups';
import { loadActivityGroups } from '../load';

export async function GET(request) {
  const staff = await getStaff();
  if (!can(staff, 'read:activities')) {
    return new Response('Not permitted', { status: 403 });
  }

  const activityId = new URL(request.url).searchParams.get('activity') || '';
  if (!activityId) return new Response('Which activity?', { status: 400 });

  const supabase = await createClient();
  let data;
  try {
    data = await loadActivityGroups(supabase, activityId);
  } catch (e) {
    console.error('activity groups export:', e.message);
    return new Response(`The groups could not be read: ${e.message}`, { status: 500 });
  }
  if (!data) return new Response('That activity was not found.', { status: 404 });

  const { activity, people, units, groups } = data;
  const row = (groupName, id) => {
    const p = people[id];
    return [
      groupName,
      p.name,
      GROUP_ROLE_LABEL[p.role] ?? p.role ?? '',
      p.pairedWithNames.join('; '),
      p.age ?? '',
      p.under ? 'yes' : '',
      // An activity with no waiver of either kind has nothing to be on file.
      p.waiver == null ? 'n/a' : p.waiver === 'on_file' ? 'yes' : p.waiver === 'checking' ? 'uploaded, not yet checked' : 'no',
    ];
  };

  const rows = [['Group', 'Name', 'Role', 'Paired with', 'Age', 'Under min age', 'Waiver on file']];
  for (const g of groups) {
    const here = new Set(g.memberIds);
    for (const u of units) for (const id of u) if (here.has(id)) rows.push(row(g.name, id));
  }
  for (const u of units) {
    for (const id of u) if (!people[id]?.groupId) rows.push(row('(not placed)', id));
  }

  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const slug = (activity.name || 'activity').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="groups-${slug}-${todayInMorristown()}.csv"`,
    },
  });
}
