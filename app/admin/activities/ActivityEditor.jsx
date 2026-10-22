'use client';

// Editing an activity, and adding one.
//
// Camp changes what it offers — between weeks, between years, and sometimes on
// a phone call with an outfitter. Testing (25 Aug) asked the obvious question
// about zip line: "where do we activate things like this? Have to go through
// you, right now? doesn't seem sensible." It isn't. This is the answer.

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createActivity,
  updateActivity,
  deleteActivity,
  setActivityActive,
  createSlot,
  deleteSlot,
  generateSlots,
} from './actions';
import { activityDayBounds, formatDayShort } from '@/lib/events';

// Wall-clock, formatted as people say it. No timezone maths anywhere in this
// file, by design (0052): these are times AT CAMP, stored as a date and two
// times of day, and the moment anything converts them a boarding time is an
// hour out at the dock.
const fmtDay = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

export const fmtTime = (t) => {
  if (!t) return '';
  const [h, min] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return t;
  const ampm = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return min ? `${hh}:${String(min).padStart(2, '0')}${ampm}` : `${hh}${ampm}`;
};

export const slotLabel = (s) =>
  `${fmtDay(s.slot_date)} ${fmtTime(s.start_time)}–${fmtTime(s.end_time)}${
    s.label ? ` · ${s.label}` : ''
  }`;

const input = 'w-full rounded-sm border border-neutral-300 px-2 py-1 text-sm';
const label = 'block text-xs font-semibold text-neutral-700 mb-0.5';

// ---------------------------------------------------------------------------
// The waiver (21 Oct 2026). One decision with three answers -- nothing, the
// outside provider's own form, or the ministry's own waiver signed on the
// site -- because the two kinds were two different places on the form and
// read as two different questions. The provider's name and link live under
// the second answer; the third attaches, writes or revises an agreement
// (0116's horseback waiver was the first, by migration; this is the screen
// 0116 said was missing). What each answer does on save is in actions.js
// under "The ministry's own waiver on an activity".

const WAIVER_EXCERPT = 120;
const excerpt = (body) => {
  const t = String(body ?? '').replace(/\s+/g, ' ').trim();
  return t.length > WAIVER_EXCERPT ? `${t.slice(0, WAIVER_EXCERPT).trimEnd()}…` : t;
};

// The waiver fields as an activity stands now: attached waiver, provider, or
// neither. `attached` is the page's reading of this activity's requirement
// row (null when it has none); `choices` the waivers already in use.
function waiverState(activity, attached) {
  return {
    waiverChoice: attached ? 'ours' : activity?.provider_name ? 'provider' : 'none',
    waiverMode: 'keep',
    waiverAgreementId: '',
    waiverTitle: '',
    waiverBody: '',
  };
}

const waiverPayload = (f) => ({
  choice: f.waiverChoice,
  mode: f.waiverMode,
  agreementId: f.waiverAgreementId || null,
  title: f.waiverTitle,
  body: f.waiverBody,
});

const sharerName = (s) => `${s.name} (${s.eventName})`;

// "Also on …" under the attached waiver, each with its own version: once one
// activity has a new version the others are still on theirs.
const sharerList = (attached) =>
  (attached?.sharers ?? []).map((s) => `${sharerName(s)}, version ${s.version}`).join('; ');

// The sentence about the OTHER activities on the same key when this one gets
// a new version. Each keeps its OWN current version, which need not be this
// activity's (Week 1 at version 2 while Week 2 is still on version 1).
function sharerSentence(attached, what) {
  const list = attached?.sharers ?? [];
  if (list.length === 0) return '';
  if (list.length === 1) {
    const [s] = list;
    return `${sharerName(s)} also uses ${what} and stays on version ${s.version} until you change it there.`;
  }
  const versions = new Set(list.map((s) => s.version));
  if (versions.size === 1) {
    return `${list.map(sharerName).join(', ')} also use ${what} and stay on version ${list[0].version} until you change them there.`;
  }
  return `${list.map((s) => `${sharerName(s)} (version ${s.version})`).join(', ')} also use ${what}; each stays on its own version until you change it there.`;
}

// What to ask before saving, or null when the save needs no confirming. Only
// a change to an ATTACHED waiver is asked about: taking it off, swapping it,
// or giving it new text (a new version). Attaching one to an activity with
// none, or writing a brand-new one, just saves.
function waiverConfirm(f, attached, activityName) {
  if (!attached) return null;
  const a = attached.agreement;
  if (f.waiverChoice !== 'ours') {
    return `Take the ${a.title} off "${activityName}"?\n\nThe waiver itself stays, and every signature already given stays on file. Families ticking ${activityName} will no longer be asked to sign it.`;
  }
  if (
    f.waiverMode === 'revise' &&
    (f.waiverTitle.trim() !== a.title || f.waiverBody.trim() !== String(a.body ?? '').trim())
  ) {
    return `Save a new version of the ${a.title}?\n\nThis makes version ${attached.nextVersion} for "${activityName}". Signatures already given stay with version ${a.version}; anyone ticking ${activityName} from now on signs the new text.\n\n${
      attached.sharers.length > 0
        ? sharerSentence(attached, `the ${a.title}`)
        : 'No other activity uses it.'
    }`;
  }
  if (f.waiverMode === 'reuse' && f.waiverAgreementId && f.waiverAgreementId !== a.id) {
    return `Swap the ${a.title} for the one you chose on "${activityName}"?\n\nSignatures of the ${a.title} stay on file; families ticking ${activityName} from now on sign the one you chose.`;
  }
  return null;
}

const radio = 'mt-0.5 h-4 w-4 shrink-0 accent-brand';

function WaiverBlock({ f, set, setMany, attached, choices = [], activityName, hadProvider }) {
  const a = attached?.agreement ?? null;
  const others = choices.filter((c) => !a || c.id !== a.id);
  const firstMode = () => (attached ? 'keep' : choices.length ? 'reuse' : 'new');
  const choose = (choice) => () =>
    setMany({ waiverChoice: choice, waiverMode: choice === 'ours' ? firstMode() : 'keep' });
  const startRevise = () =>
    setMany({ waiverMode: 'revise', waiverTitle: a.title, waiverBody: a.body ?? '' });
  const startReuse = () => setMany({ waiverMode: 'reuse', waiverAgreementId: '' });
  const startNew = () => setMany({ waiverMode: 'new', waiverTitle: '', waiverBody: '' });
  const back = () => setMany({ waiverMode: firstMode(), waiverAgreementId: '' });
  const name = activityName || 'this activity';
  // Radios group by name across the whole page, and several cards can be
  // open at once: each block gets a group of its own.
  const group = useId();

  return (
    <fieldset className="mt-4 rounded-lg border border-neutral-200 bg-white p-3">
      <legend className="px-1 text-sm font-bold">Waiver</legend>
      <p className="text-xs text-neutral-500">
        How a family agrees to the risks of this activity, if it carries any.
      </p>

      <div className="mt-2 space-y-2 text-sm">
        <label className="flex gap-2">
          <input type="radio" name={group} className={radio} checked={f.waiverChoice === 'none'} onChange={choose('none')} />
          <span>
            <span className="font-semibold">None</span>
            <span className="text-neutral-600"> — no waiver for this activity.</span>
          </span>
        </label>

        <label className="flex gap-2">
          <input type="radio" name={group} className={radio} checked={f.waiverChoice === 'provider'} onChange={choose('provider')} />
          <span>
            <span className="font-semibold">The outside provider&rsquo;s own form</span>
            <span className="text-neutral-600">
              {' '}— the family completes it with the provider and uploads their confirmation.
            </span>
          </span>
        </label>
        {f.waiverChoice === 'provider' && (
          <div className="ml-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className={label}>Provider</span>
                <input
                  className={input}
                  value={f.providerName}
                  onChange={set('providerName')}
                  placeholder="e.g. River outfitter"
                />
              </label>
              <label className="text-sm">
                <span className={label}>Their link (optional)</span>
                <input className={input} value={f.providerUrl} onChange={set('providerUrl')} />
              </label>
            </div>
            {/* Naming a provider is not cosmetic: it is what makes the family's
                page say the outfitter has a form of their own, and what puts
                the told / not told pills on this page. */}
            {f.providerName.trim() ? (
              <p className="mt-1 text-xs text-amber-800">
                Families will be told {f.providerName.trim()} has their own form to complete, and
                asked to confirm they understand.
              </p>
            ) : (
              <p className="mt-1 text-xs text-neutral-500">
                Name the provider — a blank name means camp runs it, and families are told nothing.
              </p>
            )}
          </div>
        )}

        <label className="flex gap-2">
          <input type="radio" name={group} className={radio} checked={f.waiverChoice === 'ours'} onChange={choose('ours')} />
          <span>
            <span className="font-semibold">Our own waiver, signed on the site</span>
            <span className="text-neutral-600">
              {' '}— the family reads and signs it when they tick the activity.
            </span>
          </span>
        </label>

        {f.waiverChoice === 'ours' && f.waiverMode === 'keep' && a && (
          <div className="ml-6 rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-2">
            <p>
              <span className="font-semibold">{a.title}</span>
              <span className="text-neutral-600">
                {' '}· version {a.version} · signed by {attached.signedCount} of {attached.riderCount}{' '}
                {attached.riderCount === 1 ? 'person' : 'people'} on this activity
              </span>
            </p>
            {!a.active && (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                This version has been retired, so families cannot sign it. Choose the current
                version with &ldquo;Use a different waiver&rdquo;.
              </p>
            )}
            {excerpt(a.body) && (
              <p className="mt-1 text-xs italic text-neutral-600">&ldquo;{excerpt(a.body)}&rdquo;</p>
            )}
            {attached.sharers.length > 0 && (
              <p className="mt-1 text-xs text-neutral-500">Also on {sharerList(attached)}.</p>
            )}
            <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
              <button type="button" onClick={startRevise} className="text-brand underline">
                Edit the text
              </button>
              <button type="button" onClick={startReuse} className="text-brand underline">
                Use a different waiver
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              To take it off {name}, choose None or the provider&rsquo;s form above.
            </p>
          </div>
        )}

        {f.waiverChoice === 'ours' && f.waiverMode === 'reuse' && (
          <div className="ml-6">
            <label className="text-sm">
              <span className={label}>Which waiver</span>
              <select
                className={input}
                value={f.waiverAgreementId}
                onChange={(e) =>
                  e.target.value === '__new__' ? startNew() : setMany({ waiverAgreementId: e.target.value })
                }
              >
                <option value="">Choose a waiver…</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} — {c.key}, version {c.version}
                  </option>
                ))}
                <option value="__new__">Write a new waiver…</option>
              </select>
            </label>
            <p className="mt-1 text-xs text-neutral-500">
              Waivers already in use on an activity, at their current version. Choosing one
              attaches it to {name}; nothing changes for the other activities using it.
            </p>
            {attached && (
              <button type="button" onClick={back} className="mt-1 text-xs text-neutral-600 underline">
                Keep the {a.title}
              </button>
            )}
          </div>
        )}

        {f.waiverChoice === 'ours' && (f.waiverMode === 'new' || f.waiverMode === 'revise') && (
          <div className="ml-6">
            <label className="block text-sm">
              <span className={label}>Title</span>
              <input
                className={input}
                value={f.waiverTitle}
                onChange={set('waiverTitle')}
                placeholder="e.g. Zip Line Waiver"
              />
            </label>
            <label className="mt-2 block text-sm">
              <span className={label}>Text</span>
              <textarea rows={8} className={input} value={f.waiverBody} onChange={set('waiverBody')} />
            </label>
            <p className="mt-1 text-xs text-neutral-500">
              Plain text, as the family will read it. Write <code>{'{{event}}'}</code> where the
              event&rsquo;s name should appear — the page fills it in.
            </p>
            {f.waiverMode === 'revise' && a && (
              <p className="mt-1 text-xs text-neutral-600">
                Saving makes version {attached.nextVersion} of the {a.title}. Signatures already
                given stay with version {a.version}; anyone ticking {name} from now on signs the
                new text.
                {attached.sharers.length > 0 &&
                  ` ${sharerSentence(attached, 'it')}`}
              </p>
            )}
            <button type="button" onClick={back} className="mt-1 text-xs text-neutral-600 underline">
              {attached ? `Keep the ${a.title} as it is` : 'Back to the list'}
            </button>
          </div>
        )}

        {hadProvider && f.waiverChoice !== 'provider' && (
          <p className="text-xs text-amber-800">Saving clears the provider&rsquo;s name and link.</p>
        )}
      </div>
    </fieldset>
  );
}

function Fields({ f, set, setMany, attached, waiverChoices, activityName, hadProvider }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className={label}>Name</span>
          <input className={input} value={f.name} onChange={set('name')} />
        </label>
        <label className="text-sm">
          <span className={label}>
            Position in the list{' '}
            <span className="font-normal text-neutral-500">— lowest number first</span>
          </span>
          <input
            className={input}
            inputMode="numeric"
            value={f.sortOrder}
            onChange={set('sortOrder')}
            placeholder="10, 20, 30…"
          />
          {/* Numbered in tens by convention so a new activity can be dropped
              between two existing ones without renumbering the rest. */}
          <span className="mt-0.5 block text-xs text-neutral-500">
            Counting in tens (10, 20, 30) leaves room to slot one in later.
          </span>
        </label>
      </div>

      <label className="mt-3 block text-sm">
        <span className={label}>
          Description{' '}
          <span className="font-normal text-neutral-500">
            — what a family reads. Say when it usually happens.
          </span>
        </span>
        <textarea
          rows={2}
          className={input}
          value={f.description}
          onChange={set('description')}
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className={label}>How it books</span>
          <select className={input} value={f.mode} onChange={set('mode')}>
            <option value="interest">Interest — just tell us who fancies it</option>
            <option value="signup">Sign-up — holds a place</option>
          </select>
        </label>
        <label className="text-sm">
          <span className={label}>
            Places{' '}
            <span className="font-normal text-neutral-500">
              {f.mode === 'interest' ? '— not used for interest' : '— blank means no limit'}
            </span>
          </span>
          <input
            className={input}
            inputMode="numeric"
            value={f.mode === 'interest' ? '' : f.capacity}
            onChange={set('capacity')}
            disabled={f.mode === 'interest'}
            placeholder="no limit"
          />
        </label>
      </div>

      <WaiverBlock
        f={f}
        set={set}
        setMany={setMany}
        attached={attached}
        choices={waiverChoices}
        activityName={activityName}
        hadProvider={hadProvider}
      />
    </>
  );
}

// `waiver` is the page's reading of the activity's own waiver, or null:
// { agreement: { id, key, version, title, body, active }, signedCount,
//   riderCount, sharers: [{ name, eventName, version }], nextVersion }.
// `waiverChoices` is every waiver already in use on some activity, at its
// current version: [{ id, key, version, title }].
export function ActivityEditor({ activity, waiver = null, waiverChoices = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [f, setF] = useState({
    name: activity.name ?? '',
    description: activity.description ?? '',
    mode: activity.booking_mode ?? 'interest',
    capacity: activity.capacity == null ? '' : String(activity.capacity),
    providerName: activity.provider_name ?? '',
    providerUrl: activity.provider_url ?? '',
    sortOrder: String(activity.sort_order ?? 0),
    active: activity.active !== false,
    ...waiverState(activity, waiver),
  });
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));
  const setMany = (patch) => setF((prev) => ({ ...prev, ...patch }));

  function run(fn) {
    setError('');
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button onClick={() => setOpen((v) => !v)} className="text-brand underline">
          {open ? 'Close' : 'Edit this activity'}
        </button>
        <button
          onClick={() =>
            run(() => setActivityActive(activity.id, !(activity.active !== false)))
          }
          disabled={pending}
          className="text-brand underline"
        >
          {activity.active !== false ? 'Turn off (hide from families)' : 'Turn back on'}
        </button>
      </div>

      {!open && error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}

      {open && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <Fields
            f={f}
            set={set}
            setMany={setMany}
            attached={waiver}
            waiverChoices={waiverChoices}
            activityName={activity.name}
            hadProvider={Boolean(activity.provider_name)}
          />

          {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                const ask = waiverConfirm(f, waiver, activity.name);
                if (ask && !confirm(ask)) return;
                run(() =>
                  updateActivity(activity.id, { ...f, active: f.active, waiver: waiverPayload(f) })
                );
              }}
              disabled={pending}
              className="btn-primary py-1.5! text-sm disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={pending}
              className="text-sm text-neutral-600 underline"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (
                  !confirm(
                    `Remove "${activity.name}" from this event?\n\nThis is only possible while nobody has put their name down. If anyone has, turn it off instead — that hides it and keeps the record.`
                  )
                )
                  return;
                run(() => deleteActivity(activity.id));
              }}
              disabled={pending}
              className="ml-auto text-sm text-red-700 underline"
            >
              Remove from this event
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AddActivity({ eventId, eventName, waiverChoices = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const blank = {
    name: '',
    description: '',
    mode: 'interest',
    capacity: '',
    providerName: '',
    providerUrl: '',
    sortOrder: '50',
    active: true,
    ...waiverState(null, null),
  };
  const [f, setF] = useState(blank);
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));
  const setMany = (patch) => setF((prev) => ({ ...prev, ...patch }));

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-outline py-2! text-sm">
        + Add an activity to {eventName || 'this event'}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-5">
      <h3 className="font-bold mb-3">Add an activity</h3>
      <Fields
        f={f}
        set={set}
        setMany={setMany}
        attached={null}
        waiverChoices={waiverChoices}
        activityName={f.name.trim()}
        hadProvider={false}
      />
      {/* Said here because the obvious next question after "Sign-up" is "where
          do I put the times?" and the answer is "not yet" (25 Aug). */}
      {f.mode === 'signup' && (
        <p className="mt-3 rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          <span className="font-semibold">Times come afterwards.</span> If this one runs in
          sittings — a trip that goes out four times, a chair that takes one person at a time —
          add it first, then open it and use <span className="font-semibold">Times</span>. You
          can add them one at a time or generate a whole run at once.
        </p>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={() => {
            setError('');
            start(async () => {
              const res = await createActivity(eventId, { ...f, waiver: waiverPayload(f) });
              if (!res.ok) setError(res.error);
              else {
                setF(blank);
                setOpen(false);
                router.refresh();
              }
            });
          }}
          disabled={pending}
          className="btn-primary py-1.5! text-sm disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add it'}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError('');
          }}
          disabled={pending}
          className="text-sm text-neutral-600 underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// One activity, collapsed to its title bar until somebody wants the detail.
//
// Asked for 25 Aug. A coordinator opening this page is usually answering one
// question — how many for the boat? — and eleven expanded cards, each with a
// name list and a row of edit links, buries that answer in a page of things
// nobody is doing right now.
//
// Collapsed by default, including the editor: editing is the rare act here and
// the counts are the common one. The bar carries the number, so a closed card
// still answers the question the page gets opened for.
export function ActivityCard({
  name,
  active = true,
  modeLabel,
  signedUp = 0,
  interested = 0,
  capacity = null,
  over = false,
  children,
}) {
  const [open, setOpen] = useState(false);
  const total = signedUp + interested;

  return (
    <div className="rounded-lg bg-white border border-neutral-200 shadow-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-5 py-4 text-left hover:bg-neutral-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={`shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
          <span className="text-lg font-bold">{name}</span>
          {!active && (
            <span className="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-600">
              not open
            </span>
          )}
        </span>
        <span className="flex items-center gap-3 text-sm text-neutral-600">
          <span>{modeLabel}</span>
          <span className={over ? 'font-semibold text-amber-700' : 'font-semibold'}>
            {capacity != null ? `${signedUp} of ${capacity}` : total}
            {over ? ' — over' : ''}
            {capacity == null && (
              <span className="font-normal">
                {' '}
                {total === 1 ? 'person' : 'people'}
                {interested > 0 && signedUp > 0 && ` (${signedUp} signed up)`}
              </span>
            )}
          </span>
          <span className="text-xs text-neutral-400">{open ? 'Hide' : 'Show'}</span>
        </span>
      </button>

      {/* Unmounted, not hidden: the body holds the editor's live controls, and
          leaving them in the tree but invisible puts focusable fields where a
          keyboard user cannot see them. */}
      {open && <div className="border-t border-neutral-200 px-5 pb-5 pt-4">{children}</div>}
    </div>
  );
}

// The sittings an activity runs in.
//
// Only shown for sign-up activities: an interest list has no times to hold, and
// offering them would imply a booking that is not being made. Once ANY slot
// exists, the database requires every signup to name one (0052) — so adding
// the first time to an activity people have already joined is a real change,
// and the panel says so.
export function SlotEditor({ activity, slots = [], event = null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const blank = { date: '', start: '', end: '', capacity: '', label: '' };
  const [f, setF] = useState(blank);
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  // A run of slots, generated. See generateSlots() for why this exists.
  const genBlank = { date: '', start: '', end: '', minutes: '30', capacity: '', labelPrefix: '' };
  const [g, setG] = useState(genBlank);
  const setG_ = (k) => (e) => setG((prev) => ({ ...prev, [k]: e.target.value }));
  const [genOpen, setGenOpen] = useState(false);

  // A time must fall during the event (Lawrence, 22 Oct 2026; 0119). Until
  // then this was only a warning, kept advisory so an arrival-evening sitting
  // could be set -- and Week 1's only Salon sitting was saved four days before
  // the week. The range starts on the volunteers' arrival day when that is
  // earlier, which is what the arrival evening needed, and ends on the last
  // day (a departure-morning sitting is on it). The browser's min/max, the
  // server action and a trigger on activity_slots hold the same range.
  const bounds = activityDayBounds(event);
  const dayBounds = bounds ? { min: bounds.first, max: bounds.last } : {};
  const rangeText = bounds
    ? `Between ${formatDayShort(bounds.first)} and ${formatDayShort(bounds.last)}.`
    : '';
  const outsideCamp = (d) => Boolean(d && bounds && (d < bounds.first || d > bounds.last));

  if (activity.booking_mode !== 'signup') {
    return (
      <p className="mt-3 text-xs text-neutral-500">
        Times are for sign-up activities. This one is an interest list — set it to
        &ldquo;Sign-up&rdquo; above if it runs in sittings.
      </p>
    );
  }

  function run(fn) {
    setError('');
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        setF(blank);
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
      <h4 className="text-sm font-bold">Times</h4>
      <p className="mt-0.5 text-xs text-neutral-500">
        For activities that run in sittings — the 2 o&rsquo;clock trip, chair 3. Times are as
        they are at camp; nothing is adjusted for where you are sitting.
      </p>

      {slots.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          No times yet — families just put their name on the activity.
          {' '}
          <span className="text-neutral-600">
            Adding the first one will require everyone to choose a time, including anyone
            already signed up.
          </span>
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {slots.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-sm border border-neutral-200 px-3 py-1.5 text-sm"
            >
              <span className="font-medium">{slotLabel(s)}</span>
              {outsideCamp(s.slot_date) && (
                <span className="rounded-sm bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">
                  Not during the event — remove it and add the right day
                </span>
              )}
              <span className="text-xs text-neutral-500">
                {s.capacity == null ? 'no limit' : `${s.taken ?? 0} of ${s.capacity}`}
              </span>
              <button
                onClick={() => {
                  if (!confirm(`Remove ${slotLabel(s)}?`)) return;
                  run(() => deleteSlot(s.id));
                }}
                disabled={pending}
                className="ml-auto text-xs font-semibold text-red-700 underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-5">
        <label className="text-xs">
          <span className="block font-semibold text-neutral-700 mb-0.5">Day</span>
          <input
            type="date"
            className={input}
            value={f.date}
            onChange={set('date')}
            {...dayBounds}
          />
          {rangeText && <span className="mt-0.5 block text-neutral-500">{rangeText}</span>}
        </label>
        <label className="text-xs">
          <span className="block font-semibold text-neutral-700 mb-0.5">From</span>
          <input type="time" className={input} value={f.start} onChange={set('start')} />
        </label>
        <label className="text-xs">
          <span className="block font-semibold text-neutral-700 mb-0.5">To</span>
          <input type="time" className={input} value={f.end} onChange={set('end')} />
        </label>
        <label className="text-xs">
          <span className="block font-semibold text-neutral-700 mb-0.5">Places</span>
          <input
            className={input}
            inputMode="numeric"
            value={f.capacity}
            onChange={set('capacity')}
            placeholder="no limit"
          />
        </label>
        <label className="text-xs">
          <span className="block font-semibold text-neutral-700 mb-0.5">Name (optional)</span>
          <input
            className={input}
            value={f.label}
            onChange={set('label')}
            placeholder="Sitting 1"
          />
        </label>
      </div>

      {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}

      {outsideCamp(f.date) && (
        <p className="mt-2 text-xs font-semibold text-amber-800">
          That day is not during the event. {rangeText}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => run(() => createSlot(activity.id, f))}
          disabled={pending}
          className="btn-outline py-1.5! text-sm disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add this time'}
        </button>
        <button
          onClick={() => setGenOpen((v) => !v)}
          className="text-sm font-semibold text-brand underline"
        >
          {genOpen ? 'Close' : 'Or generate a run of times'}
        </button>
      </div>

      {genOpen && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <p className="text-xs text-neutral-600">
            Splits one stretch of the day into equal slots — half-hour sittings all
            afternoon, fifteen-minute appointments. Each gets the same number of places.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-6">
            <label className="text-xs">
              <span className="block font-semibold text-neutral-700 mb-0.5">Day</span>
              <input
                type="date"
                className={input}
                value={g.date}
                onChange={setG_('date')}
                {...dayBounds}
              />
              {rangeText && <span className="mt-0.5 block text-neutral-500">{rangeText}</span>}
            </label>
            <label className="text-xs">
              <span className="block font-semibold text-neutral-700 mb-0.5">Starts</span>
              <input type="time" className={input} value={g.start} onChange={setG_('start')} />
            </label>
            <label className="text-xs">
              <span className="block font-semibold text-neutral-700 mb-0.5">Ends</span>
              <input type="time" className={input} value={g.end} onChange={setG_('end')} />
            </label>
            <label className="text-xs">
              <span className="block font-semibold text-neutral-700 mb-0.5">Each (mins)</span>
              <input
                className={input}
                inputMode="numeric"
                value={g.minutes}
                onChange={setG_('minutes')}
              />
            </label>
            <label className="text-xs">
              <span className="block font-semibold text-neutral-700 mb-0.5">Places each</span>
              <input
                className={input}
                inputMode="numeric"
                value={g.capacity}
                onChange={setG_('capacity')}
                placeholder="no limit"
              />
            </label>
            <label className="text-xs">
              <span className="block font-semibold text-neutral-700 mb-0.5">Name each</span>
              <input
                className={input}
                value={g.labelPrefix}
                onChange={setG_('labelPrefix')}
                placeholder="Trip"
              />
            </label>
          </div>

          {outsideCamp(g.date) && (
            <p className="mt-2 text-xs font-semibold text-amber-800">
              That day is not during the event. {rangeText}
            </p>
          )}

          <button
            onClick={() =>
              run(async () => {
                const res = await generateSlots(activity.id, g);
                if (res.ok) setG(genBlank);
                return res;
              })
            }
            disabled={pending}
            className="mt-3 btn-primary py-1.5! text-sm disabled:opacity-50"
          >
            {pending ? 'Making…' : 'Make these times'}
          </button>
        </div>
      )}
    </div>
  );
}
