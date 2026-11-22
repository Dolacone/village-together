import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AP_CAP, DAY, HOUR, MINUTE } from '../shared/data.ts';
import type { AnimalId, Inv, Terrain } from '../shared/data.ts';
import {
  actionMs,
  addItems,
  apNow,
  findPath,
  levelOf,
  passMults,
  percent,
  regenStock,
  repairCost,
  settleInv,
  skillMult,
  stackDur,
  takeItems,
  tintOf,
  wildlifeAt,
  wildlifePeriod,
} from '../shared/rules.ts';
import type { PathCell } from '../shared/rules.ts';

// REQ-003 條件 8
test('AP accumulates 1.5 per minute while idle and 1 per minute during an action', () => {
  assert.equal(apNow(100, 0, null, 60 * MINUTE), 190);
  assert.equal(apNow(100, 0, 60 * MINUTE, 60 * MINUTE), 160);
});

test('AP accumulates at the idle rate from the moment the action ends', () => {
  assert.equal(apNow(100, 0, 20 * MINUTE, 60 * MINUTE), 100 + 20 + 60);
});

test('AP stops at the cap of 10,000', () => {
  assert.equal(apNow(AP_CAP - 5, 0, null, DAY), AP_CAP);
  assert.equal(apNow(AP_CAP - 5, 0, DAY, DAY), AP_CAP);
});

// REQ-002 條件 5
test('resource stock regenerates over real time up to the maximum', () => {
  assert.deepEqual(regenStock(90, 0, 100, 2, 2 * HOUR), { amount: 94, at: 2 * HOUR });
  assert.equal(regenStock(90, 0, 100, 2, 100 * HOUR).amount, 100);
  assert.equal(regenStock(90, 0, 100, 2, 29 * MINUTE).amount, 90);
});

// REQ-003 條件 12
test('a higher proficiency shortens actions, down to half the time', () => {
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(400), 2);
  assert.equal(skillMult(0), 1);
  assert.equal(skillMult(400), 0.9);
  assert.equal(skillMult(1_000_000), 0.5);
  assert.equal(actionMs(10, skillMult(400)), 9 * MINUTE);
});

// REQ-002 條件 3
test('a forest slows leaving it by 25% and a river slows entering and leaving it by 75%', () => {
  assert.deepEqual(passMults('grass', null), { enter: 1, leave: 1 });
  assert.deepEqual(passMults('forest', null), { enter: 1, leave: 1.25 });
  assert.deepEqual(passMults('river', null), { enter: 1.75, leave: 1.75 });
});

// REQ-004 條件 10
test('a road shortens entering and leaving its tile by 20% and a bridge removes the river slowdown', () => {
  assert.deepEqual(passMults('grass', { type: 'road', done: true }), { enter: 0.8, leave: 0.8 });
  assert.deepEqual(passMults('forest', { type: 'road', done: true }), { enter: 0.8, leave: 1 });
  assert.deepEqual(passMults('river', { type: 'bridge', done: true }), { enter: 1, leave: 1 });
});

test('a site changes no movement time until it is finished', () => {
  assert.deepEqual(passMults('grass', { type: 'road', done: false }), { enter: 1, leave: 1 });
  assert.deepEqual(passMults('river', { type: 'bridge', done: false }), { enter: 1.75, leave: 1.75 });
});

// A grid of terrain letters: g grass, r river, x impassable, a grass with a wild animal.
function grid(rows: string[]) {
  return (x: number, y: number): PathCell | null => {
    const ch = rows[y]?.[x];
    if (!ch) return null;
    const terrain: Terrain = ch === 'r' ? 'river' : 'grass';
    return { ...passMults(terrain, null), passable: ch !== 'x', avoid: ch === 'a' };
  };
}

// REQ-003 條件 11
test('the route joins tiles by their sides and takes the least time', () => {
  const route = findPath(grid(['ggg', 'grg', 'ggg']), { x: 0, y: 1 }, { x: 2, y: 1 }, 6);
  // Straight through the river takes 1.75 + 1.75, around it takes 4 steps of 1.
  assert.deepEqual(route?.mults, [1.75, 1.75]);
  const wide = findPath(grid(['grg', 'grg', 'ggg']), { x: 0, y: 0 }, { x: 2, y: 0 }, 6);
  assert.deepEqual(wide?.mults, [1.75, 1.75]);
  const long = findPath(grid(['grrrg', 'ggggg']), { x: 0, y: 0 }, { x: 4, y: 0 }, 6);
  assert.deepEqual(long?.path, [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 0 },
  ]);
});

test('the route never crosses a tile that cannot be entered', () => {
  const route = findPath(grid(['gxg', 'gxg', 'ggg']), { x: 0, y: 0 }, { x: 2, y: 0 }, 6);
  assert.equal(route?.path.length, 6);
  assert.equal(findPath(grid(['gxg', 'gxg']), { x: 0, y: 0 }, { x: 2, y: 0 }, 6), null);
  assert.equal(findPath(grid(['gx']), { x: 0, y: 0 }, { x: 1, y: 0 }, 6), null);
});

test('the destination lies within the view', () => {
  const row = 'g'.repeat(10);
  assert.equal(findPath(grid([row]), { x: 0, y: 0 }, { x: 6, y: 0 }, 6)?.path.length, 6);
  assert.equal(findPath(grid([row]), { x: 0, y: 0 }, { x: 7, y: 0 }, 6), null);
});

// REQ-007 條件 3
test('the route goes around a tile with a wild animal unless that tile is the destination', () => {
  const around = findPath(grid(['gag', 'ggg']), { x: 0, y: 0 }, { x: 2, y: 0 }, 6);
  assert.deepEqual(around?.path, [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 0 },
  ]);
  assert.deepEqual(findPath(grid(['gag', 'ggg']), { x: 0, y: 0 }, { x: 1, y: 0 }, 6)?.path, [{ x: 1, y: 0 }]);
});

// REQ-005 條件 7
test('food lasts one week and materials and tools last one month', () => {
  const fresh = { qty: 1, dur: 1, at: 0 };
  assert.equal(stackDur('rawMeat', fresh, 3.5 * DAY), 0.5);
  assert.equal(stackDur('roastMeat', fresh, 7 * DAY), 0);
  assert.equal(stackDur('wood', fresh, 15 * DAY), 0.5);
  assert.equal(stackDur('axe', fresh, 30 * DAY), 0);
  assert.equal(stackDur('wood', fresh, 60 * DAY), 0);
});

test('an item at zero durability disappears', () => {
  const inv: Inv = { rawMeat: { qty: 3, dur: 1, at: 0 }, wood: { qty: 3, dur: 1, at: 0 } };
  settleInv(inv, 7 * DAY);
  assert.equal(inv.rawMeat, undefined);
  assert.equal(inv.wood?.qty, 3);
});

// REQ-005 條件 8
test('items of one kind form one stack with the quantity-weighted durability', () => {
  const inv: Inv = { wood: { qty: 10, dur: 0.5, at: 0 } };
  addItems(inv, 'wood', 30, 0.9, 0);
  assert.deepEqual(inv.wood, { qty: 40, dur: 0.8, at: 0 });
  assert.deepEqual(takeItems(inv, 'wood', 15), { qty: 15, dur: 0.8, at: 0 });
  assert.deepEqual(inv.wood, { qty: 25, dur: 0.8, at: 0 });
});

test('durability is shown as a whole percent', () => {
  assert.equal(percent(1), 100);
  assert.equal(percent(0.5), 50);
  assert.equal(percent(0.001), 1);
  assert.equal(percent(0), 0);
});

// REQ-004 條件 7
test('a building shows its own colour from 70%, ochre from 20%, and black below 20%', () => {
  assert.equal(tintOf(1), 0);
  assert.equal(tintOf(0.7), 0);
  assert.equal(tintOf(0.69), 1);
  assert.equal(tintOf(0.2), 1);
  assert.equal(tintOf(0.19), 2);
});

// REQ-004 條件 8
test('a repair needs the building materials times the share of durability used up', () => {
  assert.deepEqual(repairCost('storehouse', 0.5), { wood: 20, stone: 10 });
  assert.deepEqual(repairCost('road', 0.9), { stone: 1 });
  assert.deepEqual(repairCost('road', 0.75), { stone: 3 });
  assert.deepEqual(repairCost('road', 1), {});
});

// REQ-007 條件 1
function shares(terrain: Terrain) {
  const seen: Partial<Record<AnimalId, number>> = {};
  let total = 0;
  const side = 300;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const animal = wildlifeAt(7, x, y, terrain, 0);
      if (!animal) continue;
      seen[animal] = (seen[animal] ?? 0) + 1;
      total++;
    }
  }
  const share = Object.fromEntries(Object.entries(seen).map(([k, n]) => [k, Math.round((n / total) * 100)]));
  return { density: total / (side * side), share };
}

function near(actual: number | undefined, expected: number, slack: number) {
  assert.ok(actual !== undefined && Math.abs(actual - expected) <= slack, `${actual} is not within ${slack} of ${expected}`);
}

test('wild animals appear by the shares of their terrain', () => {
  const expected: [Terrain, [AnimalId, number][]][] = [
    ['grass', [['rat', 60], ['rabbit', 30], ['wolf', 10]]],
    ['forest', [['wolf', 60], ['spider', 30], ['bear', 10]]],
    ['waste', [['snake', 60], ['rat', 30], ['wolf', 10]]],
    ['mountain', [['goat', 60], ['wolf', 30], ['bear', 10]]],
  ];
  for (const [terrain, table] of expected) {
    const { share } = shares(terrain);
    assert.deepEqual(Object.keys(share).sort(), table.map(([animal]) => animal).sort());
    for (const [animal, pct] of table) near(share[animal], pct, 3);
  }
});

test('a river, the coast, and a high mountain hold no wild animal', () => {
  for (const terrain of ['river', 'coast', 'peak'] as const) assert.equal(shares(terrain).density, 0);
});

// REQ-007 條件 2
test('a wild animal that is not defeated leaves when its period ends', () => {
  let left = 0;
  let stayed = 0;
  for (let x = 0; x < 2000; x++) {
    if (!wildlifeAt(7, x, 0, 'grass', 0)) continue;
    if (wildlifeAt(7, x, 0, 'grass', 1)) stayed++;
    else left++;
  }
  assert.ok(left > stayed && left > 100);
});

test('tiles change wildlife period at different moments, each after the same length of time', () => {
  const firstChange = (x: number) => {
    const start = wildlifePeriod(7, x, 0, 0);
    let t = 0;
    while (wildlifePeriod(7, x, 0, t) === start) t += MINUTE;
    return t;
  };
  assert.notEqual(firstChange(1), firstChange(2));
  const t = firstChange(1);
  assert.equal(wildlifePeriod(7, 1, 0, t + 6 * HOUR - MINUTE), wildlifePeriod(7, 1, 0, t));
  assert.equal(wildlifePeriod(7, 1, 0, t + 6 * HOUR), wildlifePeriod(7, 1, 0, t) + 1);
});
