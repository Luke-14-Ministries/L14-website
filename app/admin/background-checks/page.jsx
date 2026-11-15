// Background Checks (Lawrence, 9 Nov 2026; its own item in the People section
// since 11 Nov 2026). Everyone 18 or older on an upcoming event is covered
// (0161/0162, lib/backgroundChecks.js). Since 15 Nov 2026 (Lawrence: "the
// volunteer and adult camper sections should look nearly identical") the page
// is: how to run a background check and how long one lasts, for everyone, then
// three cards built the same way (same filters, columns, pills and record):
//
//   1. Volunteers: a VolunteerBadge background check (0165; Checkr checks on
//      file count until they expire), sent from Background Screening.
//   2. Parents, siblings and caregivers: VolunteerBadge too (the board, 14 Nov
//      2026); a registry search under their row if they decline.
//   3. Adult campers: for now a search of the public sex-offender registry
//      (nsopw.gov), run from their row.
//
// Under 18 on the event's first day is not screened: counted, not listed.
// Someone who volunteers at any listed event is in card 1, because they need
// the full background check and a registry search doesn't count for them.

import Link from 'next/link';
import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { CHECK_TONE, clearancePill, isRegistrySearch } from '@/lib/format';
import { todayInMorristown } from '@/lib/events';
import { depositInByPerson } from '@/lib/screeningDeposit';
import { loadScreeningPeople, registryBucket, volunteerBucket, fullCheckCurrent } from '@/lib/backgroundChecks';
import { latestVbRequests } from '@/lib/screeningCandidates';
import { volunteerBadge, volunteerBadgeMode } from '@/lib/volunteerBadge';
import { VolunteerBadgeError } from '@/lib/volunteerBadgeApi';
import { creditPicture } from '@/lib/volunteerBadgeCredits';
import CheckLengthForm from './CheckLengthForm';
import RegistrySearchForm from './RegistrySearchForm';
import { RegistryQuickSearch } from './RegistryQueue';
import RecordFold from './RecordFold';
import { backgroundCheckWork } from '@/lib/backgroundCheckWork';
import ClearanceEditor from '@/components/ClearanceEditor';
import { loadClearanceRecords, vbSummary } from '@/lib/clearanceRecords';
import CheckCard from './CheckCard';
import CreditLine from './CreditLine';
import ResizableTable from '@/components/ResizableTable';

export const metadata = { title: 'Background Checks' };

const SOON_DAYS = 60;
const BASE = '/admin/background-checks/';

// One set of filters for all three cards (15 Nov 2026).
const FILTERS = [
  { key: '', label: 'All' },
  { key: 'missing', label: 'No background check on file' },
  { key: 'waiting', label: 'Waiting on the background check' },
  { key: 'expired', label: 'Out of date' },
  // In date, but not marked OK to serve yet: follow-up or no verdict
  // (Lawrence, 11 Nov 2026). Holds approval, so it is work, not "current".
  { key: 'decision', label: 'Needs a decision' },
  { key: 'not_permitted', label: 'Not permitted' },
  { key: 'soon', label: `Expiring within ${SOON_DAYS} days` },
  { key: 'current', label: 'Current' },
];

const ROLE_LABEL = {
  volunteer: 'Volunteer',
  camper: 'Camper',
  parent_guardian: 'Parent / guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
};

// Each card keeps its own filter in the URL: v= volunteers, f= parents,
// siblings and caregivers, c= adult campers.
const CARDS = [
  { key: 'volunteers', param: 'v' },
  { key: 'families', param: 'f' },
  { key: 'campers', param: 'c' },
];
function listHref(sel, anchor) {
  const q = new URLSearchParams();
  for (const { param } of CARDS) if (sel[param]) q.set(param, sel[param]);
  const str = q.toString();
  return `${BASE}${str ? `?${str}` : ''}${anchor ? `#${anchor}` : ''}`;
}

function fmtDob(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : 'unknown';
}

// 'YYYY-MM-DD' as "Jan 15, 2027", read as a calendar date (no time zone).
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function FilterPills({ filters, counts, current, hrefFor, label }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 text-sm">
      {filters.map((f) => (
        <Link
          key={f.key || 'all'}
          href={hrefFor(f.key)}
          aria-current={current === f.key ? 'page' : undefined}
          className={`rounded-full border px-3 py-1 ${
            current === f.key ? 'border-brand bg-brand-light font-semibold text-brand-dark' : 'border-neutral-300'
          }`}
        >
          {f.label} ({counts[f.key]})
        </Link>
      ))}
    </nav>
  );
}

// One outlined box style for the two boxes above the cards (Lawrence, 11 Nov
// 2026). CheckLengthForm uses the same classes.
const HOW_TO_BOX = 'rounded-lg border border-neutral-300 bg-white p-4';


function StatusPill({ pill }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${pill.cls}`} title={pill.title}>
      {pill.text}
    </span>
  );
}

function PersonLink({ row }) {
  return (
    <Link href={`/admin/people/${row.id}/`} className="font-medium text-brand underline">
      {row.name}
    </Link>
  );
}

export default async function BackgroundChecksPage({ searchParams }) {
  const staff = await getStaff();
  if (!staff) await bounceNonStaff(BASE);
  if (!can(staff, 'background_checks')) redirect('/admin/volunteers/?need=background_checks');

  const params = (await searchParams) ?? {};
  // r= was the old family/camper filter (the Review card linked ?r=due).
  const legacy = { due: 'missing', follow_up: 'decision' }[params.r] ?? params.r;
  const sel = Object.fromEntries(
    CARDS.map(({ param }) => {
      const want = params[param] ?? (param === 'v' ? '' : legacy) ?? '';
      return [param, FILTERS.some((f) => f.key === want) ? want : ''];
    })
  );
  const canWrite = can(staff, 'write:background_checks');
  const supabase = await createClient();
  const today = todayInMorristown();
  const soon = addDays(today, SOON_DAYS);

  const [{ data: setting, error: settingError }, { people, minors }] = await Promise.all([
    supabase.from('background_check_settings').select('interval_months, updated_at').maybeSingle(),
    loadScreeningPeople(supabase, today),
  ]);
  if (settingError) throw new Error(`Background check length: ${settingError.message}`);
  const months = setting?.interval_months ?? 12;
  const byId = new Map(people.map((e) => [e.person.id, e]));
  const personIds = [...byId.keys()];

  const [{ data: clearances, error: clearError }, depositIn, { count: onFileCount, error: countError }] =
    await Promise.all([
      personIds.length
        ? supabase
            .from('person_clearances')
            .select('person_id, background_check_on_file, background_check_date, expires_on, verdict, verdict_note, checkr_status, provider')
            .in('person_id', personIds)
        : Promise.resolve({ data: [], error: null }),
      // The deposit hold, per person, for every adult sent to VolunteerBadge
      // (volunteers and family adults: the board, 14 Nov 2026).
      depositInByPerson(supabase, personIds, { allRoles: true }),
      supabase
        .from('person_clearances')
        .select('person_id', { count: 'exact', head: true })
        .not('background_check_date', 'is', null),
    ]);
  if (clearError) throw new Error(`Background checks: ${clearError.message}`);
  if (countError) throw new Error(`Background checks on file: ${countError.message}`);
  const clearanceBy = new Map((clearances ?? []).map((c) => [c.person_id, c]));
  // Each adult's latest VolunteerBadge invite, in the site's mode (0165).
  const vbBy = await latestVbRequests(supabase, personIds, volunteerBadgeMode() === 'test');
  // The record itself, folded under each row for staff who can edit it
  // (Fable navigation review, 14 Nov 2026: recording by hand stays here).
  const records = canWrite ? await loadClearanceRecords(supabase, personIds) : new Map();

  const base = (id) => {
    const { person, events } = byId.get(id);
    return {
      id,
      name: `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || 'Unnamed',
      firstName: person.first_name ?? '',
      lastName: person.last_name ?? '',
      events,
      email: (person.email || person.households?.email || '').trim() || null,
      // No email of their own: the family may have registered without one
      // (allowed since 14 Nov 2026) and needs a word from staff.
      noOwnEmail: !(person.email || '').trim(),
    };
  };
  // The fold under a row: the record editor (components/ClearanceEditor.jsx).
  const recordFold = (x, cols) =>
    canWrite ? (
      <tr className="border-b border-neutral-100">
        <td colSpan={cols} className="pb-2">
          <RecordFold personId={x.id}>
            <ClearanceEditor
              personId={x.id}
              clearance={records.get(x.id) ?? null}
              vb={vbSummary(vbBy.get(x.id))}
              email={x.email}
              firstName={x.firstName}
              lastName={x.lastName}
              showVb={x.kind !== 'campers'}
            />
          </RecordFold>
        </td>
      </tr>
    ) : null;
  const byName = (a, b) => a.lastName.localeCompare(b.lastName) || a.name.localeCompare(b.name);

  // ---- Where each adult stands, in one vocabulary for all three cards ----
  // A registry search's words mapped onto the volunteer ones: due is no
  // background check on file (or out of date), follow-up needs a decision.
  const fromRegistry = (c) => {
    const b = registryBucket(c, today, soon);
    if (b === 'due') return c?.background_check_on_file && c.expires_on && c.expires_on < today ? 'expired' : 'missing';
    return b === 'follow_up' ? 'decision' : b;
  };
  const bucketFor = (kind, c, vb) => {
    if (kind === 'campers') return fromRegistry(c);
    const viaVb = volunteerBucket(c, today, soon, vb);
    // A family adult's registry search (the fallback) counts for them.
    if (kind === 'families' && isRegistrySearch(c)) {
      const viaSearch = fromRegistry(c);
      if (['current', 'soon', 'decision', 'not_permitted'].includes(viaSearch)) return viaSearch;
      if (viaVb === 'missing') return viaSearch;
    }
    return viaVb;
  };
  const rowFor = (id, kind) => {
    const c = clearanceBy.get(id) ?? null;
    const { person, roles } = byId.get(id);
    const registry = isRegistrySearch(c);
    // Adult campers aren't sent to VolunteerBadge (yet).
    const vb = kind === 'campers' ? null : vbBy.get(id) ?? null;
    const bucket = bucketFor(kind, c, vb);
    // A registry search never clears a volunteer (0161), so it shows no dates there.
    const shows = Boolean(c?.background_check_on_file) && (kind !== 'volunteers' || !registry);
    return {
      ...base(id),
      kind,
      dob: person.date_of_birth ?? null,
      place: [person.households?.city, person.households?.state].filter(Boolean).join(', '),
      roleLabel: [...roles].filter((x) => x !== 'volunteer_child').map((x) => ROLE_LABEL[x] ?? x).join(', '),
      checkDate: shows ? c?.background_check_date ?? null : null,
      expiresOn: shows ? c?.expires_on ?? null : null,
      pill: kind === 'volunteers' ? clearancePill(c, today) : clearancePill(c, today, { forRegistry: true }),
      bucket,
      // What VolunteerBadge is doing, while an invite is out or a result waits on staff.
      vbStatus: vb && !vb.confirmed_at ? vb.status : null,
      // Held from sending until their own share of the deposit is in (0157, 0169).
      heldForDeposit: kind !== 'campers' && (bucket === 'missing' || bucket === 'expired') && depositIn.get(id) === false,
      // What the registry form starts from, when a search is on file.
      initial: registry ? { date: c.background_check_date ?? '', verdict: c.verdict ?? '', note: c.verdict_note ?? '' } : null,
      // A current full background check covers them; no search is recorded over it.
      coveredByFullCheck: fullCheckCurrent(c, today),
      reason: kind === 'campers' && bucket === 'expired' && c?.expires_on ? `last search expired ${fmtDate(c.expires_on)}` : '',
    };
  };
  const others = personIds.filter((id) => !byId.get(id).volunteer);
  const rowsBy = {
    volunteers: personIds.filter((id) => byId.get(id).volunteer).map((id) => rowFor(id, 'volunteers')).sort(byName),
    families: others.filter((id) => !byId.get(id).roles.has('camper')).map((id) => rowFor(id, 'families')).sort(byName),
    campers: others.filter((id) => byId.get(id).roles.has('camper')).map((id) => rowFor(id, 'campers')).sort(byName),
  };

  // ---- VolunteerBadge, shown here as well as on Background screening
  // (Lawrence, 13 Nov 2026: the balance should be in view before anyone is
  // ready to send). Asked of VB each time; a failure is said, not hidden.
  const vbMode = volunteerBadgeMode();
  let vbCredits = null;
  let vbOutstanding = 0;
  let vbProblem = null;
  if (vbMode !== 'off') {
    try {
      ({ credits: vbCredits, outstanding: vbOutstanding } = await creditPicture(supabase, volunteerBadge()));
    } catch (err) {
      vbProblem = err instanceof VolunteerBadgeError ? err.message : err?.message ?? 'VolunteerBadge couldn’t be reached.';
    }
  }
  // Who an invite would go to now: no check, or one out of date, deposit in.
  // The same numbers as the nav badge (lib/backgroundCheckWork.js): who an
  // invite would go to now, who waits on the deposit, results waiting on
  // staff, and adult campers' registry searches due.
  const work = await backgroundCheckWork(supabase, { sandbox: volunteerBadgeMode() === 'test', today });
  const readyToInvite = work.ready;
  const heldCount = work.held;

  // ---- What each folded header says (Lawrence, 11 Nov 2026), the same
  // way for all three cards ----
  // In the same tones as the status pills (CHECK_TONE). Read here, not at
  // module level, so the import order of lib/format.js never matters.
  const RED = CHECK_TONE.hold;
  const AMBER = CHECK_TONE.todo;
  const QUIET = CHECK_TONE.na;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const factsFor = (rows, one, many, holdsApproval) => {
    const n = Object.fromEntries(FILTERS.map((f) => [f.key, f.key ? rows.filter((x) => x.bucket === f.key).length : rows.length]));
    // Red where it holds approval (volunteers), amber where it is a flag.
    const T = holdsApproval ? RED : AMBER;
    const work = n.missing + n.expired + n.decision + n.soon;
    return {
      n,
      work,
      summary: [
        plural(n[''], one, many),
        `${n.missing} no background check on file`,
        `${n.waiting} waiting on the background check`,
        `${n.expired} out of date`,
        `${n.decision} ${n.decision === 1 ? 'needs' : 'need'} a decision`,
        ...(n.not_permitted > 0 ? [`${n.not_permitted} not permitted`] : []),
        `${n.current + n.soon} current`,
      ].join(' · '),
      pills: [
        n.missing > 0 && { text: `${n.missing} no background check`, cls: T },
        n.expired > 0 && { text: `${n.expired} out of date`, cls: T },
        n.decision > 0 && { text: `${n.decision} ${n.decision === 1 ? 'needs' : 'need'} a decision`, cls: T },
        n.not_permitted > 0 && { text: `${n.not_permitted} not permitted`, cls: CHECK_TONE.blocked },
        n.soon > 0 && { text: `${n.soon} expiring soon`, cls: AMBER },
        work === 0 && n.not_permitted === 0 && n[''] > 0 && { text: 'Nothing due', cls: QUIET },
      ].filter(Boolean),
    };
  };
  const facts = {
    volunteers: factsFor(rowsBy.volunteers, 'volunteer', 'volunteers', true),
    families: factsFor(rowsBy.families, 'adult', 'adults', false),
    campers: factsFor(rowsBy.campers, 'adult camper', 'adult campers', false),
  };

  // One status cell for every card: the pill, then what is happening or what to do.
  const chip = (cls) => `whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`;
  const statusCell = (x) => {
    const due = x.bucket === 'missing' || x.bucket === 'expired';
    const viaVb = x.kind !== 'campers';
    return (
      <>
        <span className="flex flex-wrap gap-1">
          <StatusPill pill={x.pill} />
          {x.bucket === 'waiting' && (
            <span className={chip(CHECK_TONE.waiting)}>
              {x.vbStatus ? 'Waiting on VolunteerBadge' : 'Waiting on an earlier background check order'}
            </span>
          )}
          {x.bucket === 'decision' && (x.vbStatus === 'clear' || x.vbStatus === 'consider') && (
            <Link
              href="/admin/background-checks/screening/"
              className={`${chip(x.vbStatus === 'clear' ? CHECK_TONE.done : CHECK_TONE.hold)} underline`}
            >
              {x.vbStatus === 'clear' ? 'VolunteerBadge: clear, confirm on Background Screening →' : 'VolunteerBadge: needs review →'}
            </Link>
          )}
          {x.bucket === 'soon' && <span className={chip(CHECK_TONE.todo)}>Expires soon</span>}
          {x.heldForDeposit && (
            <span className={chip(CHECK_TONE.na)} title="Not sent until their own share of the deposit is paid, waived or covered by a scholarship.">
              Waiting on the deposit
            </span>
          )}
          {viaVb && due && x.noOwnEmail && (
            <span
              className={chip(CHECK_TONE.todo)}
              title="No email of their own, so no VolunteerBadge invite can be sent. Write to the family: they add one on their registration, or you agree another way and record it under Background check record."
            >
              No email of their own
            </span>
          )}
        </span>
        {viaVb && due && !x.coveredByFullCheck && !x.heldForDeposit && !x.noOwnEmail && (
          <Link href="/admin/background-checks/screening/" className="mt-1 block text-xs font-semibold text-brand underline">
            Send a VolunteerBadge invite →
          </Link>
        )}
        {/* Adult campers: the registry search, run from the row. */}
        {canWrite &&
          x.kind === 'campers' &&
          !x.coveredByFullCheck &&
          (due ? (
            <RegistryQuickSearch row={x} today={today} />
          ) : (
            <RegistrySearchForm personId={x.id} name={x.name} today={today} initial={x.initial} />
          ))}
        {/* The registry search, kept as the fallback for a family adult who
            declines VolunteerBadge (the board, 14 Nov 2026). */}
        {canWrite && x.kind === 'families' && !x.coveredByFullCheck && (
          <details className="mt-1 text-xs" open={Boolean(x.initial)}>
            <summary className="cursor-pointer text-neutral-500">Use a registry search instead (if they decline VolunteerBadge)</summary>
            <RegistrySearchForm personId={x.id} name={x.name} today={today} initial={x.initial} />
          </details>
        )}
      </>
    );
  };

  // One table for every card, one set of adjustable widths shared by all
  // three so their columns line up (Lawrence, 15 Nov 2026).
  const table = (rows) => (
    <div className="mt-4 overflow-x-auto">
      <ResizableTable storageKey="background-checks-columns" defaults={[190, 110, 230, 125, 125, 380]}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-2 pr-3">Name</th>
            <th className="py-2 pr-3">Role</th>
            <th className="py-2 pr-3">Event</th>
            <th className="py-2 pr-3">Date checked</th>
            <th className="py-2 pr-3">Expires</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <Fragment key={x.id}>
              <tr className={`${canWrite ? '' : 'border-b border-neutral-100 '}align-top`}>
                <td className="py-2 pr-3">
                  <PersonLink row={x} />
                  {/* What a registry result is checked against. */}
                  {x.kind === 'campers' && (
                    <span className="block text-xs text-neutral-500">
                      Born {fmtDob(x.dob)}
                      {x.place ? ` · ${x.place}` : ''}
                      {x.reason ? ` · ${x.reason}` : ''}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-neutral-600">{x.roleLabel}</td>
                <td className="py-2 pr-3 text-neutral-600">{x.events.join(' · ')}</td>
                <td className="whitespace-nowrap py-2 pr-3">{fmtDate(x.checkDate) || '—'}</td>
                <td className={`whitespace-nowrap py-2 pr-3 ${x.bucket === 'expired' ? 'font-semibold text-red-800' : ''}`}>
                  {fmtDate(x.expiresOn) || '—'}
                </td>
                <td className="py-2">{statusCell(x)}</td>
              </tr>
              {recordFold(x, 6)}
            </Fragment>
          ))}
        </tbody>
      </table>
      </ResizableTable>
    </div>
  );

  const screeningLink = (
    <Link href="/admin/background-checks/screening/" className="font-semibold text-brand underline">
      Background Screening
    </Link>
  );
  const CARD_TEXT = {
    volunteers: {
      title: 'Volunteers',
      label: 'Volunteers to show',
      empty: 'No adult volunteers on upcoming events.',
      intro: (
        <>
          {plural(rowsBy.volunteers.length, 'adult volunteer', 'adult volunteers')} on upcoming events. Background check:
          VolunteerBadge, sent from {screeningLink}. A volunteer can&rsquo;t be approved without a current background
          check marked OK to serve.
        </>
      ),
    },
    families: {
      title: 'Parents, siblings and caregivers',
      label: 'Parents, siblings and caregivers to show',
      empty: 'No parents, siblings or caregivers 18 or older on upcoming events.',
      intro: (
        <>
          {plural(rowsBy.families.length, 'adult', 'adults')} on upcoming events who aren&rsquo;t volunteers or campers.
          Background check: VolunteerBadge, sent from {screeningLink}; if someone declines, a registry search instead,
          under their row. A missing background check is a flag on their registration, not a hold.{' '}
          <strong>Not permitted</strong> holds approval.
        </>
      ),
    },
    campers: {
      title: 'Adult campers',
      label: 'Adult campers to show',
      empty: 'No campers 18 or older on upcoming events.',
      intro: (
        <>
          {plural(rowsBy.campers.length, 'camper', 'campers')} 18 or older on upcoming events. Background check, for now:
          a search of the public sex-offender registry, run from their row. <strong>Copy last name and search</strong>{' '}
          opens{' '}
          <a href="https://www.nsopw.gov/" target="_blank" rel="noopener noreferrer" className="underline">
            nsopw.gov
          </a>{' '}
          with the last name on your clipboard; check the date of birth and place against any result, then press{' '}
          <strong>No match</strong> or <strong>Possible match</strong>. NSOPW doesn&rsquo;t allow automated searching,
          so a person runs each one. A missing search is a flag on their registration, not a hold.{' '}
          <strong>Not permitted</strong> holds approval.
        </>
      ),
    },
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
        <h2 className="text-xl font-bold">Background Checks</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Everyone 18 or older on an upcoming event gets a background check (the board, 14 Nov 2026), in three groups:{' '}
          <a href="#volunteers" className="font-semibold text-brand underline">
            volunteers
          </a>
          ,{' '}
          <a href="#families" className="font-semibold text-brand underline">
            parents, siblings and caregivers
          </a>{' '}
          and{' '}
          <a href="#campers" className="font-semibold text-brand underline">
            adult campers
          </a>
          . Age is counted on the first day of camp.
          {minors > 0 && ` ${minors} under 18 ${minors === 1 ? 'is' : 'are'} not screened and not listed.`}
        </p>
      </div>

      {/* For everyone, above the three cards (Lawrence, 15 Nov 2026). */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className={HOW_TO_BOX}>
          <h3 className="font-bold">How to run a background check</h3>
          {/* The VolunteerBadge balance, in view before anyone is ready. */}
          <p className="mt-1 text-sm text-neutral-700">
            <CreditLine mode={vbMode} credits={vbCredits} outstanding={vbOutstanding} problem={vbProblem} />
          </p>
          <p className="mt-2 text-sm text-neutral-700">
            {/* The counts stand out like the credits (Lawrence, 14 Nov 2026). */}
            {readyToInvite > 0 ? (
              <strong className="text-red-700">
                {readyToInvite} {readyToInvite === 1 ? 'adult is' : 'adults are'} ready for a VolunteerBadge invite
              </strong>
            ) : (
              'Nobody is ready for a VolunteerBadge invite right now'
            )}
            {heldCount > 0 && (
              <>
                {' '}(<strong className="text-amber-700">{heldCount} more waiting on a deposit</strong>)
              </>
            )}
            {work.results > 0 && (
              <>
                {', '}
                <strong className="text-amber-700">
                  {work.results} VolunteerBadge {work.results === 1 ? 'result' : 'results'} to confirm
                </strong>
              </>
            )}
            {work.registry > 0 && (
              <>
                {', '}
                <strong className="text-amber-700">
                  {work.registry} adult {work.registry === 1 ? 'camper’s' : 'campers’'} registry{' '}
                  {work.registry === 1 ? 'search' : 'searches'} due
                </strong>
              </>
            )}
            .
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-700">
            <li>
              <strong>Volunteers</strong> and <strong>parents, siblings and caregivers</strong>: VolunteerBadge.
              Background Screening lists who can be sent and shows the credits; nothing goes until you press Send.
              Results come back there.
            </li>
            <li>
              <strong>Adult campers</strong>, for now: a registry search, run from their row below.
            </li>
            <li>
              A background check done another way (on paper, or straight in VolunteerBadge) is recorded by hand: open{' '}
              <strong>Background check record</strong> under the person&rsquo;s row.
            </li>
          </ul>
          {/* Named for both halves of that page (Lawrence, 15 Nov 2026). */}
          <Link href="/admin/background-checks/screening/" className="btn-primary mt-3 inline-block py-2!">
            Background Screening: send invites, see results →
          </Link>
        </div>
        <CheckLengthForm months={months} onFile={onFileCount ?? 0} canEdit={canWrite} />
      </div>

      {CARDS.map(({ key, param }) => {
        const text = CARD_TEXT[key];
        const f = facts[key];
        const rows = rowsBy[key];
        const shown = sel[param] ? rows.filter((x) => x.bucket === sel[param]) : rows;
        return (
          <CheckCard
            key={key}
            id={key}
            // The Review card and old bookmarks point at #registry.
            aliases={key === 'families' ? ['registry'] : []}
            title={text.title}
            summary={f.summary}
            pills={f.pills}
            defaultOpen={f.work > 0 || Boolean(sel[param])}
          >
            <p className="text-sm text-neutral-600">{text.intro}</p>
            <div className="rounded-lg border border-neutral-200 bg-white p-4">
              <FilterPills
                label={text.label}
                filters={FILTERS}
                counts={f.n}
                current={sel[param]}
                hrefFor={(k) => listHref({ ...sel, [param]: k }, key)}
              />
              {shown.length === 0 ? (
                <p className="mt-4 text-sm text-neutral-500">{rows.length === 0 ? text.empty : 'Nobody in this list.'}</p>
              ) : (
                table(shown)
              )}
            </div>
          </CheckCard>
        );
      })}
    </div>
  );
}
