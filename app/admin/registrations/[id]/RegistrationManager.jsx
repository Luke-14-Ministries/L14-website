'use client';

// The interactive half of the registration-management screen. The page
// (page.jsx) is a server component that reads the data under row-level
// security; this component renders it and calls the server actions to change
// it. Every write goes through those actions, so RLS still governs what a
// staff member can actually do -- this file only decides how it looks.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
// The same card the Scholarship Requests queue uses. Shared deliberately: a
// decision has to mean the same thing wherever a registrar makes it.
import ScholarshipReview from '@/app/admin/scholarships/ScholarshipReview';
import { registrationHeads, refundSuggestion, REFUND_FULL_UNTIL_DAYS, isStaleRefund, STALE_REFUND_DAYS } from '@/lib/payments';
import {
  setParticipantStatus,
  updatePerson,
  updateHousehold,
  addParticipant,
  deleteParticipantPermanently,
  setAdjustments,
  addFamilyMessage,
  deleteFamilyMessage,
  setParticipantEnrollment,
  setPersonConsent,
  refundPayment,
} from './actions';

const TSHIRT_SIZES = [
  'Youth S', 'Youth M', 'Youth L',
  'Adult S', 'Adult M', 'Adult L', 'Adult XL', 'Adult 2XL', 'Adult 3XL',
];

// The folding card every section of this page uses (StaffPlanPanel and the
// fees and payments are sections of the Money card, which is one).
import Panel from './Panel';
import ReviewCard from './ReviewCard';
import { eventDateRange, dayInMorristown, todayInMorristown } from '@/lib/events';
import RecheckRefund from '../../payments/RecheckRefund';

const SIGNER_ROLE_LABEL = {
  // "for themselves" was a mis-caption, not just terse: the option it
  // renders says "myself and my household", so a release covering a whole
  // family read as though it covered one person (spotted 25 Aug on a
  // registration containing a seven-year-old).
  // The value every signature taken from 25 Aug onward carries. The older
  // four are kept because the rows that used them are still on file, and a
  // signature is never rewritten.
  all_registered: 'on behalf of everyone on this registration',
  self: 'for themselves and their household',
  parent: 'as a parent',
  guardian: 'as parent or legal guardian',
  account_holder: 'as the account holder',
};

const STATUS_OPTIONS = [
  ['draft', 'Draft'],
  ['submitted', 'Submitted — pending review'],
  ['waitlisted', 'Waitlisted'],
  ['confirmed', 'Confirmed'],
  ['cancelled', 'Cancelled'],
];

const STATUS_CLS = {
  draft: 'bg-neutral-100 text-neutral-700',
  submitted: 'bg-amber-100 text-amber-800',
  waitlisted: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-neutral-200 text-neutral-500',
};

const ROLE_OPTIONS = [
  ['camper', 'Camper'],
  ['parent_guardian', 'Parent/Guardian'],
  ['sibling', 'Sibling'],
  ['caregiver', 'Caregiver'],
  ['volunteer', 'Volunteer'],
  ['childcare', 'Childcare'],
  ['support_team', 'Support team'],
];
const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS);
const ROLE_ORDER = ROLE_OPTIONS.map(([v]) => v);
const ROLE_PLURAL = {
  camper: 'Campers',
  parent_guardian: 'Parents / Guardians',
  sibling: 'Siblings',
  caregiver: 'Caregivers',
  volunteer: 'Volunteers',
  childcare: 'Childcare',
  support_team: 'Support team',
};
const ROLE_BADGE = {
  camper: 'bg-teal-100 text-teal-800',
  parent_guardian: 'bg-neutral-200 text-neutral-700',
  sibling: 'bg-neutral-200 text-neutral-700',
  caregiver: 'bg-purple-100 text-purple-800',
  // Indigo, not amber (Lawrence, 27 Oct 2026): amber is the site's "needs
  // attention" colour, and a volunteer is not a problem. Purple is caregivers'.
  volunteer: 'bg-indigo-100 text-indigo-800',
  childcare: 'bg-blue-100 text-blue-800',
  support_team: 'bg-blue-100 text-blue-800',
};

const PAY_METHOD_LABEL = {
  card: 'Card',
  bank_transfer: 'Bank transfer',
  check: 'Check',
  cash: 'Cash',
  other: 'Other',
};

// Always two decimals: "$247.5" (the half-dollar both-weeks discount) read as
// a typo to the 29 Sep testers, and Event Payments already prints "$247.50".
const money = (c) =>
  `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const inputCls =
  'w-full rounded-sm border border-neutral-300 px-3 py-1.5 text-sm';
const labelCls = 'block text-xs font-semibold text-neutral-500 mb-1';

// A tiny inline banner used by every sub-form to show a save error.
function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p className="mt-2 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}

// Under a waitlisted person's status (0128): why, as the family also reads it.
function WaitlistReason({ participant }) {
  if (participant.status !== 'waitlisted') return null;
  return (
    <p className="mt-1 max-w-xs text-xs text-orange-900">
      {participant.waitlist_reason ? (
        <>Why: &ldquo;{participant.waitlist_reason}&rdquo; <span className="text-neutral-500">(the family sees this)</span></>
      ) : (
        <span className="text-neutral-500">No waitlist reason recorded</span>
      )}
    </p>
  );
}

// --- the per-participant status control (#14) --------------------------------
function StatusControl({ registrationId, participant }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');

  function change(e) {
    const next = e.target.value;
    setError('');
    // Waitlisting says why (0128), asked the way this control already asks
    // about a short deposit. Cancelling the prompt changes nothing.
    let options = {};
    if (next === 'waitlisted') {
      const typed = window.prompt(
        'Why is this person waitlisted? (required, up to 500 characters)\n\nThe family can see this reason.',
        ''
      );
      const reason = (typed ?? '').trim();
      if (!reason) {
        if (typed != null) setError('Say why they are waitlisted — nothing was changed.');
        router.refresh(); // put the dropdown back where it was
        return;
      }
      if (reason.length > 500) {
        setError('Keep the waitlist reason to 500 characters — nothing was changed.');
        router.refresh();
        return;
      }
      options = { reason };
    }
    start(async () => {
      const res = await setParticipantStatus(registrationId, participant.id, next, options);
      if (res.needsOverride) {
        // The deposit is short. Say the numbers and let the registrar decide
        // — a cheque in the post is real, and a block they cannot pass is
        // worked around by recording a payment that never happened.
        if (window.confirm(`${res.error}

Confirm anyway?`)) {
          const forced = await setParticipantStatus(
            registrationId,
            participant.id,
            next,
            { ...options, override: true }
          );
          if (!forced.ok) setError(forced.error);
          else router.refresh();
        } else {
          setError('');
          router.refresh(); // put the dropdown back where it was
        }
        return;
      }
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        {/* The select is the pill (15 Oct 2026): it used to sit beside a
            read-only pill saying the same word. Same colours as every other
            status pill; the arrow is the only sign it can be changed. */}
        <select
          value={participant.status}
          onChange={change}
          disabled={pending}
          aria-label="Change status"
          className={`cursor-pointer rounded-full border-0 py-1 pl-3 pr-7 text-xs font-semibold ${
            STATUS_CLS[participant.status] ?? STATUS_CLS.submitted
          }`}
        >
          {STATUS_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        {pending && <span className="text-xs text-neutral-400">saving…</span>}
      </div>
      <WaitlistReason participant={participant} />
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

// --- edit one camper's details (#15) -----------------------------------------
function PersonEditor({ registrationId, person, onDone }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [f, setF] = useState({
    first_name: person.first_name ?? '',
    last_name: person.last_name ?? '',
    preferred_name: person.preferred_name ?? '',
    date_of_birth: person.date_of_birth ?? '',
    gender: person.gender ?? '',
    email: person.email ?? '',
    phone: person.phone ?? '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function save(confirmIdentityChange = false) {
    setError('');
    start(async () => {
      const res = await updatePerson(registrationId, person.id, f, {
        confirmIdentityChange,
      });
      if (!res.ok) {
        // The server refuses an unconfirmed name or date-of-birth change on a
        // live registration and explains why. Repeat that explanation here
        // and let the registrar decide -- staff DO need to fix typos, they
        // just should not do it without seeing what it touches. Saying yes
        // re-submits with the flag set; the edit is logged either way
        // (migration 0046).
        if (res.needsConfirm) {
          const ok = window.confirm(`${res.error}\n\nMake this change anyway?`);
          if (ok) save(true);
          else setError('');
          return;
        }
        setError(res.error);
        return;
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>First name <span className="text-red-600">*</span></label>
          <input className={inputCls} value={f.first_name} onChange={set('first_name')} />
        </div>
        <div>
          <label className={labelCls}>Last name <span className="text-red-600">*</span></label>
          <input className={inputCls} value={f.last_name} onChange={set('last_name')} />
        </div>
        <div>
          <label className={labelCls}>Preferred name</label>
          <input className={inputCls} value={f.preferred_name} onChange={set('preferred_name')} />
        </div>
        <div>
          <label className={labelCls}>Date of birth</label>
          <input type="date" className={inputCls} value={f.date_of_birth} onChange={set('date_of_birth')} min="1900-01-01" max={todayInMorristown()} />
        </div>
        <div>
          <label className={labelCls}>Sex</label>
          <select className={inputCls} value={f.gender} onChange={set('gender')}>
            <option value="">— select —</option>
            <option>Male</option>
            <option>Female</option>
            {/* Preserve any nonstandard value already on the record. */}
            {f.gender && !['Male', 'Female'].includes(f.gender) && (
              <option>{f.gender}</option>
            )}
          </select>
        </div>
        <div>
          <label className={labelCls}>Email</label>
          <input className={inputCls} value={f.email} onChange={set('email')} />
        </div>
        <div>
          <label className={labelCls}>Phone</label>
          <input className={inputCls} value={f.phone} onChange={set('phone')} />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-3 flex gap-2">
        <button onClick={() => save()} disabled={pending} className="btn-primary py-1.5! text-sm">
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onDone} disabled={pending} className="btn-outline py-1.5! text-sm">
          Cancel
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        Medical and support details are edited on the Medical &amp; Support screen, which is a
        separate permission.
      </p>
    </div>
  );
}

// --- scholarship / discount editor -------------------------------------------
function AdjustmentsEditor({ registrationId, participant, onDone }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [f, setF] = useState({
    scholarship: ((participant.scholarship_cents ?? 0) / 100).toFixed(2),
    discount: ((participant.discount_cents ?? 0) / 100).toFixed(2),
    note: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function save() {
    setError('');
    start(async () => {
      const res = await setAdjustments(registrationId, participant.id, f);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <h4 className="font-semibold mb-1 text-sm">Scholarship &amp; discount</h4>
      <p className="text-xs text-neutral-500 mb-3">
        Reduces what this person owes. Flows into the family&rsquo;s balance, their dashboard,
        and the printable statement automatically. Fee: {money(participant.fee_cents)}.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls}>Scholarship ($)</label>
          <input className={inputCls} inputMode="decimal" value={f.scholarship} onChange={set('scholarship')} />
        </div>
        <div>
          <label className={labelCls}>Discount ($)</label>
          <input className={inputCls} inputMode="decimal" value={f.discount} onChange={set('discount')} />
        </div>
        <div className="sm:col-span-3">
          <label className={labelCls}>Note (kept with the scholarship record)</label>
          <input className={inputCls} value={f.note} onChange={set('note')} placeholder="e.g. Board-approved hardship scholarship" />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-3 flex gap-2">
        <button onClick={() => save()} disabled={pending} className="btn-primary py-1.5! text-sm">
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onDone} disabled={pending} className="btn-outline py-1.5! text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- one participant row ------------------------------------------------------
function ParticipantRow({
  registrationId,
  participant,
  awaitingScholarship = false,
  canWrite = true,
  canSeeMoney = true,
  canDecide = true,
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const p = participant.person ?? {};
  const isCancelled = participant.status === 'cancelled';

  function run(fn) {
    setError('');
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  // Everyday "remove" is reversible: it just sets the status to cancelled, which
  // you can undo with Restore. Nothing leaves the database.
  function cancel() {
    if (
      !confirm(
        `Remove ${p.first_name} ${p.last_name} from this week?\n\nThis is reversible — they move to "cancelled" and you can Restore them at any time. Nothing is deleted.`
      )
    )
      return;
    run(() => setParticipantStatus(registrationId, participant.id, 'cancelled'));
  }
  function restore() {
    run(() => setParticipantStatus(registrationId, participant.id, 'submitted'));
  }
  // Only offered on an already-cancelled row, and it says plainly that it cannot
  // be undone.
  function hardDelete() {
    if (
      !confirm(
        `Permanently delete ${p.first_name} ${p.last_name} from this registration?\n\nThis CANNOT be undone. Their household record stays; only this week's entry is removed.`
      )
    )
      return;
    run(() => deleteParticipantPermanently(registrationId, participant.id));
  }

  return (
    // The Review card links each decided person here (#person-<id>, 0128);
    // People on this week opens itself for it (Panel's opensFor).
    <div
      id={`person-${participant.id}`}
      className="scroll-mt-4 border-t border-neutral-100 py-4 first:border-t-0 target:rounded-sm target:bg-amber-50"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
        {/* As on Check-In: absent when there is no photo, or when this staff
            member does not hold Sensitive read (lib/photos.js). */}
        {participant.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={participant.photoUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full object-cover border border-neutral-200"
          />
        )}
        <div className="min-w-0">
          <p className="font-semibold">
            {p.first_name} {p.last_name}
            {p.preferred_name ? (
              <span className="font-normal text-neutral-500"> (&ldquo;{p.preferred_name}&rdquo;)</span>
            ) : null}
            <span
              className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-semibold align-middle ${
                ROLE_BADGE[participant.camp_role] ?? 'bg-neutral-200 text-neutral-700'
              }`}
            >
              {ROLE_LABEL[participant.camp_role] ?? participant.camp_role}
            </span>
          </p>
          <p className="text-sm text-neutral-500">
            {canSeeMoney && money(participant.fee_cents)}
            {canSeeMoney && (participant.scholarship_cents ?? 0) > 0 && (
              <span className="text-green-700"> − {money(participant.scholarship_cents)} scholarship</span>
            )}
            {canSeeMoney && (participant.discount_cents ?? 0) > 0 && (
              <span className="text-green-700">
                {' '}
                &minus; {money(participant.discount_cents)} discount
                {/* WHY, not just how much. A credit with no explanation is one
                    staff cannot check and cannot defend to a family who asks.
                    A reason means a rule applied it (0070); no reason means a
                    person did, by hand, and that is its own answer. */}
                {participant.discount_reason ? (
                  <span className="text-neutral-500"> ({participant.discount_reason})</span>
                ) : (
                  <span className="text-neutral-500"> (set by staff)</span>
                )}
              </span>
            )}
            {canSeeMoney ? ' · ' : ''}
            {p.date_of_birth ? `b. ${p.date_of_birth}` : 'no DOB on file'}
            {participant.tshirt_size ? ` · ${participant.tshirt_size}` : ''}
          </p>
          {/* Surfaced on the summary line, not hidden behind the editor: a
              registrar looking at a family should not have to open a panel to
              discover the family asked us not to photograph someone. */}
          {(participant.media?.granted === false ||
            participant.directory?.granted === false ||
            participant.first_time_attending === true ||
            awaitingScholarship) && (
            <p className="mt-1 flex flex-wrap gap-1">
              {/* Amber here for the same reason as everywhere else: work
                  outstanding. It links up to the card at the top rather than
                  duplicating the controls, so there is one place a decision
                  gets made. */}
              {awaitingScholarship && (
                <a
                  href="#scholarship-requests"
                  className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-900 hover:bg-amber-300"
                >
                  asked for help with the fee →
                </a>
              )}
              {participant.media?.granted === false && (
                <span className="rounded-full bg-neutral-800 text-white px-2 py-0.5 text-[11px] font-semibold">
                  no photos
                </span>
              )}
              {participant.directory?.granted === false && (
                <span className="rounded-full bg-neutral-200 text-neutral-700 px-2 py-0.5 text-[11px] font-semibold">
                  not in directory
                </span>
              )}
              {participant.first_time_attending === true && (
                <span className="rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-[11px] font-semibold">
                  first time
                </span>
              )}
            </p>
          )}
        </div>
        </div>
        {canWrite ? (
          <StatusControl registrationId={registrationId} participant={participant} />
        ) : (
          <div className="shrink-0">
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700">
              {participant.status}
            </span>
            <WaitlistReason participant={participant} />
          </div>
        )}
      </div>

      {(canWrite || canDecide) && (
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {/* Each panel is named by what is IN it, and closes by name.
            "Edit details" and "Enrollment details" sat side by side saying
            almost the same thing (25 Aug), and all three closed to a bare
            "Close" -- so with two panels open the page offered two identical
            links that did different things. */}
        {canWrite && (
          <button onClick={() => setEditing((v) => !v)} className="text-brand underline">
            {editing ? 'Close personal details' : 'Personal details'}
          </button>
        )}
        {canDecide && (
          <button onClick={() => setAdjusting((v) => !v)} className="text-brand underline">
            {adjusting ? 'Close scholarship / discount' : 'Scholarship / discount'}
          </button>
        )}
        {canWrite && (
          <button onClick={() => setEnrolling((v) => !v)} className="text-brand underline">
            {enrolling ? 'Close enrollment details' : 'Enrollment details'}
          </button>
        )}
        {!canWrite ? null : isCancelled ? (
          <>
            <button onClick={restore} disabled={pending} className="text-brand underline">
              {pending ? 'Working…' : 'Restore'}
            </button>
            <button onClick={hardDelete} disabled={pending} className="text-red-700 underline">
              {pending ? 'Working…' : 'Permanently delete'}
            </button>
          </>
        ) : (
          <button onClick={cancel} disabled={pending} className="text-red-700 underline">
            {pending ? 'Working…' : 'Cancel (remove from week)'}
          </button>
        )}
      </div>
      )}
      <ErrorNote>{error}</ErrorNote>

      {editing && (
        <PersonEditor
          registrationId={registrationId}
          person={{ id: participant.person?.id, ...p }}
          onDone={() => setEditing(false)}
        />
      )}
      {adjusting && (
        <AdjustmentsEditor
          registrationId={registrationId}
          participant={participant}
          onDone={() => setAdjusting(false)}
        />
      )}
      {enrolling && (
        <EnrollmentEditor
          registrationId={registrationId}
          participant={participant}
          onDone={() => setEnrolling(false)}
        />
      )}
    </div>
  );
}

// --- enrolment answers and permissions, per person ---------------------------
//
// T-shirt size and "first time?" are ordinary edits. The two permissions are
// not: person_consents is append-only, so saving one INSERTS a new dated row
// rather than overwriting the old answer. A withdrawn permission must not
// erase the fact that an earlier one was in force when something was
// published, which is why staff can record a change here but nothing on this
// screen can rewrite history.
function EnrollmentEditor({ registrationId, participant, onDone }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [tshirt, setTshirtRaw] = useState(participant.tshirt_size ?? '');
  const [firstTime, setFirstTimeRaw] = useState(
    participant.first_time_attending === true
      ? 'true'
      : participant.first_time_attending === false
        ? 'false'
        : ''
  );
  // Any edit flips the button back from "Saved" to "Save" (site-wide pattern,
  // 24 Aug -- the old behavior here closed the panel a beat after saving,
  // which read as the option disappearing).
  const setTshirt = (v) => {
    setSaved(false);
    setTshirtRaw(v);
  };
  const setFirstTime = (v) => {
    setSaved(false);
    setFirstTimeRaw(v);
  };
  const personId = participant.person?.id;
  const who = participant.person?.first_name || 'this person';

  function saveEnrollment() {
    setError('');
    start(async () => {
      const res = await setParticipantEnrollment(registrationId, participant.id, {
        tshirt,
        firstTime,
      });
      if (!res.ok) setError(res.error);
      else {
        // The panel STAYS OPEN and the button says Saved -- no auto-close.
        setSaved(true);
        router.refresh();
      }
    });
  }

  function saveConsent(kind, granted) {
    setError('');
    start(async () => {
      const res = await setPersonConsent(registrationId, personId, kind, granted);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-sm border border-neutral-200 bg-neutral-50 p-4 text-sm">
      {/* Two separate things in one panel, and testing asked the fair question
          -- why are they grouped at all? Because they share one trait that
          matters more than their subject: both are answers the FAMILY gave on
          the registration form, and this is the one screen where staff can
          correct them for a family who phoned in. They are not, however, the
          same KIND of record, so each half now says what it is:
          enrolment answers overwrite; permissions never do (see below). */}
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
        Enrollment answers
      </p>
      <p className="text-xs text-neutral-500 mb-2">
        Ordinary edits — saving replaces the previous answer.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-semibold text-neutral-500 mb-0.5">T-shirt size</span>
          <select
            value={tshirt}
            onChange={(e) => setTshirt(e.target.value)}
            className="rounded-sm border border-neutral-300 px-2 py-1 bg-white"
          >
            <option value="">— not answered —</option>
            {TSHIRT_SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-neutral-500 mb-0.5">First time?</span>
          <select
            value={firstTime}
            onChange={(e) => setFirstTime(e.target.value)}
            className="rounded-sm border border-neutral-300 px-2 py-1 bg-white"
          >
            <option value="">— not answered —</option>
            <option value="true">Yes</option>
            <option value="false">No — been before</option>
          </select>
        </label>
        <button onClick={saveEnrollment} disabled={pending} className="btn-primary py-1.5! text-sm">
          {pending ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      <div className="mt-4 space-y-2 border-t border-neutral-200 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Permissions
        </p>
        <p className="text-xs text-neutral-500">
          A different kind of record: these are kept as a dated history, never
          overwritten.
        </p>
        <ConsentRow
          label="Photos & video"
          help={`We may feature ${who} in published material. Recording "no" does not promise they never appear in a wide group shot.`}
          record={participant.media}
          disabled={pending || !personId}
          onSet={(v) => saveConsent('media', v)}
        />
        <ConsentRow
          label="Participant directory"
          help={`Include ${who} in the list shared with other attending families.`}
          record={participant.directory}
          disabled={pending || !personId}
          onSet={(v) => saveConsent('directory', v)}
        />
        <p className="text-xs text-neutral-500">
          Changing one of these records a new dated entry — the previous answer is kept, not
          replaced.
        </p>
      </div>

      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

function ConsentRow({ label, help, record, disabled, onSet }) {
  const value = record?.granted;
  const state =
    value === true ? ['Yes', 'bg-green-100 text-green-800'] :
    value === false ? ['No', 'bg-red-100 text-red-800'] :
    ['Never asked', 'bg-neutral-200 text-neutral-600'];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold w-40 shrink-0">{label}</span>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${state[1]}`}>
        {state[0]}
      </span>
      {record?.recorded_at && (
        <span className="text-xs text-neutral-500">
          {dayInMorristown(record.recorded_at)}
          {record.recorded_as === 'staff' ? ' · entered by staff' : ' · from the family'}
        </span>
      )}
      <span className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={() => onSet(true)}
          disabled={disabled || value === true}
          className="btn-outline py-1! px-3! text-xs disabled:opacity-40"
        >
          Set yes
        </button>
        <button
          type="button"
          onClick={() => onSet(false)}
          disabled={disabled || value === false}
          className="btn-outline py-1! px-3! text-xs disabled:opacity-40"
        >
          Set no
        </button>
      </span>
      <p className="w-full text-xs text-neutral-500">{help}</p>
    </div>
  );
}

// --- what this household signed ----------------------------------------------
// Per-person signatures (30 Sep 2026): the capacity each person was signed for in.
const PERSON_ROLE_LABEL = {
  self: 'themselves',
  parent_guardian: 'by parent or guardian',
  legal_guardian: 'by legal guardian',
  authorized_adult: 'with their permission, affirmed by the signer',
};

// Open or folded (26 Oct 2026, Lawrence's rule): open while something is
// missing or unconfirmed -- nothing on file, or a signature the family only
// reported ('self_reported') that staff have not confirmed -- and folded once
// everything on file is signed. Which agreements each person still OWES is
// not read on this page; an activity waiver still owed has its own amber
// notice at the top.
function AgreementsCard({ signatures }) {
  if (!signatures || signatures.length === 0) {
    return (
      <Panel title="Signed agreements" count="none on file">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">No signed agreements on file</p>
          <p className="mt-1 text-sm text-amber-800">
            Nothing has been signed for this registration. Families sign during registration;
            a registration created by staff by hand will not have them, and neither will one
            submitted before agreements were introduced (23 Aug 2026).
          </p>
        </div>
      </Panel>
    );
  }

  const first = signatures[0];
  const unconfirmed = signatures.some((sig) => sig.status === 'self_reported');
  return (
    // Folds like the rest of the page (25 Aug). The bar carries the count,
    // because "how many are signed" is the whole question a registrar has
    // about this card — the list of WHICH ones is the follow-up.
    <Panel
      title="Signed agreements"
      count={`${signatures.length} signed`}
      defaultOpen={unconfirmed}
    >
      <p className="text-sm text-neutral-600">
        Signed by <strong>{first.signerName}</strong>{' '}
        {first.personName ? '' : SIGNER_ROLE_LABEL[first.signerRole] ?? ''} on{' '}
        {new Date(first.signedAt).toLocaleString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}
        .
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {signatures.map((s) => (
          <li key={s.id} className="flex flex-wrap items-baseline gap-2">
            <span className="text-green-700" aria-hidden>
              ✓
            </span>
            <span className="font-medium">{s.title}</span>
            {s.version != null && (
              <span className="text-xs text-neutral-400">version {s.version}</span>
            )}
            {s.personName && (
              <span className="text-xs text-neutral-600">
                for {s.personName} ({PERSON_ROLE_LABEL[s.signerRole] ?? s.signerRole})
              </span>
            )}
            {s.status !== 'signed_here' && (
              <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] leading-5 font-semibold text-neutral-600">
                {s.status.replace(/_/g, ' ')}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-neutral-500">
        Signatures are never rewritten — the date on a release is part of the record. If the
        board revises an agreement, the new version is signed alongside, not over the top.
      </p>
    </Panel>
  );
}

// --- add a person by hand (#15) ----------------------------------------------
function AddPerson({ registrationId, options }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  // Possible duplicates the server found in this household (8.3).
  const [dupes, setDupes] = useState([]);
  const [f, setF] = useState({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    gender: '',
    camp_role: 'camper',
    event_option_id: options[0]?.id ?? '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function add(extra = {}) {
    setError('');
    start(async () => {
      const res = await addParticipant(registrationId, { ...f, ...extra });
      if (!res.ok) {
        setError(res.error);
        setDupes(res.duplicates ?? []);
      } else {
        setDupes([]);
        router.refresh();
        setF({
          first_name: '',
          last_name: '',
          date_of_birth: '',
          camp_role: 'camper',
          event_option_id: options[0]?.id ?? '',
        });
        setOpen(false);
      }
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-outline py-2! text-sm mt-4">
        + Add a person to this week
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <h4 className="font-semibold mb-3">Add a person</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>First name <span className="text-red-600">*</span></label>
          <input className={inputCls} value={f.first_name} onChange={set('first_name')} />
        </div>
        <div>
          <label className={labelCls}>Last name <span className="text-red-600">*</span></label>
          <input className={inputCls} value={f.last_name} onChange={set('last_name')} />
        </div>
        <div>
          <label className={labelCls}>Date of birth</label>
          <input type="date" className={inputCls} value={f.date_of_birth} onChange={set('date_of_birth')} min="1900-01-01" max={todayInMorristown()} />
        </div>
        <div>
          <label className={labelCls}>Sex</label>
          <select className={inputCls} value={f.gender} onChange={set('gender')}>
            <option value="">— select —</option>
            <option>Male</option>
            <option>Female</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Role</label>
          <select className={inputCls} value={f.camp_role} onChange={set('camp_role')}>
            {ROLE_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Camp option (sets the fee) <span className="text-red-600">*</span></label>
          <select className={inputCls} value={f.event_option_id} onChange={set('event_option_id')}>
            {options.length === 0 && <option value="">No options published</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} — {money(o.fee_cents)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {dupes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {dupes.map((d) => (
            <button
              key={d.id}
              onClick={() => add({ existing_person_id: d.id })}
              disabled={pending}
              className="btn-primary py-1.5! text-sm"
            >
              Use {d.name}
              {d.date_of_birth ? ` (born ${d.date_of_birth})` : ''}
            </button>
          ))}
          <button onClick={() => add({ confirm_new: true })} disabled={pending} className="btn-outline py-1.5! text-sm">
            Add as a new person anyway
          </button>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button onClick={() => add()} disabled={pending} className="btn-primary py-1.5! text-sm">
          {pending ? 'Adding…' : 'Add person'}
        </button>
        <button onClick={() => setOpen(false)} disabled={pending} className="btn-outline py-1.5! text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- edit the household's contact details (#15) ------------------------------
// A folding card near the foot of the page since 26 Oct 2026 (the family's
// name is already the page's title). Folded, unless the phone or email the
// save below asks about is missing -- then open, with the gap on its bar.
function HouseholdEditor({ registrationId, household }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [f, setF] = useState({
    display_name: household.display_name ?? '',
    email: household.email ?? '',
    phone: household.phone ?? '',
    address_line1: household.address_line1 ?? '',
    address_line2: household.address_line2 ?? '',
    city: household.city ?? '',
    state: household.state ?? '',
    postal_code: household.postal_code ?? '',
    home_church: household.home_church ?? '',
    how_did_you_hear: household.how_did_you_hear ?? '',
    how_did_you_hear_from: household.how_did_you_hear_from ?? '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function save() {
    // A soft check, not a hard stop: staff sometimes genuinely don't have a
    // phone or email yet, so we ask rather than block. (Hard-required fields
    // like a person's name are enforced separately, on the server.)
    const missing = [];
    if (!f.phone.trim()) missing.push('phone number');
    if (!f.email.trim()) missing.push('email');
    if (
      missing.length &&
      !confirm(`This family has no ${missing.join(' and no ')} on file. Save anyway?`)
    )
      return;

    setError('');
    start(async () => {
      const res = await updateHousehold(registrationId, household.id, f);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        setEditing(false);
      }
    });
  }

  const missingContact = [!household.phone && 'phone', !household.email && 'email'].filter(Boolean);

  return (
    <Panel
      title="Family contact"
      count={missingContact.length ? `no ${missingContact.join(' or ')}` : null}
      defaultOpen={missingContact.length > 0}
    >
      {!editing ? (
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold">{household.display_name}</p>
            <p className="text-sm text-neutral-600">
              {household.email || 'no email'}
              {household.phone ? ` · ${household.phone}` : ''}
            </p>
            {(household.address_line1 || household.city) && (
              <p className="text-sm text-neutral-500 mt-1">
                {[household.address_line1, household.address_line2, household.city, household.state, household.postal_code]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            )}
            {(household.home_church || household.how_did_you_hear) && (
              <p className="text-sm text-neutral-500 mt-1">
                {household.home_church && <>Church: {household.home_church}</>}
                {household.home_church && household.how_did_you_hear && ' · '}
                {household.how_did_you_hear && (
                  <>
                    Heard about us: {household.how_did_you_hear}
                    {household.how_did_you_hear_from ? ` (${household.how_did_you_hear_from})` : ''}
                  </>
                )}
              </p>
            )}
          </div>
          <button onClick={() => setEditing(true)} className="text-brand underline text-sm">
            Edit
          </button>
        </div>
      ) : (
        <div>
          <h3 className="text-base font-bold mb-3">Edit household</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Household name</label>
              <input className={inputCls} value={f.display_name} onChange={set('display_name')} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input className={inputCls} value={f.email} onChange={set('email')} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input className={inputCls} value={f.phone} onChange={set('phone')} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Address line 1</label>
              <input className={inputCls} value={f.address_line1} onChange={set('address_line1')} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Address line 2</label>
              <input className={inputCls} value={f.address_line2} onChange={set('address_line2')} />
            </div>
            <div>
              <label className={labelCls}>City</label>
              <input className={inputCls} value={f.city} onChange={set('city')} />
            </div>
            <div>
              <label className={labelCls}>State</label>
              <input className={inputCls} value={f.state} onChange={set('state')} />
            </div>
            <div>
              <label className={labelCls}>Postal code</label>
              <input className={inputCls} value={f.postal_code} onChange={set('postal_code')} />
            </div>
            <div>
              <label className={labelCls}>Home church</label>
              <input className={inputCls} value={f.home_church} onChange={set('home_church')} />
            </div>
            <div>
              {/* Asked once, at the family's first registration, and never again --
                  so this is the only place a wrong or missing answer can be
                  corrected. */}
              <label className={labelCls}>How they heard about us</label>
              <input
                className={inputCls}
                value={f.how_did_you_hear}
                onChange={set('how_did_you_hear')}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Who from / detail</label>
              <input
                className={inputCls}
                value={f.how_did_you_hear_from}
                onChange={set('how_did_you_hear_from')}
              />
            </div>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <div className="mt-3 flex gap-2">
            <button onClick={() => save()} disabled={pending} className="btn-primary py-1.5! text-sm">
              {pending ? 'Saving…' : 'Save changes'}
            </button>
            <button onClick={() => setEditing(false)} disabled={pending} className="btn-outline py-1.5! text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// Short notes TO the family — shown on their dashboard the moment they're
// saved. Kept separate from the staff-internal registration notes. Since 0126
// this is the whole conversation: the family's replies from their dashboard
// are in it too, oldest first, highlighted blue. A family's reply cannot be
// removed (their words are the record); a staff note can.
function FamilyMessages({ registrationId, messages, canWrite = true, defaultOpen = true }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function add() {
    if (!body.trim()) return;
    setPending(true);
    setError('');
    const res = await addFamilyMessage(registrationId, body);
    setPending(false);
    if (!res?.ok) setError(res?.error || 'Could not save.');
    else {
      setBody('');
      router.refresh();
    }
  }
  async function remove(id) {
    if (!confirm('Remove this note? The family will no longer see it.')) return;
    const res = await deleteFamilyMessage(registrationId, id);
    if (!res?.ok) setError(res?.error || 'Could not remove.');
    else router.refresh();
  }

  return (
    <Panel
      title="Notes to and from the family"
      count={messages.length || null}
      id="family-messages"
      defaultOpen={defaultOpen}
    >
      <p className="text-sm text-neutral-500 mb-3">
        Shown on the family&rsquo;s dashboard under this registration — e.g. &ldquo;We added a
        $100 scholarship credit to your registration on 8/17.&rdquo; Everything written here is
        visible to the family, and they can reply from their dashboard; their replies appear
        here in amber. The one note only staff can see is the one kept with a
        scholarship or discount (People on this week → Scholarship &amp; discount → Note).
      </p>
      {messages.length > 0 && (
        <ul className="mb-4 space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-sm border px-3 py-2 text-sm ${
                m.fromFamily ? 'border-amber-300 bg-amber-50' : 'border-neutral-200 bg-neutral-50'
              }`}
            >
              {m.fromFamily && (
                <p className="mb-0.5 text-xs font-bold uppercase tracking-wide text-amber-800">Family replied</p>
              )}
              <p className="text-neutral-800 whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 flex items-center justify-between text-xs text-neutral-500">
                <span>
                  {m.author} · {m.at}
                </span>
                {canWrite && !m.fromFamily && (
                  <button onClick={() => remove(m.id)} className="text-red-700 underline">
                    Remove
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canWrite && <div className="flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a short note the family will see…"
          className="flex-1 rounded-sm border border-neutral-300 px-3 py-2 text-sm"
          maxLength={1000}
        />
        <button onClick={add} disabled={pending || !body.trim()} className="btn-primary py-2! text-sm">
          {pending ? 'Saving…' : 'Post note'}
        </button>
      </div>}
      <ErrorNote>{error}</ErrorNote>
    </Panel>
  );
}


// --- payments and refunds -----------------------------------------------------
//
// A refund reverses one PAYMENT, so this is the only screen where refunding
// makes sense -- Event Payments knows balances, not transactions. Partial is
// the normal case (one child withdraws from three), so the amount box opens
// pre-filled with everything still refundable and is freely editable down.
//
// A section of the Money card since 26 Oct 2026, keeping the id "payments"
// that /admin/payments links to; the Money card opens itself for it.
function PaymentsCard({ registrationId, payments, stripeBase = '', event = null, feePeople = 0, depositWaived = false, canWritePayments = false }) {
  const [openFor, setOpenFor] = useState(null);

  if (payments.length === 0) {
    return (
      <section id="payments" className="scroll-mt-4">
        <h3 className="text-base font-bold mb-1">Payments</h3>
        <p className="text-sm text-neutral-500">Nothing has been paid on this registration yet.</p>
      </section>
    );
  }

  return (
    <section id="payments" className="scroll-mt-4">
      <h3 className="text-base font-bold mb-1">
        Payments <span className="text-sm font-normal text-neutral-500">({payments.length})</span>
      </h3>
      <p className="text-sm text-neutral-500 mb-4">
        Refunds go back against the payment they came from. Card and bank payments are
        refunded through Stripe here; checks and cash are recorded here and paid by the
        ministry.
      </p>
      <ul className="divide-y divide-neutral-100">
        {payments.map((p) => (
          <li key={p.id} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <strong>{money(p.amount_cents)}</strong>
                {(p.fee_cover_cents ?? 0) > 0 && (
                  <span className="text-neutral-500"> + {money(p.fee_cover_cents)} fee cover</span>
                )}
                <span className="text-neutral-500">
                  {' '}· {PAY_METHOD_LABEL[p.method] ?? p.method}
                  {' '}· {dayInMorristown(p.received_on ?? p.created_at)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    p.status === 'refunded'
                      ? 'bg-neutral-200 text-neutral-600'
                      : p.status === 'succeeded'
                        ? 'bg-green-100 text-green-800'
                        : p.status === 'failed'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {p.status}
                </span>
                {p.refundableCents > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpenFor(openFor === p.id ? null : p.id)}
                    className="btn-outline py-1! px-3! text-sm"
                  >
                    {/* "Refund…" read as unfinished rather than as "opens a
                        form" (flagged twice, 25 Aug), and "Cancel" beside a
                        registration is worse — it looks like cancelling the
                        PLACE. Two plain words, and a button rather than a
                        cramped link. */}
                    {openFor === p.id ? 'Close' : 'Refund'}
                  </button>
                )}
              </span>
            </div>

            {/* Who paid, as recorded at the time. A family can change their
                contact email afterwards -- one did, and the Stripe record was
                then unmatchable by hand (26 Aug). This is the frozen copy
                (migration 0054), so it is allowed to disagree with the
                household's current details: both are true. */}
            <div className="mt-0.5 text-xs text-neutral-500">
              {p.payer_name || p.payer_email ? (
                <>
                  Paid by{' '}
                  {p.payer_name && <span>{p.payer_name}</span>}
                  {p.payer_name && p.payer_email && ' · '}
                  {p.payer_email && <span className="select-all">{p.payer_email}</span>}
                </>
              ) : (
                <span className="italic">Payer not recorded — this payment predates that record.</span>
              )}
              {p.stripe_payment_intent_id && stripeBase && (
                <>
                  {' '}·{' '}
                  <a
                    href={`${stripeBase}/payments/${p.stripe_payment_intent_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand underline"
                  >
                    open in Stripe ↗
                  </a>
                </>
              )}
            </div>

            {p.refunds.length > 0 && (
              <ul className="mt-2 ml-4 space-y-1 border-l-2 border-neutral-100 pl-3 text-sm">
                {p.refunds.map((r) => (
                  <li key={r.id} className="text-neutral-600">
                    Refunded <strong>{money(r.amount_cents)}</strong>
                    {(r.fee_cover_cents ?? 0) > 0 && ` + ${money(r.fee_cover_cents)} fee`}
                    {' '}· {dayInMorristown(r.refunded_on ?? r.created_at)}
                    {' '}· <span className="italic">{r.reason || 'no reason recorded'}</span>
                    {/* `reason` is written for the family -- it is printed on
                        their dashboard. `note` is where a refund that arrived
                        from outside this screen explains itself, so staff need
                        it here or a Stripe-dashboard refund looks like one of
                        ours. */}
                    {r.note && <span className="block text-xs text-neutral-500">{r.note}</span>}
                    {r.status !== 'succeeded' && !isStaleRefund(r) && (
                      <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        {r.status}
                      </span>
                    )}
                    {/* Pending past STALE_REFUND_DAYS: something went wrong
                        (lib/payments.js). Said plainly, with where to look. */}
                    {isStaleRefund(r) && (
                      <span
                        className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-400"
                        title={`A refund normally clears within a few business days; this one has been pending more than ${STALE_REFUND_DAYS} days. Check it in Stripe.`}
                      >
                        ⚑ pending since {dayInMorristown(r.created_at)} — check Stripe
                      </span>
                    )}
                    {/* Ask Stripe directly and record its answer (refundRecheckAction.js). */}
                    {isStaleRefund(r) && canWritePayments && <RecheckRefund refundId={r.id} />}
                    {/* Proof it reached Stripe, and the way to go and look
                        (26 Aug: "no indication of any handshake"). It HAD
                        reached Stripe — the id was recorded and never shown,
                        so there was no way to check and no reason to believe
                        it had worked.

                        Bank refunds get a `pyr_` id with no page of its own,
                        so the link goes to the PAYMENT, where Stripe lists its
                        refunds. */}
                    {r.stripe_refund_id && (
                      <span className="block text-xs text-neutral-500">
                        Sent to Stripe ·{' '}
                        {p.stripe_payment_intent_id && stripeBase ? (
                          <a
                            href={`${stripeBase}/payments/${p.stripe_payment_intent_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand underline"
                          >
                            open this payment in Stripe ↗
                          </a>
                        ) : (
                          'see the payment in Stripe'
                        )}
                        <span className="ml-1 font-mono select-all">{r.stripe_refund_id}</span>
                      </span>
                    )}
                  </li>
                ))}
                {p.refundableCents > 0 && (
                  <li className="text-neutral-500">
                    {money(p.refundableCents)} of this payment can still be refunded.
                  </li>
                )}
              </ul>
            )}

            {openFor === p.id && (
              <RefundForm
                registrationId={registrationId}
                payment={p}
                event={event}
                feePeople={feePeople}
                depositWaived={depositWaived}
                onDone={() => setOpenFor(null)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RefundForm({ registrationId, payment, event = null, feePeople = 0, depositWaived = false, onDone }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  // The rule's arithmetic for THIS payment and today (lib/payments.js). A
  // suggestion: the box opens on it, and the registrar may type anything.
  // Today on the ministry's calendar (Morristown), not UTC: after 8 pm
  // Eastern the UTC date is tomorrow, which moves the 30-day line by a day.
  // A waived deposit was never paid, so there is none to keep.
  const rule = refundSuggestion({
    startsOn: event?.starts_on,
    depositCents: depositWaived ? 0 : event?.deposit_cents ?? 0,
    feePeople,
    refundableCents: payment.refundableCents,
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()),
  });
  // Dollars as typed, opening on the rule's suggestion when there is one and
  // on everything still refundable otherwise.
  const [amount, setAmount] = useState(
    ((rule ? rule.suggested : payment.refundableCents) / 100).toFixed(2)
  );
  const [feeCover, setFeeCover] = useState(false);
  const [reason, setReason] = useState('');
  // One key per refund attempt (0107): pressing Refund twice, or in two tabs,
  // sends one refund. A refused attempt gets a fresh key for the retry.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  const cents = Math.round((parseFloat(amount) || 0) * 100);
  const feeCents = feeCover ? payment.fee_cover_cents ?? 0 : 0;

  function submit() {
    setError('');
    start(async () => {
      const res = await refundPayment(registrationId, {
        paymentId: payment.id,
        amountCents: cents,
        feeCoverCents: feeCents,
        reason,
        requestKey,
      });
      if (!res.ok) {
        setError(res.error);
        if (!res.duplicate) setRequestKey(crypto.randomUUID());
        return;
      }
      onDone();
      router.refresh();
    });
  }

  // Why the button will not go, in the words a registrar needs. Computed once
  // so the tooltip, the line under the button and the disabled state can never
  // tell three different stories.
  const blockedBecause = !reason.trim()
    ? 'Add a reason first — a refund nobody can explain next year is worse than no refund.'
    : cents < 1
      ? 'Enter an amount to refund.'
      : cents > payment.refundableCents
        ? `That is more than the ${money(payment.refundableCents)} still refundable on this payment.`
        : '';

  return (
    <div className="mt-3 rounded-sm border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">
        Refund from this {PAY_METHOD_LABEL[payment.method] ?? payment.method} payment
      </p>
      <p className="mt-0.5 text-xs text-amber-800">
        {payment.isStripe
          ? 'Pressing Refund sends this to Stripe straight away, and it goes back to the card or bank account it came from. Stripe usually shows it to the family within 5–10 days; the reference appears here as soon as it is accepted.'
          : 'This records a refund the ministry pays by check or cash. Nothing is sent anywhere automatically.'}
      </p>

      {rule && (
        <div className="mt-3 rounded-sm border border-amber-200 bg-white px-3 py-2 text-xs text-neutral-700">
          <p className="font-semibold text-neutral-800">The refund rule, worked for this payment</p>
          <p className="mt-0.5">
            The {money(event?.deposit_cents ?? 0)}-a-person deposit is kept
            {feePeople > 0 ? ` (${money((event?.deposit_cents ?? 0) * feePeople)} for ${feePeople} ${feePeople === 1 ? 'person' : 'people'}` : ''}
            {feePeople > 0 && rule.keep < (event?.deposit_cents ?? 0) * feePeople ? `, capped at this payment's ${money(rule.keep)})` : feePeople > 0 ? ')' : ''}
            ; the rest is refunded in full until {REFUND_FULL_UNTIL_DAYS} days before the event and half after.
            {' '}Today is{' '}
            {rule.daysBefore >= 0
              ? `${rule.daysBefore} ${rule.daysBefore === 1 ? 'day' : 'days'} before`
              : `${-rule.daysBefore} ${-rule.daysBefore === 1 ? 'day' : 'days'} after`}{' '}
            the start{rule.half ? ', so half' : ', so in full'}:{' '}
            <strong>{money(payment.refundableCents)} − {money(rule.keep)} = {money(rule.rest)}</strong>
            {rule.half ? <> → half is <strong>{money(rule.suggested)}</strong></> : null}.
          </p>
          <p className="mt-1 text-neutral-500">
            A suggestion, not a lock — if an earlier refund already kept the deposit, or the
            board decided otherwise, type the amount that is right and say why below.
          </p>
          {cents !== rule.suggested && (
            <button
              type="button"
              onClick={() => setAmount((rule.suggested / 100).toFixed(2))}
              className="mt-1 text-brand underline"
            >
              Use {money(rule.suggested)}
            </button>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-semibold text-neutral-600 mb-0.5">Amount</span>
          <span className="flex items-center gap-1">
            <span className="text-neutral-500">$</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-28 rounded-sm border border-neutral-300 px-2 py-1 bg-white"
            />
          </span>
        </label>
        <span className="text-xs text-neutral-600 pb-1.5">
          up to {money(payment.refundableCents)}
        </span>
      </div>

      {(payment.fee_cover_cents ?? 0) > 0 && (
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={feeCover}
            onChange={(e) => setFeeCover(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Also return the {money(payment.fee_cover_cents)} they added to cover processing.
            <span className="block text-xs text-neutral-600">
              Stripe keeps its fee on a refund, so this comes out of ministry funds.
            </span>
          </span>
        </label>
      )}

      <label className="mt-3 block">
        <span className="block text-xs font-semibold text-neutral-600 mb-0.5">
          Reason <span className="text-red-700">(required)</span>
          <span className="font-normal"> — recorded, and visible to the family</span>
        </span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Withdrew from Week 1 — family illness"
          aria-required="true"
          className={`w-full rounded-sm border px-2 py-1 bg-white ${
            reason.trim() ? 'border-neutral-300' : 'border-red-300'
          }`}
        />
      </label>

      {error && (
        <p className="mt-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {/* A greyed button that will not say why is the whole complaint in
            13.2 and 13.4 (26 Aug). The reason is named on the button's own
            tooltip AND in a line beneath it — a tooltip alone fails on the
            phones and tablets staff actually use. */}
        <button
          type="button"
          onClick={submit}
          disabled={pending || Boolean(blockedBecause)}
          title={blockedBecause || `Refund ${money(cents + feeCents)}`}
          className="btn-primary py-1.5! text-sm disabled:opacity-50"
        >
          {pending ? 'Refunding…' : `Refund ${money(cents + feeCents)}`}
        </button>
        <button type="button" onClick={onDone} disabled={pending} className="text-sm underline">
          Cancel
        </button>
        {blockedBecause && !pending && (
          <span className="text-xs font-semibold text-amber-900">{blockedBecause}</span>
        )}
      </div>
    </div>
  );
}

// Which people are on a registration, as a sentence of links to their
// person pages. Cancelled people are left out of the heading but stay in the
// People card below, where their status can be changed.
function PeopleLine({ participants }) {
  const seen = new Set();
  const live = participants.filter((p) => {
    if (p.status === 'cancelled' || !p.person?.id || seen.has(p.person.id)) return false;
    seen.add(p.person.id);
    return true;
  });
  if (live.length === 0) return <span className="text-neutral-500">Nobody active on this registration.</span>;
  return (
    <>
      {live.map((p, i) => (
        <span key={p.person.id}>
          {i > 0 && <span className="text-neutral-400"> · </span>}
          <Link href={`/admin/people/${p.person.id}/`} className="font-medium text-brand-dark hover:underline">
            {p.person.preferred_name || p.person.first_name} {p.person.last_name}
          </Link>
          <span className="text-neutral-500"> ({(p.camp_role ?? '').replace('_', '/')})</span>
        </span>
      ))}
    </>
  );
}

// A week tab's label: "Camp Celebrate 2026 — Week 1" reads "Week 1"; any
// other name ("Adult Adventure Retreat 2026") comes back whole. The dates sit
// under it, so two years' Week 1s still differ, and the full name is in the
// tab's title.
function tabEventName(name) {
  const n = String(name ?? 'Event');
  const m = n.match(/—\s*(Week \d+)\s*$/);
  return m ? m[1] : n;
}

// One week tab (26 Oct 2026). Module level, never inside FamilyHeader
// (CLAUDE.md). The amber dot is page.jsx's staffAttention(): this
// registration is waiting on staff for something, named in the title and
// for screen readers. A registration whose people are all cancelled is shown
// greyed, still a link.
function WeekTab({ reg, active }) {
  const parts = reg.participants ?? [];
  const cancelledOnly = parts.length > 0 && parts.every((p) => p.status === 'cancelled');
  const attention = reg.attention ?? [];
  const live = parts.filter((p) => p.status !== 'cancelled');
  const title = [
    reg.event?.name ?? 'Event',
    live.length === 0
      ? 'nobody active'
      : live.map((p) => `${p.person?.first_name ?? ''} ${p.person?.last_name ?? ''}`.trim()).join(', '),
    attention.length > 0 && `waiting on staff: ${attention.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const cls = `block h-full rounded-md border px-3 py-1.5 text-sm ${
    active
      ? 'border-brand bg-brand/10 text-brand-dark'
      : cancelledOnly
        ? 'border-neutral-200 bg-neutral-50 text-neutral-400 hover:bg-neutral-100'
        : 'border-neutral-200 bg-white text-neutral-800 hover:border-brand hover:bg-neutral-50'
  }`;
  const body = (
    <>
      <span className="flex items-center gap-1.5 font-semibold">
        {tabEventName(reg.event?.name)}
        {attention.length > 0 && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />}
      </span>
      {reg.event?.starts_on && (
        <span className="block text-xs font-normal text-neutral-500">
          {eventDateRange(reg.event.starts_on, reg.event.ends_on)}
        </span>
      )}
      {cancelledOnly && <span className="block text-xs font-normal">cancelled</span>}
      {attention.length > 0 && <span className="sr-only"> — waiting on staff: {attention.join(', ')}</span>}
    </>
  );
  return active ? (
    <span aria-current="page" title={title} className={cls}>
      {body}
    </span>
  ) : (
    <Link href={`/admin/registrations/${reg.id}/`} title={title} className={cls}>
      {body}
    </Link>
  );
}

// The page's shape from 15 Oct 2026 (Lawrence): the FAMILY is the thing, the
// event is where they are going. A registrar opening this page used to see
// the event name as the title, with the family relegated to the breadcrumb --
// which reads backwards when a family is registered for two events and the
// registrar wants to move between them. So: family name on top, the people
// on this registration as links to their person pages, and every event this
// household is registered for.
//
// Since 26 Oct 2026 those events are tabs, one per registration (Lawrence:
// still one page per registration -- approving, the deposit, payments, notes
// and the waitlist all belong to one). This one is the active tab; the
// others link to their own pages and carry an amber dot while they wait on
// staff. A family with one registration still gets its one tab, so the page
// looks the same for everyone. The tabs replace the "<Event> registration
// details" heading that used to sit under this card.
function FamilyHeader({ registration, familyRegistrations, canSeeMoney = true, footnote = null }) {
  // This registration is always a tab, even if the household lookup found
  // nothing to list.
  const tabs = familyRegistrations.some((r) => r.id === registration.id)
    ? familyRegistrations
    : [{ id: registration.id, event: registration.event, participants: registration.participants, attention: [] }, ...familyRegistrations];
  return (
    <div className="mb-6 rounded-lg border border-neutral-200 bg-white px-6 py-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {registration.household?.display_name ?? 'Registration'}
          </h1>
          <p className="mt-1 text-sm">
            <PeopleLine participants={registration.participants ?? []} />
          </p>
        </div>
        {/* The statement is money; without Payments read the page it opens
            sends the staffer back to the Overview (21 Oct screen walk). */}
        {canSeeMoney && <a
          href={`/admin/registrations/${registration.id}/statement`}
          className="btn-outline py-1.5! text-sm"
        >
          Family statement (print)
        </a>}
      </div>

      <div className="mt-4 border-t border-neutral-100 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Registered for
        </p>
        <nav aria-label="This family's registrations" className="mt-2">
          <ul className="flex flex-wrap gap-2">
            {tabs.map((r) => (
              <li key={r.id}>
                <WeekTab reg={r} active={r.id === registration.id} />
              </li>
            ))}
          </ul>
        </nav>
        {tabs.length === 1 && (
          <p className="mt-1 text-xs text-neutral-500">This is the family&rsquo;s only registration.</p>
        )}
        {footnote && <p className="mt-2 text-xs text-neutral-500">{footnote}</p>}
      </div>
    </div>
  );
}

// One line of the money summary. Module level, never inside MoneySummary:
// a component defined inside another remounts on every render (CLAUDE.md).
function MoneyRow({ label, value, note, strong, cls = '' }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? 'font-bold' : ''}`}>
      <span>
        {label}
        {note && <span className="ml-1 font-normal text-neutral-500">{note}</span>}
      </span>
      <span className={`tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

// The money, explained (Lawrence, 15 Oct 2026). The one-line version --
// "Fees $960 − $240 · Paid $950 · Credit $230 · $470 refund on its way" --
// was five true facts with no arithmetic between them, and the refund clause
// was the puzzle: a credit AND a refund on the way, with no line saying what
// the family will owe once the refund clears. Every number here comes from
// the registration_balances view (the same one Event Payments and the family
// dashboard read), and the pending-refund paragraph does the sum.
//
// How the view counts: "paid" is payments that succeeded or are processing,
// minus refunds that have COMPLETED. A refund still pending is not yet taken
// off "paid" (0053: it must not be, or the ministry could be holding all of
// a family's money while the page asks for more). So the balance shown is
// the balance today, and the paragraph says what it becomes.
function MoneySummary({ balance, livePeople, staleRefunds = 0 }) {
  if (!balance) return null;
  const fee = balance.fee_cents ?? 0;
  const scholarship = balance.scholarship_cents ?? 0;
  const discount = balance.discount_cents ?? 0;
  const coupon = balance.coupon_cents ?? 0;
  // 0123: unwaived fees (a returned bank payment, or one staff added) are owed.
  const fees = balance.fees_cents ?? 0;
  const due = fee - scholarship - discount - coupon + fees;
  const paid = balance.paid_cents ?? 0;
  const bal = balance.balance_cents ?? 0;
  const pending = balance.refund_pending_cents ?? 0;
  const refunded = balance.refunded_cents ?? 0;
  const afterPaid = paid - pending;
  const afterBal = bal + pending;

  // An amount owed is just the amount, in amber beside "Balance today" -- the
  // word "Owed" there said it twice (Lawrence, 26 Oct 2026). A credit keeps
  // its word, because a bare green figure could be read either way.
  const balanceText =
    bal < 0 ? `Credit ${money(-bal)}` : bal === 0 ? 'Settled' : money(bal);
  const balanceCls = bal > 0 ? 'text-amber-700' : 'text-green-700';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1 text-sm">
        <MoneyRow label="Fees" note={`${livePeople} ${livePeople === 1 ? 'person' : 'people'}`} value={money(fee)} />
        {scholarship > 0 && <MoneyRow label="− Scholarships" value={money(scholarship)} cls="text-green-700" />}
        {discount > 0 && <MoneyRow label="− Discounts" value={money(discount)} cls="text-green-700" />}
        {coupon > 0 && <MoneyRow label="− Coupons" value={money(coupon)} cls="text-green-700" />}
        {fees > 0 && <MoneyRow label="+ Fees" note="see Fees below" value={money(fees)} cls="text-amber-800" />}
        <div className="border-t border-neutral-200 pt-1">
          <MoneyRow label="Amount due" value={money(due)} strong />
        </div>
        <MoneyRow
          label="Paid"
          note={refunded > 0 ? `after ${money(refunded)} already refunded` : null}
          value={money(paid)}
        />
        <div className="border-t border-neutral-200 pt-1">
          <MoneyRow label="Balance today" value={balanceText} strong cls={balanceCls} />
        </div>
      </div>
      <div className="text-sm text-neutral-700">
        {bal < 0 && pending === 0 && (
          <p>
            The family has paid <strong>{money(-bal)}</strong> more than the amount due. Settle it
            with a refund from the Payments card, or leave it as a credit.
          </p>
        )}
        {bal > 0 && pending === 0 && (
          <p>
            <strong>{money(bal)}</strong> is still owed. No refund is in progress.
          </p>
        )}
        {bal === 0 && pending === 0 && <p>Paid in full. Nothing is owed and nothing is on its way back.</p>}
        {pending > 0 && (
          <>
            <p className="font-semibold text-amber-800">
              {money(pending)} refund on its way
            </p>
            <p className="mt-1">
              A refund of <strong>{money(pending)}</strong> has been sent to the family&rsquo;s card or
              bank but has not cleared yet, so it is not taken off &ldquo;Paid&rdquo; above. Once it
              clears, the family will have paid <strong>{money(afterPaid)}</strong> and the balance
              becomes{' '}
              <strong className={afterBal > 0 ? 'text-amber-700' : 'text-green-700'}>
                {afterBal < 0 ? `a ${money(-afterBal)} credit` : afterBal === 0 ? 'settled' : `${money(afterBal)} owed`}
              </strong>
              . The Payments card lists each refund and its status.
            </p>
            {staleRefunds > 0 && (
              <p className="mt-2 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                <span className="font-semibold">
                  {staleRefunds === 1 ? 'One of these refunds has' : `${staleRefunds} of these refunds have`} been
                  pending more than {STALE_REFUND_DAYS} days.
                </span>{' '}
                A refund normally clears within a few business days, so this may need checking in
                Stripe before the figures above are relied on.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function RegistrationManager({
  registration,
  familyRegistrations = [],
  review = null,
  awaiting = null,
  // The family's reply (0126): { at, unread, messages } or null.
  familyReply = null,
  hold = null,
  // The Apostles' Creed flag (0130, lib/creed.js): { pending, covered } or
  // null when everyone has affirmed it.
  creed = null,
  // For the Review card's "Photographer's list" link.
  eventId = null,
  depositWaived = null,
  // Payments read (0101/0103). Without it the balances read as $0 paid, so
  // the money block, the deposit warning and the payments card are hidden.
  canSeeMoney = true,
  // Registration write (0101). Without it the page is read-only: no status
  // menus, editors, add/cancel, notes or review buttons (Script 5 role gates).
  canWrite = true,
  // Payments + Registration write (0102): the scholarship / discount editor.
  canDecide = true,
  depositCents = 0,
  options,
  adjustmentRecords = [],
  scholarshipRequests = [],
  familyMessages = [],
  signatures = [],
  balance = null,
  // Payments write: offers "Re-check with Stripe" on a stale refund.
  canWritePayments = false,
  // 0123: the Fees panel (server-built, Payments read), a section of Money.
  feesPanel = null,
  // Emails sent to this household (page.jsx, message_log), a card at the end.
  emailsPanel = null,
  // How it is being paid (StaffPlanPanel, server-built, Payments read): the
  // last section of Money.
  planPanel = null,
  // The amber "Activity waiver outstanding" notice (page.jsx), or null.
  waiverNotice = null,
  // From page.jsx for the Money card's rule: { overdue, planTrouble }.
  moneyAlerts = {},
  payments = [],
  stripeBase = '',
}) {
  const parts = registration.participants ?? [];
  // Money (0114) arrives as null for a staffer without Payments read -- the
  // database withholds it, the page does not. A null is "not yours to see",
  // never a free place, so the header fee line below is drawn only when every
  // person's money is actually here; summing nulls as zeros would say "Fees
  // $0.00" to a reviewer who simply cannot read money.
  const moneyKnown = parts.every((p) => p.fee_cents != null);
  const total = moneyKnown ? parts.reduce((s, p) => s + (p.fee_cents ?? 0), 0) : null;
  // Which people are waiting on a decision about the fee, so their row can say
  // so where a registrar is already looking.
  const awaitingScholarship = new Set(scholarshipRequests.map((r) => r.participantId));

  // Is the deposit actually covered? Raised 25 Aug: a family of three had paid
  // one $50 deposit and nothing on the page said the other two were not held.
  // The deposit is per PLACE — three people coming means three places held —
  // and "$50 received" against a $1,440 registration reads as progress when it
  // is really one third of a first step.
  //
  // Cancelled people are not counted: they are not holding a place.
  //
  // Counted by PERSON (29 Sep 2026, §14.2/§14.3): a parent who is also
  // volunteering has two rows here and holds one place.
  const livePeople = registrationHeads(parts);
  const depositEach = registration.event?.deposit_cents ?? 0;
  const depositDue = depositEach * livePeople;
  const depositPaid = balance?.paid_cents ?? 0;
  // A waived deposit (0096) is not short (18 Oct review: the page showed both).
  const depositShort =
    canSeeMoney && !depositWaived && depositEach > 0 && livePeople > 0 && depositPaid < depositDue;
  const adjustments = moneyKnown
    ? parts.reduce((s, p) => s + (p.scholarship_cents ?? 0) + (p.discount_cents ?? 0), 0)
    : 0;

  // --- which cards open by default (Lawrence, 26 Oct 2026) -------------------
  // "Everything default open when items are outstanding and default folded
  // when done." Each rule only sets how a card first draws; a link to it
  // (#review, #people, #person-<id>, #family-messages, #payments, #plan)
  // still opens it, and staff can open or fold any card by hand.
  const anySubmitted = parts.some((p) => p.status === 'submitted');
  const anyWaitlisted = parts.some((p) => p.status === 'waitlisted');
  const replyUnread = Boolean(familyReply?.unread);
  // Review: open while anyone is submitted, the family's reply is unread, it
  // is on hold or waiting on the family, or the review view raises a flag
  // that is still work. Not these, which only inform (they still show on
  // the card and in Awaiting Review):
  //   deposit_waived     -- a decision staff already made (shown green);
  //   media_declined     -- photo permission declined: a standing fact, kept
  //                         for the photographer's list, never "done"
  //                         (Lawrence, 26 Oct 2026: "can fold the declined
  //                         photo and creed");
  //   creed_not_affirmed -- the money view's copy of the Creed flag; the card
  //                         reads creed_status instead (0130).
  // The Creed holds the card open only while someone is waiting on the
  // conversation with Larry -- never recorded, or added or renamed since;
  // once it is recorded it folds.
  const INFO_FLAGS = ['deposit_waived', 'media_declined', 'creed_not_affirmed'];
  const openFlags = (review?.flags ?? []).filter((f) => !INFO_FLAGS.includes(f));
  const creedPending = (creed?.pending.length ?? 0) > 0;
  const reviewOpen =
    anySubmitted || replyUnread || Boolean(hold?.since) || Boolean(awaiting?.since) || openFlags.length > 0 || creedPending;
  // People: open while anyone is submitted or waitlisted, or someone still
  // on the week shows a gap on their row -- no date of birth, or a request
  // for help with the fee waiting on a decision.
  const peopleGaps = parts.some(
    (p) => p.status !== 'cancelled' && (!p.person?.date_of_birth || awaitingScholarship.has(p.id))
  );
  const peopleOpen = anySubmitted || anyWaitlisted || peopleGaps;
  // Money: open when there is something for staff to do with it -- a
  // balance still owed after the due date, a short deposit while someone is
  // still submitted, a payment plan that stopped or has a failed charge
  // waiting to retry, a refund not yet cleared, or a credit to settle (a
  // refund, or a decision to keep it). Folded otherwise: paid in full, and
  // an ordinary balance before its due date, are not work.
  const bal = balance?.balance_cents ?? 0;
  const refundPending =
    (balance?.refund_pending_cents ?? 0) > 0 ||
    payments.some((p) => (p.refunds ?? []).some((r) => r.status === 'pending'));
  const moneyOpen =
    Boolean(moneyAlerts.overdue) ||
    (depositShort && anySubmitted) ||
    Boolean(moneyAlerts.planTrouble) ||
    refundPending ||
    (Boolean(balance) && bal < 0);
  // The state on the Money card's bar, so a folded card still answers "do
  // they owe anything?".
  const moneyState = !balance
    ? null
    : bal > 0
      ? `Owed ${money(bal)}`
      : bal < 0
        ? `Credit ${money(-bal)}`
        : (balance.paid_cents ?? 0) > 0
          ? 'Paid in full'
          : 'Nothing owed';

  return (
    <div>
      {/* A breadcrumb rather than a bare back-link (asked for 24 Aug: "a
          visual indicator of how I got here"). It answers two questions a
          back-link only answers one of -- where this page sits, and where
          the way out goes. The left-hand nav stays lit on Rosters for the
          same reason. */}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm">
        <Link href="/admin/rosters" className="text-brand underline">
          Rosters
        </Link>
        <span aria-hidden className="mx-2 text-neutral-400">
          ›
        </span>
        <span className="text-neutral-600">
          {registration.household?.display_name ?? 'Registration'}
        </span>
      </nav>

      <FamilyHeader
        registration={registration}
        familyRegistrations={familyRegistrations}
        canSeeMoney={canSeeMoney}
        footnote={
          <>
            {/* Without Payments read the balances view returns no row at all
                (0114), so this fallback is what such a staffer sees: the head
                count, and the fees only when the money came through. */}
            {!balance && (
              <>
                {livePeople} {livePeople === 1 ? 'person' : 'people'}
                {canSeeMoney && moneyKnown && (
                  <>
                    {' '}· Fees {money(total)}
                    {adjustments > 0 && <> − {money(adjustments)} scholarships/discounts</>}
                  </>
                )}
                {' · '}
              </>
            )}
            Status changes and edits save immediately.
          </>
        }
      />

      {/* The order from 26 Oct 2026 (Lawrence): what needs a decision first
          (Review, then the conversation with the family), then the people,
          then the money in one card, and the family's contact details and
          agreements last -- looked up, rarely worked on. */}
      <div className="space-y-6">
        {waiverNotice}

        <ReviewCard
          registrationId={registration.id}
          participants={parts.map((p) => ({
            id: p.id,
            status: p.status,
            // A person on the week twice (an older parent-and-volunteer pair from
            // before 0086) gets their role, so the card does not say "Cal, Cal".
            // Only a real id can match: a row whose person did not come back
            // must not pair with another such row (undefined === undefined
            // gave everyone a role label until 4a463d0), and a cancelled row
            // never appears on the card, so it does not count either.
            name:
              `${p.person?.preferred_name || p.person?.first_name || ''} ${p.person?.last_name || ''}`.trim() +
              (p.person?.id &&
              parts.filter((q) => q.status !== 'cancelled' && q.person?.id === p.person.id).length > 1
                ? ` (${ROLE_LABEL[p.camp_role] ?? p.camp_role})`
                : ''),
            // The plain name and the role, always shown together on the
            // "Waiting on your decision" list.
            baseName: `${p.person?.preferred_name || p.person?.first_name || ''} ${p.person?.last_name || ''}`.trim(),
            role: ROLE_LABEL[p.camp_role] ?? p.camp_role,
            // 0128: why waitlisted, and who last changed the status, when.
            waitlistReason: p.waitlist_reason ?? null,
            changedAt: p.status_changed_at ?? null,
            changedBy: p.status_changed_by_name ?? null,
          }))}
          review={review}
          awaiting={awaiting}
          familyReply={familyReply}
          hold={hold}
          creed={creed}
          eventId={eventId}
          depositWaived={depositWaived}
          depositCents={depositCents}
          canWrite={canWrite}
          canDecide={canDecide}
          defaultOpen={reviewOpen}
        />

        {/* A family asking for help with the fee sits with the review.
            It used to be a light-grey line at the bottom reading "$0
            requested" (the amount was never even loaded), which is how the
            most consequential thing on the screen ended up looking like an
            archived receipt. Raised in testing, 25 Aug: not prominent, not
            obviously in need of review, and no way to answer it.

            Amber, because it is work outstanding that drains when somebody
            acts — the same rule the cancellation queue and Recent Changes
            follow. */}
        {scholarshipRequests.length > 0 && (
          <div id="scholarship-requests" className="scroll-mt-4">
            <h2 className="text-lg font-bold mb-1">
              {scholarshipRequests.length === 1
                ? 'This family has asked for help with the fee'
                : `This family has asked for help with the fee (${scholarshipRequests.length} people)`}
            </h2>
            <p className="text-sm text-neutral-600 mb-3">
              Nothing is decided until you decide it. Approving takes the amount straight off
              their balance; declining records why, so whoever answers the phone knows.
            </p>
            <div className="space-y-4">
              {scholarshipRequests.map((row) => (
                <ScholarshipReview key={row.participantId} row={row} />
              ))}
            </div>
          </div>
        )}

        {/* The conversation sits with the Review card (0126): a family's reply
            is part of the review, not something to scroll for. Open while
            their reply is unread; folded otherwise, the count on its bar. */}
        <FamilyMessages
          registrationId={registration.id}
          messages={familyMessages}
          canWrite={canWrite}
          defaultOpen={replyUnread}
        />

        {/* What the family wrote when they registered: reading for the
            review, so open while anyone is still submitted. */}
        {registration.family_notes && (
          <Panel title="Notes from the family" defaultOpen={anySubmitted}>
            <p className="text-sm text-neutral-700 whitespace-pre-wrap">{registration.family_notes}</p>
          </Panel>
        )}

        <Panel title="People on this week" count={parts.length} id="people" opensFor="person-" defaultOpen={peopleOpen}>
          <p className="text-sm text-neutral-500 mb-2">
            Change a status to move someone off &ldquo;submitted — pending review.&rdquo;
          </p>
          {parts.length === 0 ? (
            <p className="text-neutral-500 text-sm py-2">Nobody is on this registration yet.</p>
          ) : (
            <div>
              {ROLE_ORDER.filter((role) => parts.some((p) => p.camp_role === role)).map((role) => {
                const group = parts.filter((p) => p.camp_role === role);
                const manyRoles = new Set(parts.map((p) => p.camp_role)).size > 1;
                return (
                  <div key={role}>
                    {manyRoles && (
                      <p className="mt-4 mb-1 text-xs font-bold uppercase tracking-wide text-neutral-400">
                        {ROLE_PLURAL[role] ?? role} ({group.length})
                      </p>
                    )}
                    {group.map((p) => (
                      <ParticipantRow
                        key={p.id}
                        registrationId={registration.id}
                        participant={p}
                        awaitingScholarship={awaitingScholarship.has(p.id)}
                        canWrite={canWrite}
                        canSeeMoney={canSeeMoney}
                        canDecide={canDecide}
                      />
                    ))}
                  </div>
                );
              })}
              {parts
                .filter((p) => !ROLE_ORDER.includes(p.camp_role))
                .map((p) => (
                  <ParticipantRow
                    key={p.id}
                    registrationId={registration.id}
                    participant={p}
                    awaitingScholarship={awaitingScholarship.has(p.id)}
                    canWrite={canWrite}
                    canSeeMoney={canSeeMoney}
                    canDecide={canDecide}
                  />
                ))}
            </div>
          )}
          {canWrite && <AddPerson registrationId={registration.id} options={options} />}

          {/* Decisions ALREADY made — history, not work. Anything still
              waiting on an answer is at the top of the page instead, because
              a request and a receipt are different objects and this list is
              where the request used to be buried.

              Grey is right here for the same reason amber is right up there:
              nothing on this list is asking anybody to do anything. */}
          {adjustmentRecords.length > 0 && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-sm font-semibold text-neutral-700 mb-1">
                Scholarship decisions already made
              </p>
              <ul className="text-xs text-neutral-600 space-y-1.5">
                {adjustmentRecords.map((r, i) => {
                  const person = parts.find((p) => p.id === r.participantId)?.person;
                  const who = person ? `${person.first_name} ${person.last_name}` : 'Removed person';
                  const outcome =
                    r.status === 'granted'
                      ? `${money(r.grantedCents)} granted`
                      : r.status === 'declined'
                        ? 'not granted'
                        : 'request withdrawn by the family';
                  return (
                    <li key={i}>
                      <span className="font-medium text-neutral-800">{who}</span>
                      {' — '}
                      {outcome}
                      {r.grantedBy && <> · by {r.grantedBy}</>}
                      {r.at && <> · {dayInMorristown(r.at)}</>}
                      {/* Two different people's words, kept apart since 0048.
                          The staff note used to overwrite the family's
                          statement, so granting an award erased the reason it
                          had been asked for. */}
                      {r.staffNote && (
                        <>
                          <br />
                          <span className="text-neutral-500">Staff:</span> &ldquo;{r.staffNote}&rdquo;
                        </>
                      )}
                      {r.familyStatement && (
                        <>
                          <br />
                          <span className="text-neutral-500">Family asked:</span> &ldquo;
                          {r.familyStatement}&rdquo;
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Panel>

        {/* All the money in one card (26 Oct 2026): what is owed and why, the
            deposit, each payment and its refunds, fees, and how it is being
            paid. Payments read only, as each part was before. "#payments"
            (linked from Event Payments) and "#plan" open it and scroll to
            their section. */}
        {canSeeMoney && (
          <Panel title="Money" count={moneyState} id="money" opensFor={['payments', 'plan']} defaultOpen={moneyOpen}>
            {/* Zero is SETTLED, not neutral — the one balance a registrar is
                pleased to see (25 Aug). Green for paid up and for a credit;
                amber only while money is actually outstanding. The numbers
                come from the same view the dashboard and Event Payments read,
                so the three never disagree (24 Aug). */}
            <MoneySummary
              balance={balance}
              livePeople={livePeople}
              staleRefunds={payments.reduce((n, p) => n + (p.refunds ?? []).filter((r) => isStaleRefund(r)).length, 0)}
            />

            {depositShort && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
                <p className="font-bold text-amber-900">
                  Deposit short — {money(depositPaid)} of {money(depositDue)}
                </p>
                <p className="mt-1 text-amber-900">
                  {livePeople} {livePeople === 1 ? 'place' : 'places'} at {money(depositEach)} each.{' '}
                  {depositPaid === 0
                    ? 'Nothing has been paid, so nothing is held yet.'
                    : `${money(depositDue - depositPaid)} still to come before every place is held.`}
                </p>
              </div>
            )}

            <div className="mt-5 border-t border-neutral-100 pt-5">
              <PaymentsCard
                registrationId={registration.id}
                payments={payments}
                stripeBase={stripeBase}
                event={registration.event}
                feePeople={livePeople}
                depositWaived={Boolean(depositWaived)}
                canWritePayments={canWritePayments}
              />
            </div>

            {/* empty:hidden -- FeesPanel draws nothing when there are no fees
                and this staffer cannot add one, and the rule should go too. */}
            {feesPanel && <div className="mt-5 border-t border-neutral-100 pt-5 empty:hidden">{feesPanel}</div>}

            {planPanel && <div className="mt-5 border-t border-neutral-100 pt-5">{planPanel}</div>}
          </Panel>
        )}

        {canWrite && <HouseholdEditor registrationId={registration.id} household={registration.household} />}

        <AgreementsCard signatures={signatures} />

        {emailsPanel}
      </div>
    </div>
  );
}
