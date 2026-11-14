import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signatureOk, readSubmitted } from './volunteerBadgeWebhook.js';

const SECRET = 'whsec_test_only';
const sign = (body, secret = SECRET) => createHmac('sha256', secret).update(body, 'utf8').digest('hex');
const submitted = JSON.stringify({
  event: 'application.submitted',
  data: { applicationId: 'app_123', volunteerId: 'vol_456', templateId: 't1', submittedAt: '2026-11-14T18:00:00Z' },
  timestamp: '2026-11-14T18:00:01Z',
});

test('signatureOk: only the body signed with our secret passes', () => {
  assert.equal(signatureOk(submitted, sign(submitted), SECRET), true);
  assert.equal(signatureOk(submitted, `sha256=${sign(submitted).toUpperCase()}`, SECRET), true);
  assert.equal(signatureOk(`${submitted} `, sign(submitted), SECRET), false);
  assert.equal(signatureOk(submitted, sign(submitted, 'someone-else'), SECRET), false);
  assert.equal(signatureOk(submitted, 'abc', SECRET), false);
  assert.equal(signatureOk(submitted, null, SECRET), false);
  assert.equal(signatureOk(submitted, sign(submitted), ''), false);
});

test('readSubmitted: only application.submitted with both ids is used', () => {
  assert.deepEqual(readSubmitted(submitted, 'application.submitted'), { applicationId: 'app_123', volunteerId: 'vol_456' });
  assert.deepEqual(readSubmitted(submitted, null), { applicationId: 'app_123', volunteerId: 'vol_456' });
  assert.ok(readSubmitted(submitted, 'check.complete').ignore);
  assert.ok(readSubmitted(JSON.stringify({ event: 'check.complete', data: { checkId: 'c' } }), 'check.complete').ignore);
  assert.ok(readSubmitted(JSON.stringify({ event: 'application.submitted', data: { applicationId: 'app_1', volunteerId: null } }), null).ignore);
  assert.ok(readSubmitted(JSON.stringify({ event: 'application.submitted', data: { applicationId: 'a b', volunteerId: 'v' } }), null).ignore);
  assert.ok(readSubmitted('not json', null).ignore);
});
