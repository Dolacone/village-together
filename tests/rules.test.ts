import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AP_CAP } from '../shared/data.ts';
import { apCost, levelOf, regenAp, regenStock, skillMult } from '../shared/rules.ts';

const MIN = 60_000;
const HOUR = 3_600_000;

// REQ-003 條件 6
test('AP regenerates 1 per minute, also while nobody touches the character', () => {
  assert.deepEqual(regenAp(100, 0, 30 * MIN), { ap: 130, apAt: 30 * MIN });
});

test('AP regeneration keeps the unfinished part of the current minute', () => {
  const r = regenAp(100, 0, 2 * MIN + 59_000);
  assert.equal(r.ap, 102);
  assert.equal(regenAp(r.ap, r.apAt, 3 * MIN).ap, 103);
});

test('AP stops at the cap of 10,000, about seven days of regeneration', () => {
  assert.equal(AP_CAP, 10_000);
  assert.equal(regenAp(0, 0, 7 * 24 * 60 * MIN).ap, 10_000);
  assert.equal(regenAp(9_990, 0, 60 * MIN).ap, 10_000);
});

test('AP spent from a full pool starts regenerating from the moment it was spent', () => {
  const full = regenAp(AP_CAP, 0, 500 * MIN);
  assert.equal(regenAp(full.ap - 60, full.apAt, 500 * MIN + 30_000).ap, AP_CAP - 60);
  assert.equal(regenAp(full.ap - 60, full.apAt, 501 * MIN).ap, AP_CAP - 59);
});

// REQ-002 條件 3
test('resource stock regrows with real time up to its maximum', () => {
  assert.equal(regenStock(10, 0, 100, 2, HOUR).amount, 12);
  assert.equal(regenStock(10, 0, 100, 2, 20 * MIN).amount, 10);
  assert.equal(regenStock(99, 0, 100, 2, 10 * HOUR).amount, 100);
});

// REQ-003 條件 9
test('higher proficiency lowers the AP cost of that kind of action', () => {
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(100), 1);
  assert.equal(levelOf(399), 1);
  assert.equal(levelOf(400), 2);
  assert.equal(apCost(60, skillMult(0)), 60);
  assert.equal(apCost(60, skillMult(100)), 57);
  assert.ok(apCost(60, skillMult(400)) < apCost(60, skillMult(100)));
});

test('proficiency lowers a cost to half at most, and a cost stays at least 1 AP', () => {
  assert.equal(skillMult(10_000_000), 0.5);
  assert.equal(apCost(1, 0.5), 1);
});
