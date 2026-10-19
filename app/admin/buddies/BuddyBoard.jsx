'use client';

// The pairing board: campers who need a buddy on the left, volunteers on the
// right, and one deliberate publish step underneath.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignBuddy, unassignBuddy, setBuddyPublication, setBuddyRequired } from './actions';
import { clearancePill } from '@/lib/format';
import { dayInMorristown } from '@/lib/events';

// One pill, shared with Volunteers (lib/format.js, 0091): no record is not
// the same as a failed check, on file is not the same as OK, and the
// ministry's verdict -- green OK, amber follow-up, red not permitted -- is
// what a coordinator pairing a buddy actually needs to know.
function ClearanceBadge({ clearance }) {
  const pill = clearancePill(clearance);
  return (
    <span title={pill.title} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pill.cls}`}>
      {pill.text}
    </span>
  );
}

function SupportNotes({ support, canSee = true }) {
  // Without Sensitive read the database returns nothing; that is "hidden",
  // not "missing" (Script 5 role gates, 18 Oct 2026).
  if (!support && !canSee) {
    return (
      <p className="mt-1 text-sm text-neutral-500">
        Support details hidden — they need the Sensitive grant.
      </p>
    );
  }
  if (!support) {
    return (
      <p className="mt-1 text-sm text-amber-800">
        No support details on file yet — pairing without them is guesswork.
      </p>
    );
  }
  const bits = [
    ['Communication', support.communication],
    ['Getting around', support.mobility],
    ['Personal care', support.personalCare],
    ['Harder when', support.triggers],
    ['What helps', support.helps],
  ].filter(([, v]) => v);

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-1">
        {support.seizures && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
            seizures
          </span>
        )}
        {support.allergies && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
            allergies
          </span>
        )}
      </div>
      {bits.length === 0 ? (
        <p className="text-sm text-neutral-500">No pairing notes recorded.</p>
      ) : (
        <dl className="text-sm">
          {bits.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="shrink-0 font-semibold text-neutral-500">{k}:</dt>
              <dd className="min-w-0 text-neutral-700">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default function BuddyBoard({
  eventId,
  eventName,
  publishedAt,
  campers,
  otherCampers = [],
  canMark = false,
  // Buddies write (0101). Without it the board is read-only: no publish,
  // pair or remove controls (Script 5, 13.44).
  canEdit = true,
  canSeeSupport = true,
  volunteers,
  assignments,
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [markOpen, setMarkOpen] = useState(false);

  // Marking somebody as needing a buddy. The only way this flag is now set:
  // families stopped being asked on 31 Aug 2026, because the coordinator works
  // it out by talking to them.
  function mark(personId, required, name) {
    if (
      !required &&
      !window.confirm(
        `Record that ${name} does NOT need a one-to-one buddy?

` +
          `Every camper is listed as needing one until somebody decides otherwise, so ` +
          `this is a decision rather than a tidy-up: they come off the board and stop ` +
          `being counted as waiting for a buddy.

` +
          `Any buddy already paired with them stays paired — remove that pairing ` +
          `separately if it is what you meant.`
      )
    ) {
      return;
    }
    start(async () => {
      const res = await setBuddyRequired({ personId, required });
      if (!res?.ok) window.alert(res?.error || 'That could not be saved.');
      else router.refresh();
    });
  }
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(null); // camper participantId
  // Volunteers who already have a camper are hidden from the picker unless
  // asked for (14 Oct 2026, Lawrence): the list is for finding a free pair of
  // hands, and a second camper for the same volunteer is the exception, not
  // the default. The box brings them back, with their load shown.
  const [hidePaired, setHidePaired] = useState(true);

  const byCamper = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (!m.has(a.camperParticipantId)) m.set(a.camperParticipantId, []);
      m.get(a.camperParticipantId).push(a);
    }
    return m;
  }, [assignments]);

  const loadByVolunteer = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      m.set(a.buddyParticipantId, (m.get(a.buddyParticipantId) ?? 0) + 1);
    }
    return m;
  }, [assignments]);

  const volunteerById = useMemo(
    () => new Map(volunteers.map((v) => [v.participantId, v])),
    [volunteers]
  );

  const unpaired = campers.filter((c) => (byCamper.get(c.participantId) ?? []).length === 0);

  function doAssign(camper, volunteer) {
    setError('');
    // Buddies are many-to-many (Larry, call of 16 Oct 2026; the database never
    // said otherwise): a camper may have two buddies, a buddy may have two
    // campers. Neither needs a yes any more -- the board shows every pairing
    // and each volunteer's count, which is the information the old confirms
    // carried. Only a double entry is refused.
    const existing = byCamper.get(camper.participantId) ?? [];

    // The same volunteer with the same camper twice is not a judgement call,
    // it is a double entry. Refused outright (25 Aug) -- there is no reading
    // of it that means anything.
    if (existing.some((a) => a.buddyParticipantId === volunteer.participantId)) {
      setError(`${volunteer.name} is already paired with ${camper.name}.`);
      return;
    }


    // The clearance warning fires at the moment of the decision, which is the
    // only moment it can change one. Its words are the pill's (clearancePill,
    // lib/format.js), so the question can never disagree with the badge
    // beside the name. It read the old view's cleared / expired / status
    // fields, which clearance_status does not have, and said "not cleared
    // (pending)" for people whose pill said "No background check on file"
    // (Script 5, 18 Oct 2026).
    const pill = clearancePill(volunteer.clearance);
    if (pill.key !== 'ok') {
      const ok = window.confirm(
        `${volunteer.name}: ${pill.text}.\n\nPair them with ${camper.name} anyway?\n\n(Clearances often arrive after pairing is drafted — this is a warning, not a rule. It must not still be true in the week before camp.)`
      );
      if (!ok) return;
    }
    start(async () => {
      const res = await assignBuddy({
        eventId,
        camperParticipantId: camper.participantId,
        buddyParticipantId: volunteer.participantId,
      });
      if (!res.ok) setError(res.error);
      else {
        setPicking(null);
        router.refresh();
      }
    });
  }

  function doUnassign(assignmentId) {
    setError('');
    start(async () => {
      const res = await unassignBuddy({ assignmentId });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function togglePublish() {
    setError('');
    const publishing = !publishedAt;
    const ok = window.confirm(
      publishing
        ? `Publish buddy assignments for ${eventName}?\n\nEvery paired family and volunteer will be able to see who they are with.${
            unpaired.length > 0
              ? `\n\n${unpaired.length} camper${unpaired.length === 1 ? '' : 's'} still ${
                  unpaired.length === 1 ? 'has' : 'have'
                } no buddy.`
              : ''
          }`
        : `Unpublish buddy assignments for ${eventName}?\n\nFamilies who have already seen their buddy will stop being able to.`
    );
    if (!ok) return;
    start(async () => {
      const res = await setBuddyPublication({ eventId, publish: publishing });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* The two numbers staff run the week from, given the size that says so.
          They existed already — as one grey line beside the publish state,
          which is why testing asked "what counter?" (25 Aug). How many still
          need a buddy is the whole job of this page; it should be the first
          thing on it and it should be amber while it is not zero. */}
      <div className="mb-5 flex flex-wrap gap-4">
        <div className="rounded-lg border border-neutral-200 bg-white px-5 py-3">
          <div className="text-3xl font-bold">{campers.length}</div>
          <div className="text-sm font-semibold text-neutral-700">asking for a buddy</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white px-5 py-3">
          <div className="text-3xl font-bold text-green-700">
            {campers.length - unpaired.length}
          </div>
          <div className="text-sm font-semibold text-neutral-700">paired</div>
        </div>
        <div
          className={`rounded-lg border bg-white px-5 py-3 ${
            unpaired.length > 0 ? 'border-amber-300' : 'border-neutral-200'
          }`}
        >
          <div
            className={`text-3xl font-bold ${
              unpaired.length > 0 ? 'text-amber-700' : 'text-neutral-400'
            }`}
          >
            {unpaired.length}
          </div>
          <div className="text-sm font-semibold text-neutral-700">
            {unpaired.length === 0 ? 'nobody left to pair' : 'still without a buddy'}
          </div>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="min-w-0">
          <p className="font-semibold">
            {publishedAt ? (
              <span className="text-green-700">
                Published — families can see their buddy
              </span>
            ) : (
              <span className="text-neutral-700">Draft — families see nothing yet</span>
            )}
          </p>
          <p className="text-sm text-neutral-500">
            {publishedAt && `Published ${dayInMorristown(publishedAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The pairings as a spreadsheet, and as one sheet per buddy for
              orientation (14 Oct 2026). Both carry the event. */}
          <a
            href={`/admin/buddies/export?event=${eventId}`}
            className="btn-outline !py-2 text-sm"
            title="Every pairing for this event as a CSV: camper, buddy, household, check status."
          >
            Download CSV
          </a>
          <a
            href={`/admin/buddies/print/?event=${eventId}`}
            className="btn-outline !py-2 text-sm"
            title="One printable sheet per buddy, with their camper's details, to hand out at orientation."
          >
            Print buddy sheets
          </a>
          {canEdit && (
            <button
              onClick={togglePublish}
              disabled={pending}
              className={publishedAt ? 'btn-outline !py-2' : 'btn-primary !py-2'}
            >
              {publishedAt ? 'Unpublish' : 'Publish assignments'}
            </button>
          )}
        </div>
      </div>

      {campers.length === 0 ? (
        <p className="text-neutral-500">
          Nobody on this roster has asked for a one-to-one buddy.
        </p>
      ) : (
        <div className="space-y-4">
          {campers.map((c) => {
            const mine = byCamper.get(c.participantId) ?? [];
            return (
              <div
                key={c.participantId}
                className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-bold">
                    {c.name}
                    <span className="ml-2 text-sm font-normal text-neutral-500">
                      {c.household}
                    </span>
                    {/* A sibling's buddy is a preference, not a promise (29 Sep
                        2026): pair them when a volunteer is free, after the
                        campers. */}
                    {c.role === 'sibling' && (
                      <span
                        title="Siblings may be paired with a buddy when a volunteer is free — this is a preference, not a promise. Campers come first."
                        className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 align-middle"
                      >
                        sibling — if available
                      </span>
                    )}
                  </h3>
                  {mine.length === 0 ? (
                    <span className="flex items-center gap-2">
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                        no buddy assigned
                      </span>
                      {/* Only offered while nobody is paired. Taking someone off
                          the list who already has a buddy would leave a pairing
                          behind with nothing explaining it. */}
                      {canMark && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => mark(c.personId, false, c.name)}
                          className="text-xs text-neutral-500 underline hover:text-neutral-700 disabled:opacity-50"
                        >
                          buddy not needed
                        </button>
                      )}
                    </span>
                  ) : (
                    <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-600">
                      {/* The three states, in the words camp uses (Lawrence, 1 Sep):
                          "buddy assigned — name(s)", "no buddy assigned", "buddy not
                          needed". The name is the point: "who?" is the question
                          staff actually have. */}
                      {mine.length === 1 ? 'buddy assigned' : `${mine.length} buddies assigned`}
                      {' — '}
                      {mine
                        .map((a) => volunteerById.get(a.buddyParticipantId)?.name ?? 'unknown')
                        .join(', ')}
                    </span>
                  )}
                </div>

                {c.buddyRatio && (
                  <p className="mt-0.5 text-sm text-neutral-500">
                    Requested ratio: {c.buddyRatio}
                  </p>
                )}

                <SupportNotes support={c.support} canSee={canSeeSupport} />

                {mine.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {mine.map((a) => {
                      const v = volunteerById.get(a.buddyParticipantId);
                      return (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center gap-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
                        >
                          <span className="font-semibold">{v?.name ?? 'volunteer'}</span>
                          {v && <ClearanceBadge clearance={v.clearance} />}
                          {canEdit && <button
                            onClick={() => doUnassign(a.id)}
                            disabled={pending}
                            className="ml-auto text-xs font-semibold text-brand underline"
                          >
                            Remove
                          </button>}
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="mt-3">
                  {picking === c.participantId ? (
                    <div className="rounded border border-neutral-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-semibold">Choose a buddy for {c.name}</p>
                        <button
                          onClick={() => setPicking(null)}
                          className="text-xs text-neutral-500 underline"
                        >
                          Cancel
                        </button>
                      </div>
                      <label className="mb-2 flex items-center gap-2 text-xs text-neutral-600">
                        <input
                          type="checkbox"
                          checked={hidePaired}
                          onChange={(e) => setHidePaired(e.target.checked)}
                        />
                        Hide paired
                        {hidePaired && volunteers.some((v) => (loadByVolunteer.get(v.participantId) ?? 0) > 0) && (
                          <span className="text-neutral-400">
                            ({volunteers.filter((v) => (loadByVolunteer.get(v.participantId) ?? 0) > 0).length} hidden)
                          </span>
                        )}
                      </label>
                      {volunteers.length === 0 ? (
                        <p className="text-sm text-neutral-500">
                          No volunteers on this roster yet.
                        </p>
                      ) : volunteers.every((v) => (loadByVolunteer.get(v.participantId) ?? 0) > 0) && hidePaired ? (
                        <p className="text-sm text-neutral-500">
                          Every volunteer on this roster already has a camper — untick &ldquo;Hide paired&rdquo; to see them.
                        </p>
                      ) : (
                        <ul className="grid gap-1 sm:grid-cols-2">
                          {volunteers.filter((v) => v.personId !== c.personId && (!hidePaired || (loadByVolunteer.get(v.participantId) ?? 0) === 0)).map((v) => {
                            const load = loadByVolunteer.get(v.participantId) ?? 0;
                            return (
                              <li key={v.participantId}>
                                <button
                                  onClick={() => doAssign(c, v)}
                                  disabled={pending}
                                  className="flex w-full flex-wrap items-center gap-2 rounded border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-brand-light disabled:opacity-50"
                                >
                                  <span className="font-medium">{v.name}</span>
                                  <ClearanceBadge clearance={v.clearance} />
                                  {load > 0 && (
                                    <span className="ml-auto text-xs text-neutral-500">
                                      already with {load}
                                    </span>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : canEdit ? (
                    <button
                      onClick={() => setPicking(c.participantId)}
                      disabled={pending}
                      className="btn-outline !py-1.5 text-sm"
                    >
                      {mine.length === 0 ? 'Assign a buddy' : 'Add another buddy'}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Marking somebody as needing a buddy.
          Families are no longer asked this at registration (31 Aug 2026) — the
          coordinator works it out by talking to them — so this is the only way
          the flag is ever set now. Without it the board would empty itself over
          a season with no way to refill it.

          Collapsed by default: it is a list of every camper at the event, and
          it is a thing you do occasionally, not the job this page is for. */}
      {canMark && otherCampers.length > 0 && (
        <div className="mt-8 rounded-lg border border-neutral-200 bg-white p-5">
          <button
            type="button"
            onClick={() => setMarkOpen((o) => !o)}
            aria-expanded={markOpen}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="font-semibold">Marked as not needing a buddy</span>
              <span className="ml-2 text-sm text-neutral-500">
                {otherCampers.length}{' '}
                {otherCampers.length === 1 ? 'camper' : 'campers'} — put one back on the board
              </span>
            </span>
            <span className="text-sm text-brand underline">
              {markOpen ? 'Hide' : 'Show'}
            </span>
          </button>

          {markOpen && (
            <>
              <p className="mt-2 text-sm text-neutral-600">
                Somebody decided these campers do not need a one-to-one buddy. If that
                has changed — or it was decided too quickly — put them back and they
                return to the board above, ready to pair.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {otherCampers.map((c) => (
                  <button
                    key={c.participantId}
                    type="button"
                    disabled={pending}
                    onClick={() => mark(c.personId, true, c.name)}
                    className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:border-brand hover:bg-brand-light disabled:opacity-50"
                    title={`Mark ${c.name} as needing a one-to-one buddy`}
                  >
                    + {c.name}
                    <span className="ml-1.5 text-xs text-neutral-500">{c.household}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
