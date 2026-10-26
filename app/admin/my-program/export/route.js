// GET /admin/my-program/export/?grant=<programId>:<eventId> -- a program
// leader's own roster as a CSV (Lawrence, 26 Oct 2026: "need a way to export").
//
// The SAME rows and columns as the My Program page and nothing more: name,
// age at camp, role, buddy, and the flag words. Read only from the
// program_roster view (lib/programs.js), so allergy text, medication, notes,
// rooms and contact details cannot reach the file -- the view does not carry
// them. Who may ask: ../access.js.

import { getProgramRoster, programRosterRows, askAboutWords, buddyWords } from '@/lib/programs';
import { csvCell } from '@/lib/csv';
import { programForCaller } from '../access';

// "Children - Camp Celebrate 2027 - Week 2.csv". Characters Windows refuses
// in a file name become spaces; the plain filename= is the ASCII fallback and
// filename*= carries the real one.
function fileNames(program) {
  const base = `${program.programName} - ${program.eventName}`
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const ascii = base.replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '').trim() || 'program';
  const encoded = encodeURIComponent(`${base}.csv`).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `filename="${ascii}.csv"; filename*=UTF-8''${encoded}`;
}

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
    return new Response('The roster could not be read. Nothing was exported; please try again.', {
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
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; ${fileNames(program)}`,
      // A roster of disabled children's names: not for any shared cache.
      'Cache-Control': 'private, no-store',
    },
  });
}
