import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depositOwedCents, firstPaymentCents, registrationDepositCents } from './payments.js';

const two = [
  { person_id: 'a', status: 'submitted' },
  { person_id: 'b', status: 'submitted' },
];

test('depositOwedCents: a granted scholarship pays toward the deposit first (0168)', () => {
  const base = { perPersonCents: 5000, participants: two, balanceCents: 99000 };
  assert.equal(registrationDepositCents(base), 10000);
  assert.equal(depositOwedCents(base), 10000);
  assert.equal(depositOwedCents({ ...base, scholarshipCents: 5000 }), 5000);
  assert.equal(depositOwedCents({ ...base, scholarshipCents: 20000 }), 0);
  // Never more than the balance.
  assert.equal(depositOwedCents({ ...base, balanceCents: 3000 }), 3000);
});

test('firstPaymentCents: the deposit owed, or the usual deposit once a scholarship covered it', () => {
  const base = { perPersonCents: 5000, participants: two, balanceCents: 99000 };
  assert.equal(firstPaymentCents({ ...base, scholarshipCents: 5000 }), 5000);
  assert.equal(firstPaymentCents({ ...base, scholarshipCents: 10000 }), 10000);
});
