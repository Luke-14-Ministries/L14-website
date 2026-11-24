// Run with: npm run test:lib   (node --test, no packages needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailLooksValid, sortByAge } from './format.js';

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

test('sortByAge lists oldest first, no date of birth last, ties by first name', () => {
  const people = [
    { first_name: 'Cyril', date_of_birth: '2025-03-01' },
    { first_name: 'Victoria', date_of_birth: '1989-06-10' },
    { first_name: 'Nobody', date_of_birth: null },
    { first_name: 'Lawrence', date_of_birth: '1986-01-20' },
    { first_name: 'Ann', date_of_birth: '2025-03-01' },
  ];
  assert.deepEqual(sortByAge(people).map((p) => p.first_name), ['Lawrence', 'Victoria', 'Ann', 'Cyril', 'Nobody']);
  assert.equal(people[0].first_name, 'Cyril'); // the original is not reordered
});
