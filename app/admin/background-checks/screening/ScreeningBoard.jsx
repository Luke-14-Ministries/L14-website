'use client';

// Background screening through VolunteerBadge (0165, 13 Nov 2026): who is due,
// send the invites, then the invites and their results. Replaced the Checkr
// batch file (download, upload, import).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import StatusMark from '@/components/StatusMark';
import CreditLine from '../CreditLine';
import { dayInMorristown, whenInMorristown } from '@/lib/events';
import {
  prepareVolunteerBadgeBatch,
  sendVolunteerBadgeInvite,
  refreshVolunteerBadge,
  confirmVolunteerBadgeClear,
  cancelVolunteerBadgeRequest,
  resendWithoutIdStep,
} from './actions';

// Each request's status, as a mark and plain words.
const VB_WORDS = {
  sending: ['warn', 'Sending didn’t finish'],
  invited: ['na', 'Invited'],
  applied: ['na', 'Applied, check not started'],
  processing: ['na', 'Check in progress'],
  in_review: ['na', 'VolunteerBadge is reviewing'],
  clear: ['yes', 'Clear'],
  consider: ['warn', 'Needs review in VolunteerBadge'],
  error: ['no', 'Not completed'],
  expired: ['no', 'Invite expired'],
  not_sent: ['no', 'Not sent'],
  cancelled: ['na', 'Taken back'],
  superseded: ['na', 'Replaced by a resend'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function detail(r) {
  switch (r.status) {
    case 'sending':
      return r.problem ?? 'No answer came back from VolunteerBadge. Look in its Applications list: if it isn’t there, take this back and send again.';
    case 'invited':
      return `Emailed to ${r.email} on ${dayInMorristown(r.sentAt)}${r.expiresAt ? `; the link works until ${dayInMorristown(r.expiresAt)}` : ''}. Waiting for them to apply.`;
    case 'applied':
      return 'They applied. The check hasn’t started yet.';
    case 'processing':
      return 'VolunteerBadge is running the check.';
    case 'in_review':
      return 'Possible records found. VolunteerBadge’s reviewer is checking them, usually within 3 business days.';
    case 'clear':
      return r.confirmedAt
        ? `OK to serve recorded ${dayInMorristown(r.confirmedAt)}.`
        : `Clear${r.completedAt ? ` on ${dayInMorristown(r.completedAt)}` : ''}. Record it as OK to serve.`;
    case 'consider':
      return 'Records were released on the report. Read it in VolunteerBadge, then record the ministry’s verdict on their Volunteers entry.';
    case 'error':
    case 'not_sent':
      return `${r.problem ?? 'It didn’t go through.'} They are back on the list to send again.`;
    case 'expired':
      return 'They didn’t apply before the link ran out. They are back on the list to send again.';
    case 'cancelled':
      return 'Taken back here. (It isn’t cancelled in VolunteerBadge.)';
    case 'superseded':
      return 'Replaced by a resend without the ID step.';
    default:
      return '';
  }
}

export default function ScreeningBoard({ candidates, requests, mode, credits, outstanding = 0, connectionProblem, dashboardUrl }) {
  const router = useRouter();
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [note, setNote] = useState(null);
  // The person whose "Resend without the ID step" form is open, and its reason.
  const [resendFor, setResendFor] = useState(null);
  const [resendWhy, setResendWhy] = useState('');
  // How many more invites the balance covers (live). The server asks VB again
  // on every send; this only shapes the button.
  const free = mode === 'live' && credits != null ? Math.max(0, credits - outstanding) : null;
  const creditsBlock =
    mode !== 'live'
      ? null
      : credits == null
        ? 'VolunteerBadge didn’t say how many credits are left.'
        : picked.size > free
          ? `VolunteerBadge has ${credits} ${credits === 1 ? 'credit' : 'credits'}. Buy credits in VolunteerBadge before sending invites (this ${picked.size === 1 ? 'invite needs 1' : `batch needs ${picked.size}`}${outstanding ? `, and ${outstanding} ${outstanding === 1 ? 'invite is' : 'invites are'} already out and not yet charged` : ''}).`
          : null;

  const connected = mode !== 'off' && !connectionProblem;
  const orderable = useMemo(() => candidates.filter((c) => !c.blockedBecause), [candidates]);
  const blocked = useMemo(() => candidates.filter((c) => c.blockedBecause), [candidates]);
  const allPicked = orderable.length > 0 && picked.size === orderable.length;
  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const add = (line) => setLog((l) => [...l, line]);

  async function sendBatch() {
    const ids = [...picked];
    const n = ids.length;
    const words =
      mode === 'test'
        ? `Send ${n} test ${n === 1 ? 'invite' : 'invites'}? Test mode uses no credits and runs no real check, but VolunteerBadge still emails a test invite.`
        : `Send ${n} VolunteerBadge ${n === 1 ? 'invite' : 'invites'}? Each uses one credit. VolunteerBadge emails each person now.`;
    if (!window.confirm(words)) return;
    setBusy(true);
    setLog([]);
    setNote(null);
    try {
      const prep = await prepareVolunteerBadgeBatch(ids);
      if (!prep.ok) {
        add({ tone: 'no', text: prep.error });
        return;
      }
      for (const r of prep.refused) add({ tone: 'no', text: `${r.name}: not sent, ${r.why}` });
      for (let i = 0; i < prep.ready.length; i += 1) {
        const p = prep.ready[i];
        add({ tone: 'na', text: `${p.name}: sending…`, key: p.personId });
        const r = await sendVolunteerBadgeInvite(p.personId);
        setLog((l) =>
          l.map((x) =>
            x.key === p.personId
              ? r.ok
                ? { tone: 'yes', text: `${p.name}: invite sent${r.email ? ` to ${r.email}` : ''}.${r.warning ? ` ${r.warning}` : ''}` }
                : { tone: 'no', text: `${p.name}: ${r.error}` }
              : x
          )
        );
        if (r.stop) {
          const left = prep.ready.length - i - 1;
          if (left > 0) add({ tone: 'warn', text: `Stopped. ${left} not sent; they are still on the list.` });
          break;
        }
        // VolunteerBadge allows 100 calls a minute, and each send makes two (the
        // balance, then the invite); stay well under.
        if (i < prep.ready.length - 1) await sleep(1500);
      }
      setPicked(new Set());
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function refresh() {
    setBusy(true);
    setNote(null);
    try {
      const r = await refreshVolunteerBadge();
      if (r.checked === undefined) setNote({ tone: 'no', text: r.error });
      else
        setNote({
          tone: r.ok ? 'yes' : 'warn',
          text: `Checked ${r.checked} ${r.checked === 1 ? 'invite' : 'invites'}; ${r.changed} changed.${r.more ? ' There are more: press again.' : ''}${r.error ? ` ${r.error}` : ''}`,
        });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function confirmClear(r) {
    if (!window.confirm(`Record ${r.name}'s VolunteerBadge result (clear${r.completedAt ? `, ${dayInMorristown(r.completedAt)}` : ''}) as OK to serve?`)) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await confirmVolunteerBadgeClear(r.id);
      setNote(res.ok ? { tone: 'yes', text: `${r.name}: OK to serve recorded.` } : { tone: 'no', text: res.error });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function resend(r) {
    const why = resendWhy.replace(/\s+/g, ' ').trim();
    if (why.length < 10) {
      setNote({ tone: 'no', text: 'Give a reason of at least 10 characters.' });
      return;
    }
    const words =
      mode === 'test'
        ? `Send ${r.name} a test invite without the ID step?`
        : `Send ${r.name} a new invite without VolunteerBadge's photo ID step? It replaces their open invite and uses one credit when the check runs.`;
    if (!window.confirm(words)) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await resendWithoutIdStep(r.personId, why);
      setNote(
        res.ok
          ? { tone: 'yes', text: `${r.name}: sent again without the ID step.${res.warning ? ` ${res.warning}` : ''}` }
          : { tone: 'no', text: res.error }
      );
      if (res.ok) {
        setResendFor(null);
        setResendWhy('');
      }
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function takeBack(r) {
    const words =
      r.status === 'sending'
        ? `Take back ${r.name}'s invite? Do this only if it isn't in VolunteerBadge's Applications list. They go back on the list to send again.`
        : `Take back ${r.name}'s invite here? It is NOT cancelled in VolunteerBadge: if they still apply, the check runs and uses a credit.`;
    if (!window.confirm(words)) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await cancelVolunteerBadgeRequest(r.id);
      setNote(res.ok ? { tone: 'yes', text: `${r.name}: taken back.` } : { tone: 'no', text: res.error });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const open = requests.filter((r) => ['sending', 'invited', 'applied', 'processing', 'in_review'].includes(r.status));
  const waitingOnYou = requests.filter((r) => !r.confirmedAt && (r.status === 'clear' || r.status === 'consider'));
  const lastChecked = requests.map((r) => r.lastCheckedAt).filter(Boolean).sort().pop();

  return (
    <div className="space-y-8">
      {/* Connection: off, test, live, or a problem. */}
      {mode === 'off' && (
        <p className="rounded-sm border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <strong>VolunteerBadge isn&rsquo;t connected yet.</strong> Once its key is added to the site,
          invites are sent from here. Who is due is listed below meanwhile.
        </p>
      )}
      {mode === 'test' && (
        <p className="rounded-sm border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900">
          <strong>Test mode</strong> (a VolunteerBadge sandbox key): no credits are used and no real
          checks run, but VolunteerBadge still emails a test invite, so only @luke14ministries.net
          addresses can be sent. Test results never clear anyone, and test invites don&rsquo;t show on
          the live site. VolunteerBadge keeps no applicants in test mode, so a test invite stays
          &ldquo;Invited&rdquo;.
        </p>
      )}
      {mode !== 'off' && connectionProblem && (
        <p className="rounded-sm border border-red-300 bg-red-50 px-4 py-3 text-red-800">{connectionProblem}</p>
      )}
      {mode === 'live' && !connectionProblem && (
        <p className="text-sm text-neutral-600">
          Connected to VolunteerBadge. <CreditLine mode={mode} credits={credits} outstanding={outstanding} />
        </p>
      )}

      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
        <h2 className="text-xl font-bold">1 · Who is due</h2>
        <p className="mt-1 mb-4 max-w-4xl text-sm text-neutral-500">
          Adult volunteers with no background check on file, or one out of date. Nothing here has been
          sent yet.
        </p>

        {orderable.length === 0 && blocked.length === 0 ? (
          <p className="rounded-sm border border-green-200 bg-green-50 px-4 py-3 text-green-900">
            Nobody is due. Every adult volunteer has a current background check on file, or an invite out.
          </p>
        ) : orderable.length === 0 ? (
          <p className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            {blocked.length} {blocked.length === 1 ? 'person is' : 'people are'} due a background check,
            but none can be sent yet. Each one is listed below with the reason.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setPicked(allPicked ? new Set() : new Set(orderable.map((c) => c.personId)))}
                className="btn-outline py-1.5! text-sm"
              >
                {allPicked ? 'Select none' : `Select all ${orderable.length}`}
              </button>
              <span className="text-sm text-neutral-600">{picked.size} selected</span>
            </div>
            <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
              {orderable.map((c) => (
                <li key={c.personId} className="flex flex-wrap items-center gap-3 py-2.5">
                  <input
                    type="checkbox"
                    id={`p-${c.personId}`}
                    checked={picked.has(c.personId)}
                    onChange={() => toggle(c.personId)}
                    className="h-4 w-4"
                  />
                  <label htmlFor={`p-${c.personId}`} className="min-w-0 flex-1">
                    <span className="font-semibold">{c.name}</span>
                    <span className="text-neutral-500">
                      {' '}· {c.email}
                      {c.emailIsHousehold && ' (household address)'}
                    </span>
                    {c.sharesEmailWith?.length > 0 && (
                      <span className="ml-2 rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
                        same email as {c.sharesEmailWith.join(' and ')}: send one at a time
                      </span>
                    )}
                    <span className="block text-xs text-neutral-500">
                      {c.eventName}
                      {c.reason ? ` · ${c.reason}` : ''}
                      {c.checkrOut ? ' · an old Checkr order is still marked as out' : ''}
                      {c.lastVb && ['error', 'expired', 'not_sent', 'cancelled'].includes(c.lastVb.status)
                        ? ` · last invite ${dayInMorristown(c.lastVb.sentAt)}: ${VB_WORDS[c.lastVb.status][1].toLowerCase()}`
                        : ''}
                    </span>
                    {c.alreadyInVb && (
                    <span className="mt-0.5 block text-xs font-semibold text-amber-800">
                      Already in VolunteerBadge
                      {typeof c.alreadyInVb === 'string' ? ` since ${dayInMorristown(c.alreadyInVb)}` : ''}. Look there
                      first: if a check has already run, record it by hand on their Volunteers entry instead of
                      sending (that would use a second credit).
                    </span>
                  )}
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={sendBatch}
              disabled={busy || picked.size === 0 || !connected || Boolean(creditsBlock)}
              className="btn-primary mt-4 disabled:opacity-50"
            >
              {busy
                ? 'Working…'
                : mode === 'test'
                  ? `Send ${picked.size} test ${picked.size === 1 ? 'invite' : 'invites'} (no credits)`
                  : `Send ${picked.size} VolunteerBadge ${picked.size === 1 ? 'invite' : 'invites'} (uses ${picked.size} ${picked.size === 1 ? 'credit' : 'credits'}${free != null ? `, ${free} free` : ''})`}
            </button>
            {creditsBlock && picked.size > 0 && <p className="mt-1.5 text-sm text-red-800">{creditsBlock}</p>}
            {!connected && mode !== 'off' && (
              <p className="mt-1.5 text-xs text-red-700">Sending is off until VolunteerBadge answers.</p>
            )}
          </>
        )}

        {log.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-sm border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm" aria-live="polite">
            {log.map((l, i) => (
              <li key={l.key ?? i}>
                <StatusMark state={l.tone} className="mr-1" /> {l.text}
              </li>
            ))}
          </ul>
        )}

        {blocked.length > 0 && (
          <div className="mt-5 rounded-sm border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="font-semibold text-amber-900">
              {blocked.length} {blocked.length === 1 ? 'person can’t' : 'people can’t'} be sent yet
            </p>
            <ul className="mt-1.5 space-y-1 text-sm text-amber-900">
              {blocked.map((c) => (
                <li key={c.personId}>
                  <strong>{c.name}</strong>
                  {c.reason ? ` (${c.reason === 'never checked' ? 'no check on file' : `check ${c.reason}`})` : ''}:{' '}
                  {c.blockedBecause}
                  {c.alreadyInVb && (
                    <span className="mt-0.5 block text-xs font-semibold text-amber-800">
                      Already in VolunteerBadge
                      {typeof c.alreadyInVb === 'string' ? ` since ${dayInMorristown(c.alreadyInVb)}` : ''}. Look there
                      first: if a check has already run, record it by hand on their Volunteers entry instead of
                      sending (that would use a second credit).
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold">2 · Invites and results</h2>
          <button
            type="button"
            onClick={refresh}
            disabled={busy || !connected || open.length === 0}
            className="btn-outline py-1.5! text-sm disabled:opacity-50"
          >
            Check VolunteerBadge for updates
          </button>
        </div>
        <p className="mt-1 mb-4 max-w-4xl text-sm text-neutral-500">
          {open.length} open
          {waitingOnYou.length > 0 ? ` · ${waitingOnYou.length} waiting on you` : ''}
          {lastChecked ? ` · last checked ${whenInMorristown(lastChecked)}` : ''}. A clear result counts
          only once you press <strong>OK to serve</strong>. A result that needs review is read in{' '}
          <a href={dashboardUrl} target="_blank" rel="noopener noreferrer" className="text-brand underline">
            VolunteerBadge
          </a>{' '}
          and decided on the person&rsquo;s Volunteers entry.
        </p>
        {note && (
          <p className={`mb-3 text-sm ${note.tone === 'no' ? 'text-red-800' : note.tone === 'warn' ? 'text-amber-800' : 'text-green-800'}`}>
            {note.text}
          </p>
        )}
        {requests.length === 0 ? (
          <p className="text-sm text-neutral-500">No invites in the last 90 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Person</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">What it means</th>
                  <th className="px-3 py-2 font-semibold"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const [state, words] = VB_WORDS[r.status] ?? ['na', r.status];
                  return (
                    <tr key={r.id} className="border-t border-neutral-100 align-top">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-semibold">{r.name}</span>
                        <span className="block text-xs text-neutral-500">sent {dayInMorristown(r.sentAt)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusMark
                          state={r.status === 'clear' && r.confirmedAt ? 'yes' : state}
                          label={r.status === 'clear' && r.confirmedAt ? 'OK to serve' : words}
                          title={detail(r)}
                        />
                        {/* So it is plain later that this check ran without ID
                            verification (Lawrence, 13 Nov 2026). */}
                        {r.idWaived && (
                          <span className="mt-1 block w-fit rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
                            ID step waived
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-700">{detail(r)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.status === 'clear' && !r.confirmedAt && mode === 'live' && (
                          <button type="button" disabled={busy} onClick={() => confirmClear(r)} className="btn-primary py-1! px-3! text-xs">
                            OK to serve
                          </button>
                        )}
                        {r.status === 'consider' && (
                          <a href={dashboardUrl} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                            Open VolunteerBadge
                          </a>
                        )}
                        {((r.status === 'sending' && r.stuck) || r.status === 'invited') && (
                          <button type="button" disabled={busy} onClick={() => takeBack(r)} className="block text-xs text-red-700 underline">
                            Take back
                          </button>
                        )}
                        {r.resendable && connected && resendFor !== r.id && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setResendFor(r.id);
                              setResendWhy('');
                            }}
                            className="mt-1 block text-xs text-brand underline"
                          >
                            Resend without ID step
                          </button>
                        )}
                        {r.resendable && resendFor === r.id && (
                          <div className="mt-1 w-64 whitespace-normal rounded-sm border border-neutral-200 bg-neutral-50 p-2">
                            <label htmlFor={`why-${r.id}`} className="block text-xs font-semibold text-neutral-700">
                              Why skip the ID step?
                            </label>
                            <input
                              id={`why-${r.id}`}
                              value={resendWhy}
                              onChange={(e) => setResendWhy(e.target.value)}
                              maxLength={300}
                              placeholder="e.g. Volunteer declined the photo ID step; approved by Larry"
                              className="mt-1 w-full rounded-sm border border-neutral-300 px-2 py-1 text-xs"
                            />
                            <p className="mt-1 text-xs text-neutral-500">
                              Goes to VolunteerBadge with the invite. At least 10 characters, no personal details.
                            </p>
                            <div className="mt-1.5 flex gap-2">
                              <button type="button" disabled={busy} onClick={() => resend(r)} className="btn-primary py-1! px-2! text-xs">
                                Resend
                              </button>
                              <button type="button" onClick={() => setResendFor(null)} className="text-xs text-neutral-600 underline">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
