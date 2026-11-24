import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeFamilyEmail, REMINDER_KINDS } from './templates.js';
import { sampleAutomaticEmails, AUTOMATIC_EMAIL_GUIDE } from './guide.js';

// 23 Nov 2026 (review A4-14): a retreat family's emails say "the retreat"
// and "Our staff"; a camp week's, and an item with no event type, say "camp".
test('reminder wording follows the event type', () => {
  const one = (eventType) =>
    composeFamilyEmail({
      origin: 'https://example.org',
      householdName: 'Sample',
      items: [{ kind: 'deposit', eventType, eventName: 'X', depositCents: 5000, perPersonCents: 5000, heads: 1, registrationId: 'r' }],
    }).text;
  assert.match(one('camp_week'), /Camp staff approve/);
  assert.match(one(null), /Camp staff approve/);
  assert.match(one('retreat'), /Our staff approve/);
  assert.doesNotMatch(one('retreat'), /\bcamp\b/i);
});

test('the staff guide covers every family kind and renders each one', () => {
  assert.deepEqual(new Set(AUTOMATIC_EMAIL_GUIDE.map((g) => g.kind)), new Set(REMINDER_KINDS));
  for (const eventType of ['camp_week', 'retreat']) {
    const rows = sampleAutomaticEmails({ origin: 'https://example.org', eventType });
    for (const r of rows) {
      assert.ok(r.subject && r.text.includes('Hello Sample family'), r.kind);
      assert.ok(!r.text.includes('undefined'), `${r.kind} has a missing fact`);
    }
    if (eventType === 'retreat') {
      for (const r of rows) assert.doesNotMatch(r.text, /\bcamp\b/i, r.kind);
    }
  }
});
