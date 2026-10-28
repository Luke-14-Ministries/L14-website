import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { dayInMorristown, whenInMorristown } from '@/lib/events';
import { site } from '@/lib/site';
import PrayerComposer from './PrayerComposer';
import RemoveButton from './RemoveButton';

export const metadata = { title: 'Prayer List — Staff Admin' };

// The prayer list (0141, Lawrence 28 Oct 2026). People join on the Pray page
// and confirm by email; the prayer team writes here and the site sends one
// copy to each person, each with its own unsubscribe link. Prayer list read
// sees who is on it and what was sent; write sends. Ticked by hand on Staff &
// Access for the prayer team.

export default async function PrayerListPage() {
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/prayer/');
  if (!can(staff, 'read:prayer')) redirect('/admin');

  const supabase = await createClient();
  const [{ data: people, error }, { data: sends, error: sendsError }] = await Promise.all([
    supabase
      .from('prayer_list_subscribers')
      .select('id, email, name, created_at, confirmed_at, unsubscribed_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('prayer_list_sends')
      .select('id, subject, body, sent_at, recipient_count, failed_count, sent_by')
      .order('sent_at', { ascending: false })
      .limit(20),
  ]);
  // CLAUDE.md: a failed read is an error page, never an empty list.
  if (error) throw new Error(`Prayer list: ${error.message}`);
  if (sendsError) throw new Error(`Prayer list — sent emails: ${sendsError.message}`);

  const senderIds = [...new Set((sends ?? []).map((s) => s.sent_by))];
  const { data: senders, error: sendersError } = senderIds.length
    ? await supabase.from('profiles').select('id, first_name, last_name').in('id', senderIds)
    : { data: [], error: null };
  if (sendersError) throw new Error(`Prayer list — senders: ${sendersError.message}`);
  const senderName = new Map((senders ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()]));

  const onList = (people ?? []).filter((p) => p.confirmed_at && !p.unsubscribed_at);
  const pending = (people ?? []).filter((p) => !p.confirmed_at && !p.unsubscribed_at);
  const left = (people ?? []).filter((p) => p.unsubscribed_at);

  return (
    <div>
      <h2 className="mb-1 text-xl font-bold">Prayer List</h2>
      <p className="mb-6 text-sm text-neutral-500">
        People join on the <Link href="/pray/" className="underline">Pray page</Link> and confirm by email.
        Prayer requests go to {site.emails.pray}, which also receives replies (and the odd
        &ldquo;please take me off&rdquo;: <em>Take off the list</em> below does it).
      </p>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="text-3xl font-bold">{onList.length}</div>
          <div className="text-sm font-semibold text-neutral-700">On the list</div>
          <div className="text-xs text-neutral-500">confirmed, and receive the emails</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="text-3xl font-bold">{pending.length}</div>
          <div className="text-sm font-semibold text-neutral-700">Not confirmed yet</div>
          <div className="text-xs text-neutral-500">signed up; the confirmation email is unanswered</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="text-3xl font-bold">{left.length}</div>
          <div className="text-sm font-semibold text-neutral-700">Unsubscribed</div>
          <div className="text-xs text-neutral-500">never emailed again unless they sign up afresh</div>
        </div>
      </div>

      {can(staff, 'write:prayer') && (
        <div className="mb-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
          <h3 className="mb-3 font-bold">Write to the prayer list</h3>
          <PrayerComposer count={onList.length} />
        </div>
      )}

      <div className="mb-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
        <h3 className="mb-3 font-bold">Sent</h3>
        {(sends ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {sends.map((s) => (
              <li key={s.id} className="py-2">
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-semibold">{s.subject}</span>{' '}
                    <span className="text-neutral-500">
                      · {whenInMorristown(s.sent_at)} · {senderName.get(s.sent_by) || 'Staff'} · to {s.recipient_count}
                      {s.failed_count ? ` (${s.failed_count} failed)` : ''}
                    </span>
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-neutral-700">{s.body}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
        <h3 className="mb-3 font-bold">Who is on it</h3>
        {(people ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">Nobody has signed up yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-1 pr-3 font-semibold">Name</th>
                <th className="py-1 pr-3 font-semibold">Email</th>
                <th className="py-1 pr-3 font-semibold">Signed up</th>
                <th className="py-1 pr-3 font-semibold">Status</th>
                {can(staff, 'write:prayer') && <th className="py-1 font-semibold" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {[...onList, ...pending, ...left].map((p) => (
                <tr key={p.id} className="border-t border-neutral-100">
                  <td className="py-1.5 pr-3">{p.name || '—'}</td>
                  <td className="py-1.5 pr-3">{p.email}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{dayInMorristown(p.created_at)}</td>
                  <td className="py-1.5 pr-3">
                    {p.unsubscribed_at
                      ? `Unsubscribed ${dayInMorristown(p.unsubscribed_at)}`
                      : p.confirmed_at
                        ? `On the list since ${dayInMorristown(p.confirmed_at)}`
                        : 'Not confirmed yet'}
                  </td>
                  {can(staff, 'write:prayer') && (
                    <td className="py-1.5 text-right">
                      {!p.unsubscribed_at && <RemoveButton id={p.id} email={p.email} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
