import { redirect } from 'next/navigation';
import BackLink from '@/components/BackLink';
import PrintButton from '@/components/PrintButton';
import { getProgramRoster, getProgramLeaders, programRosterRows, askAboutWords, buddyWords } from '@/lib/programs';
import { todayInMorristown } from '@/lib/events';
import { programForCaller } from '../access';
import FlagsNote from '../FlagsNote';

export const metadata = { title: 'My Program — print — Luke 14 Ministries' };

// A program leader's roster on paper, or as a PDF through the browser's own
// "Save as PDF" (Lawrence, 26 Oct 2026). No PDF library: the print dialog
// already makes one.
//
// The SAME table the My Program page shows, from the same program_roster
// view, plus what a sheet of paper needs to stand on its own: the program,
// the event and its dates, who leads it, and the "What the flags mean"
// sentence. No allergy text, medications, notes, rooms or contact details --
// the view does not carry them, and this page reads nothing else. Who may
// open it: ../access.js, the same gate as the CSV.
export default async function MyProgramPrintPage({ searchParams }) {
  const params = await searchParams;
  const gate = await programForCaller(typeof params?.grant === 'string' ? params.grant : '');
  if (!gate.program) {
    // A read that failed is an error page, not a quiet trip back.
    if (gate.status >= 500) throw new Error(gate.message);
    redirect('/admin/my-program/');
  }
  const program = gate.program;

  const [roster, leaders] = await Promise.all([
    getProgramRoster({ programId: program.programId, eventId: program.eventId }),
    getProgramLeaders({ programId: program.programId, eventId: program.eventId }),
  ]);
  const rows = programRosterRows(roster, program.startsOn);
  const needAsking = rows.filter((r) => r.allergies || r.support).length;
  const lead = leaders.find((l) => l.isLead) ?? null;
  const assistants = leaders.filter((l) => !l.isLead);
  const dates = [program.startsOn, program.endsOn].filter(Boolean).join(' – ');

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print:p-0 print:text-[12px]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <PrintButton label="Print / Save as PDF" />
        <BackLink
          href={`/admin/my-program/?grant=${encodeURIComponent(`${program.programId}:${program.eventId}`)}`}
          label="Back to My Program"
        />
      </div>
      <p className="mb-6 text-sm text-neutral-500 print:hidden">
        To make a PDF, choose “Save as PDF” as the printer in the print dialog.
      </p>

      <div className="border-b-2 border-neutral-800 pb-2">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Program roster</p>
        <h1 className="text-2xl font-bold">{program.programName}</h1>
        <p className="text-sm text-neutral-600">
          {program.eventName}
          {dates ? ` · ${dates}` : ''} · {rows.length} {rows.length === 1 ? 'person' : 'people'}
        </p>
        {leaders.length > 0 && (
          <p className="text-sm text-neutral-600">
            {/* Same words as the screen: head leader, then the leaders. */}
            Head leader: {lead ? lead.name : 'not named yet'}
            {assistants.length > 0 ? ` · Leaders: ${assistants.map((a) => a.name).join(', ')}` : ''}
          </p>
        )}
      </div>

      <FlagsNote needAsking={needAsking} className="mt-3 text-sm" />

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">
          Nobody has been placed in {program.programName} for {program.eventName} yet.
        </p>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left">
              <th className="py-1 pr-3 font-semibold">Name</th>
              <th className="py-1 pr-3 font-semibold">Age</th>
              <th className="py-1 pr-3 font-semibold">Role</th>
              <th className="py-1 pr-3 font-semibold">Buddy</th>
              <th className="py-1 font-semibold">Ask about</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="break-inside-avoid border-b border-neutral-200 align-top">
                <td className="py-1 pr-3">
                  <span className="font-medium">{r.name}</span>
                  {r.formalName && (
                    <span className="block text-xs text-neutral-500">on paperwork: {r.formalName}</span>
                  )}
                </td>
                <td className="py-1 pr-3">{r.age ?? '—'}</td>
                <td className="py-1 pr-3">{r.roleLabel}</td>
                <td className="py-1 pr-3">{buddyWords(r) || '—'}</td>
                <td className="py-1">{askAboutWords(r).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-6 border-t border-neutral-300 pt-2 text-xs text-neutral-500">
        Questions about a flag, or about anybody on this list, go to the camp coordinator rather
        than the family. Printed {todayInMorristown()} · Luke 14 Ministries.
      </p>
    </div>
  );
}
