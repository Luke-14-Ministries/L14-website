// Run with: npm run test:lib   (node --test, no packages needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailLooksValid } from './format.js';

test('emailLooksValid passes real addresses, apostrophe, plus and a long TLD included', () => {
  assert.equal(emailLooksValid("o'brien+camp@example.museum"), true);
  assert.equal(emailLooksValid('a@b.co'), true);
  assert.equal(emailLooksValid('  family@example.org  '), true);
  assert.equal(emailLooksValid(''), true); // blank is required-ness, not format
});

test('emailLooksValid refuses the shapes that can name a second recipient (23 Nov 2026)', () => {
  assert.equal(emailLooksValid('Someone <someone@example.org>'), false);
  assert.equal(emailLooksValid('one@example.org,two@example.org'), false);
  assert.equal(emailLooksValid('"quoted"@example.org'), false);
  assert.equal(emailLooksValid('a;b@example.org'), false);
  assert.equal(emailLooksValid('a@[127.0.0.1]'), false);
  assert.equal(emailLooksValid('a\\b@example.org'), false);
  assert.equal(emailLooksValid('a(b)@example.org'), false);
  assert.equal(emailLooksValid('a:b@example.org'), false);
});

test('emailLooksValid still refuses the old wrong shapes', () => {
  assert.equal(emailLooksValid('no-at-sign.example.org'), false);
  assert.equal(emailLooksValid('a@b.c'), false);
  assert.equal(emailLooksValid('a b@example.org'), false);
});
