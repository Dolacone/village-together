import { MAP_SIZE, TERRAIN_IDS } from '../shared/data.ts';
import type { Terrain } from '../shared/data.ts';
import type { Pos } from '../shared/protocol.ts';

// `cells` holds one index into TERRAIN_IDS per tile, row by row.
export type WorldMap = { size: number; cells: Uint8Array; spawn: Pos };

export function terrainOf(map: WorldMap, x: number, y: number): Terrain | null {
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return null;
  return TERRAIN_IDS[map.cells[y * map.size + x]];
}

const ID = Object.fromEntries(TERRAIN_IDS.map((t, i) => [t, i])) as Record<Terrain, number>;
const SIDES = [[0, -1], [-1, 0], [1, 0], [0, 1]];

// Width of the band along the map edge where the land sinks into the sea.
const EDGE = 40;
const SEA_SHARE = 0.1;
const PEAK_SHARE = 0.03;
const MOUNTAIN_SHARE = 0.12;
const FOREST_SHARE = 0.35;
const WASTE_SHARE = 0.15;
const TILES_PER_RIVER = 5000;
// Extra cost of a river tile per unit of elevation, against 1 for the tile itself.
const RIVER_SLOPE = 10;

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random values on a grid of `cell` tiles, blended smoothly between the grid points.
function valueNoise(rnd: () => number, size: number, cell: number): Float32Array {
  const n = Math.ceil(size / cell) + 2;
  const grid = Float32Array.from({ length: n * n }, () => rnd());
  const out = new Float32Array(size * size);
  const ease = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const gy = Math.floor(y / cell);
    const ty = ease(y / cell - gy);
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / cell);
      const tx = ease(x / cell - gx);
      const top = grid[gy * n + gx] * (1 - tx) + grid[gy * n + gx + 1] * tx;
      const bottom = grid[(gy + 1) * n + gx] * (1 - tx) + grid[(gy + 1) * n + gx + 1] * tx;
      out[y * size + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

// Noise with large patches and smaller detail on top.
function fractal(rnd: () => number, size: number): Float32Array {
  const out = new Float32Array(size * size);
  let weight = 1;
  for (const cell of [32, 16, 8, 4]) {
    const layer = valueNoise(rnd, size, cell);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * weight;
    weight *= 0.6;
  }
  return out;
}

// Value above which `share` of the given values lie.
function cutoff(values: number[], share: number): number {
  if (values.length === 0) return Infinity;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - share)))];
}

export function generateMap(seed: number, size = MAP_SIZE): WorldMap {
  const rnd = mulberry32(seed);
  const elevation = fractal(rnd, size);
  const moisture = fractal(rnd, size);
  const cells = new Uint8Array(size * size);
  const at = (x: number, y: number) => y * size + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edge = Math.min(1, Math.min(x, y, size - 1 - x, size - 1 - y) / EDGE);
      elevation[at(x, y)] -= (1 - edge) ** 2;
    }
  }

  // The sea is the low land joined to the map edge.
  const seaLine = -cutoff(Array.from(elevation, (e) => -e), SEA_SHARE);
  const queue: number[] = [];
  const flood = (x: number, y: number) => {
    if (!inside(x, y) || cells[at(x, y)] === ID.coast) return;
    const onEdge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
    if (!onEdge && elevation[at(x, y)] > seaLine) return;
    cells[at(x, y)] = ID.coast;
    queue.push(at(x, y));
  };
  for (let i = 0; i < size; i++) {
    flood(i, 0);
    flood(i, size - 1);
    flood(0, i);
    flood(size - 1, i);
  }
  while (queue.length > 0) {
    const i = queue.pop()!;
    for (const [dx, dy] of SIDES) flood((i % size) + dx, Math.floor(i / size) + dy);
  }

  const land: number[] = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] !== ID.coast) land.push(i);
  const peakLine = cutoff(land.map((i) => elevation[i]), PEAK_SHARE);
  const mountainLine = cutoff(land.map((i) => elevation[i]), PEAK_SHARE + MOUNTAIN_SHARE);
  const low = land.filter((i) => elevation[i] <= mountainLine);
  const forestLine = cutoff(low.map((i) => moisture[i]), FOREST_SHARE);
  const wasteLine = -cutoff(low.map((i) => -moisture[i]), WASTE_SHARE);
  for (const i of land) {
    if (elevation[i] > peakLine) cells[i] = ID.peak;
    else if (elevation[i] > mountainLine) cells[i] = ID.mountain;
    else if (moisture[i] > forestLine) cells[i] = ID.forest;
    else if (moisture[i] < wasteLine) cells[i] = ID.waste;
    else cells[i] = ID.grass;
  }

  // The cheapest way from every land tile to the sea, preferring low land. A river follows it.
  const toSea = new Int32Array(cells.length).fill(-1);
  const cost = new Float64Array(cells.length).fill(Infinity);
  const heap: number[] = [];
  const push = (i: number) => {
    heap.push(i);
    for (let c = heap.length - 1; c > 0; ) {
      const parent = (c - 1) >> 1;
      if (cost[heap[parent]] <= cost[heap[c]]) break;
      [heap[parent], heap[c]] = [heap[c], heap[parent]];
      c = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let c = 0; ; ) {
        let least = c;
        for (const child of [c * 2 + 1, c * 2 + 2]) {
          if (child < heap.length && cost[heap[child]] < cost[heap[least]]) least = child;
        }
        if (least === c) break;
        [heap[least], heap[c]] = [heap[c], heap[least]];
        c = least;
      }
    }
    return top;
  };
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== ID.coast) continue;
    cost[i] = 0;
    push(i);
  }
  const settled = new Uint8Array(cells.length);
  while (heap.length > 0) {
    const i = pop();
    if (settled[i]) continue;
    settled[i] = 1;
    for (const [dx, dy] of SIDES) {
      const nx = (i % size) + dx;
      const ny = Math.floor(i / size) + dy;
      if (!inside(nx, ny)) continue;
      const n = at(nx, ny);
      if (cells[n] === ID.coast || cells[n] === ID.peak) continue;
      const next = cost[i] + 1 + RIVER_SLOPE * Math.max(0, elevation[n]);
      if (next < cost[n]) {
        cost[n] = next;
        toSea[n] = i;
        push(n);
      }
    }
  }

  // A river starts in the mountains and ends at the sea or at another river. It never lies beside itself.
  const isRiver = (x: number, y: number) => inside(x, y) && cells[at(x, y)] === ID.river;
  const makesBlock = (x: number, y: number) => {
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      let others = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const cx = x + ox + dx;
        const cy = y + oy + dy;
        if (!(cx === x && cy === y) && isRiver(cx, cy)) others++;
      }
      if (others === 3) return true;
    }
    return false;
  };
  const sources = land.filter((i) => cells[i] === ID.mountain);
  const rivers = sources.length === 0 ? 0 : Math.ceil((size * size) / TILES_PER_RIVER);
  for (let n = 0; n < rivers; n++) {
    let prev = -1;
    for (let i = sources[Math.floor(rnd() * sources.length)]; i >= 0 && cells[i] !== ID.coast; i = toSea[i]) {
      const x = i % size;
      const y = Math.floor(i / size);
      if (cells[i] === ID.river || makesBlock(x, y)) break;
      const joins = SIDES.some(([dx, dy]) => isRiver(x + dx, y + dy) && at(x + dx, y + dy) !== prev);
      if (joins && prev < 0) break;
      cells[i] = ID.river;
      if (joins) break;
      prev = i;
    }
  }

  // The spawn point and the tiles around it are grass.
  const spawn = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (inside(spawn.x + dx, spawn.y + dy)) cells[at(spawn.x + dx, spawn.y + dy)] = ID.grass;
    }
  }
  return { size, cells, spawn };
}
