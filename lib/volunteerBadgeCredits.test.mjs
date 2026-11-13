// Run with: npm run test:lib   (node --test, no packages needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditShortfall, creditsFree, creditPicture } from './volunteerBadgeCredits.js';

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
  assert.match(seen.or, /^status\.in\.\(sending,invited,applied\),and\(status\.in\.\(cancelled,superseded\),vb_application_id\.not\.is\.null,or\(apply_expires_at\.is\.null,apply_expires_at\.gt\./);
  assert.deepEqual(seen.neq, ['id', 'r1']);
});
