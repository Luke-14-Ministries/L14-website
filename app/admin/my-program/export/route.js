// GET /admin/my-program/export/?grant=<programId>:<eventId> -- a program
// leader's own roster as a CSV (Lawrence, 26 Oct 2026: "need a way to export").
//
// The SAME rows and columns as the My Program page and nothing more: name,
// age at camp, role, buddy, and the flag words. Read only from the
// program_roster view (lib/programs.js), so allergy text, medication, notes,
// rooms and contact details cannot reach the file -- the view does not carry
// them. Who may ask: ../access.js.

import { getProgramRoster, programRosterRows, askAboutWords, buddyWords } from '@/lib/programs';
import { csvCell, csvResponse, logExport } from '@/lib/csv';
import { createClient } from '@/lib/supabase/server';
import { programForCaller } from '../access';

// "Children - Camp Celebrate 2027 - Week 2.csv": csvResponse() (lib/csv.js)
// makes the Windows-safe name and its plain-ASCII fallback, the way this
// route did on its own until 23 Nov 2026.

export async function GET(request) {
  const url = new URL(request.url);
  const gate = await programForCaller(url.searchParams.get('grant') || '');
  if (!gate.program) return new Response(gate.message, { status: gate.status });
  const program = gate.program;

  let roster;
  try {
    roster = await getProgramRoster({ programId: program.programId, eventId: program.eventId });
  } catch {
    // Never an empty file that looks like "nobody in this program".
    return new Response('The roster could not be read. Nothing was exported. Please try again.', {
      status: 500,
    });
  }

  const rows = [['Name', 'Age (at camp)', 'Role', 'Buddy', 'Ask about']];
  for (const r of programRosterRows(roster, program.startsOn)) {
    rows.push([
      r.formalName ? `${r.name} (on paperwork: ${r.formalName})` : r.name,
      r.age ?? '',
      r.roleLabel,
      buddyWords(r),
      askAboutWords(r).join('; '),
    ]);
  }

  // ﻿: the UTF-8 byte-order mark, so Excel reads the em-dash correctly.
  const csv = '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  // A roster of disabled children's names: csvResponse keeps it out of any
  // shared cache.
  await logExport(await createClient(), 'program_roster', { program: program.programId, event: program.eventId });
  return csvResponse(csv, `${program.programName} - ${program.eventName}.csv`);
}
