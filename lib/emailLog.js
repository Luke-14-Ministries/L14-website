// Reading message_log for staff (26 Oct 2026). Every email the site sends a
// family is recorded there (0001; staff sends through log_family_email(),
// 0120/0132; the plan edge functions as service role, 0121), but no staff page
// showed it, so once the "2 emails sent" card on Email Families was gone the
// record could only be read from the database. Two places read it now: each
// registration page (the household's emails) and Email Families (the latest
// sends). Staff read the table through message_log_staff (is_staff()).

// What each template_key means, in staff words. Keys not listed print as
// they are -- message_log.template_key is free text.
export const EMAIL_KIND = {
  family_update: 'Email from staff',
  waiver_needed: 'Waiver reminder',
  plan_receipt: 'Payment plan receipt',
  plan_payment_problem: 'Payment plan problem',
  plan_stopped: 'Payment plan stopped',
};

// Resend's own page for one message: delivered, bounced, opened.
export const resendUrl = (id) => `https://resend.com/emails/${encodeURIComponent(id)}`;

const fullName = (p) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || null;

// The rows, newest first, with who pressed Send and the household's name.
// `householdId` narrows to one family; `limit` caps the list. Throws on a
// failed read (CLAUDE.md: never an empty list for an error).
export async function loadEmailLog(supabase, { householdId = null, limit = 50 } = {}) {
  let q = supabase
    .from('message_log')
    .select('id, to_email, household_id, registration_id, template_key, subject, status, provider_message_id, error, sent_at, sent_by')
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (householdId) q = q.eq('household_id', householdId);
  const { data: rows, error } = await q;
  if (error) throw new Error(`Emails sent: ${error.message}`);

  const senderIds = [...new Set((rows ?? []).map((r) => r.sent_by).filter(Boolean))];
  const householdIds = [...new Set((rows ?? []).map((r) => r.household_id).filter(Boolean))];
  const [senders, households] = await Promise.all([
    senderIds.length
      ? supabase.from('profiles').select('id, first_name, last_name').in('id', senderIds)
      : Promise.resolve({ data: [], error: null }),
    householdIds.length && !householdId
      ? supabase.from('households').select('id, display_name').in('id', householdIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (senders.error) throw new Error(`Emails sent — who sent them: ${senders.error.message}`);
  if (households.error) throw new Error(`Emails sent — households: ${households.error.message}`);
  const senderName = new Map((senders.data ?? []).map((p) => [p.id, fullName(p)]));
  const householdName = new Map((households.data ?? []).map((h) => [h.id, h.display_name]));

  return (rows ?? []).map((r) => ({
    id: r.id,
    sentAt: r.sent_at,
    to: r.to_email,
    householdId: r.household_id,
    household: householdName.get(r.household_id) ?? null,
    registrationId: r.registration_id,
    kind: EMAIL_KIND[r.template_key] ?? r.template_key,
    subject: r.subject,
    status: r.status,
    error: r.error,
    // Staff-pressed sends carry a name; the plan emails are the site's own.
    by: r.sent_by ? senderName.get(r.sent_by) ?? 'staff' : 'the site',
    providerId: r.provider_message_id,
  }));
}
