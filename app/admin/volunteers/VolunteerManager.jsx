'use client';

// The staff view of volunteers: per event, each volunteer's application
// status, the application answers, approve/decline, and the background-check
// record (a yes/no and dates — documents stay in the restricted SharePoint
// folder). Actions live in ./actions.js; RLS is the backstop.

import Notice from '@/components/Notice';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { reviewVolunteerApplication } from './actions';
import ClearanceEditor from '@/components/ClearanceEditor';
import { clearancePill, isMinor, formatPhone, CHECK_TONE } from '@/lib/format';
import { formatDay, eventDateRange } from '@/lib/events';

// One pill per volunteer (Lawrence, 4 Nov 2026). Since 0152 the place at
// camp and the application are one decision, so the two pills that named
// them apart became one, read from both: approved only when the application
// is approved AND the place confirmed; anything still to settle is "needs
// your decision". The pill opens the application, where Approve and Decline
// are. [label, colours, still to decide]
function volunteerState(app, placeStatus) {
  if (placeStatus === 'cancelled') return ['Volunteer: canceled', 'bg-neutral-200 text-neutral-600', false];
  if (placeStatus === 'draft') return ['Volunteer: registration not submitted', 'bg-neutral-100 text-neutral-500', false];
  if (!app) return ['Volunteer: no application yet', 'bg-neutral-100 text-neutral-500', false];
  if (app.status === 'withdrawn') return ['Volunteer: application withdrawn', 'bg-neutral-200 text-neutral-600', false];
  if (app.status === 'declined') return ['Volunteer: declined', 'bg-red-100 text-red-800', false];
  if (app.status === 'approved' && placeStatus === 'confirmed') return ['Volunteer: approved', 'bg-green-100 text-green-800', false];
  if (placeStatus === 'waitlisted' && app.status === 'approved') return ['Volunteer: waitlisted', 'bg-neutral-200 text-neutral-700', false];
  return ['Volunteer: needs your decision', 'bg-amber-100 text-amber-800', true];
}

const fmtAge = (dob) => {
  if (!dob) return null;
  const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
  return age;
};


function VolunteerRow({ row, maySeeChecks, mayEditChecks = false, canReview = true }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Arriving from the roster (25 Aug). A staff member looking at a volunteer
  // on the roster and wanting their background check had no way across; the
  // link back the other way has always existed. Landing on a collapsed row
  // among thirty others is barely better than not linking at all, so the
  // target opens itself and says which one it is.
  const anchorId = `v-${row.participantId}`;
  // The background check record inside the opened row. #check-<person id>
  // (Background Checks' "Record by hand", 13 Nov 2026) opens the row and goes
  // straight to it; so does pressing the background-check pill.
  const checkId = `check-${anchorId}`;
  const personId = row.person?.id;
  const goToCheck = () => {
    setOpen(true);
    // A timer, not requestAnimationFrame: a background tab never runs that.
    setTimeout(() => {
      const el = document.getElementById(checkId);
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    }, 0);
  };
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    const check = () => {
      // Read the first #check-<id> / #v-<id> even if the address carries it
      // twice (a doubled hash from client navigation, 14 Nov 2026), and tidy
      // the address back to one.
      const raw = window.location.hash;
      const first = raw.match(/#[^#]+/)?.[0] ?? '';
      if (first && first !== raw) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${first}`);
      const hit = first === `#${anchorId}`;
      const toCheck = Boolean(personId) && first === `#check-${personId}`;
      setLinked(hit || toCheck);
      if (hit) setOpen(true);
      if (toCheck) {
        setOpen(true);
        setTimeout(() => {
          const el = document.getElementById(checkId);
          if (!el) return;
          el.scrollIntoView({ block: 'start', behavior: 'smooth' });
          el.focus({ preventScroll: true });
        }, 0);
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [anchorId, checkId, personId]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { person, household, app, clearance } = row;
  const age = fmtAge(person?.date_of_birth);
  const [stateLabel, stateTone, toDecide] = volunteerState(app, row.participantStatus);

  // One decision (0152): approving confirms the place, declining waitlists
  // it. The deposit question the registration page asks comes back the same
  // way, as needsOverride.
  async function review(decision) {
    if (
      decision === 'declined' &&
      !window.confirm(
        `Decline ${person?.first_name ?? 'this volunteer'}'s application?\n\nTheir place at camp goes on the waitlist, and the family sees: "Volunteer application not approved. The office will be in touch."`
      )
    )
      return;
    setPending(true);
    setError('');
    let res = await reviewVolunteerApplication(row.participantId, decision);
    if (res?.needsOverride) {
      if (window.confirm(`${res.error}\n\nApprove anyway?`)) {
        res = await reviewVolunteerApplication(row.participantId, decision, { override: true });
      } else {
        setPending(false);
        return;
      }
    }
    setPending(false);
    if (!res?.ok) setError(res?.error || 'Could not save.');
    else router.refresh();
  }

  // The same pill every staff member sees on the Buddy board (0091). A
  // volunteer under 18 is not screened, and says so instead of "missing".
  const pill = clearancePill(isMinor(person?.date_of_birth) ? { ...(clearance ?? {}), minor: true } : clearance);
  // The database's rule (0152): approved only with a background check on
  // file, current and marked OK to serve -- under 18 is not screened.
  const cleared = pill.key === 'ok' || pill.key === 'minor';

  return (
    <div
      id={anchorId}
      className={`scroll-mt-4 border-t border-neutral-100 py-3 ${
        linked && open ? 'rounded-lg bg-brand-light/50 ring-2 ring-brand px-3' : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* The person first, large; under it the two places staff go, each
            saying what it is for (Lawrence, 4 Nov 2026: the family name as
            the way to approvals was not obvious). */}
        <div className="min-w-0">
          <p className="text-lg font-semibold leading-tight">
            {person?.first_name} {person?.last_name}
            {age != null && age < 18 && (
              <span className="ml-2 rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-xs font-semibold align-middle">
                under 18
              </span>
            )}
          </p>
          <p className="mt-1 text-sm">
            {person?.id && (
              <>
                <Link href={`/admin/people/${person.id}/`} className="text-brand underline">
                  Person details
                </Link>
                <span className="text-neutral-400"> · </span>
              </>
            )}
            <Link href={`/admin/registrations/${row.registrationId}`} className="text-brand underline">
              Registration &amp; approval
            </Link>
            <span className="text-neutral-500"> ({household?.display_name ?? 'Household'})</span>
          </p>
          {(person?.email || person?.phone) && (
            <p className="text-xs text-neutral-500">
              {person?.email}
              {person?.email && person?.phone && ' · '}
              {person?.phone ? formatPhone(person.phone) : null}
            </p>
          )}
        </div>
        <span className="flex flex-wrap items-center gap-2 text-xs">
          {/* The one volunteer pill opens and closes the application
              (Lawrence, 4 Nov 2026: a separate "Review application" button,
              and a Place pill beside an Application pill, said the same
              things twice). The registration is the link under the name. */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            title="Open the application to approve or decline"
            className={`rounded-full px-2.5 py-0.5 font-semibold hover:underline ${stateTone}`}
          >
            {stateLabel}
          </button>
          {/* The Creed is asked, not enforced (29 Sep 2026). An application
              without it is a conversation with Larry that has to happen
              before approval, so the gap is loud here rather than a wall on
              the form. Red on purpose: it must not read as "not asked". */}
          {app && app.status !== 'withdrawn' && row.creedAsked !== false && (
            <span
              className={`rounded-full px-2.5 py-0.5 font-semibold ${
                row.creedAffirmed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}
              title={
                row.creedAffirmed
                  ? 'Affirmed the Apostles’ Creed on the volunteer application'
                  : row.creedWithdrawn
                    ? 'Affirmed the Apostles’ Creed earlier but unchecked it on the latest save. Speak with Larry before approving.'
                    : 'Did not affirm the Apostles’ Creed. They were asked to speak with Larry. Make sure that happened before approving.'
              }
            >
              {/* The fact only (Lawrence, 15 Oct 2026): red already says
                  "stop"; the triangle and "speak with Larry" are in the
                  tooltip and on the application itself. */}
              {row.creedAffirmed
                ? 'Creed affirmed'
                : row.creedWithdrawn
                  ? 'Creed affirmation withdrawn'
                  : 'Creed not affirmed'}
            </span>
          )}
          {/* Three facts for everyone on staff -- on file, current, the
              verdict -- from clearance_status (0091). Until 15 Oct this read
              "hidden" without the grant; the grant still gates the record
              itself (dates, Checkr's words, the log), not the pill. */}
          {maySeeChecks ? (
            // Opens the row at the background check record (Lawrence, 13 Nov
            // 2026: the pill looked like the place to start, and wasn't).
            <button
              type="button"
              onClick={goToCheck}
              title={`${pill.title} Open the background check record.`}
              className={`rounded-full px-2.5 py-0.5 font-semibold hover:underline ${pill.cls}`}
            >
              {pill.text}
            </button>
          ) : (
            <span title={pill.title} className={`rounded-full px-2.5 py-0.5 font-semibold ${pill.cls}`}>
              {pill.text}
            </span>
          )}
          {/* 0177 (23 Nov 2026): another record with the same name and birth
              date is marked Not permitted, so approval is held until a
              decision is recorded for this person. */}
          {row.notPermittedMatch && (
            <span
              title="Approval is held. If this is a different person, record a background check decision for them."
              className={`rounded-full px-2.5 py-0.5 font-semibold ${CHECK_TONE.blocked}`}
            >
              Same name and birth date as someone marked Not permitted
            </span>
          )}
          {/* One plain open/close control (Lawrence, 14 Nov 2026: it wasn't
              obvious how a card opens and closes). The pills still open it at
              their own part. */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="ml-1 rounded-sm border border-neutral-300 bg-white px-2 py-0.5 font-semibold text-neutral-700 hover:border-brand"
          >
            {open ? 'Close ▴' : 'Open ▾'}
          </button>
        </span>
      </div>

      {open && (
        <div className="card mt-3 p-4 text-sm">
          {/* The decision first, then what it rests on. */}
          {canReview && app && app.status !== 'withdrawn' && (
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-neutral-100 pb-3">
              {/* Say what is waiting (Lawrence, 4 Nov 2026: "what is still
                  awaiting review? not obvious when I look at her
                  application"): the application itself, until someone
                  approves or declines it, and what that rests on. */}
              <span className="mr-1 font-semibold">
                {toDecide
                  ? 'Waiting on your decision. Read the application below, then:'
                  : app.status === 'approved'
                    ? `Approved${app.reviewed_at ? ` ${formatDay(app.reviewed_at)}` : ''}. Change it:`
                    : `Declined${app.reviewed_at ? ` ${formatDay(app.reviewed_at)}` : ''}. Change it:`}
              </span>
              {(toDecide || app.status === 'declined' || row.participantStatus === 'waitlisted') && (
                <button
                  onClick={() => review('approved')}
                  disabled={pending || !cleared}
                  title={cleared ? undefined : 'Needs a background check marked OK to serve. Record it below.'}
                  className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Approve
                </button>
              )}
              {app.status !== 'declined' && (
                <button
                  onClick={() => review('declined')}
                  disabled={pending}
                  className="btn-outline btn-sm text-red-700 disabled:opacity-50"
                >
                  Decline
                </button>
              )}
              <span className="w-full text-xs text-neutral-600">
                Before deciding: {row.creedAsked === false ? 'Volunteer child, Creed not asked' : row.creedAffirmed ? 'Creed affirmed' : 'Creed not affirmed, speak with Larry first'} · {pill.text}
                {!cleared && toDecide && (
                  <strong className="text-red-800">. Approval waits for a background check marked OK to serve (below)</strong>
                )}
                . Approving also confirms their place at camp. Declining puts their place on the waitlist.
              </span>
            </div>
          )}
          {app ? (
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mb-3">
              <div>
                <dt className="text-xs font-semibold text-neutral-500">Age</dt>
                <dd>
                  {age != null ? `${age}` : 'unknown (no birth date on file)'}
                  {person?.date_of_birth && (
                    <span className="text-neutral-500"> (born {formatDay(person.date_of_birth)})</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-neutral-500">Sex / gender</dt>
                <dd>{person?.gender || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-neutral-500">Preferred areas</dt>
                <dd>{app.preferred_areas || '—'}</dd>
              </div>
              {app.languages && (
                <div>
                  <dt className="text-xs font-semibold text-neutral-500">Languages (translation)</dt>
                  <dd>{app.languages}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-semibold text-neutral-500">First time?</dt>
                <dd>{app.first_time_volunteering == null ? '—' : app.first_time_volunteering ? 'Yes' : 'No, returning'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-neutral-500">Home church</dt>
                <dd>{app.church_attendance || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-neutral-500">Accompanying adult</dt>
                <dd>{app.accompanyingAdultName || (age != null && age < 18 ? '⚠ none named' : '—')}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-neutral-500">Faith</dt>
                <dd className="whitespace-pre-wrap">{app.faith_statement || '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-neutral-500">Skills</dt>
                <dd className="whitespace-pre-wrap">{app.relevant_skills || '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-neutral-500">Disability experience</dt>
                <dd className="whitespace-pre-wrap">{app.disability_experience || '—'}</dd>
                {/* The applicant's optional tick (0118), shown only when ticked. */}
                {app.first_time_disability_ministry && (
                  <dd className="mt-1">
                    <span className="rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-xs font-semibold">
                      First time in disability ministry
                    </span>
                  </dd>
                )}
              </div>
            </dl>
          ) : (
            <div className="mb-3">
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mb-3">
                <div>
                  <dt className="text-xs font-semibold text-neutral-500">Age</dt>
                  <dd>
                    {age != null ? `${age}` : 'unknown (no birth date on file)'}
                    {person?.date_of_birth && (
                      <span className="text-neutral-500"> (born {formatDay(person.date_of_birth)})</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-neutral-500">Sex / gender</dt>
                  <dd>{person?.gender || '—'}</dd>
                </div>
              </dl>
              <p className="text-neutral-500">
                No application yet. The family fills it out at /register/volunteer, and their
                dashboard reminds them.
              </p>
            </div>
          )}

          {error && <Notice tone="error" className="mt-2">{error}</Notice>}

          {maySeeChecks ? (
            <div id={checkId} tabIndex={-1} className="scroll-mt-4 outline-none">
              <ClearanceEditor
                personId={person?.id}
                clearance={clearance}
                vb={row.vb}
                email={person?.email || household?.email}
                firstName={person?.first_name}
                canEdit={mayEditChecks}
                lastName={person?.last_name}
              />
            </div>
          ) : (
            <p className="mt-4 rounded-sm border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
              You can see the pill above: on file, current, and the verdict. Staff with Background
              checks access keep the full record (dates, the result, who decided). Ask one if something
              looks wrong.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// The summary counts are also filters (Lawrence, 4 Nov 2026: "waiting
// review should maybe be a filter"). Each keeps the rows it counts.
const SHOWS = {
  all: () => true,
  // The pill's own rule, so the count and the amber pills always agree.
  review: (r) => volunteerState(r.app, r.participantStatus)[2],
  noapp: (r) => !r.app,
  check: (r) => Boolean(r.person?.id) && !isMinor(r.person?.date_of_birth) && clearancePill(r.clearance).key !== 'ok',
};

export default function VolunteerManager({ groups, maySeeChecks = false, mayEditChecks = false, canReview = true }) {
  const [show, setShow] = useState('all');
  const total = groups.reduce((s, g) => s + g.rows.length, 0);
  const needsReview = groups.reduce(
    (s, g) => s + g.rows.filter(SHOWS.review).length,
    0
  );
  const noApp = groups.reduce((s, g) => s + g.rows.filter((r) => !r.app).length, 0);
  // People, not rows, missing a background check (Lawrence, 15 Oct 2026):
  // a volunteer at both weeks is one person to screen, so the count is by
  // person id, and 'missing' is anything short of a current check with an
  // OK verdict -- none on file, expired, undecided, follow-up, not permitted.
  // Adults only: a volunteer under 18 is not screened and is not counted.
  const missingCheck = new Set();
  for (const g of groups) {
    for (const r of g.rows) {
      if (!r.person?.id || isMinor(r.person?.date_of_birth)) continue;
      if (clearancePill(r.clearance).key !== 'ok') missingCheck.add(r.person.id);
    }
  }

  return (
    <div>
      {/* The title, buttons and intro are the page's (page.jsx, 23 Nov 2026). */}
      <div className="flex flex-wrap gap-4 mb-6 text-sm">
        {[
          // Tile words say what is counted (23 Nov 2026). A volunteer child
          // under 16 is asked the application too (lib/volunteer.js), so
          // "not started" counts them like anyone else.
          ['all', total, total === 1 ? 'volunteer registered' : 'volunteers registered', ''],
          ['review', needsReview, needsReview === 1 ? 'application to decide' : 'applications to decide', 'text-amber-700'],
          ['noapp', noApp, noApp === 1 ? 'application not started' : 'applications not started', 'text-neutral-600'],
          [
            'check',
            missingCheck.size,
            // Counts anything short of a current background check marked OK
            // (none, expired, undecided, follow-up), so not "on file".
            missingCheck.size === 1 ? 'adult not cleared by a background check' : 'adults not cleared by a background check',
            missingCheck.size > 0 ? 'text-amber-700' : 'text-green-700',
          ],
        ].map(([key, n, label, tone]) =>
          // For someone who can open Background Checks, this tile goes there
          // (23 Nov 2026 review): that is where a background check is sent
          // and recorded, and where the red number now sits. Without the
          // grant it still narrows the list below.
          key === 'check' && maySeeChecks ? (
            <Link
              key={key}
              href="/admin/background-checks/#volunteers"
              title="Adults without a current background check marked OK, counted once however many weeks they serve. Under-18s are not screened. Opens Background Checks."
              className="card px-4 py-2 text-left hover:border-brand"
            >
              <span className={`font-bold text-lg ${tone}`}>{n}</span> {label} →
            </Link>
          ) : (
          <button
            key={key}
            type="button"
            onClick={() => setShow(show === key && key !== 'all' ? 'all' : key)}
            aria-pressed={show === key}
            title={
              key === 'check'
                ? 'Adults without a current background check marked OK, counted once however many weeks they serve. Under-18s are not screened. Click to show only them.'
                : key === 'all'
                  ? 'Show everyone'
                  : 'Click to show only these. Click again to show everyone.'
            }
            // Selected is solid teal, the same as a selected filter chip
            // (components/FilterChips.jsx, 23 Nov 2026); the number goes
            // white with it, since amber or green on teal cannot be read.
            className={`rounded-lg border px-4 py-2 text-left ${
              show === key ? 'border-brand bg-brand text-white' : 'border-neutral-200 bg-white hover:border-brand'
            }`}
          >
            <span className={`font-bold text-lg ${show === key ? '' : tone}`}>{n}</span> {label}
          </button>
          )
        )}
      </div>

      {total === 0 && (
        <p className="text-neutral-500">
          No volunteers registered yet. Volunteers register like everyone else, choose the
          role &ldquo;Volunteer,&rdquo; and then fill out their application.
        </p>
      )}

      {total > 0 && groups.every((g) => !g.rows.some(SHOWS[show])) && (
        <p className="text-neutral-500">Nobody here matches that.</p>
      )}

      {groups.map((g) => ({ ...g, rows: g.rows.filter(SHOWS[show]) })).filter((g) => g.rows.length > 0).map((g) => (
        <div key={g.event.id} className="card p-5 mb-6">
          <h3 className="font-bold">
            {g.event.name}
            {g.event.starts_on && (
              <span className="font-normal text-sm text-neutral-500">
                {' '}
                ({eventDateRange(g.event.starts_on, g.event.ends_on)})
              </span>
            )}
          </h3>
          <div>
            {g.rows.map((r) => (
              <VolunteerRow key={r.participantId} row={r} maySeeChecks={maySeeChecks} mayEditChecks={mayEditChecks} canReview={canReview} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
