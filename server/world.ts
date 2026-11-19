import { randomUUID } from 'node:crypto';
import {
  ATTR_IDS,
  BACKPACK_CAPACITY,
  BUILDINGS,
  BUILDING_IDS,
  ITEMS,
  ITEM_IDS,
  SPAWN,
  START_AP,
  TERRAINS,
  TRANSFER_AP,
  VIEW_RADIUS,
} from '../shared/data.ts';
import type { Attr, BuildingId, Inv, ItemId } from '../shared/data.ts';
import type { ClientMsg, Dir, Here, Player, ServerMsg, Structure, Tile, ViewTile } from '../shared/protocol.ts';
import {
  apCost,
  buildingMult,
  enterAp,
  hasEffect,
  regenAp,
  regenStock,
  siteComplete,
  skillMult,
  toolMult,
  weightOf,
} from '../shared/rules.ts';

export interface Store {
  saveTile(tile: Tile): void;
  savePlayer(player: Player): void;
}

// A rule violation reported to the player.
export class GameError extends Error {}

const DIRS: Record<Dir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

export const tileKey = (x: number, y: number): string => `${x},${y}`;

function posInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new GameError('數量必須是正整數');
  return value;
}

function itemId(value: unknown): ItemId {
  if (!ITEM_IDS.includes(value as ItemId)) throw new GameError('沒有這種物品');
  return value as ItemId;
}

export class World {
  tiles = new Map<string, Tile>();
  players = new Map<string, Player>();
  online = new Set<string>();
  store: Store;
  now: () => number;

  constructor(tiles: Tile[], players: Player[], store: Store, now: () => number) {
    for (const t of tiles) this.tiles.set(tileKey(t.x, t.y), t);
    for (const p of players) this.players.set(p.id, p);
    this.store = store;
    this.now = now;
  }

  createPlayer(id: string, rawName: unknown): Player {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (name.length < 1 || name.length > 16) throw new GameError('角色名稱需為 1 到 16 個字');
    const prof = Object.fromEntries(ATTR_IDS.map((a) => [a, 0])) as Record<Attr, number>;
    const player: Player = { id, name, x: SPAWN.x, y: SPAWN.y, ap: START_AP, apAt: this.now(), inv: {}, prof };
    this.players.set(id, player);
    this.store.savePlayer(player);
    return player;
  }

  // Dispatches a player action. Returns the keys of the tiles whose shown state changed.
  act(id: string, msg: ClientMsg): string[] {
    switch (msg.t) {
      case 'move':
        return this.move(id, msg.dir);
      case 'gather':
        return this.gather(id);
      case 'place':
        return this.place(id, msg.building);
      case 'giveMat':
        return this.giveMat(id, msg.id, msg.item, msg.qty);
      case 'giveAp':
        return this.giveAp(id, msg.id, msg.qty);
      case 'craft':
        return this.craft(id, msg.item);
      case 'deposit':
        return this.transfer(id, msg.id, msg.item, msg.qty, 'deposit');
      case 'withdraw':
        return this.transfer(id, msg.id, msg.item, msg.qty, 'withdraw');
      default:
        throw new GameError('未知的動作');
    }
  }

  move(id: string, dir: Dir): string[] {
    const { p, tile } = this.actor(id);
    const delta = DIRS[dir];
    if (!delta) throw new GameError('未知的方向');
    const target = this.tiles.get(tileKey(p.x + delta[0], p.y + delta[1]));
    if (!target) throw new GameError('那裡是世界的邊界');
    const base = enterAp(target.terrain, target.structures);
    this.spend(p, apCost(base, skillMult(p.prof.walk)));
    p.x = target.x;
    p.y = target.y;
    p.prof.walk += base;
    this.store.savePlayer(p);
    return [tileKey(tile.x, tile.y), tileKey(target.x, target.y)];
  }

  gather(id: string): string[] {
    const { p, tile } = this.actor(id);
    const resource = TERRAINS[tile.terrain].resource;
    if (!resource || !tile.stock) throw new GameError('這一格沒有可採集的資源');
    this.refreshStock(tile);
    const room = Math.floor((BACKPACK_CAPACITY - weightOf(p.inv)) / ITEMS[resource.item].weight);
    if (room <= 0) throw new GameError('背包已滿');
    const qty = Math.min(resource.yield, tile.stock.amount, room);
    if (qty <= 0) throw new GameError('這一格的資源存量已用完');
    this.spend(p, this.actionCost(p, tile, resource.attr, resource.gatherAp));
    tile.stock.amount -= qty;
    p.inv[resource.item] = (p.inv[resource.item] ?? 0) + qty;
    p.prof[resource.attr] += resource.gatherAp;
    this.store.saveTile(tile);
    this.store.savePlayer(p);
    return [tileKey(tile.x, tile.y)];
  }

  place(id: string, type: BuildingId): string[] {
    const { tile } = this.actor(id);
    if (!BUILDING_IDS.includes(type)) throw new GameError('沒有這種建築');
    tile.structures.push({ id: randomUUID(), type, done: false, mats: {}, ap: 0, log: {}, storage: {} });
    this.store.saveTile(tile);
    return [tileKey(tile.x, tile.y)];
  }

  giveMat(id: string, structureId: string, rawItem: ItemId, rawQty: number): string[] {
    const { p, tile } = this.actor(id);
    const site = this.site(tile, structureId);
    const item = itemId(rawItem);
    const need = (BUILDINGS[site.type].mats[item] ?? 0) - (site.mats[item] ?? 0);
    const qty = Math.min(posInt(rawQty), need, p.inv[item] ?? 0);
    if (qty <= 0) throw new GameError('沒有可貢獻的材料');
    this.spend(p, TRANSFER_AP);
    this.take(p.inv, item, qty);
    site.mats[item] = (site.mats[item] ?? 0) + qty;
    const entry = this.logEntry(site, p);
    entry.mats[item] = (entry.mats[item] ?? 0) + qty;
    site.done = siteComplete(site);
    this.store.saveTile(tile);
    this.store.savePlayer(p);
    return [tileKey(tile.x, tile.y)];
  }

  // Contributes up to `rawQty` AP of progress, limited by what the site needs and what the player can pay.
  giveAp(id: string, structureId: string, rawQty: number): string[] {
    const { p, tile } = this.actor(id);
    const site = this.site(tile, structureId);
    const mult = skillMult(p.prof.build);
    let qty = Math.min(posInt(rawQty), BUILDINGS[site.type].ap - site.ap, Math.floor(p.ap / mult));
    while (qty > 0 && apCost(qty, mult) > p.ap) qty--;
    if (qty <= 0) throw new GameError(site.ap >= BUILDINGS[site.type].ap ? '這個工地的 AP 已足夠' : 'AP 不足');
    this.spend(p, apCost(qty, mult));
    site.ap += qty;
    this.logEntry(site, p).ap += qty;
    p.prof.build += qty;
    site.done = siteComplete(site);
    this.store.saveTile(tile);
    this.store.savePlayer(p);
    return [tileKey(tile.x, tile.y)];
  }

  craft(id: string, rawItem: ItemId): string[] {
    const { p, tile } = this.actor(id);
    const item = itemId(rawItem);
    const recipe = ITEMS[item].recipe;
    if (!recipe) throw new GameError('這個物品無法製作');
    if (!hasEffect(tile.structures, 'unlock')) throw new GameError('這一格沒有可製作的建築');
    for (const mat of ITEM_IDS) {
      if ((p.inv[mat] ?? 0) < (recipe.mats[mat] ?? 0)) throw new GameError('材料不足');
    }
    const after: Inv = { ...p.inv, [item]: (p.inv[item] ?? 0) + 1 };
    for (const mat of ITEM_IDS) after[mat] = (after[mat] ?? 0) - (recipe.mats[mat] ?? 0);
    if (weightOf(after) > BACKPACK_CAPACITY) throw new GameError('背包已滿');
    this.spend(p, this.actionCost(p, tile, 'craft', recipe.ap));
    for (const mat of ITEM_IDS) this.take(p.inv, mat, recipe.mats[mat] ?? 0);
    p.inv[item] = (p.inv[item] ?? 0) + 1;
    p.prof.craft += recipe.ap;
    this.store.savePlayer(p);
    return [tileKey(tile.x, tile.y)];
  }

  transfer(id: string, structureId: string, rawItem: ItemId, rawQty: number, kind: 'deposit' | 'withdraw'): string[] {
    const { p, tile } = this.actor(id);
    const building = tile.structures.find((s) => s.id === structureId);
    if (!building || !building.done || BUILDINGS[building.type].effect.kind !== 'storage') {
      throw new GameError('這一格沒有這個倉庫');
    }
    const item = itemId(rawItem);
    let qty = posInt(rawQty);
    if (kind === 'deposit') {
      qty = Math.min(qty, p.inv[item] ?? 0);
      if (qty <= 0) throw new GameError('背包裡沒有這個物品');
      this.spend(p, TRANSFER_AP);
      this.take(p.inv, item, qty);
      building.storage[item] = (building.storage[item] ?? 0) + qty;
    } else {
      const room = Math.floor((BACKPACK_CAPACITY - weightOf(p.inv)) / ITEMS[item].weight);
      if ((building.storage[item] ?? 0) <= 0) throw new GameError('倉庫裡沒有這個物品');
      qty = Math.min(qty, building.storage[item] ?? 0, room);
      if (qty <= 0) throw new GameError('背包已滿');
      this.spend(p, TRANSFER_AP);
      this.take(building.storage, item, qty);
      p.inv[item] = (p.inv[item] ?? 0) + qty;
    }
    this.store.saveTile(tile);
    this.store.savePlayer(p);
    return [tileKey(tile.x, tile.y)];
  }

  // Online players whose view contains any of the tiles.
  viewersOf(keys: string[]): string[] {
    const coords = keys.map((k) => k.split(',').map(Number));
    const ids: string[] = [];
    for (const id of this.online) {
      const p = this.players.get(id);
      if (!p) continue;
      if (coords.some(([x, y]) => Math.abs(p.x - x) <= VIEW_RADIUS && Math.abs(p.y - y) <= VIEW_RADIUS)) ids.push(id);
    }
    return ids;
  }

  stateFor(id: string): ServerMsg {
    const { p, tile } = this.actor(id);
    const present = new Map<string, Player[]>();
    for (const other of this.players.values()) {
      if (other.id === id) continue;
      const k = tileKey(other.x, other.y);
      const list = present.get(k);
      if (list) list.push(other);
      else present.set(k, [other]);
    }

    const view: ViewTile[] = [];
    for (let dy = -VIEW_RADIUS; dy <= VIEW_RADIUS; dy++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        const x = p.x + dx;
        const y = p.y + dy;
        const t = this.tiles.get(tileKey(x, y));
        if (!t) {
          view.push({ x, y, terrain: null, feature: null, road: false, online: 0, offline: 0, enterAp: 0 });
          continue;
        }
        const others = present.get(tileKey(x, y)) ?? [];
        const online = others.filter((o) => this.online.has(o.id)).length;
        view.push({
          x,
          y,
          terrain: t.terrain,
          feature: this.feature(t),
          road: t.structures.some((s) => s.done && BUILDINGS[s.type].effect.kind === 'passage'),
          online,
          offline: others.length - online,
          enterAp: enterAp(t.terrain, t.structures),
        });
      }
    }

    const resource = TERRAINS[tile.terrain].resource;
    if (resource && tile.stock) this.refreshStock(tile);
    const here: Here = {
      x: tile.x,
      y: tile.y,
      terrain: tile.terrain,
      stock: resource && tile.stock ? { item: resource.item, amount: tile.stock.amount, max: resource.max } : null,
      structures: tile.structures,
      players: [p, ...(present.get(tileKey(tile.x, tile.y)) ?? [])].map((o) => ({
        name: o.name,
        online: this.online.has(o.id),
      })),
    };
    const { id: _id, ...me } = p;
    return { t: 'state', now: this.now(), me, view, here };
  }

  private actor(id: string): { p: Player; tile: Tile } {
    const p = this.players.get(id);
    if (!p) throw new GameError('找不到角色');
    const regen = regenAp(p.ap, p.apAt, this.now());
    p.ap = regen.ap;
    p.apAt = regen.apAt;
    const tile = this.tiles.get(tileKey(p.x, p.y));
    if (!tile) throw new Error(`player ${id} stands outside the map`);
    return { p, tile };
  }

  private spend(p: Player, cost: number): void {
    if (p.ap < cost) throw new GameError(`AP 不足，需要 ${cost} AP`);
    p.ap -= cost;
  }

  private actionCost(p: Player, tile: Tile, attr: Attr, base: number): number {
    return apCost(base, skillMult(p.prof[attr]), toolMult(p.inv, attr), buildingMult(tile.structures, attr));
  }

  private refreshStock(tile: Tile): void {
    const resource = TERRAINS[tile.terrain].resource;
    if (!resource || !tile.stock) return;
    tile.stock = regenStock(tile.stock.amount, tile.stock.at, resource.max, resource.regenPerHour, this.now());
  }

  private site(tile: Tile, structureId: string): Structure {
    const site = tile.structures.find((s) => s.id === structureId);
    if (!site || site.done) throw new GameError('這一格沒有這個工地');
    return site;
  }

  private logEntry(site: Structure, p: Player) {
    site.log[p.id] ??= { name: p.name, mats: {}, ap: 0 };
    return site.log[p.id];
  }

  private take(inv: Inv, item: ItemId, qty: number): void {
    const left = (inv[item] ?? 0) - qty;
    if (left > 0) inv[item] = left;
    else delete inv[item];
  }

  private feature(tile: Tile): BuildingId | 'site' | null {
    let best: BuildingId | null = null;
    for (const s of tile.structures) {
      const def = BUILDINGS[s.type];
      if (!s.done || def.effect.kind === 'passage') continue;
      if (!best || def.priority > BUILDINGS[best].priority) best = s.type;
    }
    if (best) return best;
    return tile.structures.some((s) => !s.done) ? 'site' : null;
  }
}
