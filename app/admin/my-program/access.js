// Who may download or print one program's roster (26 Oct 2026).
//
// The CSV route does not run app/admin/layout.jsx, so it cannot lean on the
// layout's gates; this is where they are restated, once, for the CSV and the
// print view alike. The answer is yes for:
//
//   * a person who holds THAT leadership (getProgramLeadership: an active
//     grant in program_leaders naming this program at this event), on a
//     strong session -- the same rule leads_program() applies in the
//     database (0106); or
//   * staff with the read the Programs page needs (read:programs), whose
//     can() already refuses a weak session (lib/staff.js).
//
// Anything else is refused. A leader of one program asking for another gets a
// refusal, never a quiet fallback to their own: a file named for the wrong
// program is worse than no file.
//
// The data itself still comes only from the program_roster view, whose own
// where-clause (is_staff() or leads_program(...)) is the backstop.

import { getStaff, can } from '@/lib/staff';
import { getProgramLeadership } from '@/lib/programs';
import { createClient } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// { program } on success, where program has the shape getProgramLeadership
// returns; otherwise { status, message }.
export async function programForCaller(grant) {
  const [staff, leaderships] = await Promise.all([getStaff(), getProgramLeadership()]);

  const key =
    typeof grant === 'string' && grant
      ? grant
      : leaderships[0]
        ? `${leaderships[0].programId}:${leaderships[0].eventId}`
        : '';
  const [programId = '', eventId = ''] = key.split(':');
  if (!UUID.test(programId) || !UUID.test(eventId)) {
    return { status: 400, message: 'Which program? Open My Program and use the buttons there.' };
  }

  const held = leaderships.find((l) => l.programId === programId && l.eventId === eventId);
  if (held) {
    const supabase = await createClient();
    const { data: strong, error } = await supabase.rpc('session_is_strong');
    if (error) {
      console.error('my-program access: session_is_strong:', error.message);
      return { status: 500, message: 'Your sign-in could not be checked. Nothing was exported; please try again.' };
    }
    if (strong !== true) {
      return { status: 403, message: 'Enter your two-factor code first.' };
    }
    return { program: held };
  }

  if (!can(staff, 'read:programs')) return { status: 403, message: 'Not permitted' };

  const supabase = await createClient();
  const [progRes, eventRes] = await Promise.all([
    supabase.from('programs').select('name, sort_order').eq('id', programId).maybeSingle(),
    supabase.from('events').select('name, starts_on, ends_on').eq('id', eventId).maybeSingle(),
  ]);
  const failed = progRes.error ?? eventRes.error;
  if (failed) {
    console.error('my-program access:', failed.message);
    return { status: 500, message: 'The program could not be read. Nothing was exported; please try again.' };
  }
  if (!progRes.data || !eventRes.data) return { status: 404, message: 'No such program at that event.' };
  return {
    program: {
      id: null,
      programId,
      programName: progRes.data.name,
      eventId,
      eventName: eventRes.data.name,
      startsOn: eventRes.data.starts_on ?? null,
      endsOn: eventRes.data.ends_on ?? null,
      sortOrder: progRes.data.sort_order ?? 100,
    },
  };
}
