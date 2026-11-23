'use client';

// One person's background check record (0091, 15 Oct 2026; moved out of
// VolunteerManager.jsx 14 Nov 2026 so Background Checks can show it too, for
// volunteers and family adults alike: Fable navigation review). Where their
// VolunteerBadge invite stands (ScreeningPanel), the record staff keep by
// hand (paperwork on file, the check date, the ministry's verdict, the note),
// the suggested note and report file name (RecordHelper), and the log.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setVolunteerClearance } from '@/app/admin/volunteers/actions';
import { CLEARANCE_VERDICT_LABEL, checkDateMin } from '@/lib/format';
import { dayInMorristown, todayInMorristown } from '@/lib/events';

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

// A check recorded by hand (Lawrence, 14 Nov 2026): the note to type and the
// file name for the report in the restricted SharePoint folder, both made from
// the form, each with a Copy button, so every report is named the same way.
// The file name has the check date first so a folder sorts by date, then the
// name and who ran it; nothing else about the person.
const PROVIDERS = [
  ['VolunteerBadge', 'VolunteerBadge'],
  ['other', 'Another way (paper, another company)'],
];
const RESULT_WORDS = {
  ok: 'clear, OK to serve',
  follow_up: 'needs a follow-up conversation',
  not_permitted: 'not permitted to attend',
};
const fileSafe = (s) => String(s ?? '').replace(/["*:<>?/\\|#%{}~&]/g, '').replace(/\s+/g, ' ').trim();
const longDate = (iso) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '';

function CopyLine({ label, text, onUse }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="mt-1.5">
      <span className="block text-xs font-semibold text-neutral-500">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-sm border border-neutral-200 bg-white px-2 py-1 text-xs break-all">{text}</code>
        <button type="button" onClick={copy} className="btn-outline py-0.5! px-2! text-xs">
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        {onUse && (
          <button type="button" onClick={onUse} className="text-xs text-brand underline">
            Put in the note box
          </button>
        )}
      </div>
    </div>
  );
}

function RecordHelper({ firstName, lastName, date, verdict, note: current = '', onUseNote }) {
  const [provider, setProvider] = useState('VolunteerBadge');
  if (!date) {
    return (
      <p className="mt-2 text-xs text-neutral-500">
        Recording a background check done elsewhere? Enter its date and verdict, and the note and the report&rsquo;s file
        name appear here to copy.
      </p>
    );
  }
  const who = `${fileSafe(lastName) || 'Lastname'}, ${fileSafe(firstName) || 'Firstname'}`;
  const by = provider === 'other' ? 'other' : 'VolunteerBadge';
  const fileName = `${date} ${who} - Background check (${by}).pdf`;
  const checkWords = provider === 'other' ? 'Background check' : 'VolunteerBadge background check';
  const result = verdict ? RESULT_WORDS[verdict] : 'verdict not decided yet';
  const note = `${checkWords} dated ${longDate(date)}: ${result}. Recorded by hand. Report filed as: ${fileName}`;
  return (
    <div className="mt-3 rounded-sm border border-blue-200 bg-blue-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold text-blue-900">
          Suggestions for a background check recorded by hand (not saved; only the note box above is saved)
        </span>
        {PROVIDERS.map(([v, label]) => (
          <label key={v} className="flex items-center gap-1">
            <input type="radio" checked={provider === v} onChange={() => setProvider(v)} />
            {label}
          </label>
        ))}
      </div>
      {current.trim() === note ? (
        <p className="mt-1.5 text-xs text-green-800">✓ The suggested note is in the note box.</p>
      ) : (
        <CopyLine label="Suggested note" text={note} onUse={() => onUseNote(note)} />
      )}
      <CopyLine label={`Report file name (restricted SharePoint folder; year folder ${date.slice(0, 4)})`} text={fileName} />
    </div>
  );
}

// The record (0091, 15 Oct 2026): paperwork on file, the check date (the
// expiry follows by policy), and the ministry's verdict -- with who did each
// and when, stamped by the database, and the log underneath.
// canEdit: the Background checks WRITE grant (14 Nov 2026). Read-only
// holders see the record but can't change it (the database refuses anyway).
// showVb false: an adult camper, who isn't sent to VolunteerBadge (15 Nov 2026).
export default function ClearanceEditor({ personId, clearance, vb, email, firstName, lastName, onDone, canEdit = true, showVb = true }) {
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
      {showVb && <ScreeningPanel clearance={clearance} vb={vb} email={email} />}
      <p className="font-semibold text-neutral-700 mb-2">Background check record</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onFile} onChange={(e) => setOnFile(e.target.checked)} className="h-4 w-4" />
          Paperwork on file (in the restricted SharePoint folder)
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-neutral-500 mb-0.5">Background check date (required when on file)</span>
          {/* Not after today, not more than 10 years back: the server's
              rule (checkDateProblem, 23 Nov 2026). */}
          <input
            type="date"
            value={date}
            min={checkDateMin()}
            max={todayInMorristown()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-sm border border-neutral-300 px-2 py-1"
          />
        </label>
        <span className="text-xs text-neutral-500">
          {/* No check date, no expiry: 0108 clears expires_on with the date,
              and a row saved before it may still carry an old one. */}
          {clearance?.background_check_date && clearance?.expires_on
            ? `Expires ${clearance.expires_on} (12 months from the background-check date)`
            : 'Background checks are annual. Expiry is 12 months from the background check date.'}
        </span>
      </div>
      <div className="mt-3">
        <span className="block text-xs font-semibold text-neutral-500 mb-1">Verdict (the ministry&rsquo;s decision)</span>
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
          placeholder="Note (optional), e.g. Spoke with Larry 14 Oct. Cleared to serve with a buddy."
          className="mt-2 w-full rounded-sm border border-neutral-300 px-2 py-1"
        />
        <RecordHelper firstName={firstName} lastName={lastName} date={date} verdict={verdict} note={note} onUseNote={(t) => setNote(t.slice(0, 500))} />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {!canEdit && (
            <span className="text-xs text-neutral-600">
              Changing this record needs the Background checks write grant.
            </span>
          )}
          {canEdit && <button onClick={save} disabled={pending} className="btn-primary py-1.5! text-sm">
            {pending ? 'Saving…' : 'Save record'}
          </button>}
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

// Where this person's background check is (0165, 13 Nov 2026: VolunteerBadge
// replaced Checkr's batch file). Invites go out from Background screening;
// VolunteerBadge emails the person, who signs the consent and types their own
// details on its site; the result word comes back there, and a clear result
// becomes OK to serve only when staff confirm it. A Checkr order still out is
// shown as such. No Social Security number is ever sent to, or held by, Luke 14.
const VB_PANEL = {
  sending: ['Sending didn’t finish', 'bg-amber-100 text-amber-800'],
  invited: ['Invited, waiting on them', 'bg-blue-50 text-blue-700'],
  applied: ['Applied, background check not started', 'bg-blue-50 text-blue-700'],
  processing: ['Background check in progress', 'bg-blue-50 text-blue-700'],
  in_review: ['VolunteerBadge is reviewing', 'bg-blue-50 text-blue-700'],
  clear: ['Clear', 'bg-green-100 text-green-800'],
  consider: ['Needs review in VolunteerBadge', 'bg-red-100 text-red-800'],
  error: ['Not completed', 'bg-neutral-100 text-neutral-600'],
  expired: ['Invite expired', 'bg-neutral-100 text-neutral-600'],
  not_sent: ['Not sent', 'bg-neutral-100 text-neutral-600'],
  cancelled: ['Taken back', 'bg-neutral-100 text-neutral-600'],
  superseded: ['Replaced by a resend', 'bg-neutral-100 text-neutral-600'],
};

// The record below already settles a VolunteerBadge result: a current full
// background check on file, verdict OK or Not permitted. The same rule as
// settledByRecord() in lib/backgroundChecks.js, restated here because that
// file is server-side (Lawrence, 15 Nov 2026: Larry's record said OK to serve
// while this panel still asked for a confirm on Background Screening).
function recordSettles(c) {
  if (!c?.background_check_on_file || c.provider === 'registry_search') return false;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (c.expires_on && c.expires_on < today) return false;
  return c.verdict === 'ok' || c.verdict === 'not_permitted';
}

function ScreeningPanel({ clearance, vb, email }) {
  const checkrStatus = clearance?.checkr_status ?? 'not_started';
  const checkrOut = ['invited', 'pending', 'suspended'].includes(checkrStatus);
  const screening = (
    <Link href="/admin/background-checks/screening/" className="text-brand underline">
      Background Screening
    </Link>
  );
  let title = 'VolunteerBadge';
  let chip = null;
  let words;
  if (vb) {
    const [label, tone] = VB_PANEL[vb.status] ?? [vb.status, 'bg-neutral-100 text-neutral-600'];
    const settled = !vb.confirmedAt && (vb.status === 'clear' || vb.status === 'consider') && recordSettles(clearance);
    chip =
      (vb.status === 'clear' && vb.confirmedAt) || (settled && clearance.verdict === 'ok')
        ? ['OK to serve recorded', 'bg-green-100 text-green-800']
        : [label, tone];
    if (settled) {
      words = (
        <>
          {vb.status === 'clear' ? 'Clear.' : 'Records were released on the report.'} The ministry&rsquo;s verdict is
          recorded below ({CLEARANCE_VERDICT_LABEL[clearance.verdict] ?? clearance.verdict}), so nothing more is needed
          on {screening}.
        </>
      );
    } else if (vb.status === 'clear' && !vb.confirmedAt) {
      words = <>Clear. Confirm it as OK to serve on {screening}.</>;
    } else if (vb.status === 'clear') {
      words = <>Clear, and recorded as OK to serve {dayInMorristown(vb.confirmedAt)}.</>;
    } else if (vb.status === 'consider') {
      words = <>Records were released on the report. Read it in VolunteerBadge, then record the ministry&rsquo;s verdict below.</>;
    } else if (['error', 'expired', 'not_sent', 'cancelled'].includes(vb.status)) {
      words = <>{vb.problem ? `${vb.problem} ` : ''}It can be sent again from {screening}.</>;
    } else {
      words = <>Invite sent {dayInMorristown(vb.sentAt)} to {vb.email}. Updates show on {screening}.</>;
    }
  } else if (checkrOut) {
    title = 'Checkr';
    chip = [checkrStatus === 'suspended' ? 'Suspended at Checkr' : 'Waiting on Checkr', 'bg-blue-50 text-blue-700'];
    words = <>Sent to Checkr{clearance?.invited_email ? ` at ${clearance.invited_email}` : ''}. Its result comes in by hand.</>;
  } else {
    words = (
      <>
        No invite out. Send one from {screening}. It will go to{' '}
        {email || <strong>no email on file (add one first)</strong>}.
      </>
    );
  }
  return (
    <div className="mb-3 rounded-sm border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-neutral-700">{title}</p>
        {chip && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip[1]}`}>{chip[0]}</span>}
      </div>
      <p className="mt-2 text-sm">{words}</p>
      {vb?.idWaived && (
        <p className="mt-1 text-xs font-semibold text-amber-900">
          Sent without VolunteerBadge&rsquo;s photo ID step (staff waived it for this invite).
        </p>
      )}
    </div>
  );
}
