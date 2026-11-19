import { MAP_SIZE, SPAWN, TERRAINS } from '../shared/data.ts';
import type { Terrain } from '../shared/data.ts';
import type { Tile } from '../shared/protocol.ts';

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random values smoothed with a 3x3 box blur, so equal terrain forms patches.
function smoothField(rnd: () => number, size: number): number[] {
  let field = Array.from({ length: size * size }, () => rnd());
  for (let pass = 0; pass < 3; pass++) {
    const next = new Array<number>(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            sum += field[ny * size + nx];
            count++;
          }
        }
        next[y * size + x] = sum / count;
      }
    }
    field = next;
  }
  return field;
}

// Value above which `fraction` of the field lies.
function cutoff(field: number[], fraction: number): number {
  const sorted = [...field].sort((a, b) => b - a);
  return sorted[Math.floor(sorted.length * fraction)];
}

export function generateMap(seed: number, now: number): Tile[] {
  const rnd = mulberry32(seed);
  const elevation = smoothField(rnd, MAP_SIZE);
  const moisture = smoothField(rnd, MAP_SIZE);
  const mountainLine = cutoff(elevation, 0.15);
  const forestLine = cutoff(moisture, 0.4);

  const tiles: Tile[] = [];
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const i = y * MAP_SIZE + x;
      let terrain: Terrain = 'plain';
      if (elevation[i] > mountainLine) terrain = 'mountain';
      else if (moisture[i] > forestLine) terrain = 'forest';
      if (x === SPAWN.x && y === SPAWN.y) terrain = 'plain';
      const resource = TERRAINS[terrain].resource;
      tiles.push({ x, y, terrain, stock: resource ? { amount: resource.max, at: now } : null, structures: [] });
    }
  }
  return tiles;
}
