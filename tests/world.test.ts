import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AP_CAP, BUILDINGS, DAY, MINUTE, TERRAIN_IDS } from '../shared/data.ts';
import type { AnimalId, BuildingId, ItemId, Terrain } from '../shared/data.ts';
import type { ClientMsg, Player, Pos, ServerMsg, Tile } from '../shared/protocol.ts';
import { addItems, countOf, percent, structureDur } from '../shared/rules.ts';
import { GameError, World, tileKey } from '../server/world.ts';

const SIZE = 21;
const START = 1_000_000_000;
const SPAWN = { x: 10, y: 10 };
const NORTH = { x: 10, y: 9 };
const FOREST = { x: 11, y: 10 };
const MOUNTAIN = { x: 10, y: 11 };
const RIVER = { x: 9, y: 10 };
const PEAK = { x: 12, y: 12 };
const COAST = { x: 8, y: 12 };

// A grass map with one forest east of the spawn point, one mountain south of it, and one river west of it.
function setup(stored: Tile[] = []) {
  const clock = { now: START };
  const cells = new Uint8Array(SIZE * SIZE);
  const put = (pos: Pos, terrain: Terrain) => (cells[pos.y * SIZE + pos.x] = TERRAIN_IDS.indexOf(terrain));
  put(FOREST, 'forest');
  put(MOUNTAIN, 'mountain');
  put(RIVER, 'river');
  put(PEAK, 'peak');
  put(COAST, 'coast');
  const animals = new Map<string, AnimalId>();
  const store = { saveTile: () => {}, savePlayer: () => {} };
  const world = new World({ size: SIZE, cells, spawn: SPAWN }, stored, [], store, () => clock.now, {
    wildlife: (x, y) => animals.get(tileKey(x, y)) ?? null,
  });
  const a = world.createPlayer('a', 'Ann');
  const b = world.createPlayer('b', 'Bob');

  const pass = (ms: number) => {
    clock.now += ms;
    world.tick();
  };
  const state = (id: string) => {
    const msg = world.stateFor(id);
    assert.equal(msg.t, 'state');
    return msg as Extract<ServerMsg, { t: 'state' }>;
  };
  // Minutes until the player's action ends.
  const left = (id: string) => {
    const s = state(id);
    assert.ok(s.me.action, 'no action in progress');
    return (s.me.action.endAt - s.now) / MINUTE;
  };
  const grant = (p: Player, item: ItemId, qty: number, dur = 1) => addItems(p.inv, item, qty, dur, clock.now);
  const lay = (pos: Pos, item: ItemId, qty: number, dur = 1) => addItems(world.tile(pos.x, pos.y).ground, item, qty, dur, clock.now);
  const stand = (p: Player, pos: Pos) => Object.assign(p, pos);
  // Puts a finished building on a tile.
  const erect = (pos: Pos, type: BuildingId) => {
    const structure = { type, done: true, progress: BUILDINGS[type].minutes, log: {}, dur: 1, durAt: clock.now };
    world.tile(pos.x, pos.y).structure = structure;
    return structure;
  };
  // Puts a site on a tile.
  const site = (pos: Pos, type: BuildingId) => {
    const structure = { type, done: false, progress: 0, log: {}, dur: 1, durAt: clock.now };
    world.tile(pos.x, pos.y).structure = structure;
    return structure;
  };
  const act = (id: string, msg: ClientMsg) => world.act(id, msg);
  const refuses = (id: string, msg: ClientMsg) => assert.throws(() => world.act(id, msg), GameError);
  return { world, clock, a, b, animals, pass, state, left, grant, lay, stand, erect, site, act, refuses };
}

const at = (p: Player) => [p.x, p.y];
const pos = (p: Pos) => [p.x, p.y];

// --- REQ-003 玩家角色 ---

// REQ-003 條件 2
test('a new character gets the entered name and starts idle at the spawn point', () => {
  const { a, b } = setup();
  assert.equal(a.name, 'Ann');
  assert.deepEqual(at(a), pos(SPAWN));
  assert.deepEqual(at(b), pos(SPAWN));
  assert.equal(a.action, null);
});

test('a character needs a name of 1 to 16 characters', () => {
  const { world } = setup();
  assert.throws(() => world.createPlayer('c', '   '), GameError);
  assert.throws(() => world.createPlayer('c', 'x'.repeat(17)), GameError);
});

// REQ-003 條件 4, 5
test('an action takes real time, shows its state, and gives its result when the time is up, also for an offline player', () => {
  const { world, a, act, pass, state, left } = setup();
  assert.equal(world.online.size, 0);
  act('a', { t: 'move', ...NORTH });
  assert.deepEqual(at(a), pos(SPAWN));
  assert.equal(state('a').me.action?.kind, 'move');
  assert.equal(left('a'), 10);
  pass(9 * MINUTE);
  assert.deepEqual(at(a), pos(SPAWN));
  assert.equal(left('a'), 1);
  pass(1 * MINUTE);
  assert.deepEqual(at(a), pos(NORTH));
  assert.equal(state('a').me.action, null);
});

test('a character carries out one action at a time', () => {
  const { a, act, refuses, stand } = setup();
  stand(a, FOREST);
  act('a', { t: 'gather', item: 'wood', rounds: 1 });
  refuses('a', { t: 'gather', item: 'wood', rounds: 1 });
  refuses('a', { t: 'move', ...SPAWN });
});

// REQ-003 條件 6
test('gathering several rounds is one action that hands out everything at its end', () => {
  const { world, a, act, pass, state, stand } = setup();
  stand(a, FOREST);
  act('a', { t: 'gather', item: 'wood', rounds: 3 });
  assert.equal(state('a').me.action?.rounds, 3);
  assert.equal(world.tile(FOREST.x, FOREST.y).stocks.wood?.amount, 97);
  pass(29 * MINUTE);
  assert.equal(countOf(a.inv, 'wood'), 0);
  pass(1 * MINUTE);
  assert.equal(countOf(a.inv, 'wood'), 3);
  assert.equal(a.action, null);
  assert.equal(a.prof.chop, 30);
});

test('gathering is limited by the stock of the tile', () => {
  const { world, a, act, refuses, state, stand } = setup();
  stand(a, FOREST);
  world.tile(FOREST.x, FOREST.y).stocks.wood = { amount: 2, at: START };
  act('a', { t: 'gather', item: 'wood', rounds: 5 });
  assert.equal(state('a').me.action?.rounds, 2);
  act('a', { t: 'speed', ap: 20 });
  refuses('a', { t: 'gather', item: 'wood', rounds: 1 });
  refuses('a', { t: 'gather', item: 'hide' as 'wood', rounds: 1 });
});

test('crafting takes the materials of all rounds at its start', () => {
  const { a, act, pass, grant, erect } = setup();
  erect(SPAWN, 'workshop');
  grant(a, 'wood', 12);
  grant(a, 'stone', 10);
  act('a', { t: 'craft', item: 'axe', rounds: 2 });
  assert.equal(countOf(a.inv, 'wood'), 2);
  assert.equal(countOf(a.inv, 'stone'), 0);
  pass(59 * MINUTE);
  assert.equal(countOf(a.inv, 'axe'), 0);
  pass(1 * MINUTE);
  assert.equal(countOf(a.inv, 'axe'), 2);
  assert.equal(a.prof.craft, 60);
});

test('crafting is limited by the materials in the backpack', () => {
  const { a, act, refuses, state, grant, erect } = setup();
  erect(SPAWN, 'workshop');
  refuses('a', { t: 'craft', item: 'axe', rounds: 1 });
  grant(a, 'wood', 7);
  grant(a, 'stone', 5);
  act('a', { t: 'craft', item: 'axe', rounds: 5 });
  assert.equal(state('a').me.action?.rounds, 1);
});

test('products that do not fit the backpack stay on the ground of the tile', () => {
  const { a, act, pass, state, grant, stand } = setup();
  stand(a, FOREST);
  grant(a, 'wood', 49);
  act('a', { t: 'gather', item: 'wood', rounds: 3 });
  pass(30 * MINUTE);
  assert.equal(countOf(a.inv, 'wood'), 50);
  assert.equal(state('a').here.ground.wood?.qty, 2);
});

// REQ-003 條件 7
test('stopping a move leaves the character on the tile it has reached', () => {
  const { a, act, pass, state } = setup();
  act('a', { t: 'move', x: 10, y: 7 });
  pass(25 * MINUTE);
  act('a', { t: 'cancel' });
  assert.deepEqual(at(a), [10, 8]);
  assert.equal(state('a').me.action, null);
  pass(60 * MINUTE);
  assert.deepEqual(at(a), [10, 8]);
});

test('stopping a gathering gives the finished rounds and returns the rest to the tile', () => {
  const { world, a, act, pass, stand } = setup();
  stand(a, FOREST);
  act('a', { t: 'gather', item: 'wood', rounds: 5 });
  pass(25 * MINUTE);
  act('a', { t: 'cancel' });
  assert.equal(countOf(a.inv, 'wood'), 2);
  assert.equal(world.tile(FOREST.x, FOREST.y).stocks.wood?.amount, 98);
  assert.equal(a.prof.chop, 20);
});

test('stopping a crafting gives the finished rounds and returns the unused materials', () => {
  const { a, act, pass, grant, erect } = setup();
  erect(SPAWN, 'workshop');
  grant(a, 'wood', 10);
  grant(a, 'stone', 10);
  act('a', { t: 'craft', item: 'axe', rounds: 2 });
  pass(45 * MINUTE);
  act('a', { t: 'cancel' });
  assert.equal(countOf(a.inv, 'axe'), 1);
  assert.equal(countOf(a.inv, 'wood'), 5);
  assert.equal(countOf(a.inv, 'stone'), 5);
});

test('stopping a building action keeps the time already put into the site', () => {
  const { act, pass, state, site } = setup();
  site(SPAWN, 'road');
  act('a', { t: 'build', minutes: 30 });
  pass(10.5 * MINUTE);
  act('a', { t: 'cancel' });
  assert.equal(state('a').here.structure?.progress, 10);
  pass(60 * MINUTE);
  assert.equal(state('a').here.structure?.progress, 10);
});

test('there is nothing to stop while the character is idle', () => {
  const { refuses } = setup();
  refuses('a', { t: 'cancel' });
});

// REQ-003 條件 8
test('AP accumulates 1.5 per minute while idle and 1 per minute during an action, online or not', () => {
  const { a, act, pass, state, stand, clock } = setup();
  stand(a, FOREST);
  a.ap = 100;
  a.apAt = clock.now;
  pass(60 * MINUTE);
  assert.equal(state('a').me.ap, 190);
  act('a', { t: 'gather', item: 'wood', rounds: 6 });
  pass(60 * MINUTE);
  assert.equal(state('a').me.ap, 250);
  pass(10 * MINUTE);
  assert.equal(state('a').me.ap, 265);
});

test('AP is the same whether the action end is noticed at once or later', () => {
  const { a, act, pass, state, stand, clock } = setup();
  stand(a, FOREST);
  a.ap = 100;
  a.apAt = clock.now;
  act('a', { t: 'gather', item: 'wood', rounds: 2 });
  pass(60 * MINUTE);
  assert.equal(state('a').me.ap, 100 + 20 + 60);
});

test('AP stops at 10,000', () => {
  const { a, pass, state, clock } = setup();
  a.ap = AP_CAP - 10;
  a.apAt = clock.now;
  pass(DAY);
  assert.equal(state('a').me.ap, AP_CAP);
});

// REQ-003 條件 9
test('each AP spent shortens the action in progress by one minute', () => {
  const { a, act, left, stand, clock } = setup();
  stand(a, FOREST);
  a.ap = 100;
  a.apAt = clock.now;
  act('a', { t: 'gather', item: 'wood', rounds: 3 });
  act('a', { t: 'speed', ap: 10 });
  assert.equal(a.ap, 90);
  assert.equal(left('a'), 20);
  assert.equal(countOf(a.inv, 'wood'), 0);
});

test('spending AP equal to the minutes left finishes the action at once', () => {
  const { a, act, pass, state, stand, clock } = setup();
  stand(a, FOREST);
  a.ap = 100;
  a.apAt = clock.now;
  act('a', { t: 'gather', item: 'wood', rounds: 3 });
  pass(5 * MINUTE);
  act('a', { t: 'speed', ap: 25 });
  assert.equal(a.ap, 80);
  assert.equal(countOf(a.inv, 'wood'), 3);
  assert.equal(state('a').me.action, null);
});

test('speeding up never costs more AP than the minutes left', () => {
  const { a, act, stand, clock } = setup();
  stand(a, FOREST);
  a.ap = 100;
  a.apAt = clock.now;
  act('a', { t: 'gather', item: 'wood', rounds: 1 });
  act('a', { t: 'speed', ap: 500 });
  assert.equal(a.ap, 90);
  assert.equal(countOf(a.inv, 'wood'), 1);
});

test('speeding up needs the AP and an action in progress', () => {
  const { a, act, refuses, left, stand, clock } = setup();
  stand(a, FOREST);
  refuses('a', { t: 'speed', ap: 1 });
  a.ap = 5;
  a.apAt = clock.now;
  act('a', { t: 'gather', item: 'wood', rounds: 1 });
  refuses('a', { t: 'speed', ap: 10 });
  assert.equal(a.ap, 5);
  assert.equal(left('a'), 10);
});

test('a sped-up move walks the tiles of the skipped time', () => {
  const { a, act } = setup();
  act('a', { t: 'move', x: 10, y: 7 });
  act('a', { t: 'speed', ap: 20 });
  assert.deepEqual(at(a), [10, 8]);
  act('a', { t: 'speed', ap: 10 });
  assert.deepEqual(at(a), [10, 7]);
  assert.equal(a.action, null);
});

// REQ-003 條件 11
test('a move walks the route tile by tile to a destination in the view', () => {
  const { a, act, pass, state, left } = setup();
  act('a', { t: 'move', x: 10, y: 7 });
  assert.deepEqual(state('a').me.action?.dest, { x: 10, y: 7 });
  assert.equal(left('a'), 30);
  pass(10 * MINUTE);
  assert.deepEqual(at(a), [10, 9]);
  assert.equal(state('a').view[84].y, 9);
  pass(10 * MINUTE);
  assert.deepEqual(at(a), [10, 8]);
  pass(10 * MINUTE);
  assert.deepEqual(at(a), [10, 7]);
  assert.equal(a.prof.walk, 30);
});

test('a destination outside the view or on a tile that cannot be entered is refused', () => {
  const { refuses } = setup();
  refuses('a', { t: 'move', x: 10, y: 3 });
  refuses('a', { t: 'move', ...PEAK });
  refuses('a', { t: 'move', ...COAST });
  refuses('a', { t: 'move', ...SPAWN });
});

test('the time of a step comes from the tile left and the tile entered', () => {
  const { a, act, left, stand } = setup();
  act('a', { t: 'move', ...FOREST });
  assert.equal(left('a'), 10);
  act('a', { t: 'cancel' });
  stand(a, FOREST);
  act('a', { t: 'move', x: 12, y: 10 });
  assert.equal(left('a'), 12.5);
  act('a', { t: 'cancel' });
  stand(a, SPAWN);
  act('a', { t: 'move', ...RIVER });
  assert.equal(left('a'), 17.5);
  act('a', { t: 'cancel' });
  stand(a, RIVER);
  act('a', { t: 'move', x: 8, y: 10 });
  assert.equal(left('a'), 17.5);
});

// REQ-003 條件 12
test('an action adds to the proficiency of its attribute and a higher proficiency shortens it', () => {
  const { a, act, left, stand } = setup();
  stand(a, FOREST);
  a.prof.chop = 400;
  act('a', { t: 'gather', item: 'wood', rounds: 1 });
  assert.equal(left('a'), 9);
});

// --- REQ-002 世界地圖 ---

// REQ-002 條件 6
test('a player sees the 13x13 tiles around the character', () => {
  const { a, state, stand } = setup();
  const s = state('a');
  assert.equal(s.view.length, 169);
  assert.deepEqual(pos(s.view[0]), [4, 4]);
  assert.deepEqual(pos(s.view[84]), pos(SPAWN));
  assert.deepEqual(pos(s.view[168]), [16, 16]);
  stand(a, { x: 2, y: 10 });
  const edge = state('a');
  assert.deepEqual(pos(edge.view[84]), [2, 10]);
  assert.equal(edge.view[78].terrain, null);
  assert.equal(edge.view[82].terrain, 'grass');
});

// REQ-002 條件 7
test('each tile in view shows its terrain, its site or building, its wild animal, and its players', () => {
  const { world, b, animals, state, stand, erect, site } = setup();
  stand(b, FOREST);
  world.online.add('b');
  animals.set(tileKey(NORTH.x, NORTH.y), 'rabbit');
  erect(MOUNTAIN, 'road');
  site(RIVER, 'bridge');
  const view = state('a').view;
  const tile = (p: Pos) => view.find((t) => t.x === p.x && t.y === p.y)!;
  assert.equal(tile(FOREST).terrain, 'forest');
  assert.equal(tile(PEAK).terrain, 'peak');
  assert.deepEqual([tile(FOREST).online, tile(FOREST).offline], [1, 0]);
  assert.equal(tile(NORTH).animal, 'rabbit');
  assert.deepEqual(tile(MOUNTAIN).structure, { type: 'road', done: true, tint: 0 });
  assert.deepEqual(tile(RIVER).structure, { type: 'bridge', done: false, tint: 0 });
  world.online.delete('b');
  assert.deepEqual([tile(SPAWN).online, tile(SPAWN).offline], [0, 0]);
  const again = state('a').view.find((t) => t.x === FOREST.x && t.y === FOREST.y)!;
  assert.deepEqual([again.online, again.offline], [0, 1]);
});

// REQ-002 條件 8
test('the tile of the character shows resources, structure, wild animal, ground items, and the players with their state', () => {
  const { world, a, b, animals, act, state, stand, lay, grant, erect } = setup();
  stand(a, FOREST);
  stand(b, FOREST);
  world.online.add('a');
  lay(FOREST, 'stone', 4);
  animals.set(tileKey(FOREST.x, FOREST.y), 'wolf');
  act('b', { t: 'fight' });
  const here = state('a').here;
  assert.deepEqual(pos(here), pos(FOREST));
  assert.equal(here.terrain, 'forest');
  assert.deepEqual(here.resources, [
    { item: 'wood', available: true },
    { item: 'stone', available: true },
  ]);
  assert.equal(here.animal, 'wolf');
  assert.equal(here.ground.stone?.qty, 4);
  assert.deepEqual(here.players, [
    { name: 'Ann', online: true, action: null },
    { name: 'Bob', online: false, action: 'fight' },
  ]);
  stand(a, SPAWN);
  erect(SPAWN, 'workshop');
  grant(a, 'wood', 1);
  const home = state('a').here;
  assert.equal(home.structure?.type, 'workshop');
  assert.equal(home.players.length, 1);
});

// REQ-002 條件 5
test('every tile that can be entered has wood and stone: much of what its terrain is rich in, little of the rest', () => {
  const most = (where: Pos, item: 'wood' | 'stone') => {
    const { a, act, state, stand } = setup();
    stand(a, where);
    act('a', { t: 'gather', item, rounds: 500 });
    return state('a').me.action?.rounds;
  };
  assert.deepEqual([most(SPAWN, 'wood'), most(SPAWN, 'stone')], [10, 10]);
  assert.deepEqual([most(FOREST, 'wood'), most(FOREST, 'stone')], [100, 10]);
  assert.deepEqual([most(MOUNTAIN, 'wood'), most(MOUNTAIN, 'stone')], [10, 100]);
  assert.deepEqual([most(RIVER, 'wood'), most(RIVER, 'stone')], [10, 10]);
});

test('gathering one resource leaves the other resource of the tile untouched', () => {
  const { a, act, pass, state } = setup();
  act('a', { t: 'gather', item: 'wood', rounds: 10 });
  pass(100 * MINUTE);
  assert.equal(countOf(a.inv, 'wood'), 10);
  act('a', { t: 'gather', item: 'stone', rounds: 500 });
  assert.equal(state('a').me.action?.rounds, 10);
});

// REQ-002 條件 8
test('the tile shows whether each resource can be gathered now, and neither its stock nor its maximum', () => {
  const { act, refuses, pass, state } = setup();
  act('a', { t: 'gather', item: 'wood', rounds: 10 });
  act('a', { t: 'speed', ap: 100 });
  assert.deepEqual(state('a').here.resources, [
    { item: 'wood', available: false },
    { item: 'stone', available: true },
  ]);
  refuses('a', { t: 'gather', item: 'wood', rounds: 1 });
  // A resource the terrain is not rich in regenerates one every two hours.
  pass(119 * MINUTE);
  assert.equal(state('a').here.resources[0].available, false);
  pass(1 * MINUTE);
  assert.equal(state('a').here.resources[0].available, true);
});

test('a tile stored by version 0.2.0 keeps the stock of the resource its terrain is rich in', () => {
  const old = (p: Pos, stock: { amount: number; at: number } | null) =>
    ({ ...p, stock, structure: null, ground: {}, killed: null }) as unknown as Tile;
  const { a, act, state, stand } = setup([old(FOREST, { amount: 40, at: START }), old(SPAWN, null)]);
  act('a', { t: 'gather', item: 'wood', rounds: 500 });
  assert.equal(state('a').me.action?.rounds, 10);
  act('a', { t: 'cancel' });
  stand(a, FOREST);
  act('a', { t: 'gather', item: 'wood', rounds: 500 });
  assert.equal(state('a').me.action?.rounds, 40);
});

// --- REQ-004 建築 ---

// REQ-004 條件 1
test('a site needs all its materials on the ground of the tile and uses them up', () => {
  const { a, act, refuses, state, grant, lay } = setup();
  refuses('a', { t: 'place', building: 'road' });
  grant(a, 'stone', 10);
  refuses('a', { t: 'place', building: 'road' });
  lay(SPAWN, 'stone', 9);
  refuses('a', { t: 'place', building: 'road' });
  lay(SPAWN, 'stone', 3);
  act('a', { t: 'place', building: 'road' });
  const here = state('a').here;
  assert.deepEqual([here.structure?.type, here.structure?.done, here.structure?.progress], ['road', false, 0]);
  assert.equal(here.ground.stone?.qty, 2);
  assert.equal(countOf(a.inv, 'stone'), 10);
});

test('a tile holds one site or building', () => {
  const { refuses, lay, site } = setup();
  site(SPAWN, 'road');
  lay(SPAWN, 'stone', 50);
  lay(SPAWN, 'wood', 50);
  refuses('a', { t: 'place', building: 'road' });
  refuses('a', { t: 'place', building: 'workshop' });
});

test('a river takes only a bridge and a bridge goes only on a river', () => {
  const { a, act, refuses, state, stand, lay } = setup();
  lay(SPAWN, 'wood', 50);
  lay(SPAWN, 'stone', 50);
  refuses('a', { t: 'place', building: 'bridge' });
  stand(a, RIVER);
  lay(RIVER, 'wood', 50);
  lay(RIVER, 'stone', 50);
  refuses('a', { t: 'place', building: 'road' });
  act('a', { t: 'place', building: 'bridge' });
  assert.equal(state('a').here.structure?.type, 'bridge');
});

// REQ-004 條件 2, 3, 4, 5
test('players put building time into a site until it becomes a building at 100% durability', () => {
  const { clock, act, pass, state, site } = setup();
  site(SPAWN, 'road');
  act('a', { t: 'build', minutes: 20 });
  act('b', { t: 'build', minutes: 500 });
  pass(20 * MINUTE);
  const half = state('a').here.structure!;
  assert.deepEqual([half.progress, half.done], [40, false]);
  assert.equal(state('a').me.action, null);
  pass(20 * MINUTE);
  const done = state('a').here.structure!;
  assert.deepEqual([done.progress, done.done], [60, true]);
  assert.equal(percent(structureDur(done, clock.now)), 100);
  assert.deepEqual(done.log, { a: { name: 'Ann', minutes: 20 }, b: { name: 'Bob', minutes: 40 } });
  assert.equal(state('b').me.action, null);
});

test('time skipped with AP counts for the site', () => {
  const { act, state, site } = setup();
  site(SPAWN, 'road');
  act('a', { t: 'build', minutes: 60 });
  act('a', { t: 'speed', ap: 45 });
  assert.equal(state('a').here.structure?.progress, 45);
  act('a', { t: 'speed', ap: 15 });
  assert.equal(state('a').here.structure?.done, true);
});

test('a finished site ends the building actions of the other players', () => {
  const { act, pass, state, site } = setup();
  site(SPAWN, 'road');
  act('a', { t: 'build', minutes: 60 });
  act('b', { t: 'build', minutes: 60 });
  pass(30 * MINUTE);
  const done = state('a').here.structure!;
  assert.deepEqual([done.progress, done.done], [60, true]);
  pass(1000);
  assert.equal(state('a').me.action, null);
  assert.equal(state('b').me.action, null);
});

test('building needs a site', () => {
  const { refuses, erect } = setup();
  refuses('a', { t: 'build', minutes: 10 });
  erect(SPAWN, 'road');
  refuses('a', { t: 'build', minutes: 10 });
});

// REQ-004 條件 6, 7
test('a building loses durability over real time, changes colour on the map, and disappears at zero', () => {
  const { clock, pass, state, erect } = setup();
  erect(SPAWN, 'workshop');
  const shown = () => state('a').view[84].structure;
  assert.equal(shown()?.tint, 0);
  pass(10 * DAY);
  assert.equal(shown()?.tint, 1);
  assert.equal(percent(structureDur(state('a').here.structure!, clock.now)), 67);
  pass(15 * DAY);
  assert.equal(shown()?.tint, 2);
  pass(5 * DAY);
  assert.equal(shown(), null);
  assert.equal(state('a').here.structure, null);
});

test('a site does not wear out', () => {
  const { pass, state, site } = setup();
  site(SPAWN, 'road');
  pass(90 * DAY);
  assert.equal(state('a').here.structure?.type, 'road');
});

// REQ-004 條件 8
test('a repair takes its materials from the ground and restores 100% at once, without time or AP', () => {
  const { clock, a, act, refuses, pass, state, grant, lay, erect } = setup();
  erect(SPAWN, 'road');
  refuses('a', { t: 'repair' });
  pass(15 * DAY);
  grant(a, 'stone', 10);
  lay(SPAWN, 'stone', 4);
  refuses('a', { t: 'repair' });
  lay(SPAWN, 'stone', 2);
  const ap = state('a').me.ap;
  act('a', { t: 'repair' });
  const s = state('a');
  assert.equal(percent(structureDur(s.here.structure!, clock.now)), 100);
  assert.equal(s.here.ground.stone?.qty, 1);
  assert.equal(countOf(a.inv, 'stone'), 10);
  assert.equal(s.me.ap, ap);
  assert.equal(s.me.action, null);
});

test('a repair needs a building', () => {
  const { refuses, lay, site } = setup();
  lay(SPAWN, 'stone', 50);
  refuses('a', { t: 'repair' });
  site(SPAWN, 'road');
  refuses('a', { t: 'repair' });
});

// REQ-004 條件 9, 10
test('a road shortens the steps into and out of its tile by 20% for every player', () => {
  const { a, b, act, left, stand, erect } = setup();
  erect(NORTH, 'road');
  act('a', { t: 'move', ...NORTH });
  assert.equal(left('a'), 8);
  stand(b, NORTH);
  act('b', { t: 'move', ...SPAWN });
  assert.equal(left('b'), 8);
  act('a', { t: 'cancel' });
  erect(SPAWN, 'road');
  act('a', { t: 'move', ...NORTH });
  assert.equal(left('a'), 6.4);
});

test('a bridge removes the slowdown of its river tile', () => {
  const { a, act, left, stand, erect } = setup();
  erect(RIVER, 'bridge');
  act('a', { t: 'move', ...RIVER });
  assert.equal(left('a'), 10);
  act('a', { t: 'cancel' });
  stand(a, RIVER);
  act('a', { t: 'move', x: 8, y: 10 });
  assert.equal(left('a'), 10);
});

test('a workshop offers crafting tools and a campfire offers roasting meat, each on its own tile', () => {
  const { a, act, refuses, pass, grant, stand, erect, site } = setup();
  grant(a, 'wood', 5);
  grant(a, 'stone', 5);
  grant(a, 'rawMeat', 2);
  refuses('a', { t: 'craft', item: 'axe', rounds: 1 });
  refuses('a', { t: 'craft', item: 'roastMeat', rounds: 1 });
  refuses('a', { t: 'craft', item: 'wood', rounds: 1 });
  site(SPAWN, 'workshop');
  refuses('a', { t: 'craft', item: 'axe', rounds: 1 });
  erect(SPAWN, 'workshop');
  refuses('a', { t: 'craft', item: 'roastMeat', rounds: 1 });
  act('a', { t: 'craft', item: 'axe', rounds: 1 });
  pass(30 * MINUTE);
  assert.equal(countOf(a.inv, 'axe'), 1);
  stand(a, NORTH);
  erect(NORTH, 'campfire');
  refuses('a', { t: 'craft', item: 'axe', rounds: 1 });
  act('a', { t: 'craft', item: 'roastMeat', rounds: 2 });
  pass(10 * MINUTE);
  assert.equal(countOf(a.inv, 'roastMeat'), 2);
  assert.equal(countOf(a.inv, 'rawMeat'), 0);
});

test('a storehouse halves the durability loss of the items on the ground of its tile', () => {
  const { pass, state, stand, a, lay, erect, grant } = setup();
  const storehouse = erect(SPAWN, 'storehouse');
  lay(SPAWN, 'wood', 10);
  lay(NORTH, 'wood', 10);
  grant(a, 'wood', 10);
  pass(15 * DAY);
  storehouse.dur = 1;
  storehouse.durAt += 15 * DAY;
  assert.equal(state('a').here.ground.wood?.dur, 0.75);
  assert.equal(a.inv.wood?.dur, 0.5);
  stand(a, NORTH);
  assert.equal(state('a').here.ground.wood?.dur, 0.5);
});

test('items on the ground lose durability at the full rate again once the storehouse is gone', () => {
  const { pass, state, lay, erect } = setup();
  erect(SPAWN, 'storehouse');
  lay(SPAWN, 'wood', 10);
  pass(40 * DAY);
  // 30 days at half rate, then 10 days at the full rate.
  assert.equal(state('a').here.structure, null);
  assert.ok(Math.abs(state('a').here.ground.wood!.dur - (1 - 0.5 - 10 / 30)) < 1e-9);
});

// --- REQ-005 物品與背包 ---

// REQ-005 條件 1
test('holding a tool shortens the actions of its attribute', () => {
  const { a, act, left, grant, stand } = setup();
  stand(a, FOREST);
  grant(a, 'axe', 1);
  act('a', { t: 'gather', item: 'wood', rounds: 1 });
  assert.equal(left('a'), 8);
  act('a', { t: 'cancel' });
  stand(a, MOUNTAIN);
  act('a', { t: 'gather', item: 'stone', rounds: 1 });
  assert.equal(left('a'), 10);
});

// REQ-005 條件 2
test('gathering on a mountain gives stone', () => {
  const { a, act, pass, stand } = setup();
  stand(a, MOUNTAIN);
  act('a', { t: 'gather', item: 'stone', rounds: 2 });
  pass(20 * MINUTE);
  assert.equal(countOf(a.inv, 'stone'), 2);
  assert.equal(a.prof.mine, 20);
});

// REQ-005 條件 4
test('eating makes the character fed, and an action started while fed takes 10% less time', () => {
  const { clock, a, act, refuses, state, left, grant, stand } = setup();
  stand(a, FOREST);
  grant(a, 'roastMeat', 2);
  grant(a, 'rawMeat', 1);
  grant(a, 'wood', 1);
  refuses('a', { t: 'eat', item: 'wood' });
  act('a', { t: 'eat', item: 'roastMeat' });
  assert.equal(countOf(a.inv, 'roastMeat'), 1);
  assert.equal(state('a').me.fedUntil, clock.now + 120 * MINUTE);
  assert.equal(state('a').me.action, null);
  act('a', { t: 'gather', item: 'wood', rounds: 1 });
  assert.equal(left('a'), 9);
});

test('eating again while fed adds to the time left, by the kind of food', () => {
  const { clock, act, refuses, pass, state, grant, a } = setup();
  grant(a, 'roastMeat', 1);
  grant(a, 'rawMeat', 1);
  act('a', { t: 'eat', item: 'roastMeat' });
  pass(30 * MINUTE);
  act('a', { t: 'eat', item: 'rawMeat' });
  assert.equal(state('a').me.fedUntil, clock.now + (90 + 20) * MINUTE);
  refuses('a', { t: 'eat', item: 'rawMeat' });
});

test('an action started after the fed time ran out takes the full time', () => {
  const { a, act, pass, left, grant, stand } = setup();
  stand(a, FOREST);
  grant(a, 'rawMeat', 1);
  act('a', { t: 'eat', item: 'rawMeat' });
  pass(20 * MINUTE);
  act('a', { t: 'gather', item: 'wood', rounds: 1 });
  assert.equal(left('a'), 10);
});

// REQ-005 條件 5
test('the backpack holds a limited weight, and a pouch raises the limit', () => {
  const { a, act, refuses, lay, grant } = setup();
  lay(SPAWN, 'wood', 200);
  act('a', { t: 'pickup', item: 'wood', qty: 200 });
  assert.equal(countOf(a.inv, 'wood'), 50);
  refuses('a', { t: 'pickup', item: 'wood', qty: 1 });
  act('a', { t: 'drop', item: 'wood', qty: 2 });
  grant(a, 'pouch', 1);
  act('a', { t: 'pickup', item: 'wood', qty: 200 });
  assert.equal(countOf(a.inv, 'wood'), 98);
});

// REQ-005 條件 6
test('items put on the ground can be picked up by any player on the tile, without taking time', () => {
  const { a, b, act, refuses, state, grant, stand } = setup();
  grant(a, 'wood', 5);
  refuses('a', { t: 'drop', item: 'stone', qty: 1 });
  act('a', { t: 'drop', item: 'wood', qty: 9 });
  assert.equal(countOf(a.inv, 'wood'), 0);
  assert.equal(state('b').here.ground.wood?.qty, 5);
  act('b', { t: 'pickup', item: 'wood', qty: 3 });
  assert.equal(countOf(b.inv, 'wood'), 3);
  assert.equal(state('a').here.ground.wood?.qty, 2);
  assert.equal(state('b').me.action, null);
  stand(b, NORTH);
  refuses('b', { t: 'pickup', item: 'wood', qty: 1 });
});

test('items can be put down and picked up during an action', () => {
  const { a, act, grant, stand, lay } = setup();
  stand(a, FOREST);
  grant(a, 'stone', 2);
  lay(FOREST, 'hide', 1);
  act('a', { t: 'gather', item: 'wood', rounds: 1 });
  act('a', { t: 'drop', item: 'stone', qty: 2 });
  act('a', { t: 'pickup', item: 'hide', qty: 1 });
  assert.equal(countOf(a.inv, 'hide'), 1);
  assert.equal(a.action?.kind, 'gather');
});

// REQ-005 條件 7, 8
test('items lose durability in the backpack and on the ground and disappear at zero', () => {
  const { a, pass, state, grant, lay } = setup();
  grant(a, 'rawMeat', 2);
  grant(a, 'wood', 2);
  lay(SPAWN, 'rawMeat', 2);
  lay(SPAWN, 'stone', 2);
  pass(3.5 * DAY);
  const s = state('a');
  assert.equal(percent(s.me.inv.rawMeat!.dur), 50);
  assert.equal(percent(s.here.ground.rawMeat!.dur), 50);
  assert.equal(percent(s.me.inv.wood!.dur), 89);
  pass(3.5 * DAY);
  const later = state('a');
  assert.equal(later.me.inv.rawMeat, undefined);
  assert.equal(later.here.ground.rawMeat, undefined);
  assert.equal(later.here.ground.stone?.qty, 2);
  pass(23 * DAY);
  assert.equal(state('a').me.inv.wood, undefined);
});

test('picking up items merges them into the stack of the backpack', () => {
  const { a, act, grant, lay } = setup();
  grant(a, 'wood', 10, 0.5);
  lay(SPAWN, 'wood', 10, 1);
  act('a', { t: 'pickup', item: 'wood', qty: 10 });
  assert.equal(a.inv.wood?.qty, 20);
  assert.equal(a.inv.wood?.dur, 0.75);
});

test('materials returned by a stopped crafting keep the durability they had', () => {
  const { a, act, grant, erect } = setup();
  erect(SPAWN, 'campfire');
  grant(a, 'rawMeat', 4, 0.5);
  act('a', { t: 'craft', item: 'roastMeat', rounds: 4 });
  act('a', { t: 'cancel' });
  assert.equal(a.inv.rawMeat?.qty, 4);
  assert.equal(a.inv.rawMeat?.dur, 0.5);
});

// --- REQ-007 野生動物 ---

const key = (p: Pos) => tileKey(p.x, p.y);

// REQ-007 條件 1
test('a tile with a site or a building holds no wild animal', () => {
  const { animals, state, site, erect } = setup();
  animals.set(key(SPAWN), 'rat');
  animals.set(key(NORTH), 'rat');
  assert.equal(state('a').here.animal, 'rat');
  site(SPAWN, 'road');
  erect(NORTH, 'road');
  const s = state('a');
  assert.equal(s.here.animal, null);
  assert.equal(s.view.find((t) => t.x === NORTH.x && t.y === NORTH.y)?.animal, null);
});

// REQ-007 條件 3
test('a character on a tile with a wild animal cannot leave it', () => {
  const { a, animals, act, refuses } = setup();
  animals.set(key(SPAWN), 'rat');
  refuses('a', { t: 'move', ...NORTH });
  animals.delete(key(SPAWN));
  act('a', { t: 'move', ...NORTH });
  assert.equal(a.action?.kind, 'move');
});

test('a move ends on the tile where the character walks into a wild animal', () => {
  const { a, animals, act, pass, state } = setup();
  act('a', { t: 'move', x: 10, y: 7 });
  animals.set(key(NORTH), 'wolf');
  pass(10 * MINUTE);
  assert.deepEqual(at(a), pos(NORTH));
  assert.equal(state('a').me.action, null);
  pass(60 * MINUTE);
  assert.deepEqual(at(a), pos(NORTH));
});

test('the route avoids the tiles that hold a wild animal at departure, except the destination', () => {
  const { a, animals, act, pass, left } = setup();
  animals.set(key(NORTH), 'wolf');
  act('a', { t: 'move', x: 10, y: 8 });
  // East through the forest, north twice, then west: 10 + 12.5 + 10 + 10.
  assert.equal(left('a'), 42.5);
  pass(42.5 * MINUTE);
  assert.deepEqual(at(a), [10, 8]);
  act('a', { t: 'move', ...NORTH });
  pass(10 * MINUTE);
  assert.deepEqual(at(a), pos(NORTH));
});

// REQ-007 條件 4
test('a fight takes the time of the animal, then the animal is gone and the character has its drops', () => {
  const { a, animals, act, pass, state, left } = setup();
  animals.set(key(SPAWN), 'rabbit');
  act('a', { t: 'fight' });
  assert.equal(state('a').me.action?.animal, 'rabbit');
  assert.equal(left('a'), 5);
  pass(5 * MINUTE);
  assert.equal(countOf(a.inv, 'rawMeat'), 2);
  assert.equal(countOf(a.inv, 'hide'), 1);
  assert.equal(a.prof.fight, 5);
  assert.equal(state('a').here.animal, null);
  act('a', { t: 'move', ...NORTH });
});

test('a bigger animal takes longer and a spear shortens the fight', () => {
  const { a, b, animals, act, left, grant } = setup();
  animals.set(key(SPAWN), 'bear');
  act('a', { t: 'fight' });
  assert.equal(left('a'), 90);
  grant(b, 'spear', 1);
  act('b', { t: 'fight' });
  assert.equal(left('b'), 63);
});

test('defeating an animal ends the fights of the other players without drops', () => {
  const { a, b, animals, act, pass, state, grant } = setup();
  animals.set(key(SPAWN), 'wolf');
  grant(b, 'spear', 1);
  act('a', { t: 'fight' });
  act('b', { t: 'fight' });
  pass(21 * MINUTE);
  assert.equal(countOf(b.inv, 'rawMeat'), 3);
  pass(1000);
  assert.equal(state('a').me.action, null);
  pass(30 * MINUTE);
  assert.equal(countOf(a.inv, 'rawMeat'), 0);
  assert.equal(countOf(a.inv, 'hide'), 0);
});

test('a stopped fight gives no drops and leaves the animal', () => {
  const { a, animals, act, refuses, pass, state } = setup();
  animals.set(key(SPAWN), 'wolf');
  act('a', { t: 'fight' });
  pass(29 * MINUTE);
  act('a', { t: 'cancel' });
  assert.equal(countOf(a.inv, 'rawMeat'), 0);
  assert.equal(state('a').here.animal, 'wolf');
  refuses('a', { t: 'move', ...NORTH });
});

test('there is nothing to fight on a tile without a wild animal', () => {
  const { refuses } = setup();
  refuses('a', { t: 'fight' });
});

// REQ-007 條件 2
test('an animal in a fight stays until the fight ends', () => {
  const { a, animals, act, refuses, pass, state } = setup();
  animals.set(key(SPAWN), 'bear');
  act('a', { t: 'fight' });
  animals.delete(key(SPAWN));
  assert.equal(state('b').here.animal, 'bear');
  refuses('b', { t: 'move', ...NORTH });
  pass(90 * MINUTE);
  assert.equal(countOf(a.inv, 'rawMeat'), 8);
  assert.equal(state('b').here.animal, null);
});

test('a defeated animal does not come back in the same period', () => {
  const { animals, act, pass, state } = setup();
  animals.set(key(SPAWN), 'rat');
  act('a', { t: 'fight' });
  pass(3 * MINUTE);
  assert.equal(state('a').here.animal, null);
  pass(10 * DAY);
  assert.equal(state('a').here.animal, 'rat');
});
