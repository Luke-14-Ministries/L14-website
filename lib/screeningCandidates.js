// Who is due a full background check, and whether an invite can go now
// (Background screening; 0165 moved sending to VolunteerBadge, 13 Nov 2026).
//
// ONE function for the page and the send action, so what the page offers is
// exactly what the action will send. Server side: it takes the caller's
// client, and throws on a failed read (CLAUDE.md: an empty list that means
// "the query failed" would offer someone already checked for a paid check).
//
// "Due": an ADULT on a registration for an event that hasn't finished (not
// archived), with no full check on file or one out of date. Two groups, kept
// apart (the board, 14 Nov 2026: every adult 18+ through VolunteerBadge):
//   volunteer  anyone with a volunteer place. A registry search (0161) is
//              not a volunteer's check.
//   family     parents, siblings and caregivers. A current registry search
//              still covers them: it is the fallback for anyone who declines.
// Adult campers are left to the registry search for now (Lawrence, 14 Nov
// 2026), until VolunteerBadge says how a guardian completes one.
// Every extra name is a credit spent and a real person asked for their Social
// Security number.

import { depositInByPerson, WAITING_ON_DEPOSIT } from '@/lib/screeningDeposit';
import { dayInMorristown, formatDay } from '@/lib/events';
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

  // One entry per PERSON: volunteering at both weeks needs one check. A
  // volunteer place anywhere makes them a volunteer.
  const byPerson = new Map();
  for (const r of regs ?? []) {
    for (const p of r.registration_participants ?? []) {
      if (p.status === 'cancelled' || !p.camp_role) continue;
      const group = isVolunteerRole(p.camp_role) ? 'volunteer' : p.camp_role === 'camper' ? null : 'family';
      if (!group) continue;
      const person = p.people;
      if (!person?.id) continue;
      const ev = eventById.get(r.event_id);
      const seen = byPerson.get(person.id);
      if (seen) {
        if (ev?.name && !seen.events.includes(ev.name)) seen.events.push(ev.name);
        if (group === 'volunteer') seen.group = 'volunteer';
        if (ev?.starts_on && (!seen.firstStart || ev.starts_on < seen.firstStart)) seen.firstStart = ev.starts_on;
        continue;
      }
      // Most volunteers have no email of their own (15 Oct 2026); the
      // household's address stands in, and the row says so.
      byPerson.set(person.id, {
        person,
        group,
        events: ev?.name ? [ev.name] : [],
        firstStart: ev?.starts_on ?? null,
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
  const depositIn = await depositInByPerson(supabase, personIds, { allRoles: true });

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

  // ANYONE else on the site at the same address (Lawrence, 14 Nov 2026):
  // VolunteerBadge keeps one record per email address, so two people at one
  // address can end up on one VolunteerBadge record. Another person whose own
  // email it is, or another adult in a household with that address and no
  // email of their own (they would fall back to it). Under-18s don't count
  // (never invited); an adult camper may use a parent's or guardian's address
  // (14 Nov 2026), so they are named but don't block.
  const emailOfPerson = new Map();
  for (const [id, { person, householdEmail }] of byPerson) {
    const e = (person.email || '').trim().toLowerCase() || householdEmail || '';
    if (e) emailOfPerson.set(id, e);
  }
  const conflictsBy = new Map();
  {
    const emails = [...new Set(emailOfPerson.values())];
    if (emails.length) {
      // ilike for case; a _ or % in an address only widens the read, and the
      // exact lower-case match below decides who is at the address.
      const like = emails.map((e) => `email.ilike."${e.replace(/["\\]/g, '')}"`).join(',');
      const [{ data: owners, error: ownersError }, { data: homes, error: homesError }] = await Promise.all([
        supabase.from('people').select('id, first_name, last_name, email, date_of_birth').or(like),
        supabase.from('households').select('id, email').or(like),
      ]);
      if (ownersError) throw new Error(`People at these addresses: ${ownersError.message}`);
      if (homesError) throw new Error(`Households at these addresses: ${homesError.message}`);
      const homeEmail = new Map((homes ?? []).map((h) => [h.id, String(h.email ?? '').trim().toLowerCase()]));
      const { data: fallbacks, error: fallbacksError } = homeEmail.size
        ? await supabase
            .from('people')
            .select('id, first_name, last_name, email, date_of_birth, household_id')
            .in('household_id', [...homeEmail.keys()])
        : { data: [], error: null };
      if (fallbacksError) throw new Error(`Household members: ${fallbacksError.message}`);
      // address -> people there (own email, or a household fallback)
      const at = new Map();
      const add = (e, p, how) => {
        if (!e || isAdultToday(p.date_of_birth) === false) return;
        if (!at.has(e)) at.set(e, new Map());
        if (!at.get(e).has(p.id)) at.get(e).set(p.id, { id: p.id, name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'someone', how });
      };
      for (const p of owners ?? []) add(String(p.email ?? '').trim().toLowerCase(), p, 'own');
      for (const p of fallbacks ?? []) {
        if ((p.email || '').trim()) continue;
        add(homeEmail.get(p.household_id), p, 'household');
      }
      // Who is an adult camper only (allowed to share a guardian's address).
      const otherIds = [...new Set([...at.values()].flatMap((m) => [...m.keys()]))];
      const { data: roleRows, error: rolesError } = otherIds.length
        ? await supabase.from('registration_participants').select('person_id, camp_role, status').in('person_id', otherIds)
        : { data: [], error: null };
      if (rolesError) throw new Error(`Roles: ${rolesError.message}`);
      const roles = new Map();
      for (const r of roleRows ?? []) {
        if (r.status === 'cancelled') continue;
        if (!roles.has(r.person_id)) roles.set(r.person_id, new Set());
        roles.get(r.person_id).add(r.camp_role);
      }
      const camperOnly = (id) => roles.has(id) && [...roles.get(id)].every((r) => r === 'camper');
      for (const [id, e] of emailOfPerson) {
        const others = [...(at.get(e)?.values() ?? [])].filter((o) => o.id !== id);
        if (others.length) conflictsBy.set(id, others.map((o) => ({ ...o, camper: camperOnly(o.id) })));
      }
    }
  }
  const conflictWords = (personId, email) => {
    const blocking = (conflictsBy.get(personId) ?? []).filter((o) => !o.camper);
    if (!blocking.length) return null;
    // 23 Nov 2026: "X is also Y (household address)'s email" read garbled.
    // Say who else uses it, and whether it is the family's shared address.
    const names = blocking.slice(0, 3).map((o) => (o.how === 'household' ? `${o.name} (as the family address)` : o.name));
    const more = blocking.length > 3 ? ` and ${blocking.length - 3} more` : '';
    return `${names.join(', ')}${more} also ${blocking.length === 1 ? 'uses' : 'use'} ${email} on the site. VolunteerBadge keeps one record per email address, so give each person their own email on their details page first.`;
  };

  const candidates = [];
  for (const [personId, { person, group, events: evNames, householdEmail, firstStart }] of byPerson) {
    const c = clearanceBy.get(personId);
    const vb = vbBy.get(personId) ?? null;
    const adult = isAdultToday(person.date_of_birth);
    // 18 by the first day of camp but not yet today (14 Nov 2026): due, but a
    // background check can't be run on someone under 18, so the invite waits
    // for their birthday. Anyone still under 18 at camp isn't screened.
    let turns18 = null;
    if (adult === false) {
      const dob = String(person.date_of_birth).slice(0, 10);
      const b18 = `${Number(dob.slice(0, 4)) + 18}${dob.slice(4)}`;
      if (!firstStart || b18 > firstStart) continue;
      turns18 = b18;
    }

    const registryOnly = c?.provider === 'registry_search';
    const current = Boolean(c?.background_check_on_file) && (!c.expires_on || c.expires_on >= today);
    // A current full check on file: not due.
    if (!registryOnly && current) continue;
    // A family adult with a current registry search (the fallback) is covered.
    if (group === 'family' && registryOnly && current) continue;

    const ownEmail = (person.email || '').trim().toLowerCase();
    const email = ownEmail || householdEmail || '';
    const vbOpen = vb && OPEN_STATUSES.includes(vb.status);
    const vbWaitingOnStaff = vb && !vb.confirmed_at && (vb.status === 'clear' || vb.status === 'consider');
    const checkrWaiting = c && ['invited', 'pending', 'suspended'].includes(c.checkr_status);

    // Anything that stops an invite other than the person's own invite being
    // out: a "Resend without the ID step" is refused for these too.
    let otherBlock = null;
    const UNDER_18 = turns18
      ? `turns 18 on ${dayInMorristown(`${turns18}T12:00:00Z`)}. A background check can’t be run before then, so the invite can go from that day.`
      : null;
    if (c?.verdict === 'not_permitted') otherBlock = 'marked Not permitted to attend, so no invite is sent.';
    else if (UNDER_18) otherBlock = UNDER_18;
    else if (adult === null) otherBlock = 'no date of birth on file, so we can’t confirm they are 18. Add it on their details page.';
    else if (!email) otherBlock = 'no email on file for them or their household. VolunteerBadge needs one to send the invite.';
    else if (usedBy.has(email) && usedBy.get(email) !== personId) {
      otherBlock = `${nameOf(usedBy.get(email))} was invited at ${email}. VolunteerBadge keeps one record per email address, so give this person their own email on their details page first.`;
    } else if (conflictWords(personId, email)) {
      otherBlock = conflictWords(personId, email);
    } else if (sandbox && !email.endsWith('@luke14ministries.net')) {
      otherBlock = 'test mode sends only to @luke14ministries.net addresses.';
    } else if (depositIn.get(personId) === false) otherBlock = WAITING_ON_DEPOSIT;

    let blockedBecause = null;
    if (c?.verdict === 'not_permitted') {
      blockedBecause = 'marked Not permitted to attend, so no invite is sent.';
    } else if (UNDER_18) {
      blockedBecause = UNDER_18;
    } else if (vbOpen) {
      blockedBecause = `invited to VolunteerBadge on ${dayInMorristown(vb.sent_at)}; see Invites and results below.`;
    } else if (vbWaitingOnStaff) {
      blockedBecause =
        vb.status === 'clear'
          ? 'VolunteerBadge says clear: confirm OK to serve under Invites and results below.'
          : 'VolunteerBadge result needs review: read it in VolunteerBadge, then record the decision on their background check record (Background Checks).';
    } else if (adult === null) {
      blockedBecause = 'no date of birth on file, so we can’t confirm they are 18. Add it on their details page.';
    } else if (!email) {
      blockedBecause = 'no email on file for them or their household. VolunteerBadge needs one to send the invite.';
    } else if (usedBy.has(email) && usedBy.get(email) !== personId) {
      blockedBecause = `${nameOf(usedBy.get(email))} was invited at ${email}. VolunteerBadge keeps one record per email address, so give this person their own email on their details page first.`;
    } else if (conflictWords(personId, email)) {
      blockedBecause = conflictWords(personId, email);
    } else if (sandbox && !email.endsWith('@luke14ministries.net')) {
      // A test key still emails a real (test) invite: only to staff.
      blockedBecause = 'test mode sends only to @luke14ministries.net addresses.';
    }
    // The same holds as short labels, each with its explanation, for the
    // "can't be sent yet" list (Lawrence, 15 Nov 2026: the hold in bold).
    // blockedBecause stays the one sentence the actions and counts read.
    const holds = [];
    if (c?.verdict === 'not_permitted') {
      holds.push({ label: 'Not permitted', text: 'Marked Not permitted to attend, so no invite is sent.' });
    } else if (UNDER_18) {
      holds.push({
        label: `Turns 18 on ${dayInMorristown(`${turns18}T12:00:00Z`)}`,
        text: 'A background check can’t be run before then, so the invite can go from that day.',
      });
    } else if (!vbOpen && !vbWaitingOnStaff) {
      if (depositIn.get(personId) === false) {
        holds.push({
          label: 'Waiting on the deposit',
          text: 'The background check is ordered once their own share of the deposit is paid, waived or covered by a scholarship.',
        });
      }
      if (adult === null) {
        holds.push({ label: 'No date of birth', text: 'We can’t confirm they are 18. Add it on their details page.' });
      } else if (!email) {
        holds.push({ label: 'No email', text: 'None on file for them or their household. VolunteerBadge needs one to send the invite.' });
      } else if (usedBy.has(email) && usedBy.get(email) !== personId) {
        holds.push({
          label: 'Email already used',
          text: `${nameOf(usedBy.get(email))} was invited at ${email}. VolunteerBadge keeps one record per email address, so give this person their own email on their details page first.`,
        });
      } else if (conflictWords(personId, email)) {
        holds.push({ label: 'Shared email', text: conflictWords(personId, email) });
      } else if (sandbox && !email.endsWith('@luke14ministries.net')) {
        holds.push({ label: 'Test mode', text: 'Test mode sends only to @luke14ministries.net addresses.' });
      }
    }

    // The deposit hold first; anything else wrong is kept on the end.
    if (!vbOpen && !vbWaitingOnStaff && c?.verdict !== 'not_permitted' && depositIn.get(personId) === false) {
      blockedBecause = blockedBecause ? `${WAITING_ON_DEPOSIT}. Also: ${blockedBecause}` : WAITING_ON_DEPOSIT;
    }

    candidates.push({
      personId,
      // 'volunteer' or 'family': listed apart, each with its own template.
      group,
      name: `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || 'Unnamed',
      email: email || null,
      emailIsHousehold: Boolean(email) && !ownEmail,
      // Everyone else on the site at this address, for the row to name.
      emailConflicts: conflictsBy.get(personId) ?? [],
      eventName: evNames.join(' · ') || 'No event',
      // An old Checkr order still out no longer blocks a VolunteerBadge invite
      // (the Checkr import is gone); it is said, so nobody is screened twice
      // by accident.
      checkrOut: Boolean(checkrWaiting),
      // Shown as written under the name (23 Nov 2026: "background check"
      // in full, never "checked" alone, and the date as 'Nov 15, 2026').
      reason: registryOnly
        ? 'registry search only'
        : c?.expires_on && c.expires_on < today
          ? `background check expired ${formatDay(c.expires_on)}`
          : c?.background_check_on_file
            ? 'background check on file but out of date'
            : 'no background check on file',
      lastVb: vb ? { id: vb.id, status: vb.status, sentAt: vb.sent_at, idWaived: vb.id_verification_waived === true } : null,
      blockedBecause,
      holds,
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
      // Our own invite is out, or its result waits on staff: not "can't be
      // sent", just under way (Lawrence, 15 Nov 2026: "Larry and Ellen HAVE
      // been sent... Error?"). Listed apart on the screen, and given no
      // "already in VolunteerBadge" note, since our invite put them there.
      inProgress: Boolean(c?.verdict !== 'not_permitted' && !UNDER_18 && (vbOpen || vbWaitingOnStaff)),
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
