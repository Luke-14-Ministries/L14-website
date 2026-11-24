// Run with: npm run test:lib   (node --test, no packages needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrationConfirmationEmail } from './email.js';
import { composeFamilyEmail } from './reminders/templates.js';

// emailShell() takes its title and body as raw HTML, so whatever the code did
// not write itself must arrive escaped (23 Nov 2026, security review).
const NASTY = '<b>&"';
const SAFE = '&lt;b&gt;&amp;&quot;';

test('registrationConfirmationEmail escapes the event name in the HTML', () => {
  const { html, subject } = registrationConfirmationEmail({
    origin: 'https://example.org',
    eventName: NASTY,
    saved: 1,
    isUpdate: false,
  });
  assert.ok(html.includes(SAFE), 'escaped name is in the body');
  assert.ok(!html.includes(NASTY), 'raw name is not');
  // The subject is plain text, not HTML: it keeps the name as typed.
  assert.equal(subject, `Registration received: ${NASTY}`);
});

test('composeFamilyEmail escapes the event name in the title and the body', () => {
  const one = composeFamilyEmail({
    origin: 'https://example.org',
    householdName: 'Sample',
    items: [{ kind: 'plan_finished', eventName: NASTY }],
  });
  assert.ok(!one.html.includes(NASTY), 'one item: raw name is not in the HTML');
  assert.ok(one.html.includes(`Paid in full: ${SAFE}`), 'one item: the title is escaped');

  const two = composeFamilyEmail({
    origin: 'https://example.org',
    householdName: 'Sample',
    items: [
      { kind: 'plan_finished', eventName: NASTY },
      { kind: 'plan_finished', eventName: NASTY },
    ],
  });
  assert.ok(!two.html.includes(NASTY), 'two items: raw name is not in the HTML');
  assert.ok(two.html.includes(`A few things for ${SAFE}`), 'two items: the shared title is escaped');
});
