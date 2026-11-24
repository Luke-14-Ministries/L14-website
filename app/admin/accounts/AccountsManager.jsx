'use client';

// The accounts table: sort by clicking a column, filter with the search box or
// the quick-filter chips, select rows for a batch removal, and use the row
// menu for the one-account actions. All the interactivity lives here; every
// consequence goes through a server action that re-checks admin.
//
// Layout notes, learned the hard way on Event Payments and repeated here:
// - The wrapper is overflow-x-auto lg:overflow-visible. Small screens scroll
//   sideways; on desktop the table must FIT, because overflow-visible is what
//   lets the row menu float over the table edge instead of being clipped
//   inside the scroll box (where it also distorts the box's dimensions).
// - Width is won by merging columns, not shrinking text: name + email share
//   one cell, and timestamps show the date with the exact time in the hover
//   tooltip.
// - The row menu is a native <details> element, exactly like Event Payments:
//   the browser owns open/close, so there is no script between the click and
//   the menu appearing. And every action is ALWAYS listed -- the ones that
//   don't apply to a row are disabled with the reason written beside them,
//   because a menu that silently hides items reads as broken.
// - Since 23 Nov 2026 (security review) Reset two-factor, Remove account and
//   Delete family each open the step-up box (components/StepUpModal.jsx),
//   which asks for the administrator's own code; none acts on one click.

import Pill from '@/components/Pill';
import StatusMark from '@/components/StatusMark';
import SortMark from '@/components/SortMark';
import FilterChips from '@/components/FilterChips';
import { useEffect, useMemo, useState, useTransition } from 'react';
import SearchSelect from '@/components/SearchSelect';
import ResizableTable from '@/components/ResizableTable';
import StepUpModal, { Dialog } from '@/components/StepUpModal';
import Turnstile, { turnstileEnabled } from '@/components/Turnstile';
import {
  removeLogins,
  purgeHousehold,
  resetMfa,
  resendVerification,
  linkLoginToHousehold,
  mergeHouseholds,
  takeOutOfHousehold,
} from './actions';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'new7', label: 'New this week' },
  { key: 'unconfirmed', label: 'Unconfirmed email' },
  { key: 'no2fa', label: 'No two-factor' },
  { key: 'staff', label: 'Staff' },
  { key: 'never', label: 'Never signed in' },
];

const dateFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
const fullFmt = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');
// Whole years old today, or null when the birth date is unknown.
const ageOf = (dob) => {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const t = new Date();
  let age = t.getFullYear() - y;
  if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) age -= 1;
  return age;
};
const fmtFull = (iso) => (iso ? fullFmt.format(new Date(iso)) : '');
// A day in ministry time, "Nov 23, 2026", for the joined and invite lines.
const dayFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' });
const fmtDay = (iso) => (iso ? dayFmt.format(new Date(iso)) : '');

// The role column's one meaning is administrator (CLAUDE.md); registrar and
// coordinator are labels, shown as they are.
const roleWord = (r) => (r === 'admin' ? 'administrator' : r);

// A merge's "moved" counts in plain words (0180 returns table names).
const MOVED_WORDS = {
  household_members: ['account', 'accounts'],
  people: ['person', 'people'],
  registrations: ['registration', 'registrations'],
  agreement_signatures: ['signed agreement', 'signed agreements'],
  coupons: ['coupon', 'coupons'],
  message_log: ['email record', 'email records'],
  family_change_log: ['Changes to Review line', 'Changes to Review lines'],
  data_deletion_requests: ['deletion request', 'deletion requests'],
  reminder_sends: ['reminder record', 'reminder records'],
  household_invites: ['invite', 'invites'],
  household_email_change_requests: ['contact-email request', 'contact-email requests'],
};
function movedWords(moved) {
  return Object.entries(moved ?? {})
    .map(([table, n]) => {
      const key = table.replace(/^public\./, '');
      const plain = key.replace(/_/g, ' ');
      const [one, many] = MOVED_WORDS[key] ?? [plain, plain];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(', ');
}

// How this account came to be in its household, from staff_household_logins().
function joinedLine(login) {
  if (!login) return null;
  if (login.role === 'owner') return 'Set up this household';
  if (login.invite_accepted_at) {
    return `Joined by invite from ${login.invited_by_name ?? 'someone no longer on the household'}, ${fmtDay(login.invite_accepted_at)}`;
  }
  return `Added ${fmtDay(login.joined_at)}`;
}

// A sortable column heading. Module level, with the sort state passed in:
// defined inside AccountsManager it was a new component type on every render
// (react-hooks/static-components).
function Th({ k, children, right, sort, onSort }) {
  return (
    <th
      onClick={() => onSort(k)}
      className={`px-3 py-2 font-semibold cursor-pointer select-none whitespace-nowrap hover:text-brand ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
      <span className="ml-1">
        <SortMark dir={sort.key === k ? sort.dir : null} />
      </span>
    </th>
  );
}

// `newSince` is an ISO timestamp decided on the SERVER (app/admin/accounts/
// page.jsx, seven days ago via sinceISO) and passed down, so this component
// never reads the clock while rendering -- which react-hooks/purity forbids,
// and rightly: a table that filters on a value that moves between renders is
// a table whose rows can change with no click.
export default function AccountsManager({
  accounts,
  households = [],
  unclaimedPeople = [],
  // { loginId: personId } -- the login's own person record, for the link.
  personIdByUser = {},
  // { householdId: [login] } and { householdId: [open invite] } (0180).
  loginsByHousehold = {},
  invitesByHousehold = {},
  selfId,
  loadError,
  newSince = null,
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });
  const [selected, setSelected] = useState(() => new Set());
  // { kind: 'remove', rows } | { kind, row, ... } for reset, resend, link,
  // merge, takeout and purge.
  const [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState(null); // { ok, message }
  const [busy, startTransition] = useTransition();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const newSinceMs = newSince ? new Date(newSince).getTime() : 0;
    let out = accounts.filter((a) => {
      if (q) {
        const hay = `${a.email ?? ''} ${a.first_name ?? ''} ${a.last_name ?? ''} ${
          a.household_name ?? ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      switch (filter) {
        case 'new7':
          // Mirrors the nav badge: created in the last 7 days.
          return Boolean(a.created_at) && new Date(a.created_at).getTime() >= newSinceMs;
        case 'unconfirmed':
          return !a.email_confirmed_at;
        case 'no2fa':
          return (a.mfa_factor_count ?? 0) === 0;
        case 'staff':
          return Boolean(a.staff_role) && a.staff_active !== false;
        case 'never':
          return !a.last_sign_in_at;
        default:
          return true;
      }
    });

    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      let va = a[key];
      let vb = b[key];
      if (key === 'name') {
        // Sort the merged Account column by name, falling back to email for
        // rows that never filled in a profile.
        va = (`${a.last_name ?? ''} ${a.first_name ?? ''}`.trim() || a.email || '').toLowerCase();
        vb = (`${b.last_name ?? ''} ${b.first_name ?? ''}`.trim() || b.email || '').toLowerCase();
      }
      if (key === 'mfa_factor_count') {
        va = a.mfa_factor_count ?? 0;
        vb = b.mfa_factor_count ?? 0;
      }
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulls (never signed in) sink regardless of direction
      if (vb == null) return -1;
      if (va < vb) return -1 * mul;
      if (va > vb) return 1 * mul;
      return 0;
    });
    return out;
  }, [accounts, query, filter, sort, newSince]);

  function toggleSort(key) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }

  function toggleRow(id) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((s) => {
      const visible = rows.filter((r) => r.user_id !== selfId).map((r) => r.user_id);
      const allIn = visible.every((id) => s.has(id));
      const next = new Set(s);
      visible.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  // The household pickers' options: the town as the hint, so "LaPlue" lists
  // both families with where each lives, and typing a town finds them too.
  const householdOptions = households.map((h) => ({
    value: h.id,
    label: h.display_name ?? 'Household',
    hint: h.city ?? '',
  }));

  // Close everything once an action lands. The row menus are native
  // <details> elements, so any open one is closed the native way.
  function finish(next) {
    setConfirm(null);
    setSelected(new Set());
    document
      .querySelectorAll('details[data-row-menu][open]')
      .forEach((d) => d.removeAttribute('open'));
    setNotice(next);
  }

  // For the boxes without a code step: the result shows above the table.
  function run(fn, doneMessage) {
    startTransition(async () => {
      const result = await fn();
      finish(
        result.ok
          ? { ok: true, message: doneMessage(result) }
          : { ok: false, message: result.error }
      );
    });
  }

  // The step-up boxes keep an error inside the box; only success reaches
  // finish().
  const closeConfirm = () => setConfirm(null);

  // A box opened from a row menu closes that menu, so it does not hang open
  // beside the box and after it (23 Nov 2026).
  const boxKey = confirm ? `${confirm.kind}:${confirm.row?.user_id ?? confirm.rows?.length ?? ''}` : '';
  useEffect(() => {
    if (!boxKey) return;
    document
      .querySelectorAll('details[data-row-menu][open]')
      .forEach((d) => d.removeAttribute('open'));
  }, [boxKey]);

  return (
    <div>
      {loadError && (
        <p className="mb-4 rounded-sm border border-red-300 bg-red-50 text-red-800 px-4 py-3">
          The account list could not be loaded. Refresh the page. If it keeps
          happening, check the server logs for admin_list_accounts.
        </p>
      )}

      {/* Search + quick filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, or household…"
          className="field w-72 max-w-full"
        />
        <FilterChips
          label="Show accounts"
          current={filter}
          items={FILTERS.map((f) => ({ key: f.key, label: f.label, onClick: () => setFilter(f.key) }))}
        />
        <span className="ml-auto text-sm text-neutral-500">
          {rows.length} of {accounts.length}
        </span>
      </div>

      {/* Batch bar appears only when something is selected */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 rounded-sm border border-amber-300 bg-amber-50 px-4 py-2.5">
          <span className="text-sm font-semibold text-amber-900">
            {selected.size} selected
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setConfirm({
                kind: 'remove',
                rows: rows.filter((r) => selected.has(r.user_id)),
              })
            }
            className="btn-outline btn-sm"
          >
            Remove accounts…
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-neutral-600 underline"
          >
            Clear
          </button>
        </div>
      )}

      {notice && (
        <p
          className={`mb-4 rounded-sm border px-4 py-3 ${
            notice.ok
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {notice.message}
        </p>
      )}

      <div className="overflow-x-auto lg:overflow-visible rounded-lg border border-neutral-200">
        <ResizableTable storageKey="accounts">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500">
            <tr className="border-b border-neutral-200">
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Select all visible"
                  // Unticked when no row can be picked (only your own shows):
                  // an empty "every" read as all selected (23 Nov 2026).
                  checked={
                    rows.some((r) => r.user_id !== selfId) &&
                    rows.filter((r) => r.user_id !== selfId).every((r) => selected.has(r.user_id))
                  }
                  onChange={toggleAllVisible}
                />
              </th>
              <Th k="name" sort={sort} onSort={toggleSort}>
                Account
              </Th>
              <Th k="created_at" sort={sort} onSort={toggleSort}>
                Created
              </Th>
              <Th k="last_sign_in_at" sort={sort} onSort={toggleSort}>
                Last sign-in
              </Th>
              <Th k="mfa_factor_count" sort={sort} onSort={toggleSort}>
                Two-factor
              </Th>
              <th className="px-3 py-2 text-left font-semibold">Household</th>
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const isSelf = a.user_id === selfId;
              const name = [a.first_name, a.last_name].filter(Boolean).join(' ');
              const householdLogins = a.household_id ? loginsByHousehold[a.household_id] ?? [] : [];
              const myLogin = householdLogins.find((l) => l.profile_id === a.user_id) ?? null;
              const others = householdLogins.filter((l) => l.profile_id !== a.user_id);
              const openInvites = a.household_id ? invitesByHousehold[a.household_id] ?? [] : [];
              return (
                <tr key={a.user_id} className="border-b border-neutral-100 hover:bg-neutral-50 align-top">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${a.email}`}
                      disabled={isSelf}
                      checked={selected.has(a.user_id)}
                      onChange={() => toggleRow(a.user_id)}
                    />
                  </td>
                  {/* Name and email share the cell: name (bold) with badges,
                      email in smaller type below. Halves the table width. */}
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-neutral-900">
                      {/* The name opens the person's page when the login is
                          linked to a person (4 Nov 2026). */}
                      {name && personIdByUser[a.user_id] ? (
                        <a href={`/admin/people/${personIdByUser[a.user_id]}/`} className="text-brand-dark hover:underline">
                          {name}
                        </a>
                      ) : (
                        name || <span className="text-neutral-400">No name</span>
                      )}
                      {isSelf && (
                        <Pill className="ml-1.5 align-middle">you</Pill>
                      )}
                      {a.staff_role && a.staff_active !== false && (
                        <Pill tone="info" className="ml-1.5 align-middle">
                          {roleWord(a.staff_role)}
                        </Pill>
                      )}
                      {!a.email_confirmed_at && (
                        <Pill tone="todo" title="Never confirmed their email address" className="ml-1.5 align-middle">
                          unconfirmed
                        </Pill>
                      )}
                    </div>
                    <div className="text-neutral-500 break-all">{a.email}</div>
                  </td>
                  <td className="px-3 py-2.5 text-neutral-600" title={fmtFull(a.created_at)}>
                    {fmtDate(a.created_at)}
                  </td>
                  <td className="px-3 py-2.5 text-neutral-600" title={fmtFull(a.last_sign_in_at)}>
                    {fmtDate(a.last_sign_in_at)}
                  </td>
                  <td className="px-3 py-2.5">
                    {/* The shared mark (23 Nov 2026, design scheme). */}
                    {(a.mfa_factor_count ?? 0) > 0 ? (
                      <StatusMark state="yes" label="On" title="Two-factor is set up" />
                    ) : (
                      <StatusMark state="na" label="Off" title="No two-factor set up" />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-neutral-600">
                    {a.household_name ?? '—'}
                    {(a.household_count ?? 0) > 1 && (
                      <span className="text-xs text-neutral-400"> (+{a.household_count - 1})</span>
                    )}
                    {/* Who signs in and how they joined (0180, 23 Nov 2026):
                        a family can now invite another adult itself. */}
                    {myLogin && <div className="text-xs text-neutral-500">{joinedLine(myLogin)}</div>}
                    {others.length > 0 && (
                      <div className="text-xs text-neutral-500">
                        Also signs in: {others.map((l) => l.name || l.email).join(', ')}
                      </div>
                    )}
                    {openInvites.map((i) => (
                      <div key={i.id} className="text-xs text-amber-800">
                        Invite waiting: {i.email}, sent {fmtDay(i.created_at)}
                        {i.invited_by_name ? ` by ${i.invited_by_name}` : ''}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {/* Same native <details> anchored-overlay as Event
                        Payments -- the browser handles open/close, so there
                        is nothing to go wrong in script. */}
                    <details data-row-menu className="relative inline-block text-left">
                      <summary
                        className="cursor-pointer select-none list-none rounded-sm border border-neutral-300 px-2 py-0.5 font-bold text-neutral-600 hover:border-brand [&::-webkit-details-marker]:hidden"
                        title={`Actions for ${a.email}`}
                      >
                        ⋯
                      </summary>
                      <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-neutral-200 bg-white py-1 text-left shadow-lg">
                        <MenuItem
                          disabled={Boolean(a.email_confirmed_at)}
                          reason={a.email_confirmed_at ? 'email already confirmed' : null}
                          onClick={() => setConfirm({ kind: 'resend', row: a, token: null, error: '' })}
                        >
                          Re-send confirmation email…
                        </MenuItem>
                        <MenuItem
                          disabled={(a.mfa_factor_count ?? 0) === 0}
                          reason={(a.mfa_factor_count ?? 0) === 0 ? 'no two-factor set up' : null}
                          onClick={() => setConfirm({ kind: 'reset', row: a })}
                        >
                          Reset two-factor…
                        </MenuItem>
                        <MenuItem
                          disabled={(a.household_count ?? 0) > 0}
                          reason={(a.household_count ?? 0) > 0 ? 'already in a household' : null}
                          onClick={() =>
                            setConfirm({ kind: 'link', row: a, householdId: '', personId: '' })
                          }
                        >
                          Link to household…
                        </MenuItem>
                        <MenuItem
                          disabled={!a.household_id}
                          reason={!a.household_id ? 'no household attached' : null}
                          onClick={() => setConfirm({ kind: 'merge', row: a, keepId: '' })}
                        >
                          Merge household into…
                        </MenuItem>
                        <MenuItem
                          disabled={isSelf || !myLogin || myLogin.role === 'owner'}
                          reason={
                            isSelf
                              ? 'your own account'
                              : !myLogin
                                ? 'no household attached'
                                : myLogin.role === 'owner'
                                  ? 'they set up this household'
                                  : null
                          }
                          onClick={() => setConfirm({ kind: 'takeout', row: a })}
                        >
                          Take out of household…
                        </MenuItem>
                        <MenuItem
                          disabled={isSelf}
                          reason={isSelf ? 'your own account' : null}
                          onClick={() => setConfirm({ kind: 'remove', rows: [a] })}
                        >
                          Remove account…
                        </MenuItem>
                        <MenuItem
                          danger
                          disabled={isSelf || !a.household_id}
                          reason={
                            isSelf
                              ? 'your own account'
                              : !a.household_id
                                ? 'no household attached'
                                : null
                          }
                          onClick={() => setConfirm({ kind: 'purge', row: a, typed: '' })}
                        >
                          Delete family &amp; all their data…
                        </MenuItem>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-neutral-500">
                  No accounts match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </ResizableTable>
      </div>

      {/* Remove account (rewritten 23 Nov 2026): the step-up box, a pointer
          to Deletion Requests for a family that asked to be forgotten, and a
          warning when the account is staff. */}
      {confirm?.kind === 'remove' && (
        <StepUpModal
          title={confirm.rows.length === 1 ? 'Remove this account?' : `Remove ${confirm.rows.length} accounts?`}
          account={confirm.rows.length === 1 ? confirm.rows[0].email : null}
          confirmLabel="Remove"
          busyLabel="Removing…"
          remind={false}
          onClose={closeConfirm}
          onConfirm={() => removeLogins(confirm.rows.map((r) => r.user_id))}
          onDone={(r) =>
            finish({ ok: true, message: `Removed ${r.removed} ${r.removed === 1 ? 'account' : 'accounts'}.` })
          }
        >
          <p className="text-sm text-neutral-700 mb-3">
            This deletes the sign-in only. The family&rsquo;s registrations, payments and records
            stay, but nobody can sign in to them until someone is linked to the household again.
            A new account does <strong>not</strong> reconnect to the old records on its own.
          </p>
          <p className="text-sm text-neutral-700 mb-3">
            If a family asked for their data to be deleted, use{' '}
            <a href="/admin/deletion-requests/" className="font-semibold text-brand-dark underline">
              Deletion Requests
            </a>{' '}
            instead.
          </p>
          {confirm.rows.some((r) => r.staff_role) && (
            <p className="text-sm rounded-sm border border-red-300 bg-red-50 text-red-800 px-3 py-2 mb-3">
              {confirm.rows.length === 1
                ? `${confirm.rows[0].email} is staff (${roleWord(confirm.rows[0].staff_role)}). Removing the account also takes them off Staff & Access.`
                : 'At least one of these accounts is staff. Removing it also takes them off Staff & Access.'}
            </p>
          )}
          {confirm.rows.length > 1 && (
            <ul className="text-sm text-neutral-600 mb-3 max-h-32 overflow-y-auto list-disc pl-5">
              {confirm.rows.map((r) => (
                <li key={r.user_id}>{r.email}</li>
              ))}
            </ul>
          )}
        </StepUpModal>
      )}

      {/* Reset two-factor: the step-up box names the account and asks for
          the administrator's own code (23 Nov 2026). */}
      {confirm?.kind === 'reset' && (
        <StepUpModal
          title="Reset this account's two-factor?"
          account={confirm.row.email}
          confirmLabel="Reset two-factor"
          busyLabel="Resetting…"
          onClose={closeConfirm}
          onConfirm={() => resetMfa(confirm.row.user_id)}
          onDone={(r) =>
            finish({
              ok: true,
              message: `Two-factor reset for ${confirm.row.email}. Removed ${r.removed} ${
                r.removed === 1 ? 'device' : 'devices'
              }. They sign in with their password and set it up again.`,
            })
          }
        >
          <p className="text-sm text-neutral-700 mb-3">
            They sign in with their password and set up two-factor again. Their password does not
            change. Anyone who knows that password could set it up in their place, so do this only
            for the person themselves.
          </p>
        </StepUpModal>
      )}

      {/* Re-send the confirmation email: Supabase wants a bot-check token on
          every auth email, so the widget comes first (23 Nov 2026). */}
      {confirm?.kind === 'resend' && (
        <Dialog title="Re-send the confirmation email" onClose={closeConfirm} busy={busy}>
          <p className="text-sm text-neutral-700 mb-3">
            Sends the sign-up confirmation email again to{' '}
            <strong className="wrap-break-word">{confirm.row.email}</strong>.
          </p>
          {turnstileEnabled ? (
            <Turnstile
              action="resend_confirmation"
              className="mb-3"
              onToken={(token) => setConfirm((c) => (c?.kind === 'resend' ? { ...c, token } : c))}
            />
          ) : (
            <p className="text-xs text-neutral-500 mb-3">The bot check is not set up on this copy of the site.</p>
          )}
          {confirm.error && (
            <p role="alert" className="text-sm rounded-sm border border-red-300 bg-red-50 text-red-800 px-3 py-2 mb-3">
              {confirm.error}
            </p>
          )}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={closeConfirm} className="btn-outline btn-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || (turnstileEnabled && !confirm.token)}
              onClick={() =>
                startTransition(async () => {
                  const res = await resendVerification(confirm.row.email, confirm.token);
                  if (res.ok) finish({ ok: true, message: `Confirmation email re-sent to ${confirm.row.email}.` });
                  else setConfirm((c) => (c ? { ...c, error: res.error } : c));
                })
              }
              className="btn-primary btn-sm disabled:opacity-40"
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </Dialog>
      )}

      {/* Take out of household (0178's remove_household_login): the account
          stays, the family's records stay, only the sign-in to this family
          goes. Never the person who set the household up. */}
      {confirm?.kind === 'takeout' && (
        <Dialog
          title={`Take this account out of ${confirm.row.household_name ?? 'the household'}?`}
          onClose={closeConfirm}
          busy={busy}
        >
          <p className="text-sm text-neutral-700 mb-3">
            <strong className="wrap-break-word">{confirm.row.email}</strong> keeps their account
            but can no longer see this family&rsquo;s registrations or records. The family&rsquo;s
            people and registrations stay as they are.
          </p>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={closeConfirm} className="btn-outline btn-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  () => takeOutOfHousehold(confirm.row.household_id, confirm.row.user_id),
                  () => `Took ${confirm.row.email} out of ${confirm.row.household_name ?? 'the household'}.`
                )
              }
              className="btn-primary btn-sm"
            >
              {busy ? 'Taking out…' : 'Take out'}
            </button>
          </div>
        </Dialog>
      )}

      {/* Link-to-household: the reverse of remove, for reconnecting a family
          AFTER staff have verified who they are on the phone or in person.
          Deliberately manual -- automatic relinking by email address would
          hand the household's records to whoever controls that mailbox
          later, which is not necessarily the same person. */}
      {confirm?.kind === 'link' && (
        <Dialog title="Link this account to a household" onClose={closeConfirm} busy={busy}>
          <p className="text-sm text-neutral-700 mb-3">
            Connects <strong className="wrap-break-word">{confirm.row.email}</strong> to
            an existing family, giving it access to that household&rsquo;s
            registrations, payments and records. Do this only after
            you&rsquo;ve confirmed who you&rsquo;re talking to by phone or in
            person, not by email alone.
          </p>
          {/* Searchable (Lawrence, 4 Nov 2026): the list grows with every family. */}
          <div className="mb-4">
            <SearchSelect
              label="Household"
              options={householdOptions}
              value={confirm.householdId}
              onChange={(v) => setConfirm({ ...confirm, householdId: v ?? '', personId: '' })}
              placeholder="Family name or town…"
              printPrefix={false}
              noun={['household', 'households']}
            />
          </div>
          {confirm.householdId &&
            (() => {
              // Adults in the chosen household that no login has claimed.
              // Children never appear -- a login always belongs to an adult.
              // Unknown birth dates stay in the list (they may well be the
              // parent) marked "age unknown".
              const candidates = unclaimedPeople
                .filter((pp) => pp.household_id === confirm.householdId)
                .map((pp) => ({ ...pp, age: ageOf(pp.date_of_birth) }))
                .filter((pp) => pp.age === null || pp.age >= 18);
              if (candidates.length === 0) return null;
              return (
                <>
                  <label
                    className="block text-sm font-semibold mb-1.5"
                    htmlFor="link-person"
                  >
                    Which family member is this?{' '}
                    <span className="font-normal text-neutral-500">(optional)</span>
                  </label>
                  <select
                    id="link-person"
                    value={confirm.personId ?? ''}
                    onChange={(e) => setConfirm({ ...confirm, personId: e.target.value })}
                    className="field mb-1"
                  >
                    <option value="">Don&rsquo;t mark anyone, only link the household</option>
                    {candidates.map((pp) => (
                      <option key={pp.id} value={pp.id}>
                        {pp.first_name} {pp.last_name}
                        {pp.age === null ? ' (age unknown)' : ` (${pp.age})`}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-neutral-500 mb-4">
                    This tells the site which family member uses this account.
                    Adults only. If you&rsquo;re not sure, skip it. You can set
                    it later.
                  </p>
                </>
              );
            })()}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={closeConfirm} className="btn-outline btn-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !confirm.householdId}
              onClick={() =>
                run(
                  () =>
                    linkLoginToHousehold(
                      confirm.row.user_id,
                      confirm.householdId,
                      confirm.personId || null
                    ),
                  (r) =>
                    `Linked ${confirm.row.email} to the household as ${
                      r.role === 'owner' ? 'the person who set it up' : 'another adult who signs in'
                    }${confirm.personId ? ', and marked which family member they are' : ''}.`
                )
              }
              className="btn-primary btn-sm"
            >
              {busy ? 'Linking…' : 'Link account'}
            </button>
          </div>
        </Dialog>
      )}

      {/* Merge households (0151, 0180): for one family that ended up with two
          households -- a married couple who each signed up, say. Everything
          moves into the household chosen here and this one is deleted. The
          database refuses when both are registered for the same event. No
          close on an outside click: a half-made choice should not vanish. */}
      {confirm?.kind === 'merge' && (
        <Dialog
          title={`Merge ${confirm.row.household_name ?? 'this household'} into another`}
          onClose={closeConfirm}
          closeOnOutside={false}
          busy={busy}
        >
          <p className="text-sm text-neutral-700 mb-3">
            Its people, accounts, registrations, payments and records move into the
            household you choose, and{' '}
            <strong>{confirm.row.household_name ?? 'this household'}</strong> is then
            deleted. Blank contact details on the kept household are filled from
            this one. Its open invites, and any contact-email change still waiting
            for a click, are cancelled. There is no undo. If both households are
            registered for the same event, cancel one of those registrations first.
          </p>
          <div className="mb-4">
            <SearchSelect
              label="Keep this household"
              options={householdOptions.filter((o) => o.value !== confirm.row.household_id)}
              value={confirm.keepId}
              onChange={(v) => setConfirm({ ...confirm, keepId: v ?? '' })}
              placeholder="Family name or town…"
              printPrefix={false}
              noun={['household', 'households']}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={closeConfirm} className="btn-outline btn-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !confirm.keepId}
              onClick={() =>
                run(
                  () => mergeHouseholds(confirm.keepId, confirm.row.household_id),
                  (r) => {
                    const kept =
                      households.find((h) => h.id === confirm.keepId)?.display_name ??
                      'the chosen household';
                    const moved = movedWords(r.moved);
                    return `Merged ${confirm.row.household_name ?? 'the household'} into ${kept}.${
                      moved ? ` Moved across: ${moved}.` : ''
                    }`;
                  }
                )
              }
              className="btn-primary btn-sm"
            >
              {busy ? 'Merging…' : 'Merge'}
            </button>
          </div>
        </Dialog>
      )}

      {/* Delete family: destructive, so it asks for the family's name and the
          administrator's own code (23 Nov 2026; it used to be the word
          DELETE). The database refuses a family with payments on record. */}
      {confirm?.kind === 'purge' && (
        <StepUpModal
          danger
          title={`Delete ${confirm.row.household_name ?? 'this family'} and all their data?`}
          confirmLabel="Delete everything"
          busyLabel="Deleting…"
          remind={false}
          canConfirm={
            confirm.typed.trim() !== '' &&
            confirm.typed.trim().toLowerCase() === (confirm.row.household_name ?? '').trim().toLowerCase()
          }
          onClose={closeConfirm}
          onConfirm={() => purgeHousehold(confirm.row.household_id)}
          onDone={(r) => {
            const kept = r.loginsKept ?? [];
            finish({
              ok: true,
              message: `Deleted ${confirm.row.household_name ?? 'the household'} and all its data. ${
                r.loginsDeleted === 1 ? '1 account was' : `${r.loginsDeleted} accounts were`
              } deleted.${
                kept.length
                  ? ` Kept, because they are staff, a program leader or in another household: ${kept.join(', ')}. They are only off this household.`
                  : ''
              }`,
            });
          }}
        >
          <p className="text-sm text-neutral-700 mb-3">
            This permanently deletes the household, its people,{' '}
            <strong>
              {confirm.row.registration_count ?? 0} registration
              {(confirm.row.registration_count ?? 0) === 1 ? '' : 's'}
            </strong>{' '}
            and the accounts of everyone in it. There is no undo. Donation records are kept, as
            anonymous entries. An account that is staff, a program leader or in another household
            is kept and only taken off this household.
          </p>
          {(confirm.row.payment_count ?? 0) > 0 && (
            <p className="text-sm rounded-sm border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 mb-3">
              This family has {confirm.row.payment_count} payment record
              {confirm.row.payment_count === 1 ? '' : 's'}. A card or bank payment that went
              through stops the delete: use{' '}
              <a href="/admin/deletion-requests/" className="font-semibold underline">
                Deletion Requests
              </a>{' '}
              for that family.
            </p>
          )}
          <label className="block text-sm font-semibold mb-1.5" htmlFor="purge-name">
            Type the family&rsquo;s name to confirm:{' '}
            <span className="text-red-700">{confirm.row.household_name}</span>
          </label>
          <input
            id="purge-name"
            value={confirm.typed}
            onChange={(e) => setConfirm({ ...confirm, typed: e.target.value })}
            className="field mb-4"
            autoComplete="off"
          />
        </StepUpModal>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger = false, disabled = false, reason = null }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`block w-full text-left px-3 py-1.5 text-sm ${
        disabled
          ? 'text-neutral-400 cursor-default'
          : danger
            ? 'text-red-700 hover:bg-neutral-50'
            : 'text-neutral-800 hover:bg-neutral-50'
      }`}
    >
      {children}
      {disabled && reason && (
        <span className="block text-xs text-neutral-400">{reason}</span>
      )}
    </button>
  );
}
