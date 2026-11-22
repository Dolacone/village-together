import {
  AP_CAP,
  AP_PER_MIN_ACTING,
  AP_PER_MIN_IDLE,
  BACKPACK_CAPACITY,
  BUILDINGS,
  ITEMS,
  ITEM_IDS,
  ITEM_LIFE_MS,
  MINUTE,
  STRUCTURE_LIFE_MS,
  TERRAINS,
  TINT_RUINED,
  TINT_WORN,
  WILDLIFE_DENSITY,
  WILDLIFE_PERIOD_MS,
} from './data.ts';
import type { AnimalId, Attr, BuildingId, Counts, Inv, ItemId, Stack, Terrain } from './data.ts';
import type { Pos, Structure } from './protocol.ts';

// AP at `now`, from the value `ap` reached at `apAt`. The character acts until `actingUntil` and is idle after it.
// `actingUntil` is null for a character that has been idle since `apAt`.
export function apNow(ap: number, apAt: number, actingUntil: number | null, now: number): number {
  const acting = actingUntil === null ? 0 : Math.max(0, Math.min(now, actingUntil) - apAt);
  const idle = Math.max(0, now - apAt - acting);
  return Math.min(AP_CAP, ap + (acting * AP_PER_MIN_ACTING + idle * AP_PER_MIN_IDLE) / MINUTE);
}

export function regenStock(
  amount: number,
  at: number,
  max: number,
  perHour: number,
  now: number,
): { amount: number; at: number } {
  if (amount >= max) return { amount: max, at: now };
  const interval = 3_600_000 / perHour;
  const gained = Math.floor((now - at) / interval);
  if (gained <= 0) return { amount, at };
  const next = Math.min(max, amount + gained);
  return { amount: next, at: next === max ? now : at + gained * interval };
}

export function levelOf(prof: number): number {
  return Math.floor(Math.sqrt(prof / 100));
}

export function profForLevel(level: number): number {
  return level * level * 100;
}

export function skillMult(prof: number): number {
  return Math.max(0.5, 1 - 0.05 * levelOf(prof));
}

// Length of an action of `minutes` base minutes after the multipliers, in ms.
export function actionMs(minutes: number, ...mults: number[]): number {
  return Math.max(1000, Math.round(mults.reduce((acc, m) => acc * m, minutes * MINUTE)));
}

export function countOf(inv: Inv, item: ItemId): number {
  return inv[item]?.qty ?? 0;
}

export function toolMult(inv: Inv, attr: Attr): number {
  let mult = 1;
  for (const id of ITEM_IDS) {
    const tool = ITEMS[id].tool;
    if (tool && tool.attr === attr && countOf(inv, id) > 0) mult = Math.min(mult, tool.mult);
  }
  return mult;
}

export function weightOf(inv: Inv): number {
  let total = 0;
  for (const id of ITEM_IDS) total += countOf(inv, id) * ITEMS[id].weight;
  return total;
}

export function capacityOf(inv: Inv): number {
  let total = BACKPACK_CAPACITY;
  for (const id of ITEM_IDS) if (countOf(inv, id) > 0) total += ITEMS[id].capacity ?? 0;
  return total;
}

// --- durability ---

// Durability of a stack at `now`. `mult` multiplies the loss, as a storehouse does for the ground of its tile.
export function stackDur(item: ItemId, stack: Stack, now: number, mult = 1): number {
  return Math.max(0, stack.dur - ((now - stack.at) / ITEM_LIFE_MS[ITEMS[item].kind]) * mult);
}

// Moves every stack to its durability at `now` and removes the stacks that reached zero.
export function settleInv(inv: Inv, now: number, mult = 1): void {
  for (const id of ITEM_IDS) {
    const stack = inv[id];
    if (!stack) continue;
    const dur = stackDur(id, stack, now, mult);
    if (dur <= 0 || stack.qty <= 0) delete inv[id];
    else inv[id] = { qty: stack.qty, dur, at: now };
  }
}

// Adds items to an inventory settled at `now`. One kind forms one stack with the quantity-weighted durability.
export function addItems(inv: Inv, item: ItemId, qty: number, dur: number, now: number): void {
  if (qty <= 0 || dur <= 0) return;
  const stack = inv[item];
  if (!stack) inv[item] = { qty, dur, at: now };
  else inv[item] = { qty: stack.qty + qty, dur: (stack.dur * stack.qty + dur * qty) / (stack.qty + qty), at: now };
}

// Removes up to `qty` items and returns them as a stack.
export function takeItems(inv: Inv, item: ItemId, qty: number): Stack {
  const stack = inv[item];
  if (!stack || qty <= 0) return { qty: 0, dur: 0, at: 0 };
  const taken = Math.min(qty, stack.qty);
  if (taken === stack.qty) delete inv[item];
  else inv[item] = { ...stack, qty: stack.qty - taken };
  return { qty: taken, dur: stack.dur, at: stack.at };
}

export function hasCounts(inv: Inv, counts: Counts, times = 1): boolean {
  return ITEM_IDS.every((id) => countOf(inv, id) >= (counts[id] ?? 0) * times);
}

export function structureDur(s: Structure, now: number): number {
  if (!s.done) return 1;
  return Math.max(0, s.dur - (now - s.durAt) / STRUCTURE_LIFE_MS);
}

export function tintOf(dur: number): 0 | 1 | 2 {
  if (dur >= TINT_WORN) return 0;
  return dur >= TINT_RUINED ? 1 : 2;
}

// Whole percent shown for a durability. Anything above zero shows at least 1%.
export function percent(dur: number): number {
  return Math.min(100, Math.max(0, Math.ceil(Math.round(dur * 1e8) / 1e6)));
}

// Materials that restore a building at durability `dur` to 100%.
export function repairCost(type: BuildingId, dur: number): Counts {
  const cost: Counts = {};
  const lost = 1 - dur;
  for (const id of ITEM_IDS) {
    const need = Math.ceil(Math.round((BUILDINGS[type].mats[id] ?? 0) * lost * 1e6) / 1e6);
    if (need > 0) cost[id] = need;
  }
  return cost;
}

// --- movement ---

// Step time multipliers of a tile for a character that enters or leaves it.
export function passMults(
  terrain: Terrain,
  structure: { type: BuildingId; done: boolean } | null,
): { enter: number; leave: number } {
  const def = TERRAINS[terrain];
  const effect = structure?.done ? BUILDINGS[structure.type].effect : null;
  if (effect?.kind === 'bridge') return { enter: 1, leave: 1 };
  const mult = effect?.kind === 'passage' ? effect.mult : 1;
  return { enter: def.enterMult * mult, leave: def.leaveMult * mult };
}

// `avoid` marks a passable tile the route does not cross. It may still be the destination.
export type PathCell = { enter: number; leave: number; passable: boolean; avoid: boolean };

// Fastest route from `from` to `to` over tiles joined by their sides, within `radius` tiles of `from`.
// Returns the tiles after `from` and the time multiplier of each step, or null when no route exists.
export function findPath(
  cell: (x: number, y: number) => PathCell | null,
  from: Pos,
  to: Pos,
  radius: number,
): { path: Pos[]; mults: number[] } | null {
  const side = radius * 2 + 1;
  const index = (x: number, y: number) => (y - from.y + radius) * side + (x - from.x + radius);
  const inside = (x: number, y: number) => Math.abs(x - from.x) <= radius && Math.abs(y - from.y) <= radius;
  if (!inside(to.x, to.y) || (to.x === from.x && to.y === from.y)) return null;
  const target = cell(to.x, to.y);
  const start = cell(from.x, from.y);
  if (!target?.passable || !start) return null;

  const cost = new Array<number>(side * side).fill(Infinity);
  const prev = new Array<number>(side * side).fill(-1);
  const closed = new Array<boolean>(side * side).fill(false);
  const cells = new Map<number, PathCell | null>([[index(from.x, from.y), start]]);
  cost[index(from.x, from.y)] = 0;

  for (;;) {
    let current = -1;
    for (let i = 0; i < cost.length; i++) {
      if (!closed[i] && cost[i] < Infinity && (current < 0 || cost[i] < cost[current])) current = i;
    }
    if (current < 0) return null;
    if (current === index(to.x, to.y)) break;
    closed[current] = true;
    const cx = (current % side) + from.x - radius;
    const cy = Math.floor(current / side) + from.y - radius;
    const here = cells.get(current)!;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inside(nx, ny)) continue;
      const ni = index(nx, ny);
      if (closed[ni]) continue;
      if (!cells.has(ni)) cells.set(ni, cell(nx, ny));
      const next = cells.get(ni);
      if (!next?.passable) continue;
      if (next.avoid && !(nx === to.x && ny === to.y)) continue;
      const total = cost[current] + here.leave * next.enter;
      if (total < cost[ni]) {
        cost[ni] = total;
        prev[ni] = current;
      }
    }
  }

  const path: Pos[] = [];
  const mults: number[] = [];
  for (let i = index(to.x, to.y); prev[i] >= 0; i = prev[i]) {
    path.unshift({ x: (i % side) + from.x - radius, y: Math.floor(i / side) + from.y - radius });
    mults.unshift(cost[i] - cost[prev[i]]);
  }
  return { path, mults };
}

// --- wildlife ---

// Stable pseudo-random number in [0, 1) for a list of integers.
export function hash01(...ns: number[]): number {
  let h = 0x811c9dc5;
  for (const n of ns) {
    h = Math.imul(h ^ (n | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Number of the wildlife period of a tile at `now`. Tiles change period at different moments.
export function wildlifePeriod(seed: number, x: number, y: number, now: number): number {
  return Math.floor((now + hash01(seed, x, y, 1) * WILDLIFE_PERIOD_MS) / WILDLIFE_PERIOD_MS);
}

// The wild animal that a tile of this terrain holds during a wildlife period.
export function wildlifeAt(seed: number, x: number, y: number, terrain: Terrain, period: number): AnimalId | null {
  const table = TERRAINS[terrain].animals;
  if (table.length === 0 || hash01(seed, x, y, 2, period) >= WILDLIFE_DENSITY) return null;
  let roll = hash01(seed, x, y, 3, period);
  for (const [animal, share] of table) {
    if (roll < share) return animal;
    roll -= share;
  }
  return table[table.length - 1][0];
}
