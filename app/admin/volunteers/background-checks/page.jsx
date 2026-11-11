// Background Checks (Lawrence, 9 Nov 2026), under Volunteers in the sidebar:
// every adult volunteer's check on one list, ordering (Background screening,
// linked from here), and how long a check lasts (0158).
//
// Who is listed: adult volunteers and adult campers with a place on an
// upcoming, unarchived event. Under-18s are not screened (0056) and are
// counted, not listed.
//
// Two routes (0161, Lawrence 10 Nov 2026). A volunteer's full check is
// recorded on the Volunteers page or by the Checkr import; this page reads it.
// An adult camper's check is a staff search of the public sex-offender
// registry (nsopw.gov), recorded HERE, on the camper's row. Someone who
// volunteers at any listed event is listed as a volunteer, because they need
// the full check, and a registry search does not count for them.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { clearancePill, isMinor, isRegistrySearch } from '@/lib/format';
import { todayInMorristown } from '@/lib/events';
import { isCamperRole, isVolunteerRole } from '@/lib/roles';
import { depositInByPerson } from '@/lib/screeningDeposit';
import CheckLengthForm from './CheckLengthForm';
import RegistrySearchForm from './RegistrySearchForm';

export const metadata = { title: 'Background Checks' };

const SOON_DAYS = 60;

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'missing', label: 'No check on file' },
  { key: 'waiting', label: 'Waiting on Checkr' },
  { key: 'expired', label: 'Out of date' },
  { key: 'soon', label: `Expiring within ${SOON_DAYS} days` },
  { key: 'current', label: 'Current' },
];

const ROLES = [
  { key: '', label: 'Everyone' },
  { key: 'volunteer', label: 'Volunteers' },
  { key: 'camper', label: 'Campers 18+' },
];

function listHref(show, role) {
  const q = new URLSearchParams();
  if (show) q.set('show', show);
  if (role) q.set('role', role);
  const s = q.toString();
  return `/admin/volunteers/background-checks/${s ? `?${s}` : ''}`;
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

export default async function BackgroundChecksPage({ searchParams }) {
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/volunteers/background-checks/');
  if (!can(staff, 'background_checks')) redirect('/admin/volunteers');

  const { show = '', role = '' } = (await searchParams) ?? {};
  const filter = FILTERS.some((f) => f.key === show) ? show : '';
  const roleFilter = ROLES.some((r) => r.key === role) ? role : '';
  const canWrite = can(staff, 'write:background_checks');
  const supabase = await createClient();
  const today = todayInMorristown();
  const soon = addDays(today, SOON_DAYS);

  const [{ data: setting, error: settingError }, { data: events, error: eventsError }] = await Promise.all([
    supabase.from('background_check_settings').select('interval_months, updated_at').maybeSingle(),
    supabase.from('events').select('id, name, starts_on').gte('ends_on', today).is('archived_at', null),
  ]);
  if (settingError) throw new Error(`Background check length: ${settingError.message}`);
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);
  const months = setting?.interval_months ?? 12;
  const eventIds = (events ?? []).map((e) => e.id);
  const eventName = new Map((events ?? []).map((e) => [e.id, e.name]));

  const { data: places, error: placesError } = eventIds.length
    ? await supabase
        .from('registration_participants')
        .select('camp_role, status, people ( id, first_name, last_name, date_of_birth ), registrations!inner ( event_id )')
        .in('registrations.event_id', eventIds)
        .neq('status', 'cancelled')
    : { data: [], error: null };
  if (placesError) throw new Error(`Volunteers and campers: ${placesError.message}`);

  // One row per PERSON: volunteering at both weeks is one check.
  const byPerson = new Map();
  let minors = 0;
  const minorSeen = new Set();
  for (const p of places ?? []) {
    const volunteer = isVolunteerRole(p.camp_role);
    if ((!volunteer && !isCamperRole(p.camp_role)) || !p.people?.id) continue;
    const person = p.people;
    if (isMinor(person.date_of_birth) === true) {
      if (!minorSeen.has(person.id)) minors += 1;
      minorSeen.add(person.id);
      continue;
    }
    const ev = eventName.get(p.registrations?.event_id);
    const seen = byPerson.get(person.id);
    if (seen) {
      if (ev && !seen.events.includes(ev)) seen.events.push(ev);
      seen.volunteer ||= volunteer;
    } else {
      byPerson.set(person.id, { person, events: ev ? [ev] : [], volunteer });
    }
  }
  const personIds = [...byPerson.keys()];

  const [{ data: clearances, error: clearError }, depositIn, { count: onFileCount, error: countError }] =
    await Promise.all([
      personIds.length
        ? supabase
            .from('person_clearances')
            .select('person_id, background_check_on_file, background_check_date, expires_on, verdict, verdict_note, checkr_status, provider')
            .in('person_id', personIds)
        : Promise.resolve({ data: [], error: null }),
      // The deposit hold is a Checkr-ordering rule: volunteers only.
      depositInByPerson(supabase, personIds.filter((id) => byPerson.get(id).volunteer)),
      supabase
        .from('person_clearances')
        .select('person_id', { count: 'exact', head: true })
        .not('background_check_date', 'is', null),
    ]);
  if (clearError) throw new Error(`Background checks: ${clearError.message}`);
  if (countError) throw new Error(`Background checks on file: ${countError.message}`);
  const clearanceBy = new Map((clearances ?? []).map((c) => [c.person_id, c]));

  const allRows = personIds.map((id) => {
    const { person, events: evs, volunteer } = byPerson.get(id);
    const forCamper = !volunteer;
    const c = clearanceBy.get(id) ?? null;
    // A registry search clears a camper, never a volunteer (0161).
    const onFile = Boolean(c?.background_check_on_file) && (forCamper || !isRegistrySearch(c));
    const expired = onFile && c.expires_on && c.expires_on < today;
    const waiting = volunteer && !(onFile && !expired) && ['invited', 'pending', 'suspended'].includes(c?.checkr_status);
    const bucket = waiting
      ? 'waiting'
      : !onFile
        ? 'missing'
        : expired
          ? 'expired'
          : c.expires_on && c.expires_on <= soon
            ? 'soon'
            : 'current';
    return {
      id,
      name: `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || 'Unnamed',
      lastName: person.last_name ?? '',
      events: evs,
      role: volunteer ? 'volunteer' : 'camper',
      checkDate: onFile ? c?.background_check_date ?? null : null,
      expiresOn: onFile ? c?.expires_on ?? null : null,
      pill: clearancePill(c, today, { forCamper }),
      bucket,
      // Held from ordering until the deposit is in (0157).
      heldForDeposit: volunteer && (bucket === 'missing' || bucket === 'expired') && depositIn.get(id) === false,
      // What the camper's registry form starts from, when one is on file.
      registry: forCamper && isRegistrySearch(c)
        ? { date: c.background_check_date ?? '', verdict: c.verdict ?? '', note: c.verdict_note ?? '' }
        : null,
      // A full check on file and current covers a camper too; the form is not offered.
      coveredByFullCheck: forCamper && onFile && !expired && !isRegistrySearch(c),
    };
  });
  const roleCounts = Object.fromEntries(ROLES.map((r) => [r.key, r.key ? allRows.filter((x) => x.role === r.key).length : allRows.length]));
  const rows = roleFilter ? allRows.filter((r) => r.role === roleFilter) : allRows;
  rows.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.name.localeCompare(b.name));
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, f.key ? rows.filter((r) => r.bucket === f.key).length : rows.length]));
  const shown = filter ? rows.filter((r) => r.bucket === filter) : rows;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-bold">Background Checks</h1>
          <Link href="/admin/volunteers/screening/" className="btn-primary py-2!">
            Order checks
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          Every adult volunteer and adult camper signed up for an upcoming event, and where their
          check stands. <strong>Volunteers</strong> need the full background check: Order checks makes
          the file you send to Checkr and brings Checkr&rsquo;s results back in, and a check entered by
          hand goes on the Volunteers page. <strong>Campers 18 or older</strong> need a search of the
          public sex-offender registry at{' '}
          <a href="https://www.nsopw.gov/" target="_blank" rel="noopener noreferrer" className="underline">
            nsopw.gov
          </a>
          , recorded on their row below. A camper&rsquo;s search is a flag on their registration, not a
          hold, and it does not count as a volunteer&rsquo;s check.
          {minors > 0 && ` ${minors} under 18 ${minors === 1 ? 'is' : 'are'} not screened and not listed.`}
        </p>
      </div>

      <CheckLengthForm months={months} onFile={onFileCount ?? 0} canEdit={can(staff, 'write:background_checks')} />

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <nav aria-label="Who" className="mb-2 flex flex-wrap gap-2 text-sm">
          {ROLES.map((r) => (
            <Link
              key={r.key || 'everyone'}
              href={listHref(filter, r.key)}
              aria-current={roleFilter === r.key ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 ${
                roleFilter === r.key ? 'border-brand bg-brand-light font-semibold text-brand-dark' : 'border-neutral-300'
              }`}
            >
              {r.label} ({roleCounts[r.key]})
            </Link>
          ))}
        </nav>
        <nav aria-label="Show" className="flex flex-wrap gap-2 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f.key || 'all'}
              href={listHref(f.key, roleFilter)}
              aria-current={filter === f.key ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 ${
                filter === f.key ? 'border-brand bg-brand-light font-semibold text-brand-dark' : 'border-neutral-300'
              }`}
            >
              {f.label} ({counts[f.key]})
            </Link>
          ))}
        </nav>

        {shown.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">
            {rows.length === 0 ? 'Nobody 18 or older to screen on upcoming events.' : 'Nobody in this list.'}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 pr-3">Check date</th>
                  <th className="py-2 pr-3">Expires</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-b border-neutral-100 align-top">
                    <td className="py-2 pr-3">
                      <Link href={`/admin/people/${r.id}/`} className="font-medium text-brand underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-neutral-600">{r.role === 'camper' ? 'Camper' : 'Volunteer'}</td>
                    <td className="py-2 pr-3 text-neutral-600">{r.events.join(' · ')}</td>
                    <td className="py-2 pr-3">{fmtDate(r.checkDate) || '—'}</td>
                    <td className={`py-2 pr-3 ${r.bucket === 'expired' ? 'font-semibold text-amber-800' : ''}`}>
                      {fmtDate(r.expiresOn) || '—'}
                    </td>
                    <td className="py-2">
                      <span className="flex flex-wrap gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.pill.cls}`} title={r.pill.title}>
                          {r.pill.text}
                        </span>
                        {r.bucket === 'waiting' && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                            Waiting on Checkr
                          </span>
                        )}
                        {r.bucket === 'soon' && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-300">
                            Expires soon
                          </span>
                        )}
                        {r.heldForDeposit && (
                          <span
                            className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-700"
                            title="Not ordered until their registration's deposit is paid, waived or covered by a scholarship."
                          >
                            Waiting on the deposit
                          </span>
                        )}
                      </span>
                      {r.role === 'camper' && canWrite && !r.coveredByFullCheck && (
                        <RegistrySearchForm personId={r.id} name={r.name} today={today} initial={r.registry} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
