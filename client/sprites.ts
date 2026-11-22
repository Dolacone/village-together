import type { AnimalId, BuildingId } from '../shared/data.ts';
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

const BUILDING_SPRITES: Record<Exclude<BuildingId, 'road' | 'bridge'> | 'site', Sprite> = {
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
  campfire: {
    rows: [
      '.......yy.......',
      '......yyoy......',
      '.....yooooy.....',
      '.....oorroo.....',
      '....oorrrroo....',
      '.....orrrro.....',
      '...b........b...',
      '....bbbbbbbb....',
      '...b........b...',
    ],
    palette: { y: '#ffe066', o: '#ff9f1c', r: '#e03030', b: '#6b4a2a' },
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

const ANIMAL_SPRITES: Record<AnimalId, Sprite> = {
  rat: {
    rows: ['.g.g....', 'ggggggg.', 'gkgggggp', '.ggggg.p', '.g...g..'],
    palette: { g: '#8d8d8d', k: '#111111', p: '#e8a0a0' },
  },
  rabbit: {
    rows: ['.w.w....', '.w.w....', 'wwww....', 'wkwwwww.', 'wwwwwwww', '.ww..ww.'],
    palette: { w: '#f4f4f4', k: '#111111' },
  },
  wolf: {
    rows: ['d.d.......', 'ddd.......', 'dkdddddd..', 'ddddddddd.', '.ddddddd.d', '.d.d..d.d.', '.d.d..d.d.'],
    palette: { d: '#5a5f6b', k: '#ffd23f' },
  },
  spider: {
    rows: ['k..k.k..k', '.k.kkk.k.', '..kkkkk..', 'kkkrkrkkk', '..kkkkk..', '.k.kkk.k.', 'k..k.k..k'],
    palette: { k: '#1b1b1b', r: '#e03030' },
  },
  bear: {
    rows: ['.bb........', 'bbbb.bbbbb.', 'bkbbbbbbbbb', 'bbbbbbbbbbb', '.bbbbbbbbbb', '.bb.bb.bb.b', '.bb.bb.bb..'],
    palette: { b: '#6b4423', k: '#111111' },
  },
  snake: {
    rows: ['.......ss.', 'ss....sks.', '.ss..ss...', '..ssss....'],
    palette: { s: '#3fa34d', k: '#111111' },
  },
  goat: {
    rows: ['h.h......', '.ww......', 'wkwwwwww.', 'wwwwwwwww', '.wwwwwww.', '.t..t.t..', '.t..t.t..'],
    palette: { w: '#e6dcc3', h: '#7a6a4a', k: '#111111', t: '#b9ad90' },
  },
};

// Colours of a building at 20% to 70% durability and below 20%.
const TINTS = ['', '#c8a25a', '#000000'];

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

// Scatters short marks over a tile.
function speckle(ctx: CanvasRenderingContext2D, tile: ViewTile, px: number, py: number, color: string, count: number, w: number, h: number): void {
  ctx.fillStyle = color;
  for (let n = 0; n < count; n++) {
    const x = Math.floor(hash(tile.x, tile.y, n) * 28) + 1;
    const y = Math.floor(hash(tile.x, tile.y, n + 50) * 28) + 2;
    ctx.fillRect(px + x, py + y, w, h);
  }
}

function drawTerrain(ctx: CanvasRenderingContext2D, tile: ViewTile, px: number, py: number): void {
  const fill = (color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(px, py, TILE, TILE);
  };
  if (tile.terrain === null) {
    fill('#10141d');
    ctx.fillStyle = '#1a2130';
    for (let i = -TILE; i < TILE; i += 6) {
      for (let k = 0; k < TILE; k++) {
        const x = i + k;
        if (x >= 0 && x < TILE) ctx.fillRect(px + x, py + k, 1, 1);
      }
    }
  } else if (tile.terrain === 'grass') {
    fill('#8fce5a');
    speckle(ctx, tile, px, py, '#6fb043', 7, 1, 2);
  } else if (tile.terrain === 'forest') {
    fill('#62ad4a');
    const slots = [[2, 1], [12, 3], [23, 1], [6, 12], [18, 13], [1, 22], [12, 22], [23, 21]];
    slots.forEach(([sx, sy], n) => {
      if (hash(tile.x, tile.y, n) < 0.2) return;
      const jitter = Math.floor(hash(tile.x, tile.y, n + 20) * 3);
      draw(ctx, TREE, px + sx + jitter, py + sy);
    });
  } else if (tile.terrain === 'waste') {
    fill('#cdb07a');
    speckle(ctx, tile, px, py, '#a98b55', 9, 3, 1);
    speckle(ctx, tile, px, py + 1, '#8f8676', 3, 2, 2);
  } else if (tile.terrain === 'mountain') {
    fill('#b9ad90');
    speckle(ctx, tile, px, py, '#a69a7e', 6, 2, 1);
    draw(ctx, PEAK, px + 2 + Math.floor(hash(tile.x, tile.y, 7) * 3), py + 3);
    draw(ctx, PEAK, px + 16 + Math.floor(hash(tile.x, tile.y, 8) * 3), py + 14);
  } else if (tile.terrain === 'river') {
    fill('#3f8fd6');
    speckle(ctx, tile, px, py, '#8cc8f2', 6, 4, 1);
  } else if (tile.terrain === 'coast') {
    fill('#1f5fa8');
    speckle(ctx, tile, px, py, '#3a7cc4', 5, 5, 1);
  } else {
    // High mountain: one snow-capped summit that fills the tile.
    fill('#6b6660');
    for (let row = 0; row < 26; row++) {
      const half = Math.floor(row * 0.6);
      ctx.fillStyle = row < 8 ? '#f4f4f0' : '#8a857c';
      ctx.fillRect(px + 16 - half, py + 3 + row, half + 1, 1);
      ctx.fillStyle = row < 8 ? '#cfd3d8' : '#55504a';
      ctx.fillRect(px + 17, py + 3 + row, half, 1);
    }
  }
}

// A road or a bridge lies on the ground, under everything else on the tile.
function drawWay(ctx: CanvasRenderingContext2D, type: 'road' | 'bridge', tint: number, px: number, py: number): void {
  const [edge, deck] = type === 'road' ? ['#b89c62', '#dcc48e'] : ['#5a3a20', '#a9773f'];
  ctx.fillStyle = tint === 0 ? edge : tint === 1 ? '#8f7038' : '#000000';
  ctx.fillRect(px, py + 12, TILE, 8);
  ctx.fillRect(px + 12, py, 8, TILE);
  ctx.fillStyle = tint === 0 ? deck : tint === 1 ? TINTS[1] : '#1c1c1c';
  ctx.fillRect(px, py + 13, TILE, 6);
  ctx.fillRect(px + 13, py, 6, TILE);
  if (type === 'bridge') {
    ctx.fillStyle = tint === 2 ? '#000000' : '#7a5230';
    for (let i = 1; i < TILE; i += 4) {
      ctx.fillRect(px + i, py + 13, 1, 6);
      ctx.fillRect(px + 13, py + i, 6, 1);
    }
  }
}

function drawTile(ctx: CanvasRenderingContext2D, tile: ViewTile, px: number, py: number, isSelf: boolean): void {
  drawTerrain(ctx, tile, px, py);
  if (tile.terrain === null) return;
  const s = tile.structure;
  if (s?.done && (s.type === 'road' || s.type === 'bridge')) drawWay(ctx, s.type, s.tint, px, py);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fillRect(px, py + TILE - 1, TILE, 1);
  ctx.fillRect(px + TILE - 1, py, 1, TILE);

  if (s && !s.done) drawOutlined(ctx, BUILDING_SPRITES.site, px + 8, py + 3);
  else if (s && s.type !== 'road' && s.type !== 'bridge') {
    const sprite = BUILDING_SPRITES[s.type];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) draw(ctx, sprite, px + 8 + dx, py + 3 + dy, s.tint === 2 ? '#4a4a4a' : OUTLINE);
    draw(ctx, sprite, px + 8, py + 3, TINTS[s.tint] || undefined);
  }

  if (tile.animal) drawOutlined(ctx, ANIMAL_SPRITES[tile.animal], px + 11, py + 4);

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
    frame(ctx, px, py, '#ffffff');
  }
}

function frame(ctx: CanvasRenderingContext2D, px: number, py: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(px, py, TILE, 1);
  ctx.fillRect(px, py + TILE - 1, TILE, 1);
  ctx.fillRect(px, py, 1, TILE);
  ctx.fillRect(px + TILE - 1, py, 1, TILE);
}

// Draws the view row by row. The viewer stands on the middle tile. `selected` is framed as the chosen destination.
export function drawMap(ctx: CanvasRenderingContext2D, view: ViewTile[], selected: { x: number; y: number } | null): void {
  const side = Math.sqrt(view.length);
  const middle = (view.length - 1) / 2;
  view.forEach((tile, i) => {
    const px = (i % side) * TILE;
    const py = Math.floor(i / side) * TILE;
    drawTile(ctx, tile, px, py, i === middle);
    if (selected && tile.x === selected.x && tile.y === selected.y) frame(ctx, px, py, '#ffd23f');
  });
}
