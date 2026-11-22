import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAP_SIZE, TERRAINS, TERRAIN_IDS } from '../shared/data.ts';
import { generateMap, terrainOf } from '../server/mapgen.ts';

const map = generateMap(42);

// REQ-002 條件 1, 3
test('the world is a 500x500 map on which every tile has one of the seven terrains', () => {
  assert.equal(map.size, 500);
  assert.equal(MAP_SIZE, 500);
  assert.equal(map.cells.length, 500 * 500);
  const seen = new Set<string>();
  for (const cell of map.cells) seen.add(TERRAIN_IDS[cell]);
  assert.deepEqual([...seen].sort(), ['coast', 'forest', 'grass', 'mountain', 'peak', 'river', 'waste']);
});

test('the same seed gives the same map', () => {
  assert.deepEqual(generateMap(42).cells, map.cells);
  assert.notDeepEqual(generateMap(43).cells, map.cells);
});

test('tiles outside the map have no terrain', () => {
  assert.equal(terrainOf(map, -1, 0), null);
  assert.equal(terrainOf(map, 0, 500), null);
});

// REQ-002 條件 4
test('a river is one tile wide', () => {
  let rivers = 0;
  for (let y = 0; y < map.size - 1; y++) {
    for (let x = 0; x < map.size - 1; x++) {
      const square = [terrainOf(map, x, y), terrainOf(map, x + 1, y), terrainOf(map, x, y + 1), terrainOf(map, x + 1, y + 1)];
      if (square[0] === 'river') rivers++;
      assert.ok(!square.every((t) => t === 'river'), `river is two tiles wide at (${x}, ${y})`);
    }
  }
  assert.ok(rivers > 500, `only ${rivers} river tiles`);
});

// REQ-003 條件 2
test('the spawn point is grass and most of the land can be reached from it', () => {
  assert.equal(terrainOf(map, map.spawn.x, map.spawn.y), 'grass');
  const seen = new Uint8Array(map.cells.length);
  const queue = [map.spawn.y * map.size + map.spawn.x];
  seen[queue[0]] = 1;
  let reached = 0;
  while (queue.length > 0) {
    const i = queue.pop()!;
    reached++;
    const x = i % map.size;
    const y = Math.floor(i / map.size);
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const terrain = terrainOf(map, x + dx, y + dy);
      const n = (y + dy) * map.size + x + dx;
      if (!terrain || !TERRAINS[terrain].passable || seen[n]) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  let passable = 0;
  for (const cell of map.cells) if (TERRAINS[TERRAIN_IDS[cell]].passable) passable++;
  assert.ok(reached / passable > 0.9, `only ${reached} of ${passable} passable tiles can be reached`);
});
