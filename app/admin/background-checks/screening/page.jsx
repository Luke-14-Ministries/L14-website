import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import BackLink from '@/components/BackLink';
import ScreeningBoard from './ScreeningBoard';
import { loadScreeningCandidates } from '@/lib/screeningCandidates';
import { volunteerBadge, volunteerBadgeMode } from '@/lib/volunteerBadge';
import { VolunteerBadgeError, VB_DASHBOARD, loadRoster, namesAgree, possibleNameMatches } from '@/lib/volunteerBadgeApi';
import { creditPicture } from '@/lib/volunteerBadgeCredits';

export const metadata = { title: 'Background Screening — Staff Admin' };
// A batch is sent one person at a time from the browser; Refresh asks
// VolunteerBadge about up to 20 invites in one press.
export const maxDuration = 60;

// Who is due a background check, and the VolunteerBadge invites that get them
// one (0165, 13 Nov 2026; it replaced Checkr's batch file). Who counts as due
// is lib/screeningCandidates.js, shared with the send action.
export default async function ScreeningPage() {
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/background-checks/screening/');
  if (!can(staff, 'write:background_checks')) redirect('/admin');
  // Ordering a check is at least as sensitive as reading the result (0058).
  if (!can(staff, 'background_checks')) redirect('/admin/volunteers');

  const supabase = await createClient();
  const mode = volunteerBadgeMode();
  const sandbox = mode === 'test';

  const { noEvents, candidates } = await loadScreeningCandidates(supabase, { sandbox });

  // Invites and results: open ones, results waiting on staff, and the last 90
  // days of everything else, in this mode only.
  const now = new Date();
  const since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: requests, error: requestsError } = await supabase
    .from('volunteerbadge_requests')
    .select(
      'id, person_id, invited_email, status, vb_check_status, vb_result, apply_expires_at, completed_at, problem, sent_at, last_checked_at, confirmed_at, id_verification_waived, people ( first_name, last_name )'
    )
    .eq('sandbox', sandbox)
    .or(`sent_at.gte."${since}",status.in.(sending,invited,applied,processing,in_review,clear,consider)`)
    .order('sent_at', { ascending: false });
  if (requestsError) throw new Error(`VolunteerBadge requests: ${requestsError.message}`);
  // "Resend without the ID step" sits on the person's latest invite.
  const resendOn = new Set(candidates.filter((c) => c.resendable && c.lastVb).map((c) => c.lastVb.id));
  const rows = (requests ?? [])
    // A confirmed clear stays on the list for 90 days, then drops off.
    .filter((r) => !(r.confirmed_at && r.sent_at < since))
    .map((r) => ({
      id: r.id,
      personId: r.person_id,
      name: `${r.people?.first_name ?? ''} ${r.people?.last_name ?? ''}`.trim() || 'Unnamed',
      email: r.invited_email,
      status: r.status,
      vbStatus: r.vb_check_status,
      expiresAt: r.apply_expires_at,
      completedAt: r.completed_at,
      problem: r.problem,
      sentAt: r.sent_at,
      // A send with no answer for two minutes is stuck, not still going.
      stuck: r.status === 'sending' && now.getTime() - new Date(r.sent_at).getTime() > 2 * 60 * 1000,
      lastCheckedAt: r.last_checked_at,
      confirmedAt: r.confirmed_at,
      idWaived: r.id_verification_waived === true,
      resendable: resendOn.has(r.id),
    }));

  // The balance and the invites already out, asked each time the page opens
  // (the send actions ask again; this is for the button). A failure is said.
  let credits = null;
  let outstanding = 0;
  let connectionProblem = null;
  if (mode !== 'off') {
    try {
      ({ credits, outstanding } = await creditPicture(supabase, volunteerBadge()));
    } catch (err) {
      connectionProblem = err instanceof VolunteerBadgeError ? err.message : err?.message ?? 'VolunteerBadge couldn’t be reached.';
    }
  }

  // Someone due who is ALREADY on VolunteerBadge's roster (live only): put in
  // or screened there by hand, before or outside this screen (Lawrence and
  // Ellen, 13 Nov 2026). The site never pulls in a check it didn't ask for, so
  // the row says so: look there first, and if a check already ran, record it
  // by hand rather than spending a second credit. A note, not a block.
  if (mode === 'live' && !connectionProblem && candidates.length > 0) {
    try {
      const roster = await loadRoster(volunteerBadge());
      const { data: names, error: namesError } = await supabase
        .from('people')
        .select('id, first_name, preferred_name, last_name')
        .in('id', candidates.map((c) => c.personId));
      if (namesError) throw new Error(namesError.message);
      const nameBy = new Map((names ?? []).map((p) => [p.id, p]));
      for (const c of candidates) {
        const there = c.email ? roster.find(c.email) : [];
        if (there.length === 1 && namesAgree(there[0], nameBy.get(c.personId)) === true) {
          c.alreadyInVb = there[0].created_at ?? there[0].createdAt ?? true;
          continue;
        }
        // Not at this address, but someone with their name is (Lawrence,
        // 13 Nov 2026): a hint to look before sending, never a link.
        const named = possibleNameMatches(
          roster.rows.filter((v) => !c.email || String(v.email ?? '').trim().toLowerCase() !== c.email),
          nameBy.get(c.personId)
        );
        if (named.length > 0) c.possibleVbMatch = named[0].created_at ?? named[0].createdAt ?? true;
      }
    } catch {
      // The note is a courtesy; without it the page still works.
    }
  }

  return (
    <div className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
        <h1 className="text-xl font-bold">Background Screening</h1>
        <BackLink href="/admin/background-checks" label="Back to Background Checks" />
      </div>
      <p className="text-sm text-neutral-500 mb-6 max-w-4xl">
        VolunteerBadge emails each person an invite. They sign the consent and type their own
        details, including their Social Security number, on VolunteerBadge&rsquo;s site. We never
        see or keep it, or the report: only the result word comes back here.
      </p>
      {noEvents ? (
        <p className="text-neutral-600">No upcoming events, so nobody is due a background check for one.</p>
      ) : null}
      <ScreeningBoard
        candidates={candidates}
        requests={rows}
        mode={mode}
        credits={credits}
        outstanding={outstanding}
        connectionProblem={connectionProblem}
        dashboardUrl={VB_DASHBOARD}
      />
    </div>
  );
}
