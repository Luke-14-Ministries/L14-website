'use client';

// The groups board (0125): "To place" on the left, the groups on the right.
// Click a unit, then "Place … here" on a group -- the same pick-then-place as
// Rooms & Cabins, all buttons, so it works from the keyboard. Rooms & Cabins
// has no drag, so neither does this.
//
// A UNIT is a signed-up camper with their paired buddy (or buddies), or one
// person. Placing or removing a unit moves everybody in it; the server works
// the unit out again from the database (actions.js). Over capacity is allowed
// and shown red -- the size is a warning, not a lock.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createGroup, updateGroup, deleteGroup, placeUnits, unplaceUnit } from './actions';
import { GROUP_ROLE_LABEL, underAgeWords } from '@/lib/activityGroups';

const pill = 'rounded-full px-2 py-0.5 text-xs font-semibold';

function PersonLine({ person, minAge }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-medium">
        {person.name}
        {person.preferred && (
          <span className="font-normal text-neutral-600"> &ldquo;{person.preferred}&rdquo;</span>
        )}
      </span>
      {person.age != null && (
        <span className="text-xs text-neutral-500" title="Age at the start of the event">
          {person.age}
        </span>
      )}
      <span className="text-xs text-neutral-500">{GROUP_ROLE_LABEL[person.role] ?? person.role}</span>
      {person.isBuddy && <span className="text-xs text-neutral-500">· buddy</span>}
      {person.under && (
        <span className={`${pill} bg-red-100 text-red-800`}>{underAgeWords(minAge)}</span>
      )}
      {person.ageUnknown && (
        <span className={`${pill} bg-amber-100 text-amber-800`} title="No date of birth on file">
          Age unknown — check
        </span>
      )}
      {person.waiver === 'needed' && (
        <span className={`${pill} bg-amber-100 text-amber-800`}>Waiver needed</span>
      )}
      {person.waiver === 'checking' && (
        <span className={`${pill} bg-amber-50 text-amber-800 ring-1 ring-amber-300`} title="A confirmation is uploaded and waiting for staff to check it">
          Waiver being checked
        </span>
      )}
      {person.waiver === 'on_file' && (
        <span className={`${pill} bg-neutral-100 text-neutral-600`}>Waiver on file</span>
      )}
      {/* The FLAG only, never the narrative -- the activity print sheet's line. */}
      {person.ask && (
        <span
          className={`${pill} bg-blue-100 text-blue-800`}
          title="There is something to know — ask the coordinator. The detail is on Medical & Support."
        >
          ask the coordinator
        </span>
      )}
      {person.signup === 'interested' && (
        <span className={`${pill} bg-blue-50 text-blue-700`}>interested</span>
      )}
      {person.isBuddy && !person.signup && (
        <span className="text-xs text-neutral-400" title="Goes with their camper; did not sign up themselves">
          not signed up — goes with their camper
        </span>
      )}
      {person.stray && (
        <span
          className={`${pill} bg-amber-100 text-amber-800`}
          title="Placed earlier, but no longer signed up and not the buddy of anyone going"
        >
          no longer signed up
        </span>
      )}
    </span>
  );
}

function UnitButton({ unit, people, minAge, selected, disabled, onPick }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={selected}
      className={`w-full rounded-sm border px-3 py-2 text-left text-sm disabled:cursor-default ${
        selected ? 'border-brand bg-brand-light' : 'border-neutral-200 bg-white hover:bg-neutral-50'
      }`}
    >
      {unit.length > 1 && (
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Together · {unit.length}
        </span>
      )}
      <span className="block space-y-1">
        {unit.map((id) => (
          <span key={id} className="block">
            <PersonLine person={people[id]} minAge={minAge} />
          </span>
        ))}
      </span>
    </button>
  );
}

function GroupCard({
  group,
  units,
  people,
  minAge,
  noun,
  inHand,
  inHandNames,
  canPlace,
  pending,
  onPlace,
  onMove,
  onRemove,
  onSave,
  onDelete,
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [size, setSize] = useState(String(group.capacity));

  const count = group.memberIds.length;
  const over = count > group.capacity;
  const here = new Set(group.memberIds);
  const blocks = units
    .map((u) => ({ unit: u, inside: u.filter((id) => here.has(id)) }))
    .filter((b) => b.inside.length > 0);
  const incoming = inHand ? inHand.filter((id) => !here.has(id)).length : 0;
  const overBy = count + incoming - group.capacity;

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      {editing ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(group.id, name, size, () => setEditing(false));
          }}
        >
          <label className="text-sm">
            <span className="block text-xs font-semibold text-neutral-600">Name</span>
            <input
              className="rounded-sm border border-neutral-300 px-2 py-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-semibold text-neutral-600">Size</span>
            <input
              className="w-20 rounded-sm border border-neutral-300 px-2 py-1"
              inputMode="numeric"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            />
          </label>
          <button type="submit" disabled={pending} className="btn-primary py-1! text-xs">
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setName(group.name);
              setSize(String(group.capacity));
              setEditing(false);
            }}
            className="text-xs text-neutral-500 underline"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onDelete(group, count)}
            className="ml-auto text-xs font-semibold text-red-700 underline"
          >
            Delete {noun.one}
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold">{group.name}</h3>
          <span className="flex items-baseline gap-3 text-sm">
            <span className={over ? 'font-semibold text-red-700' : 'text-neutral-500'}>
              {count} of {group.capacity}
              {over ? ' — over' : ''}
            </span>
            {canPlace && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs font-semibold text-brand underline"
              >
                Edit
              </button>
            )}
          </span>
        </div>
      )}

      {blocks.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">Nobody yet.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {blocks.map(({ unit, inside }) => {
            const missing = unit.filter((id) => !here.has(id));
            return (
              <li
                key={unit[0]}
                className={`rounded-sm border bg-white px-3 py-1.5 text-sm ${
                  inHand && inHand[0] === unit[0] ? 'border-brand' : 'border-neutral-200'
                }`}
              >
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    {inside.map((id) => (
                      <div key={id}>
                        <PersonLine person={people[id]} minAge={minAge} />
                      </div>
                    ))}
                  </div>
                  {canPlace && (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onMove(unit)}
                        disabled={pending}
                        className="text-xs font-semibold text-brand underline"
                      >
                        {inHand && inHand[0] === unit[0] ? 'Choosing…' : 'Move'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(unit[0])}
                        disabled={pending}
                        className="text-xs font-semibold text-brand underline"
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </div>
                {missing.length > 0 && (
                  <p className="mt-1 text-xs font-semibold text-red-700">
                    Split: {missing.map((id) => people[id]?.name).join(', ')}{' '}
                    {missing.length === 1 ? 'is' : 'are'} not in this {noun.one}. Place them
                    together again.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canPlace && inHand && inHand.some((id) => !here.has(id)) && (
        <button
          type="button"
          onClick={() => onPlace(group.id)}
          disabled={pending}
          className={`mt-3 btn-outline py-1! text-xs ${overBy > 0 ? 'border-red-400! text-red-700!' : ''}`}
        >
          Place {inHandNames} here
          {overBy > 0 && ` — over by ${overBy}`}
        </button>
      )}
    </div>
  );
}

export default function GroupsBoard({
  activity,
  people,
  units,
  groups,
  programs,
  noun,
  canPlace = false,
  canSeeSupport = false,
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [inHand, setInHand] = useState(null); // a unit: [participantId]
  const [q, setQ] = useState('');
  const [family, setFamily] = useState('');
  const [program, setProgram] = useState('');
  const [underOnly, setUnderOnly] = useState(false);
  const [waiverOnly, setWaiverOnly] = useState(false);

  const going = useMemo(() => Object.values(people).filter((p) => !p.stray), [people]);
  const placed = going.filter((p) => p.groupId).length;

  // A unit is "to place" while anyone in it has no group.
  const toPlace = useMemo(
    () => units.filter((u) => u.some((id) => !people[id]?.groupId)),
    [units, people]
  );

  const families = useMemo(() => {
    const m = new Map();
    for (const p of going) if (p.householdId) m.set(p.householdId, p.household || 'No household name');
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [going]);
  const programIds = new Set(going.map((p) => p.programId).filter(Boolean));
  const programOptions = programs.filter((p) => programIds.has(p.id));

  const needle = q.trim().toLowerCase();
  const matches = (p) =>
    (!needle ||
      p.name.toLowerCase().includes(needle) ||
      (p.preferred ?? '').toLowerCase().includes(needle) ||
      p.household.toLowerCase().includes(needle)) &&
    (!family || p.householdId === family) &&
    (!program || p.programId === program) &&
    (!underOnly || p.under || p.ageUnknown) &&
    (!waiverOnly || p.waiver === 'needed' || p.waiver === 'checking');
  const shown = toPlace.filter((u) => u.some((id) => matches(people[id])));
  const filtering = Boolean(needle || family || program || underOnly || waiverOnly);

  // Campers with their buddies first; everyone else grouped by family.
  const pairedUnits = shown.filter((u) => u.length > 1 || u.some((id) => people[id]?.isBuddy));
  const singles = shown.filter((u) => !pairedUnits.includes(u));
  const familyMap = new Map();
  for (const u of singles) {
    const key = people[u[0]]?.household || 'No household name';
    if (!familyMap.has(key)) familyMap.set(key, []);
    familyMap.get(key).push(u);
  }
  const singlesByFamily = [...familyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const inHandNames = inHand
    ? inHand.map((id) => people[id]?.name.split(' ')[0]).join(' + ')
    : '';

  function run(fn) {
    setError('');
    start(async () => {
      const res = await fn();
      if (!res?.ok) setError(res?.error || 'That did not work.');
      else {
        setInHand(null);
        router.refresh();
      }
    });
  }

  const pick = (unit) => setInHand((cur) => (cur && cur[0] === unit[0] && cur.length === unit.length ? null : unit));

  // A whole family in one move, as on Rooms & Cabins (Lawrence, 26 Oct 2026):
  // everyone in the household still to place, each with their unit -- a
  // camper's buddy comes along. Keyed by household id.
  const familyUnits = new Map();
  for (const u of toPlace) {
    const hh = u.map((id) => people[id]).find((p) => p && !p.isBuddy)?.householdId;
    if (!hh) continue;
    if (!familyUnits.has(hh)) familyUnits.set(hh, []);
    familyUnits.get(hh).push(u);
  }
  const pickFamily = (householdId) => {
    const ids = [...new Set((familyUnits.get(householdId) ?? []).flat())];
    setInHand((cur) => (cur && cur.length === ids.length && ids.every((id) => cur.includes(id)) ? null : ids));
  };

  return (
    <div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-sm border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <p className="font-semibold">
          {going.length} going · {placed} placed · {going.length - placed} to place ·{' '}
          {groups.length} {groups.length === 1 ? noun.one : noun.many}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/admin/activities/groups/print/?activity=${activity.id}`} className="btn-outline py-2!">
            Print {noun.many}
          </a>
          <a href={`/admin/activities/groups/export/?activity=${activity.id}`} className="btn-outline py-2!">
            Download CSV
          </a>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="block text-xs font-semibold text-neutral-600">Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name or family"
            className="rounded-sm border border-neutral-300 px-2 py-1"
          />
        </label>
        <label>
          <span className="block text-xs font-semibold text-neutral-600">Family</span>
          <select
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            className="rounded-sm border border-neutral-300 px-2 py-1"
          >
            <option value="">All families</option>
            {families.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs font-semibold text-neutral-600">Program</span>
          <select
            value={program}
            onChange={(e) => setProgram(e.target.value)}
            className="rounded-sm border border-neutral-300 px-2 py-1"
          >
            <option value="">All programs</option>
            {programOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {activity.minAge != null && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={underOnly} onChange={(e) => setUnderOnly(e.target.checked)} />
            Under the minimum age ({activity.minAge}) or age unknown
          </label>
        )}
        {activity.hasWaiver && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={waiverOnly} onChange={(e) => setWaiverOnly(e.target.checked)} />
            Waiver still needed
          </label>
        )}
      </div>

      {!canSeeSupport && (
        <p className="mb-4 text-xs text-neutral-500">
          Support flags (&ldquo;ask the coordinator&rdquo;) show only for staff with Sensitive read.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="rounded-lg border border-neutral-200 bg-white p-4" aria-label="To place">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-bold">To place</h3>
            {inHand && (
              <button type="button" onClick={() => setInHand(null)} className="text-xs text-neutral-500 underline">
                Cancel placing
              </button>
            )}
          </div>
          {inHand && (
            <p className="mt-2 rounded-sm border border-brand bg-brand-light px-3 py-2 text-sm">
              Placing <span className="font-semibold">{inHandNames}</span> — choose a {noun.one} on
              the right.
            </p>
          )}
          {filtering && (
            <p className="mt-1 text-xs text-neutral-500">
              Filters narrow this list; the {noun.many} show everyone.
            </p>
          )}

          {toPlace.length === 0 ? (
            <p className="mt-2 text-sm text-green-700">
              {going.length === 0 ? 'Nobody has signed up yet.' : `Everyone going is in a ${noun.one}.`}
            </p>
          ) : shown.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Nobody to place matches the filters.</p>
          ) : (
            <>
              {pairedUnits.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">
                    Campers with their buddies
                  </p>
                  <ul className="mt-1 space-y-1">
                    {pairedUnits.map((u) => (
                      <li key={u[0]}>
                        <UnitButton
                          unit={u}
                          people={people}
                          minAge={activity.minAge}
                          selected={Boolean(inHand && inHand[0] === u[0])}
                          disabled={pending || !canPlace}
                          onPick={() => pick(u)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {singlesByFamily.map(([household, list]) => {
                const hhId = people[list[0][0]]?.householdId;
                const familyIds = hhId ? [...new Set((familyUnits.get(hhId) ?? []).flat())] : [];
                return (
                <div key={household} className="mt-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">
                      {household}
                      {list.length > 1 && ` · ${list.length} people`}
                    </p>
                    {canPlace && familyIds.length > 1 && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => pickFamily(hhId)}
                        className="text-xs font-semibold text-brand underline"
                        title="Everyone in this family still to place, each camper with their buddy"
                      >
                        Place the whole family ({familyIds.length})
                      </button>
                    )}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {list.map((u) => (
                      <li key={u[0]}>
                        <UnitButton
                          unit={u}
                          people={people}
                          minAge={activity.minAge}
                          selected={Boolean(inHand && inHand[0] === u[0])}
                          disabled={pending || !canPlace}
                          onPick={() => pick(u)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
                );
              })}
            </>
          )}
        </section>

        <section aria-label={noun.Many}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">{noun.Many}</h3>
            {canPlace && (
              <button
                type="button"
                onClick={() => run(() => createGroup({ activityId: activity.id }))}
                disabled={pending}
                className="btn-primary py-1.5! text-sm"
              >
                Add a {noun.one}
              </button>
            )}
          </div>
          {groups.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No {noun.many} yet.{canPlace ? ` Add the first with “Add a ${noun.one}”.` : ''}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((g) => (
                <GroupCard
                  key={`${g.id}:${g.name}:${g.capacity}`}
                  group={g}
                  units={units}
                  people={people}
                  minAge={activity.minAge}
                  noun={noun}
                  inHand={inHand}
                  inHandNames={inHandNames}
                  canPlace={canPlace}
                  pending={pending}
                  onPlace={(groupId) =>
                    run(() => placeUnits({ groupId, participantIds: inHand }))
                  }
                  onMove={pick}
                  onRemove={(participantId) =>
                    run(() => unplaceUnit({ activityId: activity.id, participantId }))
                  }
                  onSave={(groupId, name, capacity, done) => {
                    setError('');
                    start(async () => {
                      const res = await updateGroup({ groupId, name, capacity });
                      if (!res?.ok) setError(res?.error || 'That did not save.');
                      else {
                        done();
                        router.refresh();
                      }
                    });
                  }}
                  onDelete={(group, count) => {
                    const ok = window.confirm(
                      count > 0
                        ? `Delete ${group.name}?\n\n${count} ${count === 1 ? 'person goes' : 'people go'} back to To place.`
                        : `Delete ${group.name}?`
                    );
                    if (ok) run(() => deleteGroup({ groupId: group.id }));
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
