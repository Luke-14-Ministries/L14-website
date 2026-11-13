// Background Checks (Lawrence, 9 Nov 2026; its own item in the People section
// since 11 Nov 2026). Everyone 18 or older on an upcoming event is covered by
// one of two routes (0161/0162, lib/backgroundChecks.js), and the page is in
// two parts to match:
//
//   1. Volunteers: the full background check (VolunteerBadge since 0165;
//      Checkr checks on file count until they expire). Sending invites is
//      Background screening, linked from here; a check entered by hand goes on the
//      Volunteers page; how long a check lasts is set here (0158).
//   2. Campers & families: every other adult (camper, parent/guardian,
//      sibling, caregiver) gets a search of the public
//      sex-offender registry at nsopw.gov, recorded here, or is covered by a
//      current full check. A missing search is a flag; "Not permitted" holds
//      approval (0162).
//
// Under 18 on the event's first day is not screened: counted, not listed.
// Someone who volunteers at any listed event is in part 1, because they need
// the full check and a registry search doesn't count for them.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { CHECK_TONE, clearancePill, isRegistrySearch } from '@/lib/format';
import { todayInMorristown } from '@/lib/events';
import { depositInByPerson } from '@/lib/screeningDeposit';
import { loadScreeningPeople, registryBucket, volunteerBucket, fullCheckCurrent } from '@/lib/backgroundChecks';
import { latestVbRequests } from '@/lib/screeningCandidates';
import { volunteerBadgeMode } from '@/lib/volunteerBadge';
import CheckLengthForm from './CheckLengthForm';
import RegistrySearchForm from './RegistrySearchForm';
import RegistryQueue from './RegistryQueue';
import CheckCard from './CheckCard';

export const metadata = { title: 'Background Checks' };

const SOON_DAYS = 60;
const BASE = '/admin/volunteers/background-checks/';

const VOLUNTEER_FILTERS = [
  { key: '', label: 'All' },
  { key: 'missing', label: 'No check on file' },
  { key: 'waiting', label: 'Waiting on the check' },
  { key: 'expired', label: 'Out of date' },
  // In date, but not marked OK to serve yet: follow-up or no verdict
  // (Lawrence, 11 Nov 2026). Holds approval, so it is work, not "current".
  { key: 'decision', label: 'Needs a decision' },
  { key: 'not_permitted', label: 'Not permitted' },
  { key: 'soon', label: `Expiring within ${SOON_DAYS} days` },
  { key: 'current', label: 'Current' },
];

const REGISTRY_FILTERS = [
  { key: '', label: 'All' },
  { key: 'due', label: 'Search due' },
  { key: 'follow_up', label: 'Needs follow-up' },
  { key: 'not_permitted', label: 'Not permitted' },
  { key: 'soon', label: `Expiring within ${SOON_DAYS} days` },
  { key: 'current', label: 'Current' },
];

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent / guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
};

// Both parts keep their own filter in the URL: v= for volunteers, r= for the
// registry part.
function listHref(v, r, anchor) {
  const q = new URLSearchParams();
  if (v) q.set('v', v);
  if (r) q.set('r', r);
  const s = q.toString();
  return `${BASE}${s ? `?${s}` : ''}${anchor ? `#${anchor}` : ''}`;
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

// One outlined box style for "where and how to do this check" in both parts
// (Lawrence, 11 Nov 2026: both cards laid out the same way). CheckLengthForm
// and RegistryQueue use the same classes.
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
  if (!can(staff, 'background_checks')) redirect('/admin/volunteers');

  const { v = '', r = '' } = (await searchParams) ?? {};
  const vFilter = VOLUNTEER_FILTERS.some((f) => f.key === v) ? v : '';
  const rFilter = REGISTRY_FILTERS.some((f) => f.key === r) ? r : '';
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
  const volunteerIds = personIds.filter((id) => byId.get(id).volunteer);

  const [{ data: clearances, error: clearError }, depositIn, { count: onFileCount, error: countError }] =
    await Promise.all([
      personIds.length
        ? supabase
            .from('person_clearances')
            .select('person_id, background_check_on_file, background_check_date, expires_on, verdict, verdict_note, checkr_status, provider')
            .in('person_id', personIds)
        : Promise.resolve({ data: [], error: null }),
      // The deposit hold is a Checkr-ordering rule: volunteers only.
      depositInByPerson(supabase, volunteerIds),
      supabase
        .from('person_clearances')
        .select('person_id', { count: 'exact', head: true })
        .not('background_check_date', 'is', null),
    ]);
  if (clearError) throw new Error(`Background checks: ${clearError.message}`);
  if (countError) throw new Error(`Background checks on file: ${countError.message}`);
  const clearanceBy = new Map((clearances ?? []).map((c) => [c.person_id, c]));
  // Each volunteer's latest VolunteerBadge invite, in the site's mode (0165).
  const vbBy = await latestVbRequests(supabase, volunteerIds, volunteerBadgeMode() === 'test');

  const base = (id) => {
    const { person, events } = byId.get(id);
    return {
      id,
      name: `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || 'Unnamed',
      lastName: person.last_name ?? '',
      events,
    };
  };
  const byName = (a, b) => a.lastName.localeCompare(b.lastName) || a.name.localeCompare(b.name);

  // ---- Part 1: volunteers ----
  const volunteerRows = volunteerIds
    .map((id) => {
      const c = clearanceBy.get(id) ?? null;
      // A registry search never clears a volunteer (0161).
      const onFile = Boolean(c?.background_check_on_file) && !isRegistrySearch(c);
      // The gate's own rule (lib/backgroundChecks.js): current = in date AND OK.
      const vb = vbBy.get(id) ?? null;
      const bucket = volunteerBucket(c, today, soon, vb);
      return {
        ...base(id),
        checkDate: onFile ? c?.background_check_date ?? null : null,
        expiresOn: onFile ? c?.expires_on ?? null : null,
        pill: clearancePill(c, today),
        bucket,
        // Which service it is waiting on, or what VolunteerBadge said.
        vbStatus: vb && !vb.confirmed_at ? vb.status : null,
        // Held from ordering until the deposit is in (0157).
        heldForDeposit: (bucket === 'missing' || bucket === 'expired') && depositIn.get(id) === false,
      };
    })
    .sort(byName);
  const vCounts = Object.fromEntries(
    VOLUNTEER_FILTERS.map((f) => [f.key, f.key ? volunteerRows.filter((x) => x.bucket === f.key).length : volunteerRows.length])
  );
  const vShown = vFilter ? volunteerRows.filter((x) => x.bucket === vFilter) : volunteerRows;

  // ---- Part 2: every other adult ----
  const registryRows = personIds
    .filter((id) => !byId.get(id).volunteer)
    .map((id) => {
      const c = clearanceBy.get(id) ?? null;
      const { person, roles } = byId.get(id);
      const covered = fullCheckCurrent(c, today);
      const registry = isRegistrySearch(c);
      return {
        ...base(id),
        firstName: person.first_name ?? '',
        dob: person.date_of_birth ?? null,
        place: [person.households?.city, person.households?.state].filter(Boolean).join(', '),
        roleLabel: [...roles].map((x) => ROLE_LABEL[x] ?? x).join(', '),
        checkDate: c?.background_check_on_file ? c?.background_check_date ?? null : null,
        expiresOn: c?.background_check_on_file ? c?.expires_on ?? null : null,
        pill: clearancePill(c, today, { forRegistry: true }),
        bucket: registryBucket(c, today, soon),
        // What the form starts from, when a search is on file.
        initial: registry ? { date: c.background_check_date ?? '', verdict: c.verdict ?? '', note: c.verdict_note ?? '' } : null,
        // A current full check covers them; no search is recorded over it.
        coveredByFullCheck: covered,
      };
    })
    .sort(byName);
  const rCounts = Object.fromEntries(
    REGISTRY_FILTERS.map((f) => [f.key, f.key ? registryRows.filter((x) => x.bucket === f.key).length : registryRows.length])
  );
  const rShown = rFilter ? registryRows.filter((x) => x.bucket === rFilter) : registryRows;
  // The queue: everyone in part 2 with a search due, whatever the table shows.
  const queue = canWrite
    ? registryRows
        .filter((x) => x.bucket === 'due')
        .map((x) => ({
          id: x.id,
          name: x.name,
          firstName: x.firstName,
          lastName: x.lastName,
          roleLabel: x.roleLabel,
          dob: x.dob,
          place: x.place,
          events: x.events,
          reason: x.expiresOn && x.expiresOn < today ? `last search expired ${fmtDate(x.expiresOn)}` : '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  // ---- What each folded header says (Lawrence, 11 Nov 2026) ----
  // In the same tones as the status pills (CHECK_TONE). Read here, not at
  // module level, so the import order of lib/format.js never matters.
  const RED = CHECK_TONE.hold;
  const AMBER = CHECK_TONE.todo;
  const QUIET = CHECK_TONE.na;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const volunteerSummary = [
    plural(vCounts[''], 'volunteer', 'volunteers'),
    `${vCounts.missing} no check on file`,
    `${vCounts.waiting} waiting on the check`,
    `${vCounts.expired} out of date`,
    `${vCounts.decision} ${vCounts.decision === 1 ? 'needs' : 'need'} a decision`,
    ...(vCounts.not_permitted > 0 ? [`${vCounts.not_permitted} not permitted`] : []),
    `${vCounts.current + vCounts.soon} current`,
  ].join(' · ');
  // Work due: no check, one out of date or about to be, or one in date that
  // nobody has marked OK to serve yet.
  const volunteerWork = vCounts.missing + vCounts.expired + vCounts.decision + vCounts.soon;
  const volunteerPills = [
    vCounts.missing > 0 && { text: `${vCounts.missing} no check`, cls: RED },
    vCounts.expired > 0 && { text: `${vCounts.expired} out of date`, cls: RED },
    vCounts.decision > 0 && {
      text: `${vCounts.decision} ${vCounts.decision === 1 ? 'needs' : 'need'} a decision`,
      cls: RED,
    },
    vCounts.not_permitted > 0 && { text: `${vCounts.not_permitted} not permitted`, cls: CHECK_TONE.blocked },
    vCounts.soon > 0 && { text: `${vCounts.soon} expiring soon`, cls: AMBER },
    volunteerWork === 0 && vCounts.not_permitted === 0 && vCounts[''] > 0 && { text: 'Nothing due', cls: QUIET },
  ].filter(Boolean);
  const registrySummary = [
    plural(rCounts[''], 'adult', 'adults'),
    plural(rCounts.due, 'search due', 'searches due'),
    `${rCounts.follow_up} ${rCounts.follow_up === 1 ? 'needs' : 'need'} follow-up`,
    `${rCounts.not_permitted} not permitted`,
    `${rCounts.current + rCounts.soon} current`,
  ].join(' · ');
  const registryWork = rCounts.due + rCounts.follow_up;
  const registryPills = [
    rCounts.due > 0 && { text: plural(rCounts.due, 'search due', 'searches due'), cls: AMBER },
    rCounts.follow_up > 0 && { text: `${rCounts.follow_up} follow-up`, cls: AMBER },
    rCounts.not_permitted > 0 && { text: `${rCounts.not_permitted} not permitted`, cls: CHECK_TONE.blocked },
    rCounts.soon > 0 && { text: `${rCounts.soon} expiring soon`, cls: AMBER },
    registryWork === 0 && rCounts.not_permitted === 0 && rCounts[''] > 0 && { text: 'Nothing due', cls: QUIET },
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
        <h1 className="text-xl font-bold">Background Checks</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Everyone 18 or older on an upcoming event needs one of two checks.{' '}
          <a href="#volunteers" className="font-semibold text-brand underline">
            Volunteers
          </a>{' '}
          need the full background check through VolunteerBadge.{' '}
          <a href="#registry" className="font-semibold text-brand underline">
            Campers and families
          </a>{' '}
          (everyone else) need a search of the public sex-offender registry, or a current full check.
          Age is counted on the first day of camp.
          {minors > 0 && ` ${minors} under 18 ${minors === 1 ? 'is' : 'are'} not screened and not listed.`}
        </p>
      </div>

      {/* ---- Part 1 ---- */}
      <CheckCard
        id="volunteers"
        title="Volunteers: full background check"
        summary={volunteerSummary}
        pills={volunteerPills}
        defaultOpen={volunteerWork > 0 || Boolean(vFilter)}
      >
        <p className="text-sm text-neutral-600">
          {volunteerRows.length} adult {volunteerRows.length === 1 ? 'volunteer' : 'volunteers'} on upcoming
          events. A volunteer can&rsquo;t be approved without a current check marked OK to serve.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className={HOW_TO_BOX}>
            <h3 className="font-bold">How to run a check</h3>
            <p className="mt-1 text-sm text-neutral-700">
              <strong>Send checks</strong> sends VolunteerBadge invites and brings the results
              back in. To enter a check by hand, use the{' '}
              <Link href="/admin/volunteers/" className="font-semibold text-brand underline">
                Volunteers page
              </Link>
              .
            </p>
            <Link href="/admin/volunteers/screening/" className="btn-primary mt-3 inline-block py-2!">
              Send checks
            </Link>
          </div>
          <CheckLengthForm months={months} onFile={onFileCount ?? 0} canEdit={canWrite} />
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <FilterPills
            label="Volunteers to show"
            filters={VOLUNTEER_FILTERS}
            counts={vCounts}
            current={vFilter}
            hrefFor={(k) => listHref(k, rFilter, 'volunteers')}
          />
          {vShown.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">
              {volunteerRows.length === 0 ? 'No adult volunteers on upcoming events.' : 'Nobody in this list.'}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Event</th>
                    <th className="py-2 pr-3">Date checked</th>
                    <th className="py-2 pr-3">Expires</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vShown.map((x) => (
                    <tr key={x.id} className="border-b border-neutral-100 align-top">
                      <td className="py-2 pr-3">
                        <PersonLink row={x} />
                      </td>
                      <td className="py-2 pr-3 text-neutral-600">{x.events.join(' · ')}</td>
                      <td className="py-2 pr-3">{fmtDate(x.checkDate) || '—'}</td>
                      <td className={`py-2 pr-3 ${x.bucket === 'expired' ? 'font-semibold text-red-800' : ''}`}>
                        {fmtDate(x.expiresOn) || '—'}
                      </td>
                      <td className="py-2">
                        <span className="flex flex-wrap gap-1">
                          <StatusPill pill={x.pill} />
                          {x.bucket === 'waiting' && (
                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${CHECK_TONE.waiting}`}>
                              {x.vbStatus ? 'Waiting on VolunteerBadge' : 'Waiting on Checkr'}
                            </span>
                          )}
                          {x.bucket === 'decision' && (x.vbStatus === 'clear' || x.vbStatus === 'consider') && (
                            <Link
                              href="/admin/volunteers/screening/"
                              className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold underline ${x.vbStatus === 'clear' ? CHECK_TONE.done : CHECK_TONE.hold}`}
                            >
                              {x.vbStatus === 'clear' ? 'VolunteerBadge: clear, confirm it' : 'VolunteerBadge: needs review'}
                            </Link>
                          )}
                          {x.bucket === 'soon' && (
                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${CHECK_TONE.todo}`}>
                              Expires soon
                            </span>
                          )}
                          {x.heldForDeposit && (
                            <span
                              className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${CHECK_TONE.na}`}
                              title="Not ordered until their registration's deposit is paid, waived or covered by a scholarship."
                            >
                              Waiting on the deposit
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CheckCard>

      {/* ---- Part 2 ---- */}
      <CheckCard
        id="registry"
        title="Campers & families: registry search"
        summary={registrySummary}
        pills={registryPills}
        defaultOpen={registryWork > 0 || Boolean(rFilter)}
      >
        <p className="text-sm text-neutral-600">
          {registryRows.length} {registryRows.length === 1 ? 'adult' : 'adults'} who aren&rsquo;t volunteers:
          campers, parents and guardians, siblings and caregivers. Each needs
          a search of the public sex-offender registry at{' '}
          <a href="https://www.nsopw.gov/" target="_blank" rel="noopener noreferrer" className="underline">
            nsopw.gov
          </a>{' '}
          once a year, or a current full background check. A missing search is a flag on their
          registration, not a hold. <strong>Not permitted</strong> holds approval. A registry search
          doesn&rsquo;t count as a volunteer&rsquo;s check.
        </p>

        {canWrite ? (
          <RegistryQueue rows={queue} today={today} />
        ) : (
          <div className={HOW_TO_BOX}>
            <h3 className="font-bold">Registry searches due ({rCounts.due})</h3>
            <p className="mt-1 text-sm text-neutral-700">
              Searches are run and recorded here by staff who can edit background checks.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <FilterPills
            label="Campers and families to show"
            filters={REGISTRY_FILTERS}
            counts={rCounts}
            current={rFilter}
            hrefFor={(k) => listHref(vFilter, k, 'registry')}
          />
          {rShown.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">
              {registryRows.length === 0 ? 'No adults who aren’t volunteers on upcoming events.' : 'Nobody in this list.'}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
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
                  {rShown.map((x) => (
                    <tr key={x.id} className="border-b border-neutral-100 align-top">
                      <td className="py-2 pr-3">
                        <PersonLink row={x} />
                      </td>
                      <td className="py-2 pr-3 text-neutral-600">{x.roleLabel}</td>
                      <td className="py-2 pr-3 text-neutral-600">{x.events.join(' · ')}</td>
                      <td className="py-2 pr-3">{fmtDate(x.checkDate) || '—'}</td>
                      <td className={`py-2 pr-3 ${x.bucket === 'due' && x.expiresOn ? 'font-semibold text-amber-800' : ''}`}>
                        {fmtDate(x.expiresOn) || '—'}
                      </td>
                      <td className="py-2">
                        <span className="flex flex-wrap gap-1">
                          <StatusPill pill={x.pill} />
                          {x.bucket === 'soon' && (
                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${CHECK_TONE.todo}`}>
                              Expires soon
                            </span>
                          )}
                        </span>
                        {canWrite && !x.coveredByFullCheck && (
                          <RegistrySearchForm personId={x.id} name={x.name} today={today} initial={x.initial} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CheckCard>
    </div>
  );
}
