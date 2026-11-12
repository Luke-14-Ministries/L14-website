// Run with: npm run test:lib   (node --test, no packages needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allergenWords, allergySummary, supportPatch, supportProblems, emptySupport } from './support.js';

test('allergenWords names the medications beside the word (0164)', () => {
  const s = { has_allergies: true, allergens: ['peanut', 'medications'], allergy_medications: ' penicillin ' };
  assert.deepEqual(allergenWords(s), ['Peanut', 'Medications: penicillin']);
});

test('allergenWords still prints the bare word when no medications are named', () => {
  assert.deepEqual(allergenWords({ has_allergies: true, allergens: ['medications'] }), ['Medications']);
});

test('allergenWords keeps "Other: ..." and ignores the medications text when Medications is not ticked', () => {
  const s = { has_allergies: true, allergens: ['other'], allergy_other: 'dogs', allergy_medications: 'penicillin' };
  assert.deepEqual(allergenWords(s), ['Other: dogs']);
});

test('allergySummary carries the medications and the reaction', () => {
  const s = {
    has_allergies: true,
    allergens: ['medications'],
    allergy_medications: 'penicillin',
    allergy_detail: 'hives',
  };
  assert.equal(allergySummary(s), 'Medications: penicillin — hives');
});

test('supportProblems asks which medications once Medications is ticked', () => {
  const base = { has_allergies: true, allergens: ['medications'], allergy_severity: 'severe' };
  assert.ok(supportProblems({ ...base, allergy_medications: '' }).includes('Which medications they are allergic to'));
  assert.ok(supportProblems({ ...base, allergy_medications: '   ' }).includes('Which medications they are allergic to'));
  assert.deepEqual(supportProblems({ ...base, allergy_medications: 'penicillin' }), []);
  // Not ticked: not asked.
  assert.deepEqual(
    supportProblems({ has_allergies: true, allergens: ['peanut'], allergy_severity: 'mild' }),
    []
  );
});

test('supportPatch saves the medications and clears them when the tick comes off', () => {
  const on = supportPatch({ has_allergies: true, allergens: ['medications'], allergy_medications: 'penicillin' });
  assert.equal(on.allergy_medications, 'penicillin');
  const off = supportPatch({ has_allergies: true, allergens: ['peanut'], allergy_medications: 'penicillin' });
  assert.equal(off.allergy_medications, null);
  const none = supportPatch({ has_allergies: false, allergens: ['medications'], allergy_medications: 'penicillin' });
  assert.equal(none.allergy_medications, null);
  assert.deepEqual(none.allergens, []);
});

test('emptySupport reads allergy_medications into the form', () => {
  assert.equal(emptySupport({ allergy_medications: 'penicillin' }).allergy_medications, 'penicillin');
  assert.equal(emptySupport(null).allergy_medications, '');
});
