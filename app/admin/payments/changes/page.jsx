import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import BackLink from '@/components/BackLink';
import { whenInMorristown } from '@/lib/events';
import ResizableTable from '@/components/ResizableTable';

export const metadata = { title: 'Money Changes · Staff Admin' };

// Every write to the money tables, newest first (23 Nov 2026 review).
//
// money_change_log (0111, extended by 0114, 0123 and 0159) has recorded every
// insert, change and removal on payments, refunds, plans, coupons, each
// person's fee and adjustments, added fees and family scholarship requests,
// but nothing showed it: an audit trail nobody can read is
// only a promise. Modelled on Access Changes (/admin/staff/access-log/).
//
// Administrators only, and RLS says so too (money_change_log_read asks
// is_admin()). The redirect here is courtesy; the policy is the boundary.
// Read only: nothing on this page writes.

// How many log rows one page reads. A family search runs over these, so the
// page says so when the window is full.
const READ_LIMIT = 2000;
const SHOW_LIMIT = 300;

const TABLE_LABEL = {
  payments: 'Payment',
  payment_refunds: 'Refund',
  payment_plans: 'Payment plan',
  coupons: 'Coupon',
  coupon_redemptions: 'Coupon used',
  participant_money: 'Fee and adjustments',
  registration_fees: 'Added fee',
  family_scholarship_requests: 'Family scholarship request',
};

const OP_LABEL = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Removed' };

// Columns that identify the row rather than say what changed; left out of the
// summary (they are still in "All fields").
const QUIET = new Set([
  'id',
  'registration_id',
  'participant_id',
  'household_id',
  'payment_id',
  'coupon_id',
  'created_at',
  'updated_at',
  'request_key',
]);

const money = (c) =>
  `$${(Number(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// One value as a person reads it: cents as dollars, nothing as a dash.
function show(key, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (key.endsWith('_cents') && Number.isFinite(Number(v))) return money(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// The changed columns as "field: before → after" lines. An insert or removal
// has only one side, so it reads "field: value".
function summary(r) {
  const before = r.before ?? {};
  const after = r.after ?? {};
  const one = r.op === 'DELETE' ? before : after;
  // An added or removed row lists only the columns with something in them:
  // a new person's fee row is otherwise five lines of "$0.00".
  const empty = (v) => v === null || v === undefined || v === '' || v === 0;
  const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])].filter(
    (k) => !QUIET.has(k) && (r.op === 'UPDATE' || !empty(one[k]))
  );
  return keys.map((k) => {
    const label = k.replace(/_cents$/, '').replace(/_/g, ' ');
    if (r.op === 'UPDATE') return `${label}: ${show(k, before[k])} → ${show(k, after[k])}`;
    return `${label}: ${show(k, one[k])}`;
  });
}

// Who made the change. A null changed_by is a server-side writer: Stripe's
// webhooks and the plan charges (service_role), or the database itself.
function whoWrote(r, names) {
  if (r.changed_by) return names.get(r.changed_by) ?? 'A login since removed';
  if (r.changed_as === 'service_role') return 'Stripe or an automatic job';
  return 'The database (a migration or a rule)';
}

const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function MoneyChangesPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/payments/changes/');
  if (!can(staff, 'admin')) redirect('/admin/payments/');

  const q = typeof params?.q === 'string' ? params.q.trim().slice(0, 100) : '';
  const from = isDay(params?.from) ? params.from : '';
  const to = isDay(params?.to) ? params.to : '';

  const supabase = await createClient();

  // The dates filter in the database, so a narrow range reads far back. The
  // day boundaries are Morristown's: -05:00 is close enough for a filter
  // (an hour either way in summer), and every row shows its exact time.
  let query = supabase
    .from('money_change_log')
    .select('id, table_name, row_id, op, changed_by, changed_as, changed_at, before, after')
    .order('changed_at', { ascending: false })
    .limit(READ_LIMIT);
  if (from) query = query.gte('changed_at', `${from}T00:00:00-05:00`);
  if (to) query = query.lte('changed_at', `${to}T23:59:59.999-05:00`);
  const { data: rows, error } = await query;
  // CLAUDE.md: never turn a query error into an empty list -- an empty audit
  // trail reads as "nothing changed".
  if (error) throw new Error(`Money changes: ${error.message}`);
  const log = rows ?? [];

  // Which family each row belongs to. Most rows carry registration_id in the
  // stored row (an insert or removal has the whole row); a change stores only
  // what changed, so the live row is asked by its id. participant_money is
  // keyed by participant, so it goes through the participant.
  const regOfRow = new Map();
  const want = new Map(); // table -> Set of row ids still to look up
  for (const r of log) {
    const stored = r.after?.registration_id ?? r.before?.registration_id ?? null;
    if (stored) {
      regOfRow.set(r.id, stored);
    } else if (r.row_id && r.table_name !== 'coupons') {
      const t = r.table_name === 'participant_money' ? 'registration_participants' : r.table_name;
      if (!want.has(t)) want.set(t, new Set());
      want.get(t).add(r.row_id);
    }
  }
  const regOfId = new Map();
  await Promise.all(
    [...want.entries()].map(async ([table, ids]) => {
      const list = [...ids];
      // In slices, so a long window never makes one over-long address.
      for (let i = 0; i < list.length; i += 200) {
        const { data, error: lookupError } = await supabase
          .from(table)
          .select('id, registration_id')
          .in('id', list.slice(i, i + 200));
        if (lookupError) throw new Error(`Money changes (${table}): ${lookupError.message}`);
        for (const x of data ?? []) regOfId.set(x.id, x.registration_id);
      }
    })
  );
  for (const r of log) {
    if (!regOfRow.has(r.id) && r.row_id && regOfId.has(r.row_id)) regOfRow.set(r.id, regOfId.get(r.row_id));
  }

  const regIds = [...new Set(regOfRow.values())];
  const familyOfReg = new Map();
  for (let i = 0; i < regIds.length; i += 200) {
    const { data, error: regError } = await supabase
      .from('registrations')
      .select('id, households ( display_name ), events ( name )')
      .in('id', regIds.slice(i, i + 200));
    if (regError) throw new Error(`Money changes (families): ${regError.message}`);
    for (const x of data ?? []) {
      familyOfReg.set(x.id, { family: x.households?.display_name ?? 'Household', event: x.events?.name ?? '' });
    }
  }

  // Staff names for "By".
  const actorIds = [...new Set(log.map((r) => r.changed_by).filter(Boolean))];
  const names = new Map();
  if (actorIds.length) {
    const { data: profs, error: profError } = await supabase
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', actorIds);
    if (profError) throw new Error(`Money changes (names): ${profError.message}`);
    for (const p of profs ?? []) names.set(p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unnamed');
  }

  // The family search: every word typed must be in the family's name.
  const words = fold(q).split(/\s+/).filter(Boolean);
  const matching = log.filter((r) => {
    if (words.length === 0) return true;
    const fam = familyOfReg.get(regOfRow.get(r.id));
    const hay = fold(fam?.family);
    return words.every((w) => hay.includes(w));
  });
  const shown = matching.slice(0, SHOW_LIMIT);
  const filtered = Boolean(q || from || to);

  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
        <h2 className="text-xl font-bold">Money Changes</h2>
        <BackLink href="/admin/payments/" label="Back to Event Payments" />
      </div>
      <p className="text-sm text-neutral-500 mb-4 max-w-4xl">
        Every payment, refund, payment plan, fee, scholarship amount and discount that was added,
        changed or removed, and who did it. Changes are recorded automatically, and nobody can edit
        or delete them, including an administrator. Shows the newest {SHOW_LIMIT}.
      </p>

      {/* A plain GET form: works without JavaScript, and the address keeps
          the filter. */}
      <form method="get" action="/admin/payments/changes/" className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="block">
          <span className="block font-semibold mb-1">Family</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Family name"
            className="field sm:w-64"
          />
        </label>
        <label className="block">
          <span className="block font-semibold mb-1">From</span>
          <input type="date" name="from" defaultValue={from} className="field-sm w-auto" />
        </label>
        <label className="block">
          <span className="block font-semibold mb-1">To</span>
          <input type="date" name="to" defaultValue={to} className="field-sm w-auto" />
        </label>
        <button type="submit" className="btn-outline btn-sm">
          Show
        </button>
        {filtered && (
          <Link href="/admin/payments/changes/" className="text-brand underline self-center">
            Clear
          </Link>
        )}
      </form>

      <p className="mb-3 text-sm text-neutral-600">
        {matching.length} {matching.length === 1 ? 'change' : 'changes'}
        {q ? ` for families matching “${q}”` : ''}
        {from || to ? ` · ${from || 'the start'} to ${to || 'today'}` : ''}
        {matching.length > SHOW_LIMIT ? ` · the newest ${SHOW_LIMIT} shown` : ''}
        {log.length === READ_LIMIT && q
          ? `. The search looked at the newest ${READ_LIMIT.toLocaleString('en-US')} changes; set dates to look further back.`
          : ''}
      </p>

      {shown.length === 0 ? (
        <p className="text-neutral-600">
          {filtered ? 'No changes match this filter.' : 'Nothing recorded yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <ResizableTable storageKey="money-change-log">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Family</th>
                  <th className="px-3 py-2 font-semibold">What</th>
                  <th className="px-3 py-2 font-semibold">Change</th>
                  <th className="px-3 py-2 font-semibold">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 align-top">
                {shown.map((r) => {
                  const regId = regOfRow.get(r.id);
                  const fam = regId ? familyOfReg.get(regId) : null;
                  const lines = summary(r);
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2 whitespace-nowrap text-neutral-600">
                        {whenInMorristown(r.changed_at)}
                      </td>
                      <td className="px-3 py-2">
                        {fam ? (
                          <>
                            <Link href={`/admin/registrations/${regId}/`} className="font-semibold text-brand underline">
                              {fam.family}
                            </Link>
                            {fam.event && <span className="block text-xs text-neutral-500">{fam.event}</span>}
                          </>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-semibold">{OP_LABEL[r.op] ?? r.op}</span>{' '}
                        <span className="text-neutral-600">· {TABLE_LABEL[r.table_name] ?? r.table_name}</span>
                      </td>
                      <td className="px-3 py-2">
                        {lines.length > 0 ? (
                          <ul className="space-y-0.5">
                            {lines.slice(0, 6).map((l) => (
                              <li key={l} className="break-words">{l}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                        {lines.length > 6 && (
                          <details className="mt-1 text-xs text-neutral-500">
                            <summary className="cursor-pointer">All fields ({lines.length})</summary>
                            <ul className="mt-1 space-y-0.5">
                              {lines.slice(6).map((l) => (
                                <li key={l} className="break-words">{l}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className="px-3 py-2">{whoWrote(r, names)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ResizableTable>
        </div>
      )}
    </div>
  );
}
