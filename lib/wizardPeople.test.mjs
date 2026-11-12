// Run with: npm run test:lib   (node --test, no packages needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameName, selfRowIndex, duplicatePeople } from './wizardPeople.js';

const row = (firstName, lastName, personId = null) => ({ firstName, lastName, personId });

test('sameName ignores case and spacing, and needs both names', () => {
  assert.ok(sameName(row('Laurie ', 'Testfamily'), row('laurie', ' testfamily')));
  assert.ok(sameName(row('Mary  Ann', 'Lee'), row('Mary Ann', 'Lee')));
  assert.ok(!sameName(row('Laurie', ''), row('Laurie', '')));
  assert.ok(!sameName(row('Laurie', 'A'), row('Laura', 'A')));
});

test('selfRowIndex finds the contact by saved person even after the name changes', () => {
  const members = [row('Jon', 'Testfamily', 'p2'), row('Lauren', 'Testfamily', 'p1')];
  // The contact's first name was edited in "Your family": the name no longer
  // matches, the saved person still does.
  assert.equal(selfRowIndex(members, { contactFirst: 'Laurie', contactLast: 'Testfamily' }, 'p1'), 1);
});

test('selfRowIndex falls back to the name when there is no saved person', () => {
  const members = [row('Jon', 'Testfamily'), row('Laurie', 'Testfamily')];
  assert.equal(selfRowIndex(members, { contactFirst: 'laurie', contactLast: 'TESTFAMILY' }, null), 1);
  assert.equal(selfRowIndex(members, { contactFirst: 'Pat', contactLast: 'Testfamily' }, null), -1);
  // A contact id with no matching row still tries the name.
  assert.equal(selfRowIndex(members, { contactFirst: 'Laurie', contactLast: 'Testfamily' }, 'p9'), 1);
});

test('selfRowIndex finds the card the tick added, with no saved household', () => {
  const members = [{ ...row('Laurie', 'Testfamily'), isContact: true }, row('Jon', 'Testfamily')];
  // The contact's name was edited after the tick.
  assert.equal(selfRowIndex(members, { contactFirst: 'Laura', contactLast: 'Testfamily' }, null), 0);
});

test('duplicatePeople finds the same name twice', () => {
  const members = [row('Laurie', 'Testfamily', 'p1'), row('Jon', 'Testfamily', 'p2'), row('laurie', 'testfamily')];
  assert.deepEqual(duplicatePeople(members), [{ name: 'Laurie Testfamily', indexes: [0, 2] }]);
});

test('duplicatePeople finds the same saved person under two spellings', () => {
  const members = [row('Lauren', 'Testfamily', 'p1'), row('Laurie', 'Testfamily', 'p1')];
  assert.deepEqual(duplicatePeople(members), [{ name: 'Lauren Testfamily', indexes: [0, 1] }]);
});

test('duplicatePeople ignores blank and half-named rows, and different people', () => {
  const members = [row('', ''), row('', ''), row('Jon', ''), row('Jon', ''), row('Jon', 'A'), row('Jon', 'B')];
  assert.deepEqual(duplicatePeople(members), []);
});
