// Run with: npm run test:lib   (node --test, no packages needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, isFullPhone, splitExtension, telHref } from './phone.js';

test('formatPhone tidies a clean US number', () => {
  assert.equal(formatPhone('4232006158'), '(423) 200-6158');
  assert.equal(formatPhone('+1 (423) 200-6158'), '(423) 200-6158');
  assert.equal(formatPhone('14232006158'), '(423) 200-6158');
});

test('formatPhone keeps an extension and tidies the number', () => {
  assert.equal(formatPhone('423.555.0123 x12'), '(423) 555-0123 ext. 12');
  assert.equal(formatPhone('(423) 555-0123 ext 12'), '(423) 555-0123 ext. 12');
  assert.equal(formatPhone('423-555-0123, extension 7'), '(423) 555-0123 ext. 7');
  // Already tidy: unchanged.
  assert.equal(formatPhone('(423) 555-0123 ext. 12'), '(423) 555-0123 ext. 12');
});

test('formatPhone never mangles what it does not recognise', () => {
  assert.equal(formatPhone('555-1234'), '555-1234');
  assert.equal(formatPhone('+44 20 7946 0958'), '+44 20 7946 0958');
  assert.equal(formatPhone('ask Mum'), 'ask Mum');
  assert.equal(formatPhone(''), '');
});

test('isFullPhone ignores an extension', () => {
  assert.equal(isFullPhone('(423) 555-0123 ext 12'), true);
  assert.equal(isFullPhone('423.555.0123 x3'), true);
  assert.equal(isFullPhone('555-0123 x3'), false);
  assert.equal(isFullPhone('15551234567'), true);
});

test('splitExtension', () => {
  assert.deepEqual(splitExtension('(423) 555-0123 ext. 12'), { main: '(423) 555-0123', ext: '12' });
  assert.deepEqual(splitExtension('(423) 555-0123'), { main: '(423) 555-0123', ext: '' });
});

test('telHref dials the number, with the extension kept apart', () => {
  assert.equal(telHref('(423) 555-0123'), 'tel:+14235550123');
  assert.equal(telHref('(423) 555-0123 ext. 12'), 'tel:+14235550123;ext=12');
  assert.equal(telHref('423-555-0123 x7'), 'tel:+14235550123;ext=7');
  assert.equal(telHref('+44 20 7946 0958'), 'tel:+442079460958');
  assert.equal(telHref('555-1234'), 'tel:5551234');
  assert.equal(telHref(''), null);
  assert.equal(telHref(null), null);
});
