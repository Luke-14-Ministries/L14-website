'use server';

// Setup-page actions. Admin-checked here AND by the events_write RLS policy
// (is_admin for ALL commands) -- the same belt-and-braces pattern as the rest
// of the admin area.

import { revalidatePath } from 'next/cache';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

// One "Event status" (26 Oct 2026), stored on the two columns everything else
// reads: unpublished = not published, not archived; published = published, not
// archived; archived = archived_at set AND not published -- an archived event
// is never on the public site. Choosing either of the other two clears the
// archive mark. A row stored as both (possible before this) is tidied here, on
// its next save, and nowhere else.
const EVENT_STATUSES = new Set(['unpublished', 'published', 'archived']);

export async function updateEventRegistration(eventId, { status, opensAt, closesAt }) {
  const staff = await getStaff();
  if (!can(staff, 'write:setup')) return { ok: false, error: 'Admins only.' };
  if (!eventId) return { ok: false, error: 'Missing event.' };
  if (!EVENT_STATUSES.has(status)) return { ok: false, error: 'Choose an event status.' };
  if (opensAt && closesAt && new Date(opensAt) >= new Date(closesAt)) {
    return { ok: false, error: 'Registration would close before it opens — check the two times.' };
  }

  const supabase = await createClient();
  const patch = {
    published: status === 'published',
    registration_opens_at: opensAt || null,
    registration_closes_at: closesAt || null,
    archived_at: null,
  };
  // The archive mark (0099). The date it was first set is kept: re-saving an
  // archived event does not move it.
  if (status === 'archived') {
    const { data: cur, error: curError } = await supabase
      .from('events')
      .select('archived_at')
      .eq('id', eventId)
      .maybeSingle();
    if (curError) {
      console.error('updateEventRegistration (read archived_at):', curError.message);
      return { ok: false, error: 'Could not save. Please try again.' };
    }
    if (!cur) return { ok: false, error: 'That event was not found.' };
    patch.archived_at = cur.archived_at ?? new Date().toISOString();
  }
  const { error } = await supabase
    .from('events')
    .update(patch)
    .eq('id', eventId);

  if (error) {
    console.error('updateEventRegistration:', error.message);
    return { ok: false, error: 'Could not save. Please try again.' };
  }

  // Every public surface that lists open events re-renders with the change.
  revalidatePath('/admin/setup');
  revalidatePath('/register');
  revalidatePath('/register/family');
  revalidatePath('/admin');
  return { ok: true };
}

// The facts of the event itself: when it runs, how many can come, what it
// costs. All three were readable on this page and editable only by me, which
// is not a workable arrangement for a ministry that has to change a date
// (asked for 25 Aug). Registration windows already lived here; these are the
// numbers underneath them.
//
// The FEE is not on the event: it lives on the published event_option, which
// is what registration_participants copies and what every balance is built
// from. A RAISE changes what the NEXT registration is charged and leaves every
// existing participant's fee where it was: they keep what they signed up at.
// A CUT reaches everyone already registered too (Lawrence, 29 Oct 2026,
// lower_registered_fees(), 0145), except anyone whose scholarship and
// hand-set discount add up to more than the new price -- staff adjust those
// first. Any other re-pricing is the adjustments editor, per person.
export async function updateEventDetails(
  eventId,
  {
    startsOn, endsOn, capacity, feeDollars, earlyEndsOn, earlyDollars,
    // 0096: the due date and the two discounts, as settings.
    balanceDueOn, familyDollars, familyFromPerson, multiWeekPercent,
    // 0123: the returned bank payment fee.
    returnedFeeDollars,
    // The deposit per person (29 Oct 2026; until then set only at creation).
    depositDollars,
  }
) {
  const staff = await getStaff();
  if (!can(staff, 'write:setup')) return { ok: false, error: 'Admins only.' };
  if (!eventId) return { ok: false, error: 'Missing event.' };

  if (!startsOn || !endsOn) return { ok: false, error: 'An event needs a start and an end date.' };
  if (endsOn < startsOn) {
    return { ok: false, error: 'The end date is before the start date — check the two.' };
  }

  let cap = null;
  if (String(capacity ?? '').trim() !== '') {
    cap = Number.parseInt(String(capacity).replace(/[^0-9-]/g, ''), 10);
    if (Number.isNaN(cap) || cap < 0) {
      return { ok: false, error: 'Capacity has to be a whole number, or blank for no limit.' };
    }
  }

  const supabase = await createClient();

  // Refuse to set a capacity BELOW the people already registered. The number
  // would be immediately false, and the roster is the thing that is true.
  if (cap != null) {
    const { count, error: countError } = await supabase
      .from('registration_participants')
      .select('id, registrations!inner ( event_id )', { count: 'exact', head: true })
      .eq('registrations.event_id', eventId)
      .neq('status', 'cancelled');
    if (countError) return { ok: false, error: `The people registered could not be counted: ${countError.message}` };
    if ((count ?? 0) > cap) {
      return {
        ok: false,
        error: `${count} people are already registered for this event, so the capacity cannot be set to ${cap}. Cancel places first, or set a higher number.`,
      };
    }
  }

  // Early registration (0080): a last day and a per-person amount. Blank
  // amount = no early discount. The date must fall before the event starts.
  let earlyCents = 0;
  if (String(earlyDollars ?? '').trim() !== '') {
    const n = Number.parseFloat(String(earlyDollars).replace(/[$,\s]/g, ''));
    if (Number.isNaN(n) || n < 0) {
      return { ok: false, error: 'The early-registration discount has to be a dollar amount, or blank.' };
    }
    earlyCents = Math.round(n * 100);
  }
  if (earlyCents > 0 && !earlyEndsOn) {
    return { ok: false, error: 'Give the early-registration discount a last day, or clear the amount.' };
  }
  if (earlyEndsOn && earlyEndsOn >= startsOn) {
    return { ok: false, error: 'Early registration has to end before the event starts.' };
  }

  // The money settings (0096). Blank due date = "staff will be in touch".
  const dueOn = String(balanceDueOn ?? '').trim() || null;
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
    return { ok: false, error: 'The balance-due date is not a date.' };
  }
  let familyCents = 0;
  if (String(familyDollars ?? '').trim() !== '') {
    const n = Number.parseFloat(String(familyDollars).replace(/[$,\s]/g, ''));
    if (Number.isNaN(n) || n < 0) return { ok: false, error: 'The family discount is not an amount.' };
    familyCents = Math.round(n * 100);
  }
  let fromPerson = 3;
  if (String(familyFromPerson ?? '').trim() !== '') {
    fromPerson = Number.parseInt(String(familyFromPerson).replace(/[^0-9]/g, ''), 10);
    if (!Number.isInteger(fromPerson) || fromPerson < 2) {
      return { ok: false, error: 'The family discount starts from the 2nd person at the earliest.' };
    }
  }
  // The both-weeks discount is set on a camp's later week only, where it
  // applies (Lawrence, 27 Oct 2026); an earlier week's form does not send it
  // (undefined), and its stored figure is left alone. Blank is not zero
  // (18 Oct review: an emptied box silently saved 0%).
  let pct;
  if (multiWeekPercent !== undefined) {
    if (String(multiWeekPercent ?? '').trim() === '') {
      return { ok: false, error: 'Give the both-weeks discount as a percentage — 0 for none.' };
    }
    pct = Number.parseInt(String(multiWeekPercent).replace(/[^0-9]/g, ''), 10);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
      return { ok: false, error: 'The both-weeks discount is a percentage from 0 to 100.' };
    }
  }

  // 0123: the returned bank payment fee. Blank is not zero (the 18 Oct
  // lesson above): say 0 to switch it off.
  if (String(returnedFeeDollars ?? '').trim() === '') {
    return { ok: false, error: 'Give the returned bank payment fee in dollars — 0 for none.' };
  }
  const feeN = Number.parseFloat(String(returnedFeeDollars).replace(/[$,\s]/g, ''));
  if (Number.isNaN(feeN) || feeN < 0) {
    return { ok: false, error: 'The returned bank payment fee has to be a dollar amount, or 0.' };
  }
  const returnedFeeCents = Math.round(feeN * 100);

  // The deposit per person (Lawrence, 29 Oct 2026: it could be set only when
  // the event was created). It is read live -- "deposit received" is always
  // the event's current figure -- so a change applies to everyone registered.
  // Blank is not zero: say 0 for no deposit. Never more than the price.
  if (String(depositDollars ?? '').trim() === '') {
    return { ok: false, error: 'Give the deposit per person in dollars — 0 for none.' };
  }
  const depN = Number.parseFloat(String(depositDollars).replace(/[$,\s]/g, ''));
  if (Number.isNaN(depN) || depN < 0) {
    return { ok: false, error: 'The deposit has to be a dollar amount, or 0.' };
  }
  const depositCents = Math.round(depN * 100);
  const priceN = String(feeDollars ?? '').trim() === '' ? null : Number.parseFloat(String(feeDollars).replace(/[$,\s]/g, ''));
  if (priceN != null && !Number.isNaN(priceN) && depositCents > Math.round(priceN * 100)) {
    return { ok: false, error: 'The deposit cannot be more than the price.' };
  }

  // The settings a later week takes from this one (0137). Dates are each
  // week's own; the both-weeks discount is the later week's.
  const shared = {
    capacity: cap,
    early_registration_ends_on: earlyEndsOn || null,
    early_registration_discount_cents: earlyCents,
    balance_due_on: dueOn,
    family_discount_cents: familyCents,
    family_discount_from_person: fromPerson,
    returned_payment_fee_cents: returnedFeeCents,
    deposit_cents: depositCents,
  };
  const { error } = await supabase
    .from('events')
    .update({
      starts_on: startsOn,
      ends_on: endsOn,
      ...shared,
      ...(pct !== undefined ? { multi_week_discount_percent: pct } : {}),
      // Saved by hand: a later week stops following its earlier week (0137).
      details_set_by_hand_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId);
  if (error) {
    console.error('updateEventDetails:', error.message);
    return { ok: false, error: 'Could not save the event. Please try again.' };
  }
  // A changed discount applies to everyone already registered -- it is a rule
  // recomputed from stored facts (0070, 0081), not a price copied at sign-up.
  // Never fatal: the settings have saved, and a stale discount is a visible
  // number an administrator can re-run.
  try {
    const { error: recalcError } = await supabase.rpc('recalc_event_discounts', { p_event_id: eventId });
    if (recalcError) console.error('recalc_event_discounts:', recalcError.message);
  } catch (e) {
    console.error('recalc_event_discounts:', e?.message);
  }

  let priceCents = null;
  const priceNotes = [];
  if (String(feeDollars ?? '').trim() !== '') {
    const n = Number.parseFloat(String(feeDollars).replace(/[$,\s]/g, ''));
    if (Number.isNaN(n) || n < 0) {
      return { ok: false, error: 'The dates and capacity saved, but the price is not a number.' };
    }
    const cents = Math.round(n * 100);
    priceCents = cents;
    const { data: opt, error: optError } = await supabase
      .from('event_options')
      .select('id')
      .eq('event_id', eventId)
      .eq('published', true)
      // The ENROLLMENT option only. Without this, "the first published option"
      // could be 0069's zero-fee volunteer row, and saving a price here would
      // quietly charge volunteers and leave the camp fee unchanged.
      .is('participant_role', null)
      .order('sort_order')
      .limit(1)
      .maybeSingle();
    if (optError) {
      return { ok: false, error: `The dates and capacity saved, but the price could not be read: ${optError.message}` };
    }
    if (!opt) {
      return {
        ok: false,
        error: 'The dates and capacity saved, but this event has no published price to change.',
      };
    }
    const { error: feeError } = await supabase
      .from('event_options')
      .update({ fee_cents: cents, updated_at: new Date().toISOString() })
      .eq('id', opt.id);
    if (feeError) {
      return { ok: false, error: `The dates saved, but the price did not: ${feeError.message}` };
    }
    const cut = await lowerRegisteredFees(supabase, opt.id);
    if (cut.error) return { ok: false, error: `The price saved, but ${cut.error}` };
    priceNotes.push(...cut.notes);
  }

  // Week 1's details are the later weeks' defaults (Lawrence, 27 Oct 2026):
  // copied to each later week of the same camp that has never been saved by
  // hand. The weeks of a camp share the part of the name before " — ", the
  // pairing recalc_multi_week_discount() uses. A week with more people
  // registered than the places copied keeps its own places, and says so.
  const copiedTo = [];
  const kept = [];
  const { data: me, error: meError } = await supabase.from('events').select('name').eq('id', eventId).maybeSingle();
  if (meError) {
    return { ok: false, error: `The event saved, but its later weeks could not be checked: ${meError.message}` };
  }
  const name = String(me?.name ?? '');
  if (name.includes(' — ')) {
    const program = name.split(' — ')[0].trim();
    // LIKE wildcards in a camp's name are matched literally.
    const like = `${program.replace(/[\\%_]/g, (c) => `\\${c}`)} — %`;
    const { data: later, error: laterError } = await supabase
      .from('events')
      .select('id, name')
      .like('name', like)
      .gt('starts_on', startsOn)
      .is('details_set_by_hand_at', null);
    if (laterError) {
      return { ok: false, error: `The event saved, but its later weeks could not be read: ${laterError.message}` };
    }
    for (const w of later ?? []) {
      const theirs = { ...shared };
      if (cap != null) {
        const { count, error: countError } = await supabase
          .from('registration_participants')
          .select('id, registrations!inner ( event_id )', { count: 'exact', head: true })
          .eq('registrations.event_id', w.id)
          .neq('status', 'cancelled');
        if (countError) return { ok: false, error: `This week saved, but ${w.name} could not be checked: ${countError.message}` };
        if ((count ?? 0) > cap) {
          delete theirs.capacity;
          kept.push(`${w.name} kept its places (${count} already registered).`);
        }
      }
      const { error: copyError } = await supabase
        .from('events')
        .update({ ...theirs, updated_at: new Date().toISOString() })
        .eq('id', w.id);
      if (copyError) return { ok: false, error: `This week saved, but ${w.name} did not: ${copyError.message}` };
      if (priceCents != null) {
        // The enrollment option only, as above: never the volunteer row.
        const { data: theirOpts, error: priceError } = await supabase
          .from('event_options')
          .update({ fee_cents: priceCents, updated_at: new Date().toISOString() })
          .eq('event_id', w.id)
          .eq('published', true)
          .is('participant_role', null)
          .select('id');
        if (priceError) return { ok: false, error: `This week saved, but ${w.name}'s price did not: ${priceError.message}` };
        for (const o of theirOpts ?? []) {
          const cut = await lowerRegisteredFees(supabase, o.id);
          if (cut.error) return { ok: false, error: `${w.name}'s price saved, but ${cut.error}` };
          priceNotes.push(...cut.notes.map((n) => `${w.name}: ${n}`));
        }
      }
      try {
        const { error: recalcError } = await supabase.rpc('recalc_event_discounts', { p_event_id: w.id });
        if (recalcError) console.error('recalc_event_discounts:', recalcError.message);
      } catch (e) {
        console.error('recalc_event_discounts:', e?.message);
      }
      copiedTo.push(w.name);
    }
  }

  revalidatePath('/admin/setup');
  revalidatePath('/register');
  revalidatePath('/register/family');
  revalidatePath('/account/dashboard');
  return { ok: true, copiedTo, notCopied: [...kept, ...priceNotes].join(' ') || null };
}

// A price cut reaches the people already registered (0145); a raise reaches
// nobody, and the function changes nothing then. What it did comes back as
// sentences for the Setup notice: who came down, who was left alone because
// of a scholarship or discount, and who now holds a credit to refund.
async function lowerRegisteredFees(supabase, optionId) {
  const { data, error } = await supabase.rpc('lower_registered_fees', { p_option_id: optionId });
  if (error) return { error: `the people already registered were not re-priced: ${error.message}`, notes: [] };
  const notes = [];
  const n = (k) => Number(data?.[k] ?? 0);
  if (n('lowered') > 0) {
    notes.push(`The lower price now applies to ${n('lowered')} ${n('lowered') === 1 ? 'person' : 'people'} already registered.`);
  }
  if (n('skipped') > 0) {
    notes.push(
      `${n('skipped')} kept the old price: their scholarship and discount add up to more than the new one. Adjust them on the registration, then save the price again.`
    );
  }
  if (n('overpaid') > 0) {
    notes.push(
      `${n('overpaid')} ${n('overpaid') === 1 ? 'registration has' : 'registrations have'} now paid more than ${n('overpaid') === 1 ? 'it owes' : 'they owe'}: refund the difference from the registration page.`
    );
  }
  return { notes };
}

// Create an event (2 Oct 2026). Until now every event was a migration, so a
// new camp week needed a developer. The work is one database function,
// admin_create_event (0083), so the event, its two price options, its
// agreements and -- when copying -- its activities and rooms all land in one
// transaction or not at all. A half-made event (no price, no agreements) would
// take registrations that sign nothing, which is worse than no event.
//
// Always created UNPUBLISHED. Setting its Event status to Published stays a
// separate, deliberate act.
const parseDollars = (v) => {
  const t = String(v ?? '').replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number.parseFloat(t);
  return Number.isNaN(n) || n < 0 ? Number.NaN : Math.round(n * 100);
};

export async function createEvent({
  name,
  eventType,
  startsOn,
  endsOn,
  feeDollars,
  depositDollars,
  capacity,
  location,
  copyFrom,
}) {
  const staff = await getStaff();
  if (!can(staff, 'write:setup')) return { ok: false, error: 'Admins only.' };

  const cleanName = String(name ?? '').trim();
  if (!cleanName) return { ok: false, error: 'Give the event a name.' };
  if (!['camp_week', 'retreat'].includes(eventType)) {
    return { ok: false, error: 'Choose Camp or Retreat.' };
  }
  if (!startsOn || !endsOn) return { ok: false, error: 'An event needs a first and a last day.' };
  if (endsOn < startsOn) {
    return { ok: false, error: 'The last day is before the first day — check the two.' };
  }

  const fee = parseDollars(feeDollars);
  if (fee == null || Number.isNaN(fee)) {
    return { ok: false, error: 'The price has to be a dollar amount (0 is allowed).' };
  }
  const deposit = parseDollars(depositDollars);
  if (Number.isNaN(deposit)) return { ok: false, error: 'The deposit has to be a dollar amount, or blank.' };
  if ((deposit ?? 0) > fee) return { ok: false, error: 'The deposit cannot be more than the price.' };

  let cap = null;
  if (String(capacity ?? '').trim() !== '') {
    cap = Number.parseInt(String(capacity).replace(/[^0-9-]/g, ''), 10);
    if (Number.isNaN(cap) || cap < 0) {
      return { ok: false, error: 'Places has to be a whole number, or blank for no limit.' };
    }
  }

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc('admin_create_event', {
    p_name: cleanName,
    p_event_type: eventType,
    p_starts_on: startsOn,
    p_ends_on: endsOn,
    p_fee_cents: fee,
    p_deposit_cents: deposit ?? 0,
    p_capacity: cap,
    p_location: String(location ?? '').trim() || null,
    p_copy_from: copyFrom || null,
  });
  if (error) {
    console.error('createEvent:', error.message);
    return { ok: false, error: `Could not create the event: ${error.message}` };
  }

  // The source's money settings come too (W70, 28 Oct 2026): admin_create_event
  // copies the description, agreements, activities and rooms, but not the
  // registration window, early registration, discounts, balance due or the
  // returned-payment fee, so a copied week opened with none of them. Every date
  // moves by the same number of days as the event itself. Setup write is what
  // the events policy asks, so this is an ordinary update as the staff member.
  // details_set_by_hand_at stays empty: a later week made here still takes
  // Week 1's details when Week 1 is saved (0137).
  let warning = null;
  if (copyFrom) {
    const { data: src, error: srcError } = await supabase
      .from('events')
      .select(
        'starts_on, registration_opens_at, registration_closes_at, early_registration_ends_on, early_registration_discount_cents, balance_due_on, family_discount_cents, family_discount_from_person, multi_week_discount_percent, returned_payment_fee_cents'
      )
      .eq('id', copyFrom)
      .maybeSingle();
    if (srcError || !src) {
      warning = `Created “${cleanName}”, but its money settings could not be read from the source (${srcError?.message ?? 'not found'}): set them on its card below.`;
    } else {
      const shift = Math.round((Date.parse(`${startsOn}T00:00:00Z`) - Date.parse(`${src.starts_on}T00:00:00Z`)) / 86400000);
      const moveDate = (iso) => {
        if (!iso) return null;
        const t = new Date(`${iso}T00:00:00Z`);
        t.setUTCDate(t.getUTCDate() + shift);
        return t.toISOString().slice(0, 10);
      };
      const moveMoment = (ts) => (ts ? new Date(Date.parse(ts) + shift * 86400000).toISOString() : null);
      const { error: copyError } = await supabase
        .from('events')
        .update({
          registration_opens_at: moveMoment(src.registration_opens_at),
          registration_closes_at: moveMoment(src.registration_closes_at),
          early_registration_ends_on: moveDate(src.early_registration_ends_on),
          early_registration_discount_cents: src.early_registration_discount_cents,
          balance_due_on: moveDate(src.balance_due_on),
          family_discount_cents: src.family_discount_cents,
          family_discount_from_person: src.family_discount_from_person,
          multi_week_discount_percent: src.multi_week_discount_percent,
          returned_payment_fee_cents: src.returned_payment_fee_cents,
        })
        .eq('id', id);
      if (copyError) {
        console.error('createEvent settings copy:', copyError.message);
        warning = `Created “${cleanName}”, but its money settings were not copied (${copyError.message}): set them on its card below.`;
      }
    }
  }

  revalidatePath('/admin/setup');
  revalidatePath('/admin', 'layout');
  return { ok: true, id, warning };
}
