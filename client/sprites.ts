import type { BuildingId } from '../shared/data.ts';
import type { ViewTile } from '../shared/protocol.ts';

export const TILE = 32;

type Palette = Record<string, string>;
type Sprite = { rows: string[]; palette: Palette };

const OUTLINE = '#141821';

const TREE: Sprite = {
  rows: ['..ggg..', '.ggGgg.', 'ggGgggg', 'ggggggg', '.ggggg.', '..ggg..', '...b...', '...b...'],
  palette: { g: '#2e6b2a', G: '#4c9440', b: '#6b4a2a' },
};

const PEAK: Sprite = {
  rows: [
    '......w......',
    '.....www.....',
    '....wwsww....',
    '...sssSsss...',
    '..ssssSSsss..',
    '.sssssSSSsss.',
    'ssssssSSSSsss',
  ],
  palette: { s: '#7d776b', S: '#5f5a51', w: '#f4f4f0' },
};

const BUILDING_SPRITES: Record<Exclude<BuildingId, 'road'> | 'site', Sprite> = {
  workshop: {
    rows: [
      '...........cc...',
      '...........cc...',
      '....rrrrrrrcc...',
      '...rrrrrrrrrrr..',
      '..rrrrrrrrrrrrr.',
      '.rrrrrrrrrrrrrrr',
      '..wwwwwwwwwwwww.',
      '..wwddwwwwgggww.',
      '..wwddwwwwgggww.',
      '..wwddwwwwwwwww.',
      '..wwddwwwwwwwww.',
    ],
    palette: { r: '#b5482f', c: '#6b6b6b', w: '#e8d9b0', d: '#6b4a2a', g: '#7fc8e8' },
  },
  storehouse: {
    rows: [
      '......yyyy......',
      '....yyyyyyyy....',
      '..yyyyyyyyyyyy..',
      'yyyyyyyyyyyyyyyy',
      '.bbbbbbbbbbbbbb.',
      '.bbbddddddddbbb.',
      '.bbbdDddddDdbbb.',
      '.bbbddddddddbbb.',
      '.bbbdDddddDdbbb.',
      '.bbbddddddddbbb.',
    ],
    palette: { y: '#d8b24a', b: '#8a5a34', d: '#5a3a20', D: '#3d2715' },
  },
  lumbercamp: {
    rows: [
      '......oo........',
      '.....oOOo.......',
      '...oooOOooo.....',
      '..oOOooooOOo....',
      '..oOOooooOOo....',
      '.ooooooooooooo..',
      '.oOOooOOooOOoo..',
      '.oOOooOOooOOoo..',
      '..oooooooooooo..',
    ],
    palette: { o: '#8a5a34', O: '#e3c08a' },
  },
  site: {
    rows: [
      '..p........p...',
      '..pppppppppp...',
      '..p...p....p...',
      '..p...p....p...',
      '..pppppppppp...',
      '..p....p...p...',
      '..p....p...p...',
      '..pppppppppp...',
      '..p........p...',
      '.sss......sss..',
    ],
    palette: { p: '#d9a441', s: '#8a8a8a' },
  },
};

const PERSON_ROWS = ['.hhh.', '.hhh.', 'ccccc', 'ccccc', '.ccc.', '.c.c.', '.c.c.'];
const PERSON = {
  self: { rows: PERSON_ROWS, palette: { h: '#f2c79a', c: '#ffd23f' } },
  online: { rows: PERSON_ROWS, palette: { h: '#f2c79a', c: '#3b82f6' } },
  offline: { rows: PERSON_ROWS, palette: { h: '#b4b4b4', c: '#7c7c7c' } },
} satisfies Record<string, Sprite>;

const DIGITS: Record<string, string[]> = {
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '+': ['...', '.#.', '###', '.#.', '...'],
};

function draw(ctx: CanvasRenderingContext2D, sprite: Sprite, x: number, y: number, solid?: string): void {
  sprite.rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '.') continue;
      ctx.fillStyle = solid ?? sprite.palette[row[i]];
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  });
}

// Draws the sprite over a 1px dark silhouette, so it stays readable on any terrain.
function drawOutlined(ctx: CanvasRenderingContext2D, sprite: Sprite, x: number, y: number): void {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) draw(ctx, sprite, x + dx, y + dy, OUTLINE);
  draw(ctx, sprite, x, y);
}

function drawCount(ctx: CanvasRenderingContext2D, count: number, x: number, y: number): void {
  const text = count > 9 ? '9+' : String(count);
  [...text].forEach((ch, n) => {
    const glyph: Sprite = { rows: DIGITS[ch], palette: { '#': '#ffffff' } };
    drawOutlined(ctx, glyph, x + n * 4, y);
  });
}

// Stable pseudo-random number in [0, 1) for a tile and a slot, so a tile always looks the same.
function hash(x: number, y: number, n: number): number {
  let h = (x * 374761393 + y * 668265263 + n * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function drawTerrain(ctx: CanvasRenderingContext2D, tile: ViewTile, px: number, py: number): void {
  if (tile.terrain === null) {
    ctx.fillStyle = '#10141d';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = '#1a2130';
    for (let i = -TILE; i < TILE; i += 6) {
      for (let k = 0; k < TILE; k++) {
        const x = i + k;
        if (x >= 0 && x < TILE) ctx.fillRect(px + x, py + k, 1, 1);
      }
    }
    return;
  }
  if (tile.terrain === 'plain') {
    ctx.fillStyle = '#8fce5a';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = '#6fb043';
    for (let n = 0; n < 7; n++) {
      const x = Math.floor(hash(tile.x, tile.y, n) * 28) + 1;
      const y = Math.floor(hash(tile.x, tile.y, n + 50) * 28) + 2;
      ctx.fillRect(px + x, py + y, 1, 2);
      ctx.fillRect(px + x + 2, py + y, 1, 2);
    }
  } else if (tile.terrain === 'forest') {
    ctx.fillStyle = '#62ad4a';
    ctx.fillRect(px, py, TILE, TILE);
    const slots = [[2, 1], [12, 3], [23, 1], [6, 12], [18, 13], [1, 22], [12, 22], [23, 21]];
    slots.forEach(([sx, sy], n) => {
      if (hash(tile.x, tile.y, n) < 0.2) return;
      const jitter = Math.floor(hash(tile.x, tile.y, n + 20) * 3);
      draw(ctx, TREE, px + sx + jitter, py + sy);
    });
  } else {
    ctx.fillStyle = '#b9ad90';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = '#a69a7e';
    for (let n = 0; n < 6; n++) {
      const x = Math.floor(hash(tile.x, tile.y, n) * 28) + 1;
      const y = Math.floor(hash(tile.x, tile.y, n + 50) * 28) + 2;
      ctx.fillRect(px + x, py + y, 2, 1);
    }
    draw(ctx, PEAK, px + 2 + Math.floor(hash(tile.x, tile.y, 7) * 3), py + 3);
    draw(ctx, PEAK, px + 16 + Math.floor(hash(tile.x, tile.y, 8) * 3), py + 14);
  }
}

function drawRoad(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  ctx.fillStyle = '#b89c62';
  ctx.fillRect(px, py + 12, TILE, 8);
  ctx.fillRect(px + 12, py, 8, TILE);
  ctx.fillStyle = '#dcc48e';
  ctx.fillRect(px, py + 13, TILE, 6);
  ctx.fillRect(px + 13, py, 6, TILE);
}

function drawTile(ctx: CanvasRenderingContext2D, tile: ViewTile, px: number, py: number, isSelf: boolean): void {
  drawTerrain(ctx, tile, px, py);
  if (tile.terrain === null) return;
  if (tile.road) drawRoad(ctx, px, py);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fillRect(px, py + TILE - 1, TILE, 1);
  ctx.fillRect(px + TILE - 1, py, 1, TILE);

  if (tile.feature && tile.feature !== 'road') drawOutlined(ctx, BUILDING_SPRITES[tile.feature], px + 8, py + 3);

  if (tile.online > 0) {
    drawOutlined(ctx, PERSON.online, px + 3, py + 23);
    if (tile.online > 1) drawCount(ctx, tile.online, px + 10, py + 25);
  }
  if (tile.offline > 0) {
    drawOutlined(ctx, PERSON.offline, px + 18, py + 23);
    if (tile.offline > 1) drawCount(ctx, tile.offline, px + 25, py + 25);
  }

  if (isSelf) {
    drawOutlined(ctx, PERSON.self, px + 13, py + 14);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px, py, TILE, 1);
    ctx.fillRect(px, py + TILE - 1, TILE, 1);
    ctx.fillRect(px, py, 1, TILE);
    ctx.fillRect(px + TILE - 1, py, 1, TILE);
  }
}

// Draws the view row by row. The viewer stands on the middle tile.
export function drawMap(ctx: CanvasRenderingContext2D, view: ViewTile[]): void {
  const side = Math.sqrt(view.length);
  const middle = (view.length - 1) / 2;
  view.forEach((tile, i) => {
    drawTile(ctx, tile, (i % side) * TILE, Math.floor(i / side) * TILE, i === middle);
  });
}
