import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, MAP_SIZE, SPAWN, START_AP } from '../shared/data.ts';
import type { BuildingId, Terrain } from '../shared/data.ts';
import type { ServerMsg, Tile } from '../shared/protocol.ts';
import { generateMap } from '../server/mapgen.ts';
import { GameError, World, tileKey } from '../server/world.ts';

const MIN = 60_000;
const HOUR = 3_600_000;
const FOREST = { x: SPAWN.x + 1, y: SPAWN.y };
const MOUNTAIN = { x: SPAWN.x, y: SPAWN.y + 1 };

// A plain map with one forest east of the spawn point and one mountain south of it.
function setup() {
  const clock = { now: 0 };
  const tiles: Tile[] = [];
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      let terrain: Terrain = 'plain';
      if (x === FOREST.x && y === FOREST.y) terrain = 'forest';
      if (x === MOUNTAIN.x && y === MOUNTAIN.y) terrain = 'mountain';
      tiles.push({ x, y, terrain, stock: terrain === 'plain' ? null : { amount: 100, at: 0 }, structures: [] });
    }
  }
  const saved = { tiles: 0, players: 0 };
  const store = { saveTile: () => void saved.tiles++, savePlayer: () => void saved.players++ };
  const world = new World(tiles, [], store, () => clock.now);
  const a = world.createPlayer('a', 'Ann');
  const b = world.createPlayer('b', 'Bob');
  return { world, clock, a, b, saved };
}

function state(world: World, id: string) {
  const msg = world.stateFor(id);
  assert.equal(msg.t, 'state');
  return msg as Extract<ServerMsg, { t: 'state' }>;
}

// Builds a finished building on the player's tile by giving it everything it needs.
function finish(world: World, id: string, type: BuildingId) {
  const p = world.players.get(id)!;
  world.place(id, type);
  const tile = world.tiles.get(tileKey(p.x, p.y))!;
  const site = tile.structures.at(-1)!;
  site.mats = { ...BUILDINGS[type].mats };
  site.ap = BUILDINGS[type].ap;
  site.done = true;
  return site;
}

// REQ-003 條件 2
test('a new character gets the entered name and starts at the fixed spawn point', () => {
  const { a, b } = setup();
  assert.equal(a.name, 'Ann');
  assert.deepEqual([a.x, a.y], [SPAWN.x, SPAWN.y]);
  assert.deepEqual([b.x, b.y], [SPAWN.x, SPAWN.y]);
});

test('a character needs a name of 1 to 16 characters', () => {
  const { world } = setup();
  assert.throws(() => world.createPlayer('c', '   '), GameError);
  assert.throws(() => world.createPlayer('c', 'x'.repeat(17)), GameError);
});

// REQ-003 條件 5, 8
test('moving goes one tile in one of four directions and costs AP by terrain at once', () => {
  const { world, a } = setup();
  world.move('a', 'n');
  assert.deepEqual([a.x, a.y], [SPAWN.x, SPAWN.y - 1]);
  assert.equal(a.ap, START_AP - 12);
  world.move('a', 's');
  world.move('a', 'e');
  assert.deepEqual([a.x, a.y], [FOREST.x, FOREST.y]);
  assert.equal(a.ap, START_AP - 12 - 12 - 20);
  world.move('a', 'w');
  world.move('a', 's');
  assert.deepEqual([a.x, a.y], [MOUNTAIN.x, MOUNTAIN.y]);
  assert.equal(a.ap, START_AP - 12 - 12 - 20 - 12 - 40);
});

test('an action the character cannot pay for leaves the character unchanged', () => {
  const { world, a } = setup();
  a.ap = 11;
  assert.throws(() => world.move('a', 'n'), GameError);
  assert.deepEqual([a.x, a.y, a.ap], [SPAWN.x, SPAWN.y, 11]);
});

test('the map edge stops movement without costing AP', () => {
  const { world, a } = setup();
  a.x = 0;
  a.y = 0;
  assert.throws(() => world.move('a', 'w'), GameError);
  assert.throws(() => world.move('a', 'n'), GameError);
  assert.equal(a.ap, START_AP);
});

// REQ-005 條件 2, REQ-002 條件 3
test('gathering turns tile stock into backpack materials', () => {
  const { world, a } = setup();
  world.move('a', 'e');
  const before = a.ap;
  world.gather('a');
  assert.equal(a.inv.wood, 5);
  assert.equal(a.ap, before - 60);
  assert.deepEqual(state(world, 'a').here.stock, { item: 'wood', amount: 95, max: 100 });
});

test('a tile without resources offers nothing to gather', () => {
  const { world } = setup();
  assert.throws(() => world.gather('a'), GameError);
});

test('gathered stock regrows with real time', () => {
  const { world, clock } = setup();
  world.move('a', 'e');
  world.gather('a');
  clock.now += HOUR;
  assert.equal(state(world, 'a').here.stock?.amount, 97);
  clock.now += 100 * HOUR;
  assert.equal(state(world, 'a').here.stock?.amount, 100);
});

test('an exhausted tile gives nothing until it regrows', () => {
  const { world, a } = setup();
  world.move('a', 'e');
  world.tiles.get(tileKey(FOREST.x, FOREST.y))!.stock = { amount: 3, at: 0 };
  world.gather('a');
  assert.equal(a.inv.wood, 3);
  assert.throws(() => world.gather('a'), GameError);
});

// REQ-005 條件 4
test('the backpack holds 50 weight: gathering fills it and then stops', () => {
  const { world, a } = setup();
  world.move('a', 'e');
  a.inv = { wood: 47 };
  world.gather('a');
  assert.equal(a.inv.wood, 50);
  const ap = a.ap;
  assert.throws(() => world.gather('a'), GameError);
  assert.equal(a.ap, ap);
});

// REQ-003 條件 9
test('doing an action raises its attribute and makes the same action cheaper', () => {
  const { world, a } = setup();
  world.move('a', 'e');
  let ap = a.ap;
  world.gather('a');
  assert.equal(ap - a.ap, 60);
  world.gather('a');
  assert.equal(a.prof.chop, 120);
  ap = a.ap;
  world.gather('a');
  assert.equal(ap - a.ap, 57);
  assert.equal(a.prof.mine, 0);
});

// REQ-005 條件 1
test('holding a tool lowers the AP cost of its kind of action', () => {
  const { world, a } = setup();
  world.move('a', 'e');
  a.inv = { axe: 1 };
  const ap = a.ap;
  world.gather('a');
  assert.equal(ap - a.ap, 48);
});

// REQ-004 條件 1
test('placing a site is free, works on any tile, and a tile holds several sites', () => {
  const { world, a } = setup();
  world.place('a', 'workshop');
  world.place('a', 'road');
  world.move('a', 'e');
  const ap = a.ap;
  world.place('a', 'lumbercamp');
  assert.equal(a.ap, ap);
  assert.equal(world.tiles.get(tileKey(SPAWN.x, SPAWN.y))!.structures.length, 2);
  assert.equal(world.tiles.get(tileKey(FOREST.x, FOREST.y))!.structures[0].done, false);
});

// REQ-004 條件 2, 3, 4, 5
test('several players complete a site together and the log shows what each one gave', () => {
  const { world, a, b } = setup();
  world.place('a', 'road');
  const site = world.tiles.get(tileKey(SPAWN.x, SPAWN.y))!.structures[0];
  a.inv = { stone: 4 };
  b.inv = { stone: 20 };

  world.giveMat('a', site.id, 'stone', 99);
  assert.equal(site.mats.stone, 4);
  world.giveAp('a', site.id, 25);
  assert.equal(site.done, false);

  world.giveMat('b', site.id, 'stone', 99);
  assert.equal(site.mats.stone, 10);
  assert.equal(b.inv.stone, 14);
  world.giveAp('b', site.id, 999);
  assert.equal(site.ap, 60);
  assert.equal(site.done, true);

  assert.deepEqual(site.log, {
    a: { name: 'Ann', mats: { stone: 4 }, ap: 25 },
    b: { name: 'Bob', mats: { stone: 6 }, ap: 35 },
  });
  assert.equal(b.ap, START_AP - 1 - 35);
});

test('a site takes contributions only from players standing on its tile', () => {
  const { world, b } = setup();
  world.place('a', 'road');
  const site = world.tiles.get(tileKey(SPAWN.x, SPAWN.y))!.structures[0];
  world.move('b', 'n');
  b.inv = { stone: 10 };
  assert.throws(() => world.giveMat('b', site.id, 'stone', 10), GameError);
  assert.throws(() => world.giveAp('b', site.id, 10), GameError);
});

test('a finished building takes no further contributions', () => {
  const { world, a } = setup();
  const road = finish(world, 'a', 'road');
  a.inv = { stone: 10 };
  assert.throws(() => world.giveMat('a', road.id, 'stone', 1), GameError);
  assert.throws(() => world.giveAp('a', road.id, 1), GameError);
});

// REQ-004 條件 7, REQ-005 條件 3
test('a workshop unlocks crafting tools on its tile', () => {
  const { world, a } = setup();
  a.inv = { wood: 5, stone: 5 };
  assert.throws(() => world.craft('a', 'axe'), GameError);
  world.place('a', 'workshop');
  assert.throws(() => world.craft('a', 'axe'), GameError);
  world.tiles.get(tileKey(SPAWN.x, SPAWN.y))!.structures = [];
  finish(world, 'a', 'workshop');
  const ap = a.ap;
  world.craft('a', 'axe');
  assert.deepEqual(a.inv, { axe: 1 });
  assert.equal(ap - a.ap, 30);
  assert.throws(() => world.craft('a', 'axe'), GameError);
});

test('a lumber camp lowers the AP cost of chopping on its tile', () => {
  const { world, a } = setup();
  world.move('a', 'e');
  finish(world, 'a', 'lumbercamp');
  const ap = a.ap;
  world.gather('a');
  assert.equal(ap - a.ap, 42);
});

test('a storehouse lets one player store items and another take them out', () => {
  const { world, a, b } = setup();
  const store = finish(world, 'a', 'storehouse');
  a.inv = { wood: 30, axe: 1 };
  world.transfer('a', store.id, 'wood', 20, 'deposit');
  world.transfer('a', store.id, 'axe', 1, 'deposit');
  assert.deepEqual(a.inv, { wood: 10 });
  world.transfer('b', store.id, 'wood', 99, 'withdraw');
  world.transfer('b', store.id, 'axe', 1, 'withdraw');
  assert.deepEqual(b.inv, { wood: 20, axe: 1 });
  assert.deepEqual(store.storage, {});
  assert.throws(() => world.transfer('b', store.id, 'stone', 1, 'withdraw'), GameError);
});

test('a road lowers the AP cost of entering its tile', () => {
  const { world, a } = setup();
  world.move('a', 'e');
  finish(world, 'a', 'road');
  world.move('a', 'w');
  const ap = a.ap;
  world.move('a', 'e');
  assert.equal(ap - a.ap, 10);
});

// REQ-002 條件 4, 5, 6
test('the view is the 5x5 tiles centred on the character', () => {
  const { world } = setup();
  world.move('a', 'e');
  const { view, here } = state(world, 'a');
  assert.equal(view.length, 25);
  assert.deepEqual([view[12].x, view[12].y], [FOREST.x, FOREST.y]);
  assert.deepEqual([view[0].x, view[0].y], [FOREST.x - 2, FOREST.y - 2]);
  assert.deepEqual([view[24].x, view[24].y], [FOREST.x + 2, FOREST.y + 2]);
  assert.equal(view[12].terrain, 'forest');
  assert.deepEqual([here.x, here.y, here.terrain], [FOREST.x, FOREST.y, 'forest']);
});

test('a view tile shows its terrain, its feature building, and online and offline players', () => {
  const { world } = setup();
  world.createPlayer('c', 'Cat');
  world.online.add('a');
  world.online.add('b');
  world.place('a', 'workshop');
  world.move('a', 'e');
  let spawn = state(world, 'a').view[11];
  assert.deepEqual(
    [spawn.terrain, spawn.feature, spawn.online, spawn.offline],
    ['plain', 'site', 1, 1],
  );
  world.tiles.get(tileKey(SPAWN.x, SPAWN.y))!.structures = [];
  world.move('a', 'w');
  finish(world, 'a', 'workshop');
  finish(world, 'a', 'storehouse');
  world.move('a', 'e');
  spawn = state(world, 'a').view[11];
  assert.equal(spawn.feature, 'storehouse');
  assert.equal(state(world, 'a').view[12].online, 0);
});

test('the character tile lists structures and the players standing there', () => {
  const { world } = setup();
  world.online.add('a');
  world.place('a', 'road');
  const { here } = state(world, 'a');
  assert.equal(here.stock, null);
  assert.deepEqual(here.structures.map((s) => [s.type, s.done]), [['road', false]]);
  assert.deepEqual(here.players, [
    { name: 'Ann', online: true },
    { name: 'Bob', online: false },
  ]);
});

test('tiles beyond the map edge appear in the view as empty', () => {
  const { world, a } = setup();
  a.x = 0;
  a.y = 0;
  const { view } = state(world, 'a');
  assert.equal(view[0].terrain, null);
  assert.equal(view[12].terrain, 'plain');
});

// REQ-001 條件 1
test('a change on a tile reaches the online players who see that tile', () => {
  const { world, b } = setup();
  world.online.add('a');
  world.online.add('b');
  b.x = SPAWN.x + 3;
  assert.deepEqual(world.viewersOf(world.move('a', 'e')).sort(), ['a', 'b']);
  b.x = SPAWN.x + 4;
  assert.deepEqual(world.viewersOf([tileKey(SPAWN.x, SPAWN.y)]), ['a']);
  world.online.delete('a');
  assert.deepEqual(world.viewersOf([tileKey(SPAWN.x, SPAWN.y)]), []);
});

// REQ-003 條件 6
test('AP regenerates while the character is idle', () => {
  const { world, clock, a } = setup();
  world.move('a', 'n');
  clock.now += 5 * MIN;
  assert.equal(state(world, 'a').me.ap, START_AP - 12 + 5);
  assert.equal(a.ap, START_AP - 7);
});

// REQ-002 條件 1
test('the generated map has a fixed size, every terrain, and a plain spawn tile', () => {
  const tiles = generateMap(42, 0);
  assert.equal(tiles.length, MAP_SIZE * MAP_SIZE);
  assert.deepEqual(new Set(tiles.map((t) => t.terrain)), new Set(['plain', 'forest', 'mountain']));
  assert.equal(tiles.find((t) => t.x === SPAWN.x && t.y === SPAWN.y)!.terrain, 'plain');
  assert.deepEqual(generateMap(42, 0), tiles);
  assert.notDeepEqual(generateMap(43, 0), tiles);
});
