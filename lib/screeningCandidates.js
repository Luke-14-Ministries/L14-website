// Who is due a full background check, and whether an invite can go now
// (Background screening; 0165 moved sending to VolunteerBadge, 13 Nov 2026).
//
// ONE function for the page and the send action, so what the page offers is
// exactly what the action will send. Server side: it takes the caller's
// client, and throws on a failed read (CLAUDE.md: an empty list that means
// "the query failed" would offer someone already checked for a paid check).
//
// "Due" stays deliberately narrow: an ADULT VOLUNTEER on a registration for an
// event that hasn't finished (not archived), with no full check on file or
// one out of date. A registry search (0161) is not a volunteer's check.
// Every extra name is a credit spent and a real person asked for their Social
// Security number.

import { depositInByPerson, WAITING_ON_DEPOSIT } from '@/lib/screeningDeposit';
import { dayInMorristown } from '@/lib/events';
import { isVolunteerRole } from '@/lib/roles';
import { OPEN_STATUSES } from '@/lib/volunteerBadgeApi';

const isAdultToday = (dob) => {
  if (!dob) return null; // null = unknown, not false
  const d = new Date(`${String(dob).slice(0, 10)}T00:00:00Z`);
  const eighteen = new Date(d);
  eighteen.setUTCFullYear(eighteen.getUTCFullYear() + 18);
  return eighteen <= new Date();
};

// Latest VolunteerBadge request per person, in this mode (a test key sees
// test rows, a live key live ones).
export async function latestVbRequests(supabase, personIds, sandbox) {
  if (!personIds.length) return new Map();
  const { data, error } = await supabase
    .from('volunteerbadge_requests')
    .select(
      'id, person_id, invited_email, sandbox, status, vb_check_status, vb_result, apply_expires_at, completed_at, problem, sent_at, last_checked_at, confirmed_at, id_verification_waived'
    )
    .in('person_id', personIds)
    .eq('sandbox', sandbox)
    .order('sent_at', { ascending: false });
  if (error) throw new Error(`VolunteerBadge requests: ${error.message}`);
  const by = new Map();
  for (const r of data ?? []) if (!by.has(r.person_id)) by.set(r.person_id, r);
  return by;
}

export async function loadScreeningCandidates(supabase, { sandbox = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on')
    .gte('ends_on', today)
    .is('archived_at', null);
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));
  if (eventById.size === 0) return { noEvents: true, candidates: [] };

  const { data: regs, error: regsError } = await supabase
    .from('registrations')
    .select(
      `id, event_id,
       households ( email ),
       registration_participants ( id, camp_role, status,
         people ( id, first_name, last_name, email, date_of_birth ) )`
    )
    .in('event_id', [...eventById.keys()]);
  if (regsError) throw new Error(`Registrations: ${regsError.message}`);

  // One entry per PERSON: volunteering at both weeks needs one check.
  const byPerson = new Map();
  for (const r of regs ?? []) {
    for (const p of r.registration_participants ?? []) {
      if (!isVolunteerRole(p.camp_role) || p.status === 'cancelled') continue;
      const person = p.people;
      if (!person?.id) continue;
      const ev = eventById.get(r.event_id);
      const seen = byPerson.get(person.id);
      if (seen) {
        if (ev?.name && !seen.events.includes(ev.name)) seen.events.push(ev.name);
        continue;
      }
      // Most volunteers have no email of their own (15 Oct 2026); the
      // household's address stands in, and the row says so.
      byPerson.set(person.id, {
        person,
        events: ev?.name ? [ev.name] : [],
        householdEmail: (r.households?.email ?? '').trim().toLowerCase() || null,
      });
    }
  }

  const personIds = [...byPerson.keys()];
  const { data: clearances, error: clearancesError } = personIds.length
    ? await supabase
        .from('person_clearances')
        .select('person_id, background_check_on_file, expires_on, checkr_status, provider, verdict')
        .in('person_id', personIds)
    : { data: [], error: null };
  if (clearancesError) throw new Error(`Background checks: ${clearancesError.message}`);
  const clearanceBy = new Map((clearances ?? []).map((c) => [c.person_id, c]));
  const vbBy = await latestVbRequests(supabase, personIds, sandbox);
  // Held until the deposit is in (Ellen and Lawrence, 9 Nov 2026).
  const depositIn = await depositInByPerson(supabase, personIds);

  // Addresses ever used for someone's invite. VolunteerBadge keeps one
  // record per address, so an address that one person was invited at is
  // theirs: anyone else needs their own email, or their results could be
  // tied together (review, 13 Nov 2026).
  const usedBy = new Map();
  {
    const { data: used, error: usedError } = await supabase
      .from('volunteerbadge_requests')
      .select('person_id, invited_email')
      .eq('sandbox', sandbox)
      .neq('status', 'not_sent');
    if (usedError) throw new Error(`VolunteerBadge requests: ${usedError.message}`);
    for (const u of used ?? []) if (!usedBy.has(u.invited_email)) usedBy.set(u.invited_email, u.person_id);
  }
  const nameOf = (id) => {
    const p = byPerson.get(id)?.person;
    return p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'someone' : 'someone';
  };

  const candidates = [];
  for (const [personId, { person, events: evNames, householdEmail }] of byPerson) {
    const c = clearanceBy.get(personId);
    const vb = vbBy.get(personId) ?? null;
    const adult = isAdultToday(person.date_of_birth);
    if (adult === false) continue; // a minor is not screened; nothing to do

    const registryOnly = c?.provider === 'registry_search';
    // A current full check on file: not due.
    if (!registryOnly && c?.background_check_on_file && (!c.expires_on || c.expires_on >= today)) continue;

    const ownEmail = (person.email || '').trim().toLowerCase();
    const email = ownEmail || householdEmail || '';
    const vbOpen = vb && OPEN_STATUSES.includes(vb.status);
    const vbWaitingOnStaff = vb && !vb.confirmed_at && (vb.status === 'clear' || vb.status === 'consider');
    const checkrWaiting = c && ['invited', 'pending', 'suspended'].includes(c.checkr_status);

    // Anything that stops an invite other than the person's own invite being
    // out: a "Resend without the ID step" is refused for these too.
    let otherBlock = null;
    if (c?.verdict === 'not_permitted') otherBlock = 'marked Not permitted to attend, so no invite is sent.';
    else if (adult === null) otherBlock = 'no date of birth on file, so we can’t confirm they are 18. Add it on their details page.';
    else if (!email) otherBlock = 'no email on file for them or their household. VolunteerBadge needs one to send the invite.';
    else if (usedBy.has(email) && usedBy.get(email) !== personId) {
      otherBlock = `${nameOf(usedBy.get(email))} was invited at ${email}. VolunteerBadge keeps one record per email address, so give this person their own email on their details page first.`;
    } else if (sandbox && !email.endsWith('@luke14ministries.net')) {
      otherBlock = 'test mode sends only to @luke14ministries.net addresses.';
    } else if (depositIn.get(personId) === false) otherBlock = WAITING_ON_DEPOSIT;

    let blockedBecause = null;
    if (c?.verdict === 'not_permitted') {
      blockedBecause = 'marked Not permitted to attend, so no invite is sent.';
    } else if (vbOpen) {
      blockedBecause = `invited to VolunteerBadge on ${dayInMorristown(vb.sent_at)}; see Invites and results below.`;
    } else if (vbWaitingOnStaff) {
      blockedBecause =
        vb.status === 'clear'
          ? 'VolunteerBadge says clear: confirm OK to serve under Invites and results below.'
          : 'VolunteerBadge result needs review: read it in VolunteerBadge, then record the verdict on their Volunteers entry.';
    } else if (adult === null) {
      blockedBecause = 'no date of birth on file, so we can’t confirm they are 18. Add it on their details page.';
    } else if (!email) {
      blockedBecause = 'no email on file for them or their household. VolunteerBadge needs one to send the invite.';
    } else if (usedBy.has(email) && usedBy.get(email) !== personId) {
      blockedBecause = `${nameOf(usedBy.get(email))} was invited at ${email}. VolunteerBadge keeps one record per email address, so give this person their own email on their details page first.`;
    } else if (sandbox && !email.endsWith('@luke14ministries.net')) {
      // A test key still emails a real (test) invite: only to staff.
      blockedBecause = 'test mode sends only to @luke14ministries.net addresses.';
    }
    // The deposit hold first; anything else wrong is kept on the end.
    if (!vbOpen && !vbWaitingOnStaff && c?.verdict !== 'not_permitted' && depositIn.get(personId) === false) {
      blockedBecause = blockedBecause ? `${WAITING_ON_DEPOSIT}. Also: ${blockedBecause}` : WAITING_ON_DEPOSIT;
    }

    candidates.push({
      personId,
      name: `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || 'Unnamed',
      email: email || null,
      emailIsHousehold: Boolean(email) && !ownEmail,
      eventName: evNames.join(' · ') || 'No event',
      // An old Checkr order still out no longer blocks a VolunteerBadge invite
      // (the Checkr import is gone); it is said, so nobody is screened twice
      // by accident.
      checkrOut: Boolean(checkrWaiting),
      reason: registryOnly
        ? 'registry search only'
        : c?.expires_on && c.expires_on < today
          ? `expired ${c.expires_on}`
          : c?.background_check_on_file
            ? 'on file but out of date'
            : 'never checked',
      lastVb: vb ? { id: vb.id, status: vb.status, sentAt: vb.sent_at, idWaived: vb.id_verification_waived === true } : null,
      blockedBecause,
      // "Resend without the ID step" (Lawrence, 13 Nov 2026): someone invited
      // before, nothing else in the way, and either no invite out now or one
      // nobody has started a check on (invited, or applied with no check).
      // The resend replaces that open invite.
      resendable:
        Boolean(vb) &&
        !otherBlock &&
        !vbWaitingOnStaff &&
        (!vbOpen || vb.status === 'invited' || vb.status === 'applied'),
      openRequestId: vbOpen ? vb.id : null,
    });
  }

  // Two people due at one address: only one can be sent at a time.
  const emailUse = new Map();
  for (const c of candidates) {
    if (!c.email) continue;
    if (!emailUse.has(c.email)) emailUse.set(c.email, []);
    emailUse.get(c.email).push(c.name);
  }
  for (const c of candidates) {
    c.sharesEmailWith = c.email ? emailUse.get(c.email).filter((n) => n !== c.name) : [];
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name));
  return { noEvents: false, candidates };
}
