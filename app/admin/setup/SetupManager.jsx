'use client';

// Per-event registration controls. Times are entered and shown in YOUR local
// time zone (the browser's); they are stored as absolute moments, so a
// staffer in Tennessee and one traveling see the same instant rendered in
// their own clocks.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateEventRegistration, updateEventDetails, createEvent } from './actions';
import { EVENT_TYPE_LABELS } from '@/lib/events';
import { PLAN_MIN_DAYS } from '@/lib/plans';

const money = (cents) =>
  cents == null ? '—' : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

const fmtDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ISO timestamp <-> the browser's datetime-local input format, in local time.
const isoToLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localToIso = (v) => (v ? new Date(v).toISOString() : null);

// One "Event status" in place of two tick boxes (Lawrence, 26 Oct 2026: both
// could be ticked at once). It maps onto the two columns the rest of the site
// already reads -- events.published (public pages) and events.archived_at
// (isCurrentEventRow, registrationOpen) -- and an archived event is always
// stored unpublished. A row saved before this with both set reads as Archived,
// which is what every staff page already treated it as.
// Each status has its colour, on the closed dropdown and on its own line in
// the list (Lawrence, 26 Oct 2026): blue on blue unpublished, green on green
// published, grey on grey archived.
const EVENT_STATUSES = [
  ['unpublished', 'Unpublished', 'Hidden from the public site; staff can still set it up.', 'bg-blue-100 text-blue-800 border-blue-300'],
  ['published', 'Published', 'On the public site; registration follows the open/close times.', 'bg-green-100 text-green-800 border-green-300'],
  ['archived', 'Archived', 'Finished: out of every current list and off the public site; its records stay.', 'bg-neutral-200 text-neutral-700 border-neutral-300'],
];
const statusTone = (v) => EVENT_STATUSES.find(([key]) => key === v)?.[3] ?? '';
const eventStatus = (published, archivedAt) =>
  archivedAt ? 'archived' : published ? 'published' : 'unpublished';

function statusOf(row) {
  const now = new Date();
  if (row.status === 'archived') return ['Archived — out of every current list', 'bg-neutral-200 text-neutral-600'];
  if (row.status !== 'published') return ['Unpublished — not on the public site', 'bg-neutral-200 text-neutral-600'];
  if (!row.hasPublishedOption)
    return ['No published price — cannot open', 'bg-red-100 text-red-800'];
  if (row.opensAt && new Date(row.opensAt) > now)
    return [`Opens ${new Date(row.opensAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, 'bg-amber-100 text-amber-800'];
  if (row.closesAt && new Date(row.closesAt) < now)
    return [`Closed ${new Date(row.closesAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, 'bg-neutral-200 text-neutral-600'];
  return ['Open now', 'bg-green-100 text-green-800'];
}

function EventRow({ e }) {
  const router = useRouter();
  const [, start] = useTransition();
  const savedStatus = eventStatus(e.published, e.archivedAt);
  // Published AND archived at once -- possible before 26 Oct (the Adult
  // Adventure Retreat 2026). Shown as Archived; Save stores it unpublished.
  const legacyBoth = e.published && Boolean(e.archivedAt);
  const [status, setStatus] = useState(savedStatus);
  const [opens, setOpens] = useState(isoToLocal(e.opensAt));
  const [closes, setCloses] = useState(isoToLocal(e.closesAt));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { ok, message }

  // The event's own facts, behind a disclosure. Kept apart from the
  // registration window above deliberately: opening and closing registration
  // is a weekly act, and changing the DATE of camp is not. Putting them on one
  // row invites the second while doing the first.
  const [editing, setEditing] = useState(false);
  const [startsOn, setStartsOn] = useState(e.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(e.endsOn ?? '');
  const [capacity, setCapacity] = useState(e.capacity == null ? '' : String(e.capacity));
  const [fee, setFee] = useState(e.feeCents == null ? '' : (e.feeCents / 100).toFixed(2));
  // Early registration (0080): last day + $ off per person. Blank = none.
  const [earlyEndsOn, setEarlyEndsOn] = useState(e.earlyEndsOn ?? '');
  const [early, setEarly] = useState(e.earlyCents ? (e.earlyCents / 100).toFixed(2) : '');
  // The money settings (0096): due date, family discount, both-weeks percent.
  const [balanceDueOn, setBalanceDueOn] = useState(e.balanceDueOn ?? '');
  const [family, setFamily] = useState(e.familyDiscountCents ? (e.familyDiscountCents / 100).toFixed(2) : '');
  const [familyFrom, setFamilyFrom] = useState(String(e.familyFromPerson ?? 3));
  const [multiWeek, setMultiWeek] = useState(String(e.multiWeekPercent ?? 0));
  // 0123: returned bank payment fee, dollars; '0.00' = off.
  const [returnedFee, setReturnedFee] = useState(((e.returnedFeeCents ?? 0) / 100).toFixed(2));
  // The deposit per person (29 Oct 2026; until then only on New event).
  const [deposit, setDeposit] = useState(((e.depositCents ?? 0) / 100).toFixed(2));
  // The weeks of one camp (page.jsx; Lawrence, 27 Oct 2026). A later week
  // carries the both-weeks discount, where it applies; an earlier week's
  // details are the defaults for any later week not yet saved by hand.
  const isLaterWeek = (e.earlierWeeks ?? []).length > 0;
  const followers = (e.laterWeeks ?? []).filter((w) => !w.setByHand).map((w) => w.name);
  const ownSet = (e.laterWeeks ?? []).filter((w) => w.setByHand).map((w) => w.name);

  // ONE save for the card (Lawrence, 27 Oct 2026: "just one save is still
  // more sensible"). It saves whatever changed -- the status and registration
  // window, the event's details, or both -- and says what it did. The two
  // writes stay separate actions underneath; the status one runs first, so a
  // details error never hides a status change that did save.
  const detailsDirty =
    startsOn !== (e.startsOn ?? '') ||
    endsOn !== (e.endsOn ?? '') ||
    capacity !== (e.capacity == null ? '' : String(e.capacity)) ||
    fee !== (e.feeCents == null ? '' : (e.feeCents / 100).toFixed(2)) ||
    earlyEndsOn !== (e.earlyEndsOn ?? '') ||
    early !== (e.earlyCents ? (e.earlyCents / 100).toFixed(2) : '') ||
    balanceDueOn !== (e.balanceDueOn ?? '') ||
    family !== (e.familyDiscountCents ? (e.familyDiscountCents / 100).toFixed(2) : '') ||
    familyFrom !== String(e.familyFromPerson ?? 3) ||
    (isLaterWeek && multiWeek !== String(e.multiWeekPercent ?? 0)) ||
    returnedFee !== ((e.returnedFeeCents ?? 0) / 100).toFixed(2) ||
    deposit !== ((e.depositCents ?? 0) / 100).toFixed(2);

  function undoAll() {
    setStatus(savedStatus);
    setOpens(isoToLocal(e.opensAt));
    setCloses(isoToLocal(e.closesAt));
    setStartsOn(e.startsOn ?? '');
    setEndsOn(e.endsOn ?? '');
    setCapacity(e.capacity == null ? '' : String(e.capacity));
    setFee(e.feeCents == null ? '' : (e.feeCents / 100).toFixed(2));
    setEarlyEndsOn(e.earlyEndsOn ?? '');
    setEarly(e.earlyCents ? (e.earlyCents / 100).toFixed(2) : '');
    setBalanceDueOn(e.balanceDueOn ?? '');
    setFamily(e.familyDiscountCents ? (e.familyDiscountCents / 100).toFixed(2) : '');
    setFamilyFrom(String(e.familyFromPerson ?? 3));
    setMultiWeek(String(e.multiWeekPercent ?? 0));
    setReturnedFee(((e.returnedFeeCents ?? 0) / 100).toFixed(2));
    setDeposit(((e.depositCents ?? 0) / 100).toFixed(2));
    setNotice(null);
  }

  function saveAll() {
    setBusy(true);
    setNotice(null);
    start(async () => {
      const said = [];
      let failed = null;
      if (dirty) {
        const res = await updateEventRegistration(e.id, {
          status,
          opensAt: localToIso(opens),
          closesAt: localToIso(closes),
        });
        if (res.ok) said.push('Status saved — the public site shows it now.');
        else failed = res.error;
      }
      if (!failed && detailsDirty) {
        const res = await updateEventDetails(e.id, {
          startsOn,
          endsOn,
          capacity,
          feeDollars: fee,
          earlyEndsOn,
          earlyDollars: early,
          balanceDueOn,
          familyDollars: family,
          familyFromPerson: familyFrom,
          // Only a later week carries the both-weeks discount (0137 note).
          multiWeekPercent: isLaterWeek ? multiWeek : undefined,
          returnedFeeDollars: returnedFee,
          depositDollars: deposit,
        });
        if (res.ok) {
          said.push(
            `Event details saved.${res.copiedTo?.length ? ` Copied to ${res.copiedTo.join(' and ')}.` : ''}${
              res.notCopied ? ` ${res.notCopied}` : ''
            }`
          );
        } else failed = res.error;
      }
      setBusy(false);
      setNotice(
        failed
          ? { ok: false, message: said.length ? `${said.join(' ')} But: ${failed}` : failed }
          : { ok: true, message: said.join(' ') }
      );
      router.refresh();
    });
  }

  const dirty =
    status !== savedStatus ||
    legacyBoth ||
    opens !== isoToLocal(e.opensAt) ||
    closes !== isoToLocal(e.closesAt);

  const [statusLabel, statusClass] = statusOf({
    ...e,
    status,
    opensAt: localToIso(opens),
    closesAt: localToIso(closes),
  });
  const statusHint = EVENT_STATUSES.find(([v]) => v === status)?.[2];


  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold">
            {e.name}{' '}
            <span className="ml-1 rounded-full bg-neutral-100 px-2 py-0.5 align-middle text-xs font-medium text-neutral-600">
              {EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}
            </span>
          </p>
          <p className="text-sm text-neutral-500">
            {fmtDate(e.startsOn)} &ndash; {fmtDate(e.endsOn)} &middot; {money(e.feeCents)}/person
            {e.capacity ? ` · capacity ${e.capacity}` : ''}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        {/* Archived (0099, 16 Oct 2026): "current" is a rule -- until two
            weeks after the event ends -- and this is the one human override:
            a cancelled week or a duplicate drops out of every staff page's
            pill row now, and registration can never be open for it. It stays
            in history and in every "Other events" search box. */}
        <label className="text-sm">
          <span className="block font-semibold text-neutral-700 mb-0.5">Event status</span>
          <select
            value={status}
            onChange={(ev) => setStatus(ev.target.value)}
            className={`rounded-sm border px-2 py-1 font-semibold ${statusTone(status)}`}
          >
            {EVENT_STATUSES.map(([v, label, , tone]) => (
              <option key={v} value={v} className={tone}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-neutral-500 mb-0.5" title="Your local time zone. Blank = no limit on that end.">
            Registration opens
          </span>
          <input
            type="datetime-local"
            value={opens}
            onChange={(ev) => setOpens(ev.target.value)}
            className="rounded-sm border border-neutral-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-neutral-500 mb-0.5" title="Your local time zone. Blank = no limit on that end.">
            Registration closes
          </span>
          <input
            type="datetime-local"
            value={closes}
            onChange={(ev) => setCloses(ev.target.value)}
            className="rounded-sm border border-neutral-300 px-2 py-1"
          />
        </label>
        {(opens || closes) && (
          <button
            type="button"
            onClick={() => {
              setOpens('');
              setCloses('');
            }}
            disabled={busy}
            className="text-sm text-neutral-600 underline"
          >
            Clear times
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-neutral-600">{statusHint}</p>
      {legacyBoth && status === 'archived' && (
        <p className="mt-1 text-xs text-amber-800">
          Saved before 26 Oct as both visible and archived. Save stores it as Archived (off the public site).
        </p>
      )}

      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        className="mt-3 text-sm font-semibold text-brand underline"
      >
        {editing ? 'Close event details' : 'Edit dates, capacity, price and early registration'}
      </button>

      {editing && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">First day</span>
              <input
                type="date"
                value={startsOn}
                onChange={(ev) => setStartsOn(ev.target.value)}
                className="w-full rounded-sm border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Last day</span>
              <input
                type="date"
                value={endsOn}
                onChange={(ev) => setEndsOn(ev.target.value)}
                className="w-full rounded-sm border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Places</span>
              <input
                inputMode="numeric"
                value={capacity}
                onChange={(ev) => setCapacity(ev.target.value)}
                placeholder="no limit"
                className="w-full rounded-sm border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Price ($/person)</span>
              <input
                inputMode="decimal"
                value={fee}
                onChange={(ev) => setFee(ev.target.value)}
                className="w-full rounded-sm border border-neutral-300 px-2 py-1"
              />
            </label>
          </div>

          {/* Tidied 27 Oct 2026 (Lawrence: "too wordy ... fix alignment"):
              four columns, a label over every box and nothing under them; the
              explanations are folded into "How these settings work" below.
              Dates and the early discount on one line, every other discount
              on the next. */}
          <div className="mt-3 grid items-end gap-3 sm:grid-cols-4">
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Early registration ends</span>
              <input
                type="date"
                value={earlyEndsOn}
                onChange={(ev) => setEarlyEndsOn(ev.target.value)}
                className="w-full rounded-sm border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Early discount ($/person)</span>
              <input
                inputMode="decimal"
                value={early}
                onChange={(ev) => setEarly(ev.target.value)}
                placeholder="none"
                className="w-full rounded-sm border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Balance due</span>
              <input
                type="date"
                value={balanceDueOn}
                onChange={(ev) => setBalanceDueOn(ev.target.value)}
                className="w-full rounded-sm border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Returned bank payment fee ($)</span>
              <input
                inputMode="decimal"
                value={returnedFee}
                onChange={(ev) => setReturnedFee(ev.target.value)}
                className="w-full rounded-sm border border-neutral-300 px-2 py-1"
              />
            </label>
          </div>

          <div className="mt-3 grid items-end gap-3 sm:grid-cols-4">
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Deposit ($/person)</span>
              <input
                inputMode="decimal"
                value={deposit}
                onChange={(ev) => setDeposit(ev.target.value)}
                className="w-full rounded-sm border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Family discount ($/person)</span>
              <input
                inputMode="decimal"
                value={family}
                onChange={(ev) => setFamily(ev.target.value)}
                placeholder="none"
                className="w-full rounded-sm border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">…from person number</span>
              <input
                inputMode="numeric"
                value={familyFrom}
                onChange={(ev) => setFamilyFrom(ev.target.value)}
                className="w-full rounded-sm border border-neutral-300 px-2 py-1"
              />
            </label>
            {/* On the later week only (Lawrence, 27 Oct 2026): it comes off the
                later week's fee, so that is the one figure that counts. An
                earlier week shows where it is set, in the same box shape. */}
            {isLaterWeek ? (
              <label className="text-sm">
                <span className="block font-semibold text-neutral-700 mb-0.5">Both-weeks volunteer discount (%)</span>
                <input
                  inputMode="numeric"
                  value={multiWeek}
                  onChange={(ev) => setMultiWeek(ev.target.value)}
                  className="w-full rounded-sm border border-neutral-300 px-2 py-1"
                />
              </label>
            ) : (e.laterWeeks ?? []).length > 0 ? (
              <div className="text-sm">
                <span className="block font-semibold text-neutral-700 mb-0.5">Both-weeks volunteer discount (%)</span>
                <span className="block rounded-sm border border-dashed border-neutral-300 px-2 py-1 text-neutral-500">
                  Set on {(e.laterWeeks ?? []).map((w) => w.name.split(' — ').pop()).join(' and ')}
                </span>
              </div>
            ) : null}
          </div>


          {/* Week 1's details are the later weeks' defaults (0137). */}
          {(followers.length > 0 || ownSet.length > 0 || (isLaterWeek && !e.setByHand)) && (
            <p className="mt-3 text-xs text-neutral-600">
              {followers.length > 0 && <>Saving also updates {followers.map((n) => n.split(' — ').pop()).join(' and ')}. </>}
              {ownSet.length > 0 && <>{ownSet.map((n) => n.split(' — ').pop()).join(' and ')} keeps its own settings. </>}
              {isLaterWeek && !e.setByHand && (
                <>Following {(e.earlierWeeks ?? []).map((n) => n.split(' — ').pop()).join(' and ')} until saved here.</>
              )}
            </p>
          )}

          <details className="mt-3 text-xs text-neutral-600">
            <summary className="fold-summary cursor-pointer font-semibold text-neutral-700">
              How these settings work
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>Price:</strong> a <em>lower</em> price applies to everyone already registered
                too (unless their scholarship and discount add up to more than it; a family that has
                paid more than the new total is due a refund, and Save says so). A <em>higher</em>{' '}
                price applies to new registrations only. <strong>Places</strong> cannot go below the
                number registered.
              </li>
              <li>
                <strong>Deposit</strong> is per fee-paying person, never more than the price, and is
                what staff look for before approving. A change applies to everyone registered; $0 is
                no deposit.
              </li>
              <li>
                <strong>Early discount:</strong> off each person registered by the early date, once
                the family is on a payment plan or has paid in full. A scholarship request alone does
                not earn it.
              </li>
              <li>
                <strong>Balance due</strong> is shown to families. A payment plan is offered only when
                it is set and more than {PLAN_MIN_DAYS} days away; blank means pay in full, or the
                deposit now and the rest when staff say.
              </li>
              <li>
                <strong>Family discount:</strong> off the chosen person and every later fee-paying
                person on one registration. <strong>Both-weeks:</strong> off the later week for a
                confirmed volunteer at both, set on the later week. Saving re-applies both to everyone
                registered.
              </li>
              <li>
                <strong>Returned bank payment fee:</strong> added when a bank returns a payment, never
                for a card decline; $0 is off. Families see it before choosing a bank payment and keep
                the amount they agreed to.
              </li>
              <li>
                <strong>Weeks of one camp:</strong> saving an earlier week copies its price, places,
                early registration, balance due, deposit, family discount and returned fee to a later week
                that has not been saved on its own.
              </li>
            </ul>
            <ReminderScheduleNote />
          </details>

        </div>
      )}

      {notice && (
        <p
          className={`mt-3 rounded-sm border px-3 py-2 text-sm ${
            notice.ok
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {notice.message}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={saveAll}
          disabled={(!dirty && !detailsDirty) || busy}
          className="btn-primary py-1.5! text-sm disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {(dirty || detailsDirty) && !busy && (
          <button type="button" onClick={undoAll} className="text-sm text-neutral-600 underline">
            Undo my changes
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The reminder-email schedule (Lawrence, 27 Oct 2026; the draft is
// 01 Plans and Decisions\Luke14-Automatic-Emails-Draft.pdf). Not sent yet:
// said here so whoever adds an event knows which of its dates the reminders
// will run from. Module level, beside the other shared pieces.
function ReminderScheduleNote() {
  return (
    <div className="mt-2 text-xs text-neutral-600">
      <p className="font-semibold text-neutral-700">Reminder emails run from the event&rsquo;s dates</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>
          <strong>Deposit and balance:</strong> monthly on the 15th until paid, then 2 weeks before the{' '}
          <em>balance due</em> date and on it, then weekly once it is past due.
        </li>
        <li>
          <strong>Missing details</strong> (support details, applications, waivers, agreements): monthly
          on the 15th until done, then 2 weeks and 5 days before the <em>first day</em>.
        </li>
        <li>
          <strong>Payment plans:</strong> a notice 1 week before each automatic payment.
        </li>
      </ul>
      <p className="mt-1">These go out by themselves each morning (in test mode, to staff addresses only, until the site goes live).</p>
    </div>
  );
}

// New event (2 Oct 2026). Hoisted to module level like EventRow -- a component
// defined inside another is remounted on every render (CLAUDE.md).
//
// Copying is the normal path: next year's Week 1 is this year's Week 1 with
// new dates. A draft pre-fills everything from its source, with the name's
// year bumped and the dates moved 52 weeks on (same weekdays), all editable;
// createEvent then copies the source's money settings, dates moved to match.
// ---------------------------------------------------------------------------

const CAMP_GETS =
  'Camp: registration, payments, check-in and medical, plus rooms and cabins, buddies, programs and activities.';
const RETREAT_GETS =
  'Retreat: registration, payments, check-in and medical. Rooms, buddies and programs are sorted on arrival, so those pages leave it out.';

// 'YYYY-MM-DD' + n days, by parts (never new Date(iso), which is UTC midnight).
const addDays = (iso, n) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};
const bumpYear = (name) => (name ?? '').replace(/\b(20\d\d)\b/, (y) => String(Number(y) + 1));
const dollars = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

const BLANK = {
  copyFrom: '',
  eventType: 'camp_week',
  name: '',
  startsOn: '',
  endsOn: '',
  fee: '',
  deposit: '50.00',
  capacity: '',
  location: '',
};

// Drafts from last season (Lawrence, 28 Oct 2026, W70): New event offers
// Camp Celebrate (one or two weeks), the Adult Adventure Retreat, or a blank
// event. The first two start from the newest event of that kind -- a camp's
// weeks are the events whose names share the part before " — ", as Setup's
// copy-to-later-weeks rule groups them -- moved 52 weeks on. Events with
// "test" in the name (a go-live test event) are never a template.
const programOf = (name) => String(name ?? '').split(' — ')[0].trim();
const notTest = (e) => !/\btest\b/i.test(e.name ?? '');

function lastCampWeeks(events) {
  const camps = events.filter((e) => e.eventType === 'camp_week' && e.startsOn && notTest(e));
  if (!camps.length) return [];
  const newest = camps.reduce((a, b) => (b.startsOn > a.startsOn ? b : a));
  const program = programOf(newest.name);
  return camps
    .filter((e) => programOf(e.name) === program)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

function lastRetreat(events) {
  const retreats = events.filter((e) => e.eventType === 'retreat' && e.startsOn && notTest(e));
  return retreats.length ? retreats.reduce((a, b) => (b.startsOn > a.startsOn ? b : a)) : null;
}

// One editable draft from a source event: next year's name, the same
// weekdays 52 weeks on (plus `extraDays` for a second week made from a first).
function draftFrom(src, { name, extraDays = 0 } = {}) {
  return {
    copyFrom: src.id,
    eventType: src.eventType === 'retreat' ? 'retreat' : 'camp_week',
    name: name ?? bumpYear(src.name),
    startsOn: addDays(src.startsOn, 364 + extraDays),
    endsOn: addDays(src.endsOn, 364 + extraDays),
    fee: dollars(src.feeCents),
    deposit: dollars(src.depositCents),
    capacity: src.capacity == null ? '' : String(src.capacity),
    location: src.location ?? '',
  };
}

function campDrafts(events, weeks) {
  const last = lastCampWeeks(events);
  if (!last.length) return null;
  const program = bumpYear(programOf(last[0].name));
  if (weeks === 1) return [draftFrom(last[0], { name: program })];
  const second = last[1]
    ? draftFrom(last[1])
    : draftFrom(last[0], { name: `${program} — Week 2`, extraDays: 7 });
  const first = last[1] ? draftFrom(last[0]) : draftFrom(last[0], { name: `${program} — Week 1` });
  return [first, second];
}

const CHOICES = [
  ['camp', 'Camp Celebrate', 'From last season’s camp: one week or two.'],
  ['retreat', 'Adult Adventure Retreat', 'From last season’s retreat.'],
  ['other', 'Other', 'A blank event.'],
];

const FIELD = 'w-full rounded-sm border border-neutral-300 px-2 py-1';

// One draft's boxes. Module level, never inside NewEventPanel (CLAUDE.md).
function DraftFields({ draft, onChange }) {
  const set = (k) => (ev) => onChange({ ...draft, [k]: ev.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <label className="text-sm sm:col-span-2">
        <span className="block font-semibold text-neutral-700 mb-0.5">Name</span>
        <input value={draft.name} onChange={set('name')} placeholder="Camp Celebrate 2028 — Week 1" className={FIELD} />
      </label>
      <label className="text-sm">
        <span className="block font-semibold text-neutral-700 mb-0.5">First day</span>
        <input type="date" value={draft.startsOn} onChange={set('startsOn')} className={FIELD} />
      </label>
      <label className="text-sm">
        <span className="block font-semibold text-neutral-700 mb-0.5">Last day</span>
        <input type="date" value={draft.endsOn} onChange={set('endsOn')} className={FIELD} />
      </label>
      <label className="text-sm">
        <span className="block font-semibold text-neutral-700 mb-0.5">Price ($/person)</span>
        <input inputMode="decimal" value={draft.fee} onChange={set('fee')} className={FIELD} />
      </label>
      <label className="text-sm">
        <span className="block font-semibold text-neutral-700 mb-0.5">Deposit ($/person)</span>
        <input inputMode="decimal" value={draft.deposit} onChange={set('deposit')} className={FIELD} />
      </label>
      <label className="text-sm">
        <span className="block font-semibold text-neutral-700 mb-0.5">Places</span>
        <input inputMode="numeric" value={draft.capacity} onChange={set('capacity')} placeholder="no limit" className={FIELD} />
      </label>
      <label className="text-sm">
        <span className="block font-semibold text-neutral-700 mb-0.5">Location</span>
        <input value={draft.location} onChange={set('location')} placeholder="optional" className={FIELD} />
      </label>
    </div>
  );
}

function NewEventPanel({ events }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('');
  const [weeks, setWeeks] = useState(2);
  const [drafts, setDrafts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  function reset() {
    setOpen(false);
    setKind('');
    setWeeks(2);
    setDrafts([]);
  }

  function choose(k, w = weeks) {
    setKind(k);
    setNotice(null);
    if (k === 'camp') {
      setWeeks(w);
      setDrafts(campDrafts(events, w) ?? [{ ...BLANK, eventType: 'camp_week' }]);
    } else if (k === 'retreat') {
      const src = lastRetreat(events);
      setDrafts([src ? draftFrom(src) : { ...BLANK, eventType: 'retreat' }]);
    } else if (k === 'other') {
      setDrafts([{ ...BLANK }]);
    }
  }

  // "Or copy one particular event": the 2 Oct path, kept for anything the
  // three drafts do not cover.
  function copyOne(id) {
    const src = events.find((e) => e.id === id);
    if (!src) return;
    setKind('copy');
    setNotice(null);
    setDrafts([draftFrom(src)]);
  }

  const updateDraft = (i) => (d) => setDrafts((cur) => cur.map((x, j) => (j === i ? d : x)));

  function submit() {
    setBusy(true);
    setNotice(null);
    start(async () => {
      const made = [];
      for (const d of drafts) {
        const res = await createEvent({
          name: d.name,
          eventType: d.eventType,
          startsOn: d.startsOn,
          endsOn: d.endsOn,
          feeDollars: d.fee,
          depositDollars: d.deposit,
          capacity: d.capacity,
          location: d.location,
          copyFrom: d.copyFrom,
        });
        if (!res.ok) {
          setBusy(false);
          setNotice({
            ok: false,
            message: made.length
              ? `Created “${made.join('” and “')}”, but not “${d.name.trim()}”: ${res.error}`
              : res.error,
          });
          if (made.length) router.refresh();
          return;
        }
        made.push(d.name.trim());
        if (res.warning) {
          setNotice({ ok: false, message: res.warning });
        }
      }
      setBusy(false);
      setNotice((cur) =>
        cur && !cur.ok
          ? cur
          : {
              ok: true,
              message: `Created “${made.join('” and “')}”. ${made.length > 1 ? 'They are' : 'It is'} unpublished: check the details below, then set the Event status to Published when registration should open.`,
            }
      );
      reset();
      router.refresh();
    });
  }

  const sources = drafts.map((d) => events.find((e) => e.id === d.copyFrom)).filter(Boolean);
  const isCamp = drafts.some((d) => d.eventType === 'camp_week');
  const noTemplate = (kind === 'camp' || kind === 'retreat') && !sources.length;

  return (
    <div className="mb-6">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="btn-primary py-1.5! text-sm">
          + New event
        </button>
      ) : (
        <div className="rounded-lg border border-brand/40 bg-brand-light/30 p-4">
          <p className="font-semibold mb-3">New event</p>

          <div className="grid gap-2 sm:grid-cols-3">
            {CHOICES.map(([k, label, hint]) => (
              <button
                key={k}
                type="button"
                onClick={() => choose(k)}
                aria-pressed={kind === k}
                className={`rounded-md border px-3 py-2 text-left text-sm ${
                  kind === k ? 'border-brand bg-white ring-2 ring-brand/40' : 'border-neutral-300 bg-white hover:border-brand'
                }`}
              >
                <span className="block font-semibold">{label}</span>
                <span className="block text-xs text-neutral-600">{hint}</span>
              </button>
            ))}
          </div>
          <label className="mt-2 block text-xs text-neutral-600">
            Or copy one particular event:{' '}
            <select
              value={kind === 'copy' ? drafts[0]?.copyFrom ?? '' : ''}
              onChange={(ev) => copyOne(ev.target.value)}
              className="rounded-sm border border-neutral-300 px-2 py-0.5"
            >
              <option value="">choose…</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>

          {kind === 'camp' && (
            <fieldset className="mt-3 text-sm">
              <legend className="font-semibold text-neutral-700">How many weeks?</legend>
              <div className="flex gap-4 py-1">
                {[1, 2].map((w) => (
                  <label key={w} className="inline-flex items-center gap-1.5">
                    <input type="radio" name="new-event-weeks" checked={weeks === w} onChange={() => choose('camp', w)} />
                    {w === 1 ? 'One week' : 'Two weeks'}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {kind === 'other' && (
            <fieldset className="mt-3 text-sm">
              <legend className="font-semibold text-neutral-700">Type</legend>
              <div className="flex gap-4 py-1">
                {[
                  ['camp_week', 'Camp'],
                  ['retreat', 'Retreat'],
                ].map(([v, label]) => (
                  <label key={v} className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="new-event-type"
                      value={v}
                      checked={drafts[0]?.eventType === v}
                      onChange={() => setDrafts((cur) => cur.map((d) => ({ ...d, eventType: v })))}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-neutral-600">
                {drafts[0]?.eventType === 'retreat' ? RETREAT_GETS : CAMP_GETS}
              </p>
            </fieldset>
          )}

          {drafts.length > 0 && (
            <div className="mt-3 space-y-4">
              {drafts.map((d, i) => (
                <div key={i}>
                  {drafts.length > 1 && <p className="mb-1 text-sm font-semibold text-neutral-700">Week {i + 1}</p>}
                  <DraftFields draft={d} onChange={updateDraft(i)} />
                </div>
              ))}
            </div>
          )}

          {drafts.length > 0 && (
            <p className="mt-3 text-xs text-neutral-600">
              {noTemplate ? (
                <>There is no earlier event of this kind to start from, so this is a blank event of that type. </>
              ) : sources.length ? (
                <>
                  Drafted from {[...new Set(sources.map((s) => s.name))].join(' and ')}: dates moved to the same
                  weekdays a year on, and its description, agreements, activities and their waivers
                  {isCamp ? ', rooms and cabins (empty, no one assigned)' : ''}, and money settings (registration
                  window, early registration and its discount, family and both-weeks discounts, balance due,
                  returned-payment fee) copied, every date moved to match. People, assignments and program leaders
                  are not copied. Check each box before creating.{' '}
                </>
              ) : (
                <>
                  A blank event gets the standard agreements and nothing else; add activities
                  {isCamp ? ' and rooms (Rooms & Cabins can copy them from another event)' : ''} afterwards.{' '}
                </>
              )}
              {isCamp && 'Volunteers are set to arrive the day before. '}
              {drafts.length > 1 ? 'Both start' : 'It starts'} <strong>unpublished</strong>.
            </p>
          )}
          {drafts.length > 0 && (
            <details className="mt-3">
              <summary className="fold-summary cursor-pointer text-xs font-semibold text-neutral-700">
                Reminder emails — set the first day and the balance due date
              </summary>
              <ReminderScheduleNote />
            </details>
          )}

          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !drafts.length}
              className="btn-primary py-1.5! text-sm disabled:opacity-40"
            >
              {busy ? 'Creating…' : drafts.length > 1 ? `Create ${drafts.length} events` : 'Create event'}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setNotice(null);
              }}
              disabled={busy}
              className="text-sm text-neutral-600 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p
          className={`mt-2 rounded-sm border px-3 py-2 text-sm ${
            notice.ok
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {notice.message}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events grouped by the year they start (Lawrence, 2 Oct 2026). Now that staff
// make an event every year, the list only grows; a finished year folds away
// instead of being deleted, since its registrations and payments are history.
// A year stays open while any of its events is still running or ahead; once
// every event in it has ended it starts collapsed, one click from its controls.
// Native <details>, as on Staff & Access: no client state, and a group the
// staffer opened stays open across router.refresh().
// ---------------------------------------------------------------------------

// The site's fold arrow on the left (fold-summary in globals.css, 26 Oct 2026).
const SUMMARY = 'fold-summary flex items-center gap-1';

function groupByYear(events) {
  const byYear = new Map();
  for (const e of events) {
    const year = (e.startsOn ?? '').slice(0, 4) || 'Undated';
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(e);
  }
  const groups = [...byYear].map(([year, list]) => ({
    year,
    list,
    past: list.every((e) => e.isPast),
  }));
  // Current and coming years first, earliest first; finished years after them,
  // newest first, so last year sits just below this one.
  return [
    ...groups.filter((g) => !g.past).sort((a, b) => a.year.localeCompare(b.year)),
    ...groups.filter((g) => g.past).sort((a, b) => b.year.localeCompare(a.year)),
  ];
}

function YearGroup({ year, list, past }) {
  const visible = list.filter((e) => eventStatus(e.published, e.archivedAt) === 'published').length;
  return (
    <details open={!past} className="group rounded-lg border border-neutral-200">
      <summary className={`${SUMMARY} px-4 py-3`}>
        <span>
          <span className="font-bold">{year}</span>
          <span className="ml-2 text-sm text-neutral-500">
            {list.length} {list.length === 1 ? 'event' : 'events'} · {visible} published
            {past ? ' · finished' : ''}
          </span>
        </span>
      </summary>
      <div className="space-y-4 border-t border-neutral-200 p-4">
        {list.map((e) => (
          <EventRow key={e.id} e={e} />
        ))}
      </div>
    </details>
  );
}

export default function SetupManager({ events }) {
  return (
    <div>
      <NewEventPanel events={events} />
      {events.length === 0 ? (
        <p className="text-neutral-600">No events yet. Use “New event” above to make the first.</p>
      ) : (
        <div className="space-y-4">
          {groupByYear(events).map((g) => (
            <YearGroup key={g.year} year={g.year} list={g.list} past={g.past} />
          ))}
        </div>
      )}
    </div>
  );
}
