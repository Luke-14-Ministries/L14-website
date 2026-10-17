// GET /admin/newsletter/export — the newsletter list as a CSV: everyone with
// "Ministry news & updates" on. Registrar-gated; the function it calls checks
// the same thing again inside the database.

import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) {
    return new Response('Not permitted', { status: 403 });
  }
  // Build plan item 15 (the call of 16 Oct 2026, 3:32 pm): the same people in
  // Mailchimp's import layout, so Ellen can sync the audience by upload until
  // the Mailchimp-or-Resend question is settled. The Tags column marks where
  // they came from, so a website row is tellable from a Google-Form one.
  const mailchimp = new URL(request.url).searchParams.get('format') === 'mailchimp';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_newsletter_list');
  if (error) {
    console.error('newsletter export:', error.message);
    return new Response('Could not load the list', { status: 500 });
  }
  const rows = mailchimp
    ? [['Email Address', 'First Name', 'Last Name', 'Tags']]
    : [['First name', 'Last name', 'Email', 'Since']];
  for (const r of (data ?? []).filter((r) => r.email_news)) {
    if (mailchimp) {
      if (!r.email) continue;
      rows.push([r.email, r.first_name ?? '', r.last_name ?? '', 'website']);
    } else {
      rows.push([r.first_name ?? '', r.last_name ?? '', r.email ?? '', String(r.since ?? '').slice(0, 10)]);
    }
  }
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  if (mailchimp) {
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="newsletter-mailchimp-import-${stamp}.csv"`,
      },
    });
  }
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="newsletter-list-${stamp}.csv"`,
    },
  });
}
