// Run with: npm run test:lib   (node --test, no packages needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrationOpen } from './events.js';

const ev = (over = {}) => ({
  published: true,
  archived_at: null,
  starts_on: '2027-07-19',
  ends_on: '2027-07-23',
  registration_opens_at: null,
  registration_closes_at: null,
  event_options: [{ id: 'o', fee_cents: 49500, published: true, participant_role: null }],
  ...over,
});

test('registrationOpen: a published event with no window is open until its last day (23 Nov 2026)', () => {
  // Noon in Morristown on the last day: still open.
  assert.equal(registrationOpen(ev(), new Date('2027-07-23T16:00:00Z')), true);
  // The next morning there: closed, though no close time was set.
  assert.equal(registrationOpen(ev(), new Date('2027-07-24T14:00:00Z')), false);
});

test('registrationOpen reads the last day on the ministry calendar, not UTC', () => {
  // 9 PM Morristown on the last day is already the next day in UTC.
  assert.equal(registrationOpen(ev(), new Date('2027-07-24T01:00:00Z')), true);
});

test('registrationOpen: unpublished, archived or no price is closed', () => {
  const now = new Date('2027-01-10T12:00:00Z');
  assert.equal(registrationOpen(ev({ published: false }), now), false);
  assert.equal(registrationOpen(ev({ archived_at: '2027-01-01T00:00:00Z' }), now), false);
  assert.equal(registrationOpen(ev({ event_options: [] }), now), false);
  assert.equal(registrationOpen(ev(), now), true);
});
