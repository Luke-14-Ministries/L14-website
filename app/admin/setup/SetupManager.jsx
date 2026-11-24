'use client';

// Per-event registration controls. Times are entered and shown in YOUR local
// time zone (the browser's); they are stored as absolute moments, so a
// staffer in Tennessee and one traveling see the same instant rendered in
// their own clocks.

import EmptyState from '@/components/EmptyState';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateEventRegistration, updateEventDetails, createEvent, setHiddenFromFamilies } from './actions';
import { EVENT_TYPE_LABELS, staffAssigns, programOf as programName } from '@/lib/events';
import { PLAN_MIN_DAYS } from '@/lib/plans';
import FoldArrow from '@/components/FoldArrow';
import TimeSelect from '@/components/TimeSelect';
import { unfinishedTimeBox } from '@/lib/timeBoxes';

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
// Only a whole "YYYY-MM-DDTHH:MM" is a moment: a day with no time yet (or a
// time with no day) is unfinished, and saveAll refuses it rather than
// reading it as blank -- blank is "no limit".
const WHOLE_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const localToIso = (v) => (v && WHOLE_LOCAL.test(v) ? new Date(v).toISOString() : null);
// The registration boxes are a day box and a TimeSelect (5 Nov 2026: Safari
// misreads its native date-and-time box, as it did the activity times), kept
// together as one "YYYY-MM-DDTHH:MM" string, either half possibly empty.
const dayPart = (v) => (v ?? '').split('T')[0] ?? '';
const timePart = (v) => (v ?? '').split('T')[1] ?? '';
const joinDayTime = (day, time) => (day || time ? `${day}T${time}` : '');

function DayTimeField({ label, value, onChange, dayRef }) {
  const box = 'rounded-sm border border-neutral-300 px-2 py-1';
  return (
    <div className="text-sm">
      <span className="block text-neutral-500 mb-0.5" title="In your local time zone. Leave blank for no limit.">
        {label}
      </span>
      <span className="flex flex-wrap gap-1">
        <input
          ref={dayRef}
          type="date"
          aria-label={`${label}: day`}
          value={dayPart(value)}
          onChange={(ev) => onChange(joinDayTime(ev.target.value, timePart(value)))}
          className={box}
        />
        <TimeSelect
          label={label}
          value={timePart(value)}
          onChange={(t) => onChange(joinDayTime(dayPart(value), t))}
          className={box}
        />
      </span>
    </div>
  );
}

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
  ['unpublished', 'Unpublished', 'Hidden from the public site. Staff can still set it up.', 'bg-blue-100 text-blue-800 border-blue-300'],
  ['published', 'Published', 'On the public site. Registration follows the open and close times.', 'bg-green-100 text-green-800 border-green-300'],
  ['archived', 'Archived', 'Finished. Off the public site and out of current lists. Its records stay.', 'bg-neutral-200 text-neutral-700 border-neutral-300'],
];
const STATUS_SAVED = {
  unpublished: 'Unpublished. It\'s hidden from the public site, and staff can keep setting it up.',
  published: 'Published. It\'s on the public site now, and registration follows the open and close times.',
  archived: 'Archived. It\'s off the public site and out of current lists. Its records stay.',
};
const statusTone = (v) => EVENT_STATUSES.find(([key]) => key === v)?.[3] ?? '';
const eventStatus = (published, archivedAt) =>
  archivedAt ? 'archived' : published ? 'published' : 'unpublished';

// The heading pill takes the status dropdown's colours (Lawrence, 4 Nov
// 2026): blue unpublished, green published (whether registration is open,
// not yet open or closed), grey archived. Red only when a published event
// cannot open at all.
function statusOf(row) {
  const now = new Date();
  const tone = (v) => statusTone(v).replace(/\bborder-\S+/g, '').trim();
  if (row.status === 'archived') return ['Archived, out of current lists', tone('archived')];
  if (row.status !== 'published') return ['Unpublished, not on the public site', tone('unpublished')];
  if (!row.hasPublishedOption)
    return ['No published price, can\'t open', 'bg-red-100 text-red-800'];
  // registrationOpen() closes an event after its last day (23 Nov 2026).
  if (row.isPast) return ['Published · over, registration closed', tone('published')];
  if (row.opensAt && new Date(row.opensAt) > now)
    return [`Published · opens ${new Date(row.opensAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, tone('published')];
  if (row.closesAt && new Date(row.closesAt) < now)
    return [`Published · closed ${new Date(row.closesAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, tone('published')];
  return ['Published · open now', tone('published')];
}

// The public pages each kind of event appears on (23 Nov 2026 review, A4-11),
// so staff can look at what families see after a save. The camp pages show
// the next camp; the retreat page the next retreat; Register lists every
// event open now.
const SITE_PAGES = {
  camp_week: [
    ['/camp-celebrate/', 'Camp Celebrate'],
    ['/camper-information/', 'Camper Information'],
    ['/volunteer-information/', 'Volunteer Information'],
    ['/register/', 'Register'],
  ],
  retreat: [
    ['/adult-adventure-retreat/', 'Adult Adventure Retreat'],
    ['/register/', 'Register'],
  ],
};
const sitePages = (type) => SITE_PAGES[type] ?? [['/register/', 'Register']];

// The staff pages that hold the rest of an event's setup, opened on this
// event. Rooms and Program Groups are for camps only (staffAssigns): a
// retreat sorts those on arrival, and those pages leave it out.
function alsoFor(e) {
  const q = `?event=${e.id}`;
  return [
    [`/admin/activities/${q}`, 'Activities'],
    ...(staffAssigns({ event_type: e.eventType })
      ? [
          [`/admin/lodging/${q}`, 'Rooms & Cabins'],
          [`/admin/programs/${q}`, 'Program Groups'],
        ]
      : []),
    // The medical contact families read stays on Check-In (0109), where
    // staff look for it during camp; this is the way there.
    [`/admin/checkin/${q}`, 'Medical contact (Check-In)'],
    [`/admin/email-families/${q}`, 'Email Families'],
  ];
}

const families = (n) => `${n} ${n === 1 ? 'family is' : 'families are'}`;

// 'YYYY-MM-DD' to 'YYYY-MM-DD' in whole days, by parts (no time zone moves it).
const daysBetween = (fromIso, toIso) => {
  const t = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(toIso) - t(fromIso)) / 86400000);
};

// A save's message: words, then any links (23 Nov 2026: "See it on the site",
// and after a date change the pages to check). Module level (CLAUDE.md).
function SaveNotice({ notice, className = 'mt-3' }) {
  if (!notice) return null;
  return (
    <p
      className={`${className} rounded-sm border px-3 py-2 text-sm ${
        notice.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'
      }`}
    >
      {notice.message}
      {(notice.links ?? []).map(([href, label]) => (
        <span key={href}>
          {' '}
          <Link href={href} className="font-semibold underline" target={href.startsWith('/admin') ? undefined : '_blank'}>
            {label}
          </Link>
        </span>
      ))}
    </p>
  );
}

// The agreements this event asks families to sign, read-only (23 Nov 2026
// review, A4-20). A signature points at one exact version, so new wording is
// a new version made by a developer, never an edit on this page.
function AgreementsFold({ e }) {
  const list = e.agreements ?? [];
  return (
    <details className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 text-sm">
      <summary className="fold-summary flex cursor-pointer items-center gap-2 px-4 py-2.5 font-semibold text-neutral-800">
        Agreements families sign ({list.length})
      </summary>
      <div className="border-t border-neutral-200 p-4">
        {list.length === 0 ? (
          <p className="text-neutral-600">This event asks for no agreements.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-neutral-600">
              Families sign these when they register. To change the wording, ask Lawrence: each
              signature points at the exact version the family signed, so new wording becomes a new
              version rather than an edit here. Activity waivers are set on each activity, on{' '}
              <Link href={`/admin/activities/?event=${e.id}`} className="text-brand underline">
                Activities
              </Link>
              .{' '}
              <Link href={`/admin/setup/agreements/?event=${e.id}`} className="font-semibold text-brand underline">
                Print these agreements
              </Link>
            </p>
            <div className="space-y-2">
              {list.map((a) => (
                <details key={a.id} className="rounded-sm border border-neutral-200 bg-white">
                  <summary className="fold-summary flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                    <span className="font-semibold">{a.title}</span>
                    <span className="text-xs text-neutral-500">
                      version {a.version}
                      {a.createdOn ? ` · since ${fmtDate(a.createdOn)}` : ''}
                      {a.required ? '' : ' · optional'}
                      {a.appliesTo === 'participant' ? ' · signed for each person' : ' · signed once per family'}
                    </span>
                  </summary>
                  <div className="border-t border-neutral-200 px-3 py-2 text-neutral-700">
                    {a.externalUrl ? (
                      <p>
                        Signed on another site:{' '}
                        <a href={a.externalUrl} target="_blank" rel="noopener" className="text-brand underline">
                          {a.externalUrl}
                        </a>
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap">{a.text || 'No text on file.'}</p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

// A second step for an archived event (0147; Lawrence, 4 Nov 2026): clear it
// from family dashboards. Meant for a test event or one cancelled before it
// ran -- a real event that took place stays, so families keep their records.
// Hides only; nothing is deleted. The warning says so before it happens.
function FamilyDashboardChoice({ e }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const hidden = Boolean(e.hiddenFromFamiliesAt);

  function change(hide) {
    if (
      hide &&
      !window.confirm(
        `Clear "${e.name}" from every family's dashboard?\n\n` +
          'Use this only for a test event, or one canceled before it took place. A real event ' +
          'should stay archived, so families can look back at their registration and payments.' +
          '\n\nNothing is deleted. Registrations, payments and refunds stay for staff and in every ' +
          'export, and you can undo this here.'
      )
    )
      return;
    setError('');
    start(async () => {
      const res = await setHiddenFromFamilies(e.id, hide);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 text-xs text-neutral-600">
      {hidden ? (
        <>
          Cleared from family dashboards{' '}
          {new Date(e.hiddenFromFamiliesAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          .{' '}
          <button type="button" disabled={pending} onClick={() => change(false)} className="text-brand underline">
            Show it to families again
          </button>
        </>
      ) : (
        <>
          Families still see it on their dashboards, folded among past events.{' '}
          <button type="button" disabled={pending} onClick={() => change(true)} className="text-brand underline">
            Clear from family dashboards…
          </button>
        </>
      )}
      {error && <span className="ml-2 text-red-700">{error}</span>}
    </div>
  );
}

// Every box on an event card as its saved value, in the form's own strings.
// The card compares against it to say what changed, and to take a newer
// saved value when the event changed under it (below).
function formValues(e) {
  return {
    status: eventStatus(e.published, e.archivedAt),
    opens: isoToLocal(e.opensAt),
    closes: isoToLocal(e.closesAt),
    full: Boolean(e.waitlistNoticeAt),
    name: e.name ?? '',
    location: e.location ?? '',
    volArrives: e.volunteerArrivesOn ?? '',
    arrivalNote: e.arrivalNote ?? '',
    mapUrl: e.campusMapUrl ?? '',
    startsOn: e.startsOn ?? '',
    endsOn: e.endsOn ?? '',
    capacity: e.capacity == null ? '' : String(e.capacity),
    fee: e.feeCents == null ? '' : (e.feeCents / 100).toFixed(2),
    earlyEndsOn: e.earlyEndsOn ?? '',
    early: e.earlyCents ? (e.earlyCents / 100).toFixed(2) : '',
    balanceDueOn: e.balanceDueOn ?? '',
    family: e.familyDiscountCents ? (e.familyDiscountCents / 100).toFixed(2) : '',
    familyFrom: String(e.familyFromPerson ?? 3),
    multiWeek: String(e.multiWeekPercent ?? 0),
    returnedFee: ((e.returnedFeeCents ?? 0) / 100).toFixed(2),
    deposit: ((e.depositCents ?? 0) / 100).toFixed(2),
  };
}

function EventRow({ e, reminderMode }) {
  const router = useRouter();
  const [, start] = useTransition();
  const savedStatus = eventStatus(e.published, e.archivedAt);
  // Published AND archived at once -- possible before 26 Oct (the Adult
  // Adventure Retreat 2026). Shown as Archived; Save stores it unpublished.
  const legacyBoth = e.published && Boolean(e.archivedAt);
  const [status, setStatus] = useState(savedStatus);
  const [opens, setOpens] = useState(isoToLocal(e.opensAt));
  const [closes, setCloses] = useState(isoToLocal(e.closesAt));
  // A half-filled day box reads as blank, and blank is "no limit": published,
  // that is open now. Caught before saving (unfinishedTimeBox, 5 Nov 2026),
  // as is a day without a time or a time without a day.
  const opensRef = useRef(null);
  const closesRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { ok, message }
  // Each event card folds (Lawrence, 4 Nov 2026), opening by default unless
  // archived. Folding only hides it: unsaved changes stay, and the header
  // says so.
  const [open, setOpen] = useState(savedStatus !== 'archived');

  // The event's own facts, behind a disclosure. Kept apart from the
  // registration window above deliberately: opening and closing registration
  // is a weekly act, and changing the DATE of camp is not. Putting them on one
  // row invites the second while doing the first.
  const [editing, setEditing] = useState(false);
  // What families read (23 Nov 2026 review): name, location, the volunteers'
  // arrival day, the arrival line and the venue map.
  const [name, setName] = useState(e.name ?? '');
  const [location, setLocation] = useState(e.location ?? '');
  const [volArrives, setVolArrives] = useState(e.volunteerArrivesOn ?? '');
  // Edited by hand in this save: then a new first day leaves it alone.
  const [volTouched, setVolTouched] = useState(false);
  const [arrivalNote, setArrivalNote] = useState(e.arrivalNote ?? '');
  const [mapUrl, setMapUrl] = useState(e.campusMapUrl ?? '');
  // Staff's "this event is full" switch (0184).
  const [full, setFull] = useState(Boolean(e.waitlistNoticeAt));
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

  // The event changed under this card (23 Nov 2026, found in the review):
  // saving Week 1 copies its settings to Week 2, and router.refresh() gave
  // Week 2's card the new values while its boxes kept the old ones, so it
  // read "unsaved changes" and its Save would have put the old values back.
  // When the saved values move, a card nobody has edited takes them; a card
  // with edits keeps them. React's "adjust state when a prop changes"
  // pattern: compared during render, no effect.
  const saved = formValues(e);
  const [base, setBase] = useState(saved);
  if (JSON.stringify(base) !== JSON.stringify(saved)) {
    const current = {
      status, opens, closes, full, name, location, volArrives, arrivalNote, mapUrl, startsOn, endsOn,
      capacity, fee, earlyEndsOn, early, balanceDueOn, family, familyFrom, multiWeek, returnedFee, deposit,
    };
    const untouched = Object.keys(base).every((k) => current[k] === base[k]);
    setBase(saved);
    if (untouched) resetTo(saved);
  }

  const followers = (e.laterWeeks ?? []).filter((w) => !w.setByHand).map((w) => w.name);
  const ownSet = (e.laterWeeks ?? []).filter((w) => w.setByHand).map((w) => w.name);

  // ONE save for the card (Lawrence, 27 Oct 2026: "just one save is still
  // more sensible"). It saves whatever changed -- the status and registration
  // window, the event's details, or both -- and says what it did. The two
  // writes stay separate actions underneath; the status one runs first, so a
  // details error never hides a status change that did save.
  const detailsDirty =
    name !== (e.name ?? '') ||
    location !== (e.location ?? '') ||
    volArrives !== (e.volunteerArrivesOn ?? '') ||
    arrivalNote !== (e.arrivalNote ?? '') ||
    mapUrl !== (e.campusMapUrl ?? '') ||
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

  // A new first day moves the volunteers' arrival day by as many days, unless
  // staff changed that day themselves in this save (23 Nov 2026 review,
  // A4-03). Shown in the box before saving, so nothing moves unseen.
  function changeStartsOn(v) {
    setStartsOn(v);
    if (!volTouched && e.volunteerArrivesOn && e.startsOn && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      setVolArrives(addDays(e.volunteerArrivesOn, daysBetween(e.startsOn, v)));
    }
  }

  // Every box back to the given values (the saved ones).
  function resetTo(v) {
    setStatus(v.status);
    setOpens(v.opens);
    setCloses(v.closes);
    setFull(v.full);
    setName(v.name);
    setLocation(v.location);
    setVolArrives(v.volArrives);
    setVolTouched(false);
    setArrivalNote(v.arrivalNote);
    setMapUrl(v.mapUrl);
    setStartsOn(v.startsOn);
    setEndsOn(v.endsOn);
    setCapacity(v.capacity);
    setFee(v.fee);
    setEarlyEndsOn(v.earlyEndsOn);
    setEarly(v.early);
    setBalanceDueOn(v.balanceDueOn);
    setFamily(v.family);
    setFamilyFrom(v.familyFrom);
    setMultiWeek(v.multiWeek);
    setReturnedFee(v.returnedFee);
    setDeposit(v.deposit);
  }

  function undoAll() {
    resetTo(formValues(e));
    setNotice(null);
  }

  function saveAll() {
    const unfinished = unfinishedTimeBox([
      [opensRef.current, 'Registration opens'],
      [closesRef.current, 'Registration closes'],
    ]);
    if (unfinished) {
      setNotice({ ok: false, message: `Nothing saved. ${unfinished}` });
      return;
    }
    const half = [
      [opens, 'Registration opens'],
      [closes, 'Registration closes'],
    ].find(([v]) => v && !WHOLE_LOCAL.test(v));
    if (half) {
      setNotice({ ok: false, message: `Nothing saved. "${half[1]}" needs both a day and a time, or neither.` });
      return;
    }
    setBusy(true);
    setNotice(null);
    start(async () => {
      const said = [];
      const links = [];
      let failed = null;
      if (dirty) {
        const res = await updateEventRegistration(e.id, {
          status,
          opensAt: localToIso(opens),
          closesAt: localToIso(closes),
          full,
        });
        // Say what the saved status DOES (Lawrence, 1 Nov 2026: "the public
        // site shows it now" read wrong for an event just archived).
        if (res.ok) said.push(STATUS_SAVED[status] ?? 'Saved.');
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
          name,
          location,
          volunteerArrivesOn: volArrives,
          arrivalNote,
          campusMapUrl: mapUrl,
        });
        if (res.ok) {
          said.push(
            `Event details saved.${res.copiedTo?.length ? ` Copied to ${res.copiedTo.join(' and ')}.` : ''}${
              res.notCopied ? ` ${res.notCopied}` : ''
            }`
          );
          // What a date change reached (A4-03). Activity times are not moved
          // and families are not emailed: staff decide both.
          const m = res.datesMoved;
          if (m?.error) {
            said.push(`The dates saved, but who they affect could not be counted (${m.error}).`);
          } else if (m) {
            said.push(`The dates changed. ${families(m.families)} registered; nobody was emailed.`);
            if (m.families > 0) links.push([`/admin/email-families/?event=${e.id}`, 'Email Families']);
            if (m.slotsOutside > 0) {
              said.push(
                `${m.slotsOutside} activity ${m.slotsOutside === 1 ? 'time is' : 'times are'} now outside the event's days and ${
                  m.slotsOutside === 1 ? 'was' : 'were'
                } not moved.`
              );
              links.push([`/admin/activities/?event=${e.id}`, 'Check Activities']);
            }
          }
        } else failed = res.error;
      }
      // Where families will see it (A4-11).
      if (!failed && status === 'published') links.push([sitePages(e.eventType)[0][0], 'See it on the site']);
      setBusy(false);
      setNotice(
        failed
          ? { ok: false, message: said.length ? `${said.join(' ')} But: ${failed}` : failed }
          : { ok: true, message: said.join(' '), links }
      );
      router.refresh();
    });
  }

  const dirty =
    status !== savedStatus ||
    full !== Boolean(e.waitlistNoticeAt) ||
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

  // Said before Save (23 Nov 2026 review, A4-21): publishing with no times
  // opens registration the moment it saves; taking an event off the site
  // with families on it reaches them.
  const opensOnSave =
    status === 'published' && savedStatus !== 'published' && !opens && !closes && e.hasPublishedOption && !e.isPast;
  const leavingFamilies = status !== savedStatus && status !== 'published' && (e.regFamilies ?? 0) > 0;

  // A rename (A4-02): the part before " — " pairs a camp's weeks.
  const trimmedName = name.trim();
  const renamed = trimmedName !== '' && trimmedName !== (e.name ?? '');
  const hadDash = String(e.name ?? '').includes(' — ');
  const hasDash = trimmedName.includes(' — ');
  const pairingNote = !renamed
    ? null
    : hadDash && !hasDash
      ? 'This name no longer has " — ", so the event stops being paired with its other weeks (the both-weeks discount, settings copied to later weeks, and the camp pages).'
      : !hadDash && hasDash
        ? 'This name now has " — ", so it is paired with other events whose names start the same way in the same year (the both-weeks discount, copied settings, the camp pages).'
        : hadDash && programName(trimmedName) !== programName(e.name)
          ? 'The part before " — " changed, so this week is paired with different weeks (the both-weeks discount, copied settings, the camp pages).'
          : null;
  const volMoved = !volTouched && volArrives !== (e.volunteerArrivesOn ?? '') && startsOn !== (e.startsOn ?? '');
  const mapLooksRight = /^https:\/\/\S+$/i.test(mapUrl.trim());


  return (
    <div id={`event-${e.id}`} className="scroll-mt-20 rounded-lg border border-neutral-200 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
      >
        <div className="flex items-baseline gap-2">
          <FoldArrow open={open} />
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
            {e.regPeople != null ? ` · ${e.regPeople} registered` : ''}
            {!open && (dirty || detailsDirty) && (
              <span className="ml-2 font-semibold text-amber-800">· unsaved changes</span>
            )}
          </p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>
          {statusLabel}
        </span>
      </button>

      {open && (
      <>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        {/* Archived (0099, 16 Oct 2026): "current" is a rule -- until two
            weeks after the event ends -- and this is the one human override:
            a cancelled week or a duplicate drops out of every staff page's
            current events now, and registration can never be open for it. It
            stays in history, under "Other events" in every event dropdown. */}
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
        <DayTimeField label="Registration opens" value={opens} onChange={setOpens} dayRef={opensRef} />
        <DayTimeField label="Registration closes" value={closes} onChange={setCloses} dayRef={closesRef} />
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
      {status === 'published' && (
        // A switch, not a count (0184): staff run the waiting list by hand.
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={full} onChange={(ev) => setFull(ev.target.checked)} className="mt-1" />
          <span>
            Tell families this event is full (new registrations join the waiting list)
            <span className="block text-xs text-neutral-600">
              The public pages then say it&rsquo;s full and that registering joins the waiting list.
              Registration stays open; you approve or waitlist each person on Awaiting Review.
            </span>
          </span>
        </label>
      )}
      {legacyBoth && status === 'archived' && (
        <p className="mt-1 text-xs text-amber-800">
          This event is marked both visible and archived. Saving will archive it.
        </p>
      )}
      {savedStatus === 'archived' && status === 'archived' && <FamilyDashboardChoice e={e} />}

      {/* Where it shows, and the rest of its setup (A4-11, A4-22). */}
      <div className="mt-3 space-y-1 text-xs text-neutral-600">
        <p>
          <span className="font-semibold text-neutral-700">Shows on:</span>{' '}
          {savedStatus === 'published' ? (
            sitePages(e.eventType).map(([href, label], i) => (
              <span key={href}>
                {i > 0 && ' · '}
                <a href={href} target="_blank" rel="noopener" className="text-brand underline">
                  {label}
                </a>
              </span>
            ))
          ) : savedStatus === 'archived' ? (
            'Not on the site (archived)'
          ) : (
            'Not on the site yet'
          )}
        </p>
        <p>
          <span className="font-semibold text-neutral-700">Also for this event:</span>{' '}
          {alsoFor(e).map(([href, label], i) => (
            <span key={href}>
              {i > 0 && ' · '}
              <Link href={href} className="text-brand underline">
                {label}
              </Link>
            </span>
          ))}
        </p>
      </div>

      {/* A folding section, not a link (Lawrence, 4 Nov 2026), with the
          site's left-hand arrow. Folding keeps unsaved edits. */}
      <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50">
      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        aria-expanded={editing}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-neutral-800"
      >
        <FoldArrow open={editing} />
        Name, place, dates, price and discounts
        {!editing && detailsDirty && <span className="font-semibold text-amber-800">· unsaved changes</span>}
      </button>

      {editing && (
        <div className="border-t border-neutral-200 p-4">
          {/* What families read (23 Nov 2026 review, A4-02/A4-05). */}
          <div className="mb-3 grid gap-3 sm:grid-cols-4">
            <label className="text-sm sm:col-span-2">
              <span className="block font-semibold text-neutral-700 mb-0.5">Name</span>
              <input value={name} onChange={(ev) => setName(ev.target.value)} className="field-sm" />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block font-semibold text-neutral-700 mb-0.5">Location</span>
              <input
                value={location}
                onChange={(ev) => setLocation(ev.target.value)}
                placeholder="Blank: the camp pages name Carson Springs"
                className="field-sm"
              />
            </label>
          </div>
          {(renamed || e.regFamilies > 0) && (
            <p className="-mt-1 mb-3 text-xs text-neutral-600">
              {e.regFamilies > 0 && (
                <>
                  {families(e.regFamilies)} registered for this event.
                  {renamed && ' The new name shows on their dashboard, statements and emails.'}{' '}
                </>
              )}
              {pairingNote && <span className="font-semibold text-amber-800">{pairingNote}</span>}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">First day</span>
              <input
                type="date"
                value={startsOn}
                onChange={(ev) => changeStartsOn(ev.target.value)}
                className="field-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Last day</span>
              <input
                type="date"
                value={endsOn}
                onChange={(ev) => setEndsOn(ev.target.value)}
                className="field-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Places</span>
              <input
                inputMode="numeric"
                value={capacity}
                onChange={(ev) => setCapacity(ev.target.value)}
                placeholder="no limit"
                className="field-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Price ($/person)</span>
              <input
                inputMode="decimal"
                value={fee}
                onChange={(ev) => setFee(ev.target.value)}
                className="field-sm"
              />
            </label>
          </div>

          <div className="mt-3 grid items-start gap-3 sm:grid-cols-4">
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Volunteers arrive</span>
              <input
                type="date"
                value={volArrives}
                onChange={(ev) => {
                  setVolArrives(ev.target.value);
                  setVolTouched(true);
                }}
                className="field-sm"
              />
              {volMoved && <span className="mt-0.5 block text-xs text-neutral-600">Moved with the first day.</span>}
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Arrival note</span>
              <input
                value={arrivalNote}
                onChange={(ev) => setArrivalNote(ev.target.value)}
                placeholder="e.g. 6:00 PM Thursday"
                maxLength={200}
                className="field-sm"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block font-semibold text-neutral-700 mb-0.5">
                Campus map link
                {mapLooksRight && (
                  <a href={mapUrl.trim()} target="_blank" rel="noopener" className="ml-2 font-normal text-brand underline">
                    Open
                  </a>
                )}
              </span>
              <input
                type="url"
                value={mapUrl}
                onChange={(ev) => setMapUrl(ev.target.value)}
                placeholder="https://"
                className="field-sm"
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
                className="field-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Early discount ($/person)</span>
              <input
                inputMode="decimal"
                value={early}
                onChange={(ev) => setEarly(ev.target.value)}
                placeholder="none"
                className="field-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Balance due</span>
              <input
                type="date"
                value={balanceDueOn}
                onChange={(ev) => setBalanceDueOn(ev.target.value)}
                className="field-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Returned bank payment fee ($)</span>
              <input
                inputMode="decimal"
                value={returnedFee}
                onChange={(ev) => setReturnedFee(ev.target.value)}
                className="field-sm"
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
                className="field-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Family discount ($/person)</span>
              <input
                inputMode="decimal"
                value={family}
                onChange={(ev) => setFamily(ev.target.value)}
                placeholder="none"
                className="field-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">…from person number</span>
              <input
                inputMode="numeric"
                value={familyFrom}
                onChange={(ev) => setFamilyFrom(ev.target.value)}
                className="field-sm"
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
                  className="field-sm"
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
                <strong>Name and location</strong> show on the public pages, the family dashboard,
                statements and emails. A blank location keeps the Carson Springs sentence on the camp
                pages. <strong>Arrival note</strong> is the retreat page&rsquo;s Arrival line (blank:
                6:00 PM on the first day). The <strong>campus map</strong> opens from the family
                dashboard once someone is checked in.
              </li>
              <li>
                <strong>First day:</strong> changing it moves the volunteers&rsquo; arrival day by the
                same number of days, unless you change that day too. Activity times are not moved and
                families are not emailed; Save says how many are registered.
              </li>
              <li>
                <strong>Price:</strong> a <em>lower</em> price also applies to everyone already
                registered, unless their scholarship and discount add up to more than the new price.
                If a family has paid more than the new total, they&rsquo;re due a refund, and Save
                tells you. A <em>higher</em> price applies to new registrations only. <strong>Places</strong> cannot go below the
                number registered.
              </li>
              <li>
                <strong>Deposit</strong> is per fee-paying person, never more than the price, and is
                what staff look for before approving. A change applies to everyone registered. $0
                means no deposit.
              </li>
              <li>
                <strong>Early discount:</strong> off each person registered by the early date, once
                the family is on a payment plan or has paid in full. A scholarship request alone does
                not earn it.
              </li>
              <li>
                <strong>Balance due</strong> is shown to families. A payment plan is offered only when
                it is set and more than {PLAN_MIN_DAYS} days away. If it&rsquo;s blank, families pay in
                full, or pay the deposit now and the rest when staff say.
              </li>
              <li>
                <strong>Family discount:</strong> off the chosen person and every later fee-paying
                person on one registration. <strong>Both-weeks:</strong> off the later week for a
                confirmed volunteer at both, set on the later week. Saving re-applies both to everyone
                registered.
              </li>
              <li>
                <strong>Returned bank payment fee:</strong> added when a bank returns a payment, never
                for a declined card. $0 turns it off. Families see it before choosing to pay by bank,
                and they&rsquo;re charged the amount they saw then.
              </li>
              <li>
                <strong>Weeks of one camp:</strong> saving an earlier week copies its location, campus
                map, arrival note, price, places, early registration, balance due, deposit, family
                discount and returned fee to a later week that has not been saved on its own. The name
                and the dates are each week&rsquo;s own.
              </li>
            </ul>
            <ReminderScheduleNote mode={reminderMode} />
          </details>

        </div>
      )}
      </div>

      <AgreementsFold e={e} />

      <SaveNotice notice={notice} />
      {opensOnSave && (
        <p className="mt-3 text-sm text-amber-800">
          Registration will open as soon as you save, and close after the event&rsquo;s last day. Set an
          open time above to open it later.
        </p>
      )}
      {leavingFamilies && (
        <p className="mt-3 text-sm text-amber-800">
          {families(e.regFamilies)} registered for this event. They keep it on their dashboards
          {status === 'archived' ? ', folded among past events' : ''}; nobody is emailed.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={saveAll}
          disabled={(!dirty && !detailsDirty) || busy}
          className="btn-primary btn-sm disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {(dirty || detailsDirty) && !busy && (
          <button type="button" onClick={undoAll} className="text-sm text-neutral-600 underline">
            Undo my changes
          </button>
        )}
      </div>
      </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The reminder-email schedule (Lawrence, 27 Oct 2026; the draft is
// 01 Plans and Decisions\Luke14-Automatic-Emails-Draft.pdf), said here so
// whoever adds an event knows which of its dates the reminders run from.
// Since 23 Nov 2026 (review, A4-06) it prints the job's real mode, read on
// the server from reminderMode() (lib/reminders/run.js), and lists what the
// job actually sends (lib/reminders/run.js, remindersForDay). Module level,
// beside the other shared pieces.
const REMINDER_MODE_LINE = {
  live: 'They go out automatically each morning, to every family.',
  test: 'Test mode: they go only to @luke14ministries.net addresses. Other families are not emailed.',
  off: 'Switched off: no reminder emails go out until REMINDERS_MODE is set back to live.',
};

function ReminderScheduleNote({ mode }) {
  return (
    <div className="mt-2 text-xs text-neutral-600">
      <p className="font-semibold text-neutral-700">Reminder emails run from the event&rsquo;s dates</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>
          <strong>Deposit and balance:</strong> monthly on the 15th until paid, then 2 weeks before the{' '}
          <em>balance due</em> date and on it, then weekly once it is past due.
        </li>
        <li>
          <strong>Missing details</strong> (support details, volunteer applications, activity waivers, and a
          staff question waiting on the family): monthly on the 15th until done, then 2 weeks and 5 days
          before the <em>first day</em>.
        </li>
        <li>
          <strong>Payment plans:</strong> a notice 1 week before each automatic payment (10 days for a bank
          account).
        </li>
        <li>
          <strong>Also:</strong> a confirmation or off-the-waiting-list note the morning after staff approve
          someone, and a nudge for a registration started but not submitted.
        </li>
      </ul>
      <p className="mt-1">
        {REMINDER_MODE_LINE[mode] ?? REMINDER_MODE_LINE.test}{' '}
        <Link href="/admin/email-families/" className="text-brand underline">
          See the next 7 days on Email Families
        </Link>
        , and{' '}
        {/* 23 Nov 2026: the wording of each kind, read-only. */}
        <Link href="/admin/email-families/#automatic-emails" className="text-brand underline">
          what each email says
        </Link>
        .
      </p>
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
  // 0154: the newest camp's weeks are its name AND year.
  const program = programOf(newest.name);
  const year = String(newest.startsOn).slice(0, 4);
  return camps
    .filter((e) => programOf(e.name) === program && String(e.startsOn).slice(0, 4) === year)
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

function NewEventPanel({ events, reminderMode }) {
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
              message: `Created “${made.join('” and “')}”. ${made.length > 1 ? 'They are' : 'It is'} unpublished. Check the details below, then set Event status to Published when registration should open.`,
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
        <button type="button" onClick={() => setOpen(true)} className="btn-primary btn-sm">
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
              className="field-sm w-auto"
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
                <>There&rsquo;s no earlier event of this kind to copy, so this starts as a blank event. </>
              ) : sources.length ? (
                <>
                  Copied from {[...new Set(sources.map((s) => s.name))].join(' and ')}, with every date moved to
                  the same weekday a year later. This copies the agreements, activities and their
                  waivers{isCamp ? ', rooms and cabins (empty, no one assigned)' : ''}, and the money settings:
                  registration dates, early registration and its discount, family and both-weeks discounts,
                  balance due and returned payment fee. People, assignments and program leaders are not
                  copied. Check each box before you create it.{' '}
                </>
              ) : (
                <>
                  A blank event gets the standard agreements and nothing else. Add activities
                  {isCamp ? ' and rooms (Rooms & Cabins can copy them from another event)' : ''} afterward.{' '}
                </>
              )}
              {isCamp && 'Volunteers are set to arrive the day before. '}
              {drafts.length > 1 ? 'Both start' : 'It starts'} <strong>unpublished</strong>.
            </p>
          )}
          {drafts.length > 0 && (
            <details className="mt-3">
              <summary className="fold-summary cursor-pointer text-xs font-semibold text-neutral-700">
                Reminder emails use the first day and the balance due date
              </summary>
              <ReminderScheduleNote mode={reminderMode} />
            </details>
          )}

          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !drafts.length}
              className="btn-primary btn-sm disabled:opacity-40"
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

      <SaveNotice notice={notice} className="mt-2" />
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

function YearGroup({ year, list, past, reminderMode }) {
  const visible = list.filter((e) => eventStatus(e.published, e.archivedAt) === 'published').length;
  return (
    <details open={!past} className="card group p-0">
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
          <EventRow key={e.id} e={e} reminderMode={reminderMode} />
        ))}
      </div>
    </details>
  );
}

export default function SetupManager({ events, reminderMode = 'test' }) {
  return (
    <div>
      <NewEventPanel events={events} reminderMode={reminderMode} />
      {events.length === 0 ? (
        <EmptyState kind="missing">No events yet. Use “New event” above to make the first.</EmptyState>
      ) : (
        <div className="space-y-4">
          {groupByYear(events).map((g) => (
            <YearGroup key={g.year} year={g.year} list={g.list} past={g.past} reminderMode={reminderMode} />
          ))}
        </div>
      )}
    </div>
  );
}
