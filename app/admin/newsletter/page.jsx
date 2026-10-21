import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { sinceISO, dayInMorristown } from '@/lib/events';

export const metadata = { title: 'Newsletter — Staff Admin' };

// The newsletter list, as staff see it (14 Oct 2026, Lawrence).
//
// Deliberately small: who has "Ministry news & updates" switched on, who has
// joined or left in the last 30 days, and a CSV. Sending still happens in
// Resend's own tools; a future version may hand the list across. The
// preference itself is set by the family on My Account → Contact details,
// and the public Newsletter page still points at the Google Form for people
// without an account -- those names are not here.

export default async function NewsletterPage() {
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/newsletter/');
  if (!can(staff, 'read:registration')) redirect('/admin');

  const supabase = await createClient();
  const [{ data: list, error }, { data: recent }] = await Promise.all([
    supabase.rpc('admin_newsletter_list'),
    supabase
      .from('newsletter_preference_log')
      .select('profile_id, email_news, changed_at, profiles ( first_name, last_name )')
      .gte('changed_at', sinceISO(30))
      .order('changed_at', { ascending: false })
      .limit(100),
  ]);
  if (error) console.error('admin_newsletter_list:', error.message);

  const rows = (list ?? []).map((r) => ({
    ...r,
    name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || r.email,
  }));
  const subscribed = rows.filter((r) => r.email_news).sort((a, b) => a.name.localeCompare(b.name));
  const joined = (recent ?? []).filter((r) => r.email_news).length;
  const left = (recent ?? []).filter((r) => !r.email_news).length;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Newsletter</h2>
        <span className="flex flex-wrap gap-2">
          <a href="/admin/newsletter/export" className="btn-outline py-2! text-sm">
            Download CSV
          </a>
          <a
            href="/admin/newsletter/export?format=mailchimp"
            className="btn-outline py-2! text-sm"
            title="Email Address, First Name, Last Name, Tags — Mailchimp's import layout, tagged 'website'"
          >
            Mailchimp import CSV
          </a>
        </span>
      </div>
      <p className="mb-5 text-sm text-neutral-500">
        Everyone with an account who has <em>Ministry news &amp; updates</em> switched on. Families
        change it themselves on My Account → Contact details. Sending happens in Mailchimp for now
        (Ellen runs it; a move to Resend is for later); this is the list. People who signed up through
        the public Google Form are not here.
      </p>

      {error && (
        <p className="mb-4 rounded-sm border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          The list could not be loaded. Check the server log for admin_newsletter_list.
        </p>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="text-3xl font-bold">{subscribed.length}</div>
          {/* No "N opted out" under it (Lawrence, 15 Oct 2026): somebody who
              has news off is simply not on the list, and a count of them
              with no names is a question, not information. */}
          <div className="text-sm font-semibold text-neutral-700">on the list</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="text-3xl font-bold text-green-700">{joined}</div>
          <div className="text-sm font-semibold text-neutral-700">joined in the last 30 days</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="text-3xl font-bold text-neutral-500">{left}</div>
          <div className="text-sm font-semibold text-neutral-700">left in the last 30 days</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr className="border-b border-neutral-200">
                <th className="px-3 py-2 text-left font-semibold">Name</th>
                <th className="px-3 py-2 text-left font-semibold">Email</th>
                <th className="px-3 py-2 text-left font-semibold">Since</th>
              </tr>
            </thead>
            <tbody>
              {subscribed.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-neutral-500" colSpan={3}>
                    Nobody is on the list yet.
                  </td>
                </tr>
              )}
              {subscribed.map((r) => (
                <tr key={r.profile_id} className="border-b border-neutral-100">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-neutral-600">{r.email}</td>
                  <td className="px-3 py-2 text-neutral-500">{dayInMorristown(r.since)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h3 className="font-semibold text-neutral-700 mb-2">Last 30 days</h3>
          {(recent ?? []).length === 0 ? (
            <p className="text-sm text-neutral-500">No changes.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(recent ?? []).map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                      r.email_news ? 'bg-green-100 text-green-800' : 'bg-neutral-200 text-neutral-700'
                    }`}
                  >
                    {r.email_news ? 'joined' : 'left'}
                  </span>
                  <span>
                    {`${r.profiles?.first_name ?? ''} ${r.profiles?.last_name ?? ''}`.trim() || 'Someone'}
                  </span>
                  <span className="text-xs text-neutral-500">{dayInMorristown(r.changed_at)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-neutral-500">
            Changes are recorded from 14 October 2026 onward; earlier opt-ins show their account
            date under &ldquo;Since&rdquo;.
          </p>
        </div>
      </div>
    </div>
  );
}
