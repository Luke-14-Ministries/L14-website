// Run with: npm run test:lib   (node --test, no packages needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditShortfall, creditsFree, creditPicture, countToCancelInVb, stillToCancelInVb } from './volunteerBadgeCredits.js';

test('no credits: refused in plain words, with what the batch needs', () => {
  assert.equal(
    creditShortfall({ credits: 0, outstanding: 0 }, 8),
    'VolunteerBadge has 0 credits. Buy credits in VolunteerBadge before sending invites (this batch needs 8).'
  );
  assert.equal(
    creditShortfall({ credits: 0, outstanding: 0 }, 1),
    'VolunteerBadge has 0 credits. Buy credits in VolunteerBadge before sending invites (this invite needs 1).'
  );
});

test('invites already out count against the balance', () => {
  assert.equal(creditShortfall({ credits: 10, outstanding: 7 }, 3), null);
  assert.match(creditShortfall({ credits: 10, outstanding: 8 }, 3), /needs 11: 3 to send now and 8 invites already out/);
  assert.match(creditShortfall({ credits: 1, outstanding: 1 }, 1), /1 invite already out that hasn’t been charged yet/);
});

test('an unknown balance is refused, never treated as enough', () => {
  assert.match(creditShortfall({ credits: null, outstanding: 0 }, 1), /didn’t say how many credits/);
  assert.equal(creditsFree({ credits: null, outstanding: 2 }), null);
  assert.equal(creditsFree({ credits: 3, outstanding: 5 }), 0);
  assert.equal(creditsFree({ credits: 9, outstanding: 5 }), 4);
});

test('creditPicture refuses an unknown count rather than reading it as zero', async () => {
  const q = { select: () => q, eq: () => q, or: () => q, neq: () => q, then: (res) => res({ count: null, error: null }) };
  await assert.rejects(creditPicture({ from: () => q }, { credits: async () => 5 }), /couldn’t be counted/);
});

test('creditPicture counts live invites not yet charged, leaving out the one being replaced', async () => {
  const seen = {};
  const q = {
    select: (_c, opts) => ((seen.head = opts?.head), q),
    eq: (k, v) => ((seen[k] = v), q),
    in: (k, v) => ((seen[k] = v), q),
    or: (f) => ((seen.or = f), q),
    neq: (k, v) => ((seen.neq = [k, v]), q),
    then: (res) => res({ count: 4, error: null }),
  };
  const supabase = { from: (t) => ((seen.table = t), q) };
  const api = { credits: async () => 12 };
  const p = await creditPicture(supabase, api, { replacing: 'r1' });
  assert.deepEqual(p, { credits: 12, outstanding: 4 });
  assert.equal(seen.table, 'volunteerbadge_requests');
  assert.equal(seen.sandbox, false);
  assert.match(seen.or, /^status\.in\.\(sending,invited,applied\),and\(status\.in\.\(cancelled,superseded\),vb_application_id\.not\.is\.null,vb_cancelled_at\.is\.null,or\(apply_expires_at\.is\.null,apply_expires_at\.gt\./);
  assert.deepEqual(seen.neq, ['id', 'r1']);
});

// 0187 (Lawrence, 25 Nov 2026): a taken-back or replaced invite that staff
// have marked cancelled in VolunteerBadge holds no credit, straight away.
test('a taken-back invite marked cancelled in VolunteerBadge stops holding a credit', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  const live = { status: 'cancelled', sandbox: false, vb_application_id: 'app1', vb_cancelled_at: null, apply_expires_at: '2026-11-30T00:00:00Z' };
  assert.equal(stillToCancelInVb(live, now), true);
  assert.equal(stillToCancelInVb({ ...live, status: 'superseded' }, now), true);
  assert.equal(stillToCancelInVb({ ...live, apply_expires_at: null }, now), true, 'no end date: held, to be safe');
  assert.equal(stillToCancelInVb({ ...live, vb_cancelled_at: '2026-11-25T11:00:00Z' }, now), false, 'marked cancelled in VB');
  assert.equal(stillToCancelInVb({ ...live, apply_expires_at: '2026-11-24T00:00:00Z' }, now), false, 'link already ran out');
  assert.equal(stillToCancelInVb({ ...live, vb_application_id: null }, now), false, 'never reached VB');
  assert.equal(stillToCancelInVb({ ...live, sandbox: true }, now), false, 'test mode');
  assert.equal(stillToCancelInVb({ ...live, status: 'invited' }, now), false, 'still open: take back first');
});

test('countToCancelInVb counts live taken-back invites not yet cancelled in VolunteerBadge', async () => {
  const seen = {};
  const q = {
    select: (_c, opts) => ((seen.head = opts?.head), q),
    eq: (k, v) => ((seen[k] = v), q),
    or: (f) => ((seen.or = f), q),
    then: (res) => res({ count: 2, error: null }),
  };
  assert.equal(await countToCancelInVb({ from: () => q }), 2);
  assert.equal(seen.head, true);
  assert.equal(seen.sandbox, false);
  assert.match(seen.or, /^and\(status\.in\.\(cancelled,superseded\),vb_application_id\.not\.is\.null,vb_cancelled_at\.is\.null,/);
  const bad = { select: () => bad, eq: () => bad, or: () => bad, then: (res) => res({ count: null, error: null }) };
  await assert.rejects(countToCancelInVb({ from: () => bad }), /couldn’t be counted/);
});
