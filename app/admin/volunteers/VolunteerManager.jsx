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

const APP_CHIP = {
  applied: ['Applied — needs review', 'bg-amber-100 text-amber-800'],
  approved: ['Approved', 'bg-green-100 text-green-800'],
  declined: ['Declined', 'bg-red-100 text-red-800'],
  withdrawn: ['Withdrawn', 'bg-neutral-200 text-neutral-600'],
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
  background_check_date: 'check date',
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
    <div className="mt-2 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm">
      <p className="font-semibold text-neutral-700 mb-2">Background check record</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onFile} onChange={(e) => setOnFile(e.target.checked)} className="h-4 w-4" />
          Paperwork on file (in the restricted SharePoint folder)
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-neutral-500 mb-0.5">Check date (required when on file)</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-neutral-300 px-2 py-1" />
        </label>
        <span className="text-xs text-neutral-500">
          {clearance?.expires_on
            ? `Expires ${clearance.expires_on} (12 months from the check date)`
            : 'Expiry is worked out from the check date: 12 months — checks are annual.'}
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
          className="mt-2 w-full rounded border border-neutral-300 px-2 py-1"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={pending} className="btn-primary !py-1.5 text-sm">
            {pending ? 'Saving…' : 'Save record'}
          </button>
          {clearance?.paperwork_marked_at && (
            <span className="text-xs text-neutral-500">
              Paperwork marked by {clearance.paperworkByName ?? 'staff'} · {whenLocal(clearance.paperwork_marked_at)}
            </span>
          )}
          {clearance?.verdict_at && (
            <span className="text-xs text-neutral-500">
              Verdict ({CLEARANCE_VERDICT_LABEL[clearance.verdict] ?? clearance.verdict}) by {clearance.verdictByName ?? 'staff'} · {whenLocal(clearance.verdict_at)}
            </span>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-red-700">{error}</p>}
      {(clearance?.log ?? []).length > 0 && (
        <details className="mt-3 text-xs text-neutral-600">
          <summary className="cursor-pointer font-semibold">History ({clearance.log.length} most recent changes)</summary>
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

      <CheckrPanel clearance={clearance} email={email} />
    </div>
  );
}

// PLACEHOLDER. The database columns behind this are live (migration 0029) but
// nothing writes them yet: no API key has been issued and no webhook handler
// exists. It is here so the shape of the finished feature -- and the promise
// that we never touch a Social Security number -- is visible and reviewable
// before anyone wires it up.
function CheckrPanel({ clearance, email }) {
  const status = clearance?.checkr_status ?? 'not_started';
  const [label, tone] = CHECKR_CHIP[status] ?? CHECKR_CHIP.not_started;
  const started = status !== 'not_started';

  return (
    <div className="mt-3 rounded border border-dashed border-neutral-300 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-neutral-700">
          Checkr background check{' '}
          <span className="ml-1 rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
            not connected yet
          </span>
        </p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
      </div>

      <p className="mt-2 text-xs text-neutral-600">
        When this is switched on, Checkr is sent an email address and nothing else. Checkr
        emails the volunteer, the volunteer enters their Social Security number and date of
        birth into <em>Checkr&rsquo;s</em> form, and the result comes back to us as a
        pass/fail. Luke 14 never receives, transmits, or stores the number — which is the
        whole reason to use the API rather than a form of our own.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled
          title="Not available yet — needs a Checkr account administrator and an API key. See the Staff Questions log, section 8."
          className="btn-outline !py-1 !px-3 text-sm opacity-50 cursor-not-allowed"
        >
          Send background-check invitation
        </button>
        <span className="text-xs text-neutral-500">
          would go to {email || 'this volunteer’s email — none on file'}
        </span>
      </div>

      {started && (
        <dl className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div>
            <dt className="font-semibold text-neutral-500">Invited</dt>
            <dd>{clearance?.invitation_sent_at?.slice(0, 10) ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-neutral-500">Report completed</dt>
            <dd>{clearance?.report_completed_at?.slice(0, 10) ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-neutral-500">Package</dt>
            <dd>{clearance?.checkr_package ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-neutral-500">Decision</dt>
            <dd>{ADJUDICATION_LABEL[clearance?.adjudication] ?? '—'}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function VolunteerRow({ row, maySeeChecks }) {
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
  const chip = app ? APP_CHIP[app.status] : ['No application yet', 'bg-neutral-100 text-neutral-500'];

  async function review(decision) {
    setPending(true);
    setError('');
    const res = await reviewVolunteerApplication(row.participantId, decision);
    setPending(false);
    if (!res?.ok) setError(res?.error || 'Could not save.');
    else router.refresh();
  }

  // The same pill every staff member sees on the Buddy board (0091). A
  // volunteer under 18 is not screened, and says so instead of "missing".
  const pill = clearancePill(isMinor(person?.date_of_birth) ? { ...(clearance ?? {}), minor: true } : clearance);

  return (
    <div
      id={anchorId}
      className={`scroll-mt-4 border-t border-neutral-100 py-3 ${
        linked ? 'rounded-lg bg-brand-light/50 ring-2 ring-brand px-3' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {person?.first_name} {person?.last_name}
            {age != null && age < 18 && (
              <span className="ml-2 rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-xs font-semibold">
                under 18
              </span>
            )}
          </p>
          <p className="text-xs text-neutral-500">
            <Link href={`/admin/registrations/${row.registrationId}`} className="text-brand underline">
              {household?.display_name ?? 'Household'}
            </Link>
            {person?.email && <> · {person.email}</>}
            {person?.phone && <> · {person.phone}</>}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-0.5 font-semibold ${chip[1]}`}>{chip[0]}</span>
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
          <button type="button" onClick={() => setOpen((o) => !o)} className="btn-outline !py-1 !px-3">
            {open ? 'Close' : 'Details'}
          </button>
        </span>
      </div>

      {open && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-4 text-sm">
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

          {app && app.status !== 'withdrawn' && (
            <div className="flex flex-wrap gap-2">
              {app.status !== 'approved' && (
                <button onClick={() => review('approved')} disabled={pending} className="btn-primary !py-1.5 text-sm">
                  Approve
                </button>
              )}
              {app.status !== 'declined' && (
                <button
                  onClick={() => review('declined')}
                  disabled={pending}
                  className="rounded border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  Decline
                </button>
              )}
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
            <p className="mt-4 rounded border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
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

export default function VolunteerManager({ groups, maySeeChecks = false }) {
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
          <Link href="/admin/volunteers/screening" className="btn-outline !py-2 shrink-0">
            Background screening
          </Link>
        )}
      </div>
      <p className="text-sm text-neutral-500 mb-6 max-w-prose">
        Everyone registered with the Volunteer role, with their application and background-check
        status. The check paperwork itself lives in the restricted SharePoint folder. The record
        here — ordering, Checkr&rsquo;s import, the check date and the verdict — is an
        administrator&rsquo;s to keep; everyone else on staff sees on file, current, and the
        verdict.
      </p>

      <div className="flex flex-wrap gap-4 mb-6 text-sm">
        <span className="rounded-lg bg-white border border-neutral-200 px-4 py-2">
          <span className="font-bold text-lg">{total}</span> registered
        </span>
        <span className="rounded-lg bg-white border border-neutral-200 px-4 py-2">
          <span className="font-bold text-lg text-amber-700">{needsReview}</span> awaiting review
        </span>
        <span className="rounded-lg bg-white border border-neutral-200 px-4 py-2">
          <span className="font-bold text-lg text-neutral-600">{noApp}</span> no application yet
        </span>
        <span
          className="rounded-lg bg-white border border-neutral-200 px-4 py-2"
          title="Adults (counted once, however many weeks they serve) without a current background check marked OK; under-18s are not screened"
        >
          <span className={`font-bold text-lg ${missingCheck.size > 0 ? 'text-amber-700' : 'text-green-700'}`}>
            {missingCheck.size}
          </span>{' '}
          {missingCheck.size === 1 ? 'adult' : 'adults'} without a background check
        </span>
      </div>

      {total === 0 && (
        <p className="text-neutral-500">
          No volunteers registered yet. Volunteers register through the ordinary registration
          flow with the role &ldquo;Volunteer,&rdquo; then complete their application.
        </p>
      )}

      {groups.map((g) => (
        <div key={g.event.id} className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5 mb-6">
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
              <VolunteerRow key={r.participantId} row={r} maySeeChecks={maySeeChecks} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
