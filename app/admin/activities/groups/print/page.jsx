import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import BackLink from '@/components/BackLink';
import { GROUP_ROLE_LABEL, groupNoun, underAgeWords } from '@/lib/activityGroups';
import { loadActivityGroups } from '../load';

export const metadata = { title: 'Activity Groups — Print — Staff Admin' };

// The groups on paper (0125): one block per group -- each unit on one line,
// the buddy beside their camper, with age, the Under-8 pill and a waiver
// tick -- and at the end the OUTFITTER LIST: names only, by group, which is
// all the outfitter needs (Lawrence, 26 Oct 2026; we set the boats).
//
// Same line as the activity print sheet (app/admin/activities/print): a
// support FLAG, "ask the coordinator", never the narrative. Paper gets left
// on a table.
function Person({ id, people, minAge }) {
  const p = people[id];
  if (!p) return null;
  return (
    <span>
      <span className="font-medium">{p.name}</span>
      {p.preferred && <span className="text-neutral-600"> &ldquo;{p.preferred}&rdquo;</span>}
      <span className="text-neutral-600">
        {' '}
        · {p.age ?? '?'} · {GROUP_ROLE_LABEL[p.role] ?? p.role}
        {p.isBuddy ? ' (buddy)' : ''}
      </span>
      {p.under && (
        <span className="ml-1 rounded-full border border-neutral-800 px-1.5 text-xs font-semibold">
          {underAgeWords(minAge)}
        </span>
      )}
      {p.ageUnknown && <span className="ml-1 text-xs font-semibold">age unknown — check</span>}
      {p.waiver === 'on_file' && <span className="ml-1 text-xs">· waiver ✓</span>}
      {p.waiver === 'needed' && <span className="ml-1 text-xs font-semibold">· waiver NEEDED</span>}
      {p.waiver === 'checking' && <span className="ml-1 text-xs font-semibold">· waiver not yet checked</span>}
      {p.ask && <span className="ml-1 text-xs font-semibold">· ask the coordinator</span>}
    </span>
  );
}

// One row per unit: the buddy beside their camper, joined by "+".
function Units({ list, people, minAge }) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <tbody>
        {list.map((inside) => (
          <tr key={inside[0]} className="border-b border-neutral-200 align-top">
            <td className="w-8 py-1.5">
              <span className="inline-block h-3.5 w-3.5 border border-neutral-500" />
            </td>
            <td className="py-1.5">
              {inside.map((id, i) => (
                <span key={id}>
                  {i > 0 && <span className="mx-2 font-semibold">+</span>}
                  <Person id={id} people={people} minAge={minAge} />
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ActivityGroupsPrintPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/activities/groups/print/');
  if (!can(staff, 'read:activities')) redirect('/admin');

  const activityId = typeof params?.activity === 'string' ? params.activity : '';
  const supabase = await createClient();
  const data = activityId ? await loadActivityGroups(supabase, activityId) : null;
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl bg-white p-8">
        <p className="text-sm text-neutral-500">No activity chosen, or it was not found.</p>
      </div>
    );
  }

  const { activity, event, people, units, groups } = data;
  const noun = groupNoun(activity.name);
  const minAge = activity.minAge;

  const blocksFor = (g) => {
    const here = new Set(g.memberIds);
    return units
      .map((u) => u.filter((id) => here.has(id)))
      .filter((inside) => inside.length > 0);
  };
  // By family, as on the board: each unit under its camper's family (the
  // first member who is not a buddy), so a family's people print together.
  const familyOf = (u) =>
    (u.map((id) => people[id]).find((p) => p && !p.isBuddy) ?? people[u[0]])?.household ?? '';
  const unplacedUnits = units
    .filter((u) => u.some((id) => !people[id]?.groupId))
    .sort((a, b) => familyOf(a).localeCompare(familyOf(b)));

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print:p-0 print:text-[12px]">
      <div className="mb-2 flex items-start justify-between print:hidden">
        <h1 className="text-xl font-bold">
          {activity.name} — {noun.many}
        </h1>
        {/* The way back on the title's line, Print under it (27 Oct 2026). */}
        <span className="flex flex-col items-end gap-2">
          <BackLink href={`/admin/activities/groups/?activity=${activityId}`} label="Back to the groups" />
          <PrintButton />
        </span>
      </div>
      <p className="mb-3 text-sm text-neutral-500 print:hidden">
        One block per {noun.one}, each camper with their buddy on one line, then the outfitter
        list (names only). Flags only — the detail behind &ldquo;ask the coordinator&rdquo; stays on
        the Medical &amp; Support page.
      </p>

      <p className="mb-6 text-sm font-semibold">
        {activity.name}
        {event ? ` · ${event.name} · ${event.startsOn} – ${event.endsOn}` : ''}
        {minAge != null ? ` · minimum age ${minAge} (check with camp staff for exceptions)` : ''}
      </p>

      {groups.length === 0 && (
        <p className="text-sm text-neutral-500">No {noun.many} have been set up yet.</p>
      )}

      {groups.map((g) => {
        const count = g.memberIds.length;
        return (
          <div key={g.id} className="mb-6 break-inside-avoid">
            <h2 className="mb-1 border-b-2 border-neutral-800 pb-1 text-lg font-bold">
              {g.name}
              <span className="ml-2 text-sm font-normal">
                {count} of {g.capacity}
                {count > g.capacity ? ' — OVER' : ''}
              </span>
            </h2>
            {count === 0 ? (
              <p className="text-sm text-neutral-500">Nobody yet.</p>
            ) : (
              <Units list={blocksFor(g)} people={people} minAge={minAge} />
            )}
          </div>
        );
      })}

      {unplacedUnits.length > 0 && (
        <div className="mb-6 break-inside-avoid">
          <h2 className="mb-1 border-b-2 border-neutral-800 pb-1 text-lg font-bold">
            Not in a {noun.one} yet
          </h2>
          <Units
            list={unplacedUnits.map((u) => u.filter((id) => !people[id]?.groupId))}
            people={people}
            minAge={minAge}
          />
        </div>
      )}

      {/* The outfitter needs names, and nothing else -- except who still owes
          a waiver: "(W)" after the name until the confirmation is ACCEPTED
          (missing, rejected or not yet checked; Lawrence, 26 Oct 2026), so the
          outfitter can sort the paperwork on the day. */}
      {groups.length > 0 && (
        <div className="break-before-page">
          <h2 className="mb-1 border-b-2 border-neutral-800 pb-1 text-lg font-bold">
            Outfitter list — {activity.name}
            {event ? `, ${event.name}` : ''}
          </h2>
          {groups.some((g) => blocksFor(g).flat().some((id) => people[id]?.waiver && people[id].waiver !== 'on_file')) && (
            <p className="mt-1 text-sm">(W) = waiver still needed</p>
          )}
          <div className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2 print:grid-cols-2">
            {groups.map((g) => (
              <div key={g.id} className="break-inside-avoid">
                <p className="font-bold">{g.name}</p>
                <ol className="list-decimal pl-6 text-sm">
                  {blocksFor(g)
                    .flat()
                    .map((id) => (
                      <li key={id}>
                        {people[id]?.name}
                        {people[id]?.waiver && people[id].waiver !== 'on_file' ? ' (W)' : ''}
                      </li>
                    ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
