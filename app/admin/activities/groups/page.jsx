import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { groupNoun } from '@/lib/activityGroups';
import { loadActivityGroups } from './load';
import GroupsBoard from './GroupsBoard';

export const metadata = { title: 'Activity Groups — Staff Admin' };

// Rafts for white water rafting, boats for the pontoon (0125). Who is going
// is who signed up, plus each signed-up camper's paired buddy, who goes with
// them; staff put them into groups of an adjustable size (default 6) and
// print the lists. Reached from "Rafts →" / "Groups →" under each activity.
//
// Read: Activities read. Placing and changing groups: Activities write.
export default async function ActivityGroupsPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/activities/groups/');
  if (!can(staff, 'read:activities')) redirect('/admin');

  const activityId = typeof params?.activity === 'string' ? params.activity : '';
  if (!activityId) {
    return (
      <div>
        <h2 className="mb-1 text-xl font-bold">Activity groups</h2>
        <p className="text-sm text-neutral-500">
          Choose an activity first: open{' '}
          <Link href="/admin/activities/" className="text-brand underline">
            Activities
          </Link>{' '}
          and press &ldquo;Groups &rarr;&rdquo; under it.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const data = await loadActivityGroups(supabase, activityId);
  if (!data) {
    return (
      <div>
        <h2 className="mb-1 text-xl font-bold">Activity groups</h2>
        <p className="text-sm text-neutral-500">
          That activity was not found.{' '}
          <Link href="/admin/activities/" className="text-brand underline">
            Back to Activities
          </Link>
        </p>
      </div>
    );
  }

  const noun = groupNoun(data.activity.name);

  return (
    <div>
      <p className="mb-1 text-sm">
        <Link
          href={`/admin/activities/${data.event ? `?event=${data.event.id}` : ''}`}
          className="text-brand underline"
        >
          &larr; Activities
        </Link>
      </p>
      <h2 className="mb-1 text-xl font-bold">
        {data.activity.name} &mdash; {noun.many}
      </h2>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Everyone signed up for {data.activity.name}
        {data.event ? ` at ${data.event.name}` : ''}, and each camper&rsquo;s paired buddy, who
        goes wherever their camper goes. Pick someone, then choose their {noun.one}. A camper and
        their buddy move together.
        {data.activity.minAge != null &&
          ` The minimum age is ${data.activity.minAge}: younger people are flagged, not refused — check with camp staff.`}
      </p>

      {!data.activity.active && (
        <p className="mb-4 rounded-sm border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          This activity is turned off. Families cannot see it, and waivers are not tracked for it
          while it is off.
        </p>
      )}

      <GroupsBoard
        activity={data.activity}
        event={data.event}
        people={data.people}
        units={data.units}
        groups={data.groups}
        programs={data.programs}
        noun={noun}
        canPlace={can(staff, 'write:activities')}
        canSeeSupport={can(staff, 'read:sensitive')}
      />
    </div>
  );
}
