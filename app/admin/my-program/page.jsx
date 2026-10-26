import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/staff';
import {
  getProgramLeadership,
  getProgramRoster,
  getProgramLeaders,
  programRosterRows,
} from '@/lib/programs';
import FlagsNote from './FlagsNote';
import ProgramRosterTable from './ProgramRosterTable';

export const metadata = { title: 'My Program — Luke 14 Ministries' };

// The program leader's whole view of the system: who is in their program.
//
// It is mostly a list, and that is the design rather than a first draft. A
// leader is here to know who they have got, who is buddied with whom, and who
// they need to ask the coordinator about before Monday morning. Everything
// else -- the medical detail, the payments, the other programs -- belongs to
// people whose job it is.
//
// WHAT IS NOT ON THIS PAGE, and why (see migration 0061):
//   * No allergy detail, no medications, no behaviour notes. A flag says
//     "ask"; the coordinator holds the answer. A leader who needs the detail
//     -- a nurse, a one-to-one carer -- is granted it separately and it
//     expires by itself.
//   * No room or cabin. A program leader does not need to know where a family
//     sleeps.
//   * No edit controls at all. Moving a person between programs is a
//     coordinator's decision, so that the roster is always the single answer
//     to "where is this child meant to be?"
export default async function MyProgramPage({ searchParams }) {
  const params = await searchParams;
  const [staff, leaderships] = await Promise.all([getStaff(), getProgramLeadership()]);

  // Staff who lead nothing land here from a stray link; send them to the
  // portal that is actually theirs.
  if (!leaderships.length) {
    if (staff) redirect('/admin/programs');
    redirect('/admin');
  }

  const selectedKey = params?.grant || `${leaderships[0].programId}:${leaderships[0].eventId}`;
  const current =
    leaderships.find((l) => `${l.programId}:${l.eventId}` === selectedKey) ?? leaderships[0];

  const [roster, leaders] = await Promise.all([
    getProgramRoster({ programId: current.programId, eventId: current.eventId }),
    getProgramLeaders({ programId: current.programId, eventId: current.eventId }),
  ]);
  const lead = leaders.find((l) => l.isLead) ?? null;
  // The other leaders, named after the head leader (all of them if none is).
  const assistants = leaders.filter((l) => !l.isLead);

  // Built in lib/programs.js so the CSV and the print view show the same rows.
  const rows = programRosterRows(roster, current.startsOn);
  const needAsking = rows.filter((r) => r.allergies || r.support).length;
  const grant = encodeURIComponent(`${current.programId}:${current.eventId}`);

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">{current.programName}</h2>
      <p className="text-sm text-neutral-500 mb-4">
        {current.eventName}
        {current.startsOn ? ` · from ${current.startsOn}` : ''} — {rows.length}{' '}
        {rows.length === 1 ? 'person' : 'people'} in your program.
      </p>

      {/* Who else leads this program, head leader first. Everyone with a
          program_leaders grant is a LEADER; the one marked is_lead (0071) is
          the HEAD LEADER -- a label, not a permission (Lawrence, 26 Oct 2026:
          "lead" beside "Program Leader" read as two different things). This
          line is so each knows the others, and "who is in charge?" has one
          answer. */}
      {leaders.length > 0 && (
        <p className="-mt-3 mb-4 text-sm text-neutral-600">
          Head leader: {lead ? <strong>{lead.name}</strong> : 'not named yet'}
          {assistants.length > 0 && <> · Leaders: {assistants.map((a) => a.name).join(', ')}</>}
        </p>
      )}

      {leaderships.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {leaderships.map((l) => {
            const key = `${l.programId}:${l.eventId}`;
            const active = key === `${current.programId}:${current.eventId}`;
            return (
              <Link
                key={l.id}
                href={`/admin/my-program?grant=${encodeURIComponent(key)}`}
                className={`rounded-full border px-3 py-1 text-sm ${
                  active
                    ? 'border-brand bg-brand-light font-semibold text-brand-dark'
                    : 'border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                {l.programName} · {l.eventName}
              </Link>
            );
          })}
        </div>
      )}

      <FlagsNote
        needAsking={needAsking}
        className="mb-5 rounded-sm border border-brand/30 bg-brand-light/50 px-4 py-3 text-sm"
      />

      {/* Export (Lawrence, 26 Oct 2026). Both carry exactly this table and
          nothing more; see export/route.js and print/page.jsx. Plain links:
          the CSV is a download, the print view a page of its own. */}
      {rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <a href={`/admin/my-program/export/?grant=${grant}`} className="btn-outline py-1.5! text-sm">
            Download CSV
          </a>
          <Link href={`/admin/my-program/print/?grant=${grant}`} className="btn-outline py-1.5! text-sm">
            Print / PDF
          </Link>
          <span className="text-xs text-neutral-500">
            The CSV and the print view hold the whole list, not just the rows a search is showing.
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-sm border border-neutral-200 bg-white p-6 text-neutral-500">
          Nobody has been placed in {current.programName} for {current.eventName} yet. This page
          fills up as the coordinator assigns people — there is nothing for you to do here.
        </p>
      ) : (
        <ProgramRosterTable rows={rows} />
      )}

      <p className="mt-4 text-xs text-neutral-500">
        Something wrong on this list — somebody missing, somebody who should not be here, a name
        spelled wrong? Tell the camp coordinator rather than the family. Changes are made in one
        place so that the roster and this page never disagree.
      </p>
    </div>
  );
}
