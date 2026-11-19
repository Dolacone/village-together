import { AP_CAP, AP_REGEN_MS, BUILDINGS, ITEMS, ITEM_IDS, TERRAINS } from './data.ts';
import type { Attr, Inv, Terrain } from './data.ts';
import type { Structure } from './protocol.ts';

// AP regenerates 1 per AP_REGEN_MS up to AP_CAP. `apAt` is the time the current AP value was reached.
export function regenAp(ap: number, apAt: number, now: number): { ap: number; apAt: number } {
  if (ap >= AP_CAP) return { ap: AP_CAP, apAt: now };
  const gained = Math.floor((now - apAt) / AP_REGEN_MS);
  if (gained <= 0) return { ap, apAt };
  const next = Math.min(AP_CAP, ap + gained);
  return { ap: next, apAt: next === AP_CAP ? now : apAt + gained * AP_REGEN_MS };
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

export function apCost(base: number, ...mults: number[]): number {
  const raw = mults.reduce((acc, m) => acc * m, base);
  return Math.max(1, Math.ceil(Math.round(raw * 1000) / 1000));
}

export function toolMult(inv: Inv, attr: Attr): number {
  let mult = 1;
  for (const id of ITEM_IDS) {
    const tool = ITEMS[id].tool;
    if (tool && tool.attr === attr && (inv[id] ?? 0) > 0) mult = Math.min(mult, tool.apMult);
  }
  return mult;
}

export function buildingMult(structures: Structure[], attr: Attr): number {
  let mult = 1;
  for (const s of structures) {
    const effect = BUILDINGS[s.type].effect;
    if (s.done && effect.kind === 'efficiency' && effect.attr === attr) mult = Math.min(mult, effect.apMult);
  }
  return mult;
}

// AP to enter a tile before the walk attribute applies.
export function enterAp(terrain: Terrain, structures: Structure[]): number {
  let mult = 1;
  for (const s of structures) {
    const effect = BUILDINGS[s.type].effect;
    if (s.done && effect.kind === 'passage') mult = Math.min(mult, effect.enterMult);
  }
  return apCost(TERRAINS[terrain].enterAp, mult);
}

export function hasEffect(structures: Structure[], kind: 'unlock' | 'storage'): boolean {
  return structures.some((s) => s.done && BUILDINGS[s.type].effect.kind === kind);
}

export function weightOf(inv: Inv): number {
  let total = 0;
  for (const id of ITEM_IDS) total += (inv[id] ?? 0) * ITEMS[id].weight;
  return total;
}

export function siteComplete(s: Structure): boolean {
  const def = BUILDINGS[s.type];
  if (s.ap < def.ap) return false;
  for (const id of ITEM_IDS) {
    if ((s.mats[id] ?? 0) < (def.mats[id] ?? 0)) return false;
  }
  return true;
}
