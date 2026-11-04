'use client';

// The staff view of volunteers: per event, each volunteer's application
// status, the application answers, approve/decline, and the background-check
// record (a yes/no and dates — documents stay in the restricted SharePoint
// folder). Actions live in ./actions.js; RLS is the backstop.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { reviewVolunteerApplication, setVolunteerClearance } from './actions';
import { clearancePill, CLEARANCE_VERDICT_LABEL, isMinor } from '@/lib/format';
import { dayInMorristown } from '@/lib/events';

// Two pills, named apart on every row (Lawrence, 4 Nov 2026: "Approved" read
// as the place at camp) -- but since 0152 one decision: approving the
// application here confirms the place, and confirming a volunteer's place on
// the registration page approves the application.
const APP_CHIP = {
  applied: ['Application: needs your decision', 'bg-amber-100 text-amber-800'],
  approved: ['Application: approved', 'bg-green-100 text-green-800'],
  declined: ['Application: declined', 'bg-red-100 text-red-800'],
  withdrawn: ['Application: withdrawn', 'bg-neutral-200 text-neutral-600'],
};
const PLACE_CHIP = {
  submitted: ['Place: needs approval', 'bg-amber-100 text-amber-800'],
  confirmed: ['Place: confirmed', 'bg-green-100 text-green-800'],
  waitlisted: ['Place: waitlisted', 'bg-neutral-200 text-neutral-700'],
  draft: ['Place: not submitted', 'bg-neutral-100 text-neutral-500'],
};

// Checkr report states, mirrored into volunteer_clearances.checkr_status by the
// webhook handler once that exists. Nothing writes these today -- the columns
// and this display are the placeholder, so the shape of the finished feature is
// visible (and reviewable) before any key is issued.
const CHECKR_CHIP = {
  not_started: ['Not started', 'bg-neutral-100 text-neutral-500'],
  invited: ['Invited — waiting on volunteer', 'bg-amber-100 text-amber-800'],
  pending: ['Running at Checkr', 'bg-blue-100 text-blue-800'],
  clear: ['Clear', 'bg-green-100 text-green-800'],
  consider: ['Consider — needs a decision', 'bg-red-100 text-red-800'],
  suspended: ['Suspended at Checkr', 'bg-red-100 text-red-800'],
  dispute: ['Disputed by volunteer', 'bg-amber-100 text-amber-800'],
  canceled: ['Cancelled', 'bg-neutral-200 text-neutral-600'],
};

const ADJUDICATION_LABEL = {
  engaged: 'Engaged — proceeding despite the result',
  pre_adverse_action: 'Pre-adverse action notice sent',
  post_adverse_action: 'Post-adverse action — declined',
};

const fmtAge = (dob) => {
  if (!dob) return null;
  const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
  return age;
};

const VERDICT_OPTIONS = [
  ['ok', 'OK to serve', 'text-green-800'],
  ['follow_up', 'Needs a follow-up conversation', 'text-amber-800'],
  ['not_permitted', 'Not permitted to attend', 'text-red-800'],
];
const LOG_FIELD = {
  background_check_on_file: 'paperwork on file',
  background_check_date: 'background check date',
  expires_on: 'expires',
  verdict: 'verdict',
  verdict_note: 'verdict note',
  checkr_status: 'Checkr status',
  adjudication: 'adjudication',
};
const whenLocal = (iso) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) : '';

// The record (0091, 15 Oct 2026): paperwork on file, the check date (the
// expiry follows by policy), and the ministry's verdict -- with who did each
// and when, stamped by the database, and the log underneath.
function ClearanceEditor({ personId, clearance, email, onDone }) {
  const router = useRouter();
  const [onFile, setOnFile] = useState(Boolean(clearance?.background_check_on_file));
  const [date, setDate] = useState(clearance?.background_check_date ?? '');
  const [verdict, setVerdict] = useState(clearance?.verdict ?? '');
  const [note, setNote] = useState(clearance?.verdict_note ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setPending(true);
    setError('');
    const res = await setVolunteerClearance({ personId, onFile, date: date || null, verdict: verdict || null, note });
    setPending(false);
    if (!res?.ok) setError(res?.error || 'Could not save.');
    else {
      onDone?.();
      router.refresh();
    }
  }

  return (
    <div className="mt-2 rounded-sm border border-neutral-200 bg-neutral-50 p-3 text-sm">
      <CheckrPanel clearance={clearance} email={email} />
      <p className="font-semibold text-neutral-700 mb-2">Background check record</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onFile} onChange={(e) => setOnFile(e.target.checked)} className="h-4 w-4" />
          Paperwork on file (in the restricted SharePoint folder)
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-neutral-500 mb-0.5">Background check date (required when on file)</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-sm border border-neutral-300 px-2 py-1" />
        </label>
        <span className="text-xs text-neutral-500">
          {/* No check date, no expiry: 0108 clears expires_on with the date,
              and a row saved before it may still carry an old one. */}
          {clearance?.background_check_date && clearance?.expires_on
            ? `Expires ${clearance.expires_on} (12 months from the background-check date)`
            : 'Expiry is worked out from the background-check date: 12 months — background checks are annual.'}
        </span>
      </div>
      <div className="mt-3">
        <span className="block text-xs font-semibold text-neutral-500 mb-1">Verdict — the ministry&rsquo;s decision, not Checkr&rsquo;s word</span>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-1.5">
            <input type="radio" name={`verdict-${personId}`} checked={verdict === ''} onChange={() => setVerdict('')} />
            <span className="text-neutral-600">Not decided</span>
          </label>
          {VERDICT_OPTIONS.map(([v, label, cls]) => (
            <label key={v} className={`flex items-center gap-1.5 font-semibold ${cls}`}>
              <input type="radio" name={`verdict-${personId}`} checked={verdict === v} onChange={() => setVerdict(v)} />
              {label}
            </label>
          ))}
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Note (optional) — e.g. spoke with Larry 14 Oct; cleared to serve with a buddy"
          className="mt-2 w-full rounded-sm border border-neutral-300 px-2 py-1"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={pending} className="btn-primary py-1.5! text-sm">
            {pending ? 'Saving…' : 'Save record'}
          </button>
          {clearance?.paperwork_marked_at && (
            <span className="text-xs text-neutral-500">
              Paperwork marked by {clearance.paperworkByName ?? 'staff'} · {whenLocal(clearance.paperwork_marked_at)}
            </span>
          )}
          {clearance?.verdict_at && (
            <span className="text-xs text-neutral-500">
              Verdict ({clearance.verdict ? CLEARANCE_VERDICT_LABEL[clearance.verdict] ?? clearance.verdict : 'Not decided'}) by {clearance.verdictByName ?? 'staff'} · {whenLocal(clearance.verdict_at)}
            </span>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-red-700">{error}</p>}
      {(clearance?.log ?? []).length > 0 && (
        <details className="mt-3 text-xs text-neutral-600">
          <summary className="fold-summary font-semibold">History ({clearance.log.length} most recent changes)</summary>
          <ul className="mt-1 space-y-0.5">
            {clearance.log.map((l, i) => (
              <li key={i}>
                {whenLocal(l.changed_at)} · {l.by} set <span className="font-semibold">{LOG_FIELD[l.field] ?? l.field}</span>{' '}
                {l.old_value != null && <>from &ldquo;{l.old_value}&rdquo; </>}to &ldquo;{l.new_value ?? '—'}&rdquo;
              </li>
            ))}
          </ul>
        </details>
      )}

    </div>
  );
}

// Where this person is in Checkr's process (Lawrence, 4 Nov 2026). The
// ministry's way is the bulk file, not the API: names and emails go to Checkr
// in a batch from Background screening, Checkr emails each person, they fill
// in their own details on Checkr's form, and the results file comes back and
// is uploaded there. This card says which of those steps this person is at;
// the ministry's verdict is recorded underneath. No Social Security number is
// ever sent to, or held by, Luke 14.
function CheckrPanel({ clearance, email }) {
  const status = clearance?.checkr_status ?? 'not_started';
  const [label, tone] = CHECKR_CHIP[status] ?? CHECKR_CHIP.not_started;
  const sent = Boolean(clearance?.order_batch) || status !== 'not_started';
  const resultIn = ['clear', 'consider', 'dispute', 'suspended', 'canceled'].includes(status);

  return (
    <div className="mb-3 rounded-sm border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-neutral-700">Checkr</p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
      </div>
      <ol className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
        <li className={sent ? 'text-green-800' : 'font-semibold text-neutral-800'}>
          {sent ? '✓' : '1.'} Name and email sent to Checkr in a batch
        </li>
        <li className={resultIn ? 'text-green-800' : sent ? 'font-semibold text-neutral-800' : 'text-neutral-500'}>
          {resultIn ? '✓' : '2.'} Checkr emails them; they fill in their own details
        </li>
        <li className={resultIn ? 'font-semibold text-neutral-800' : 'text-neutral-500'}>
          3. Result uploaded here — then record the verdict below
        </li>
      </ol>
      <p className="mt-2 text-sm">
        {!sent ? (
          <>
            Not sent yet. It goes in the next batch from{' '}
            <Link href="/admin/volunteers/screening/" className="text-brand underline">
              Background screening
            </Link>{' '}
            — to {email || <strong>no email on file (add one first)</strong>}.
          </>
        ) : !resultIn ? (
          <>
            Sent{clearance?.order_batch ? ` in the batch of ${dayInMorristown(clearance.order_batch)}` : ''}
            {clearance?.invited_email ? ` to ${clearance.invited_email}` : ''}. Waiting on Checkr; upload the
            results file on{' '}
            <Link href="/admin/volunteers/screening/" className="text-brand underline">
              Background screening
            </Link>{' '}
            when it comes back.
          </>
        ) : (
          <>
            Result uploaded{clearance?.report_completed_at ? ` ${clearance.report_completed_at.slice(0, 10)}` : ''}:{' '}
            <strong>{label}</strong>. Record the ministry&rsquo;s verdict below — a volunteer is approved only
            once it reads OK to serve.
            {clearance?.adjudication && <> ({ADJUDICATION_LABEL[clearance.adjudication] ?? clearance.adjudication})</>}
          </>
        )}
      </p>
    </div>
  );
}

function VolunteerRow({ row, maySeeChecks, canReview = true }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Arriving from the roster (25 Aug). A staff member looking at a volunteer
  // on the roster and wanting their background check had no way across; the
  // link back the other way has always existed. Landing on a collapsed row
  // among thirty others is barely better than not linking at all, so the
  // target opens itself and says which one it is.
  const anchorId = `v-${row.participantId}`;
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    const check = () => {
      const hit = window.location.hash === `#${anchorId}`;
      setLinked(hit);
      if (hit) setOpen(true);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [anchorId]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { person, household, app, clearance } = row;
  const age = fmtAge(person?.date_of_birth);
  const chip = app ? APP_CHIP[app.status] : ['Application: not started', 'bg-neutral-100 text-neutral-500'];
  const place = PLACE_CHIP[row.participantStatus] ?? null;

  // One decision (0152): approving confirms the place, declining waitlists
  // it. The deposit question the registration page asks comes back the same
  // way, as needsOverride.
  async function review(decision) {
    if (
      decision === 'declined' &&
      !window.confirm(
        `Decline ${person?.first_name ?? 'this volunteer'}'s application?\n\nTheir place at camp goes on the waitlist, and the family sees: "Volunteer application not approved — the office will be in touch."`
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
        linked ? 'rounded-lg bg-brand-light/50 ring-2 ring-brand px-3' : ''
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
              {person?.phone}
            </p>
          )}
        </div>
        <span className="flex flex-wrap items-center gap-2 text-xs">
          {place && (
            <Link
              href={`/admin/registrations/${row.registrationId}`}
              title="The place at camp — approved on the registration page"
              className={`rounded-full px-2.5 py-0.5 font-semibold hover:underline ${place[1]}`}
            >
              {place[0]}
            </Link>
          )}
          {/* Both decision pills act (Lawrence, 4 Nov 2026: one was a link,
              one was not): Place opens the registration, where the place is
              approved; Application opens the application review below. */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            title="Open this application — reviewed here"
            className={`rounded-full px-2.5 py-0.5 font-semibold hover:underline ${chip[1]}`}
          >
            {chip[0]}
          </button>
          {/* The Creed is asked, not enforced (29 Sep 2026). An application
              without it is a conversation with Larry that has to happen
              before approval, so the gap is loud here rather than a wall on
              the form. Red on purpose: it must not read as "not asked". */}
          {app && app.status !== 'withdrawn' && (
            <span
              className={`rounded-full px-2.5 py-0.5 font-semibold ${
                row.creedAffirmed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}
              title={
                row.creedAffirmed
                  ? 'Affirmed the Apostles’ Creed on the volunteer application'
                  : row.creedWithdrawn
                    ? 'Affirmed the Apostles’ Creed on an earlier save and left it unticked on the latest one — speak with Larry before approving'
                    : 'Did not affirm the Apostles’ Creed — they were asked to speak with Larry; confirm that has happened before approving'
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
          <span title={pill.title} className={`rounded-full px-2.5 py-0.5 font-semibold ${pill.cls}`}>
            {pill.text}
          </span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`${app?.status === 'applied' && canReview ? 'btn-primary' : 'btn-outline'} py-1! px-3!`}
          >
            {open ? 'Close' : app?.status === 'applied' && canReview ? 'Review application' : 'Application'}
          </button>
        </span>
      </div>

      {open && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-4 text-sm">
          {/* The decision first, then what it rests on. */}
          {canReview && app && app.status !== 'withdrawn' && (
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-neutral-100 pb-3">
              {/* Say what is waiting (Lawrence, 4 Nov 2026: "what is still
                  awaiting review? not obvious when I look at her
                  application"): the application itself, until someone
                  approves or declines it, and what that rests on. */}
              <span className="mr-1 font-semibold">
                {app.status === 'applied'
                  ? 'Waiting on your decision — read the application below, then:'
                  : app.status === 'approved'
                    ? `Approved${app.reviewed_at ? ` ${new Date(app.reviewed_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}` : ''}. Change it:`
                    : `Declined${app.reviewed_at ? ` ${new Date(app.reviewed_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}` : ''}. Change it:`}
              </span>
              {app.status !== 'approved' && (
                <button
                  onClick={() => review('approved')}
                  disabled={pending || !cleared}
                  title={cleared ? undefined : 'Needs a background check on file marked OK to serve — record it below'}
                  className="btn-primary py-1.5! text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Approve
                </button>
              )}
              {app.status !== 'declined' && (
                <button
                  onClick={() => review('declined')}
                  disabled={pending}
                  className="rounded-sm border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  Decline
                </button>
              )}
              <span className="w-full text-xs text-neutral-600">
                Before deciding: {row.creedAffirmed ? 'Creed affirmed' : 'Creed not affirmed — speak with Larry first'} · {pill.text}
                {!cleared && app.status !== 'approved' && (
                  <strong className="text-red-800"> — approval waits for a background check marked OK to serve (below)</strong>
                )}
                . One decision: approving also confirms their place at camp; declining puts the place on the waitlist.
              </span>
            </div>
          )}
          {app ? (
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mb-3">
              <div>
                <dt className="text-xs font-semibold text-neutral-500">Age</dt>
                <dd>
                  {age != null ? `${age}` : 'unknown — no birth date on file'}
                  {person?.date_of_birth && (
                    <span className="text-neutral-500"> (b. {person.date_of_birth})</span>
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
              <div>
                <dt className="text-xs font-semibold text-neutral-500">First time?</dt>
                <dd>{app.first_time_volunteering == null ? '—' : app.first_time_volunteering ? 'Yes' : 'No — returning'}</dd>
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
                    {age != null ? `${age}` : 'unknown — no birth date on file'}
                    {person?.date_of_birth && (
                      <span className="text-neutral-500"> (b. {person.date_of_birth})</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-neutral-500">Sex / gender</dt>
                  <dd>{person?.gender || '—'}</dd>
                </div>
              </dl>
              <p className="text-neutral-500">
                No application filed yet — the family completes it at /register/volunteer (their
                dashboard reminds them).
              </p>
            </div>
          )}

          {error && <p className="mt-2 text-red-700 text-sm">{error}</p>}

          {maySeeChecks ? (
            <ClearanceEditor
              personId={person?.id}
              clearance={clearance}
              email={person?.email || household?.email}
            />
          ) : (
            <p className="mt-4 rounded-sm border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
              The pill above is all you can see: on file, current, and the verdict. The record
              itself (dates, what Checkr said, who decided) is kept by administrators. Ask one if
              something looks wrong.
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
  review: (r) => r.app?.status === 'applied',
  noapp: (r) => !r.app,
  check: (r) => Boolean(r.person?.id) && !isMinor(r.person?.date_of_birth) && clearancePill(r.clearance).key !== 'ok',
};

export default function VolunteerManager({ groups, maySeeChecks = false, canReview = true }) {
  const [show, setShow] = useState('all');
  const total = groups.reduce((s, g) => s + g.rows.length, 0);
  const needsReview = groups.reduce(
    (s, g) => s + g.rows.filter((r) => r.app?.status === 'applied').length,
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-bold mb-1">Volunteers</h2>
        {/* Ordering checks is a batch job, not a per-person one -- Checkr's
            bulk upload takes a whole list at once -- so it gets its own screen
            rather than a button on every row. */}
        {maySeeChecks && (
          <Link href="/admin/volunteers/screening" className="btn-outline py-2! shrink-0">
            Background screening
          </Link>
        )}
      </div>
      <p className="text-sm text-neutral-500 mb-6 max-w-4xl">
        Everyone registered with the Volunteer role, with their application and background-check
        status. The background-check paperwork itself lives in the restricted SharePoint folder. The
        record here — ordering, the import from Checkr (the background-check company), the
        background-check date and the verdict — is an
        administrator&rsquo;s to keep; everyone else on staff sees on file, current, and the
        verdict.
      </p>

      <div className="flex flex-wrap gap-4 mb-6 text-sm">
        {[
          ['all', total, 'registered', ''],
          ['review', needsReview, needsReview === 1 ? 'application to decide' : 'applications to decide', 'text-amber-700'],
          ['noapp', noApp, 'no application yet', 'text-neutral-600'],
          [
            'check',
            missingCheck.size,
            missingCheck.size === 1 ? 'adult without a background check' : 'adults without a background check',
            missingCheck.size > 0 ? 'text-amber-700' : 'text-green-700',
          ],
        ].map(([key, n, label, tone]) => (
          <button
            key={key}
            type="button"
            onClick={() => setShow(show === key && key !== 'all' ? 'all' : key)}
            aria-pressed={show === key}
            title={
              key === 'check'
                ? 'Adults (counted once, however many weeks they serve) without a current background check marked OK; under-18s are not screened. Click to show only them.'
                : key === 'all'
                  ? 'Show everyone'
                  : 'Click to show only these; click again for everyone'
            }
            className={`rounded-lg border px-4 py-2 text-left ${
              show === key ? 'border-brand bg-brand-light ring-1 ring-brand' : 'border-neutral-200 bg-white hover:border-brand'
            }`}
          >
            <span className={`font-bold text-lg ${tone}`}>{n}</span> {label}
          </button>
        ))}
      </div>

      {total === 0 && (
        <p className="text-neutral-500">
          No volunteers registered yet. Volunteers register through the ordinary registration
          flow with the role &ldquo;Volunteer,&rdquo; then complete their application.
        </p>
      )}

      {total > 0 && groups.every((g) => !g.rows.some(SHOWS[show])) && (
        <p className="text-neutral-500">Nobody here matches that.</p>
      )}

      {groups.map((g) => ({ ...g, rows: g.rows.filter(SHOWS[show]) })).filter((g) => g.rows.length > 0).map((g) => (
        <div key={g.event.id} className="rounded-lg bg-white border border-neutral-200 shadow-xs p-5 mb-6">
          <h3 className="font-bold">
            {g.event.name}
            {g.event.starts_on && (
              <span className="font-normal text-sm text-neutral-500">
                {' '}
                ({g.event.starts_on} – {g.event.ends_on})
              </span>
            )}
          </h3>
          <div>
            {g.rows.map((r) => (
              <VolunteerRow key={r.participantId} row={r} maySeeChecks={maySeeChecks} canReview={canReview} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
