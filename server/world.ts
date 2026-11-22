import {
  ANIMALS,
  ATTR_IDS,
  BUILDINGS,
  BUILDING_IDS,
  ITEMS,
  ITEM_IDS,
  MAX_ROUNDS,
  MINUTE,
  FED_MULT,
  START_AP,
  STEP_MINUTES,
  STRUCTURE_LIFE_MS,
  TERRAINS,
  VIEW_RADIUS,
} from '../shared/data.ts';
import type { AnimalId, Attr, BuildingId, Inv, ItemId, Terrain } from '../shared/data.ts';
import type {
  Action,
  ActionView,
  ClientMsg,
  Here,
  Player,
  ServerMsg,
  Structure,
  Tile,
  ViewTile,
} from '../shared/protocol.ts';
import {
  actionMs,
  addItems,
  apNow,
  capacityOf,
  countOf,
  findPath,
  hasCounts,
  passMults,
  percent,
  regenStock,
  repairCost,
  settleInv,
  skillMult,
  stackDur,
  structureDur,
  takeItems,
  tintOf,
  toolMult,
  weightOf,
  wildlifeAt,
  wildlifePeriod,
} from '../shared/rules.ts';
import { terrainOf } from './mapgen.ts';
import type { WorldMap } from './mapgen.ts';

export interface Store {
  saveTile(tile: Tile): void;
  savePlayer(player: Player): void;
}

export type WorldOptions = {
  seed?: number;
  // Replaces the wild animal a tile holds during a wildlife period.
  wildlife?: (x: number, y: number, terrain: Terrain, period: number) => AnimalId | null;
};

// Tiles whose shown state changed, and players whose own state changed.
export type Changes = { tiles: string[]; players: string[] };

// A rule violation reported to the player.
export class GameError extends Error {}

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
  map: WorldMap;
  tiles = new Map<string, Tile>();
  players = new Map<string, Player>();
  online = new Set<string>();
  store: Store;
  now: () => number;
  seed: number;
  wildlife: NonNullable<WorldOptions['wildlife']>;
  private dirtyTiles = new Set<string>();
  private dirtyPlayers = new Set<string>();

  constructor(map: WorldMap, tiles: Tile[], players: Player[], store: Store, now: () => number, opts: WorldOptions = {}) {
    this.map = map;
    for (const t of tiles) this.tiles.set(tileKey(t.x, t.y), t);
    for (const p of players) this.players.set(p.id, p);
    this.store = store;
    this.now = now;
    this.seed = opts.seed ?? 0;
    this.wildlife = opts.wildlife ?? ((x, y, terrain, period) => wildlifeAt(this.seed, x, y, terrain, period));
  }

  createPlayer(id: string, rawName: unknown): Player {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (name.length < 1 || name.length > 16) throw new GameError('角色名稱需為 1 到 16 個字');
    const prof = Object.fromEntries(ATTR_IDS.map((a) => [a, 0])) as Record<Attr, number>;
    const { x, y } = this.map.spawn;
    const player: Player = { id, name, x, y, ap: START_AP, apAt: this.now(), inv: {}, prof, action: null, fedUntil: 0 };
    this.players.set(id, player);
    this.store.savePlayer(player);
    return player;
  }

  // Applies a player's message.
  act(id: string, msg: ClientMsg): Changes {
    this.dirtyPlayers.add(id);
    switch (msg.t) {
      case 'move':
        this.move(id, msg.x, msg.y);
        break;
      case 'gather':
        this.gather(id, msg.rounds);
        break;
      case 'craft':
        this.craft(id, msg.item, msg.rounds);
        break;
      case 'build':
        this.build(id, msg.minutes);
        break;
      case 'fight':
        this.fight(id);
        break;
      case 'cancel':
        this.cancel(id);
        break;
      case 'speed':
        this.speed(id, msg.ap);
        break;
      case 'place':
        this.place(id, msg.building);
        break;
      case 'repair':
        this.repair(id);
        break;
      case 'drop':
        this.drop(id, msg.item, msg.qty);
        break;
      case 'pickup':
        this.pickup(id, msg.item, msg.qty);
        break;
      case 'eat':
        this.eat(id, msg.item);
        break;
      default:
        throw new GameError('未知的行動');
    }
    return this.drain();
  }

  // Advances every action in progress to the current time.
  tick(): Changes {
    const now = this.now();
    for (const p of this.players.values()) if (p.action) this.settle(p, now);
    return this.drain();
  }

  // --- actions that take time ---

  private move(id: string, x: number, y: number): void {
    const { p, now } = this.idle(id);
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new GameError('未知的目的地');
    if (this.animalAt(p.x, p.y, now)) throw new GameError('這一格有野生動物，必須先打倒牠才能離開');
    const cell = (cx: number, cy: number) => {
      const terrain = terrainOf(this.map, cx, cy);
      if (!terrain) return null;
      const mults = passMults(terrain, this.structureAt(cx, cy, now));
      return { ...mults, passable: TERRAINS[terrain].passable, avoid: this.animalAt(cx, cy, now) !== null };
    };
    const route = findPath(cell, p, { x, y }, VIEW_RADIUS);
    if (!route) throw new GameError('走不到那裡');
    const ends: number[] = [];
    let total = 0;
    for (const mult of route.mults) {
      total += actionMs(STEP_MINUTES, mult, skillMult(p.prof.walk), this.fedMult(p, now));
      ends.push(total);
    }
    this.start(p, { kind: 'move', t0: now, skip: 0, floorAt: now, totalMs: total, path: route.path, ends, done: 0 });
  }

  private gather(id: string, rawRounds: number): void {
    const { p, tile, now } = this.idle(id);
    const resource = TERRAINS[this.terrain(tile)].resource;
    if (!resource || !tile.stock) throw new GameError('這一格沒有可採集的資源');
    const rounds = Math.min(posInt(rawRounds), MAX_ROUNDS, Math.floor(tile.stock.amount / resource.yield));
    if (rounds <= 0) throw new GameError('這一格的資源存量不足');
    tile.stock.amount -= rounds * resource.yield;
    this.saveTile(tile);
    const roundMs = actionMs(
      resource.minutes,
      skillMult(p.prof[resource.attr]),
      toolMult(p.inv, resource.attr),
      this.fedMult(p, now),
    );
    this.start(p, {
      kind: 'gather',
      t0: now,
      skip: 0,
      floorAt: now,
      totalMs: roundMs * rounds,
      item: resource.item,
      attr: resource.attr,
      rounds,
      roundMs,
      minutes: resource.minutes,
      yield: resource.yield,
    });
  }

  private craft(id: string, rawItem: ItemId, rawRounds: number): void {
    const { p, tile, now } = this.idle(id);
    const item = itemId(rawItem);
    const recipe = ITEMS[item].recipe;
    if (!recipe) throw new GameError('這個物品無法製作');
    if (!tile.structure?.done || tile.structure.type !== recipe.at) {
      throw new GameError(`這一格沒有${BUILDINGS[recipe.at].name}`);
    }
    let rounds = Math.min(posInt(rawRounds), MAX_ROUNDS);
    for (const mat of ITEM_IDS) {
      const need = recipe.mats[mat] ?? 0;
      if (need > 0) rounds = Math.min(rounds, Math.floor(countOf(p.inv, mat) / need));
    }
    if (rounds <= 0) throw new GameError('材料不足');
    const inputs: Inv = {};
    for (const mat of ITEM_IDS) {
      const need = recipe.mats[mat] ?? 0;
      if (need > 0) inputs[mat] = takeItems(p.inv, mat, need * rounds);
    }
    const roundMs = actionMs(recipe.minutes, skillMult(p.prof.craft), this.fedMult(p, now));
    this.start(p, { kind: 'craft', t0: now, skip: 0, floorAt: now, totalMs: roundMs * rounds, item, rounds, roundMs, inputs });
  }

  private build(id: string, rawMinutes: number): void {
    const { p, tile, now } = this.idle(id);
    const site = tile.structure;
    if (!site || site.done) throw new GameError('這一格沒有工地');
    const minutes = Math.min(posInt(rawMinutes), BUILDINGS[site.type].minutes - site.progress);
    const totalMs = actionMs(minutes, skillMult(p.prof.build), this.fedMult(p, now));
    this.start(p, { kind: 'build', t0: now, skip: 0, floorAt: now, totalMs, minutes, credited: 0 });
  }

  private fight(id: string): void {
    const { p, now } = this.idle(id);
    const found = this.animalAt(p.x, p.y, now);
    if (!found) throw new GameError('這一格沒有野生動物');
    const totalMs = actionMs(
      ANIMALS[found.animal].fightMinutes,
      skillMult(p.prof.fight),
      toolMult(p.inv, 'fight'),
      this.fedMult(p, now),
    );
    this.start(p, { kind: 'fight', t0: now, skip: 0, floorAt: now, totalMs, animal: found.animal, period: found.period });
  }

  private cancel(id: string): void {
    const { p, tile, now } = this.actor(id);
    const a = p.action;
    if (!a) throw new GameError('沒有進行中的行動');
    if (a.kind === 'gather' || a.kind === 'craft') {
      this.finishRounds(p, tile, a, Math.floor((now - a.t0 + a.skip) / a.roundMs), now);
    }
    p.action = null;
    this.savePlayer(p);
    this.mark(p.x, p.y);
  }

  private speed(id: string, rawAp: number): void {
    const { p, now } = this.actor(id);
    const a = p.action;
    if (!a) throw new GameError('沒有進行中的行動');
    const remaining = a.t0 + a.totalMs - a.skip - now;
    const cost = Math.min(posInt(rawAp), Math.ceil(remaining / MINUTE));
    if (p.ap < cost) throw new GameError(`AP 不足，需要 ${cost} AP`);
    p.ap -= cost;
    a.skip += Math.min(cost * MINUTE, remaining);
    a.floorAt = now;
    this.settle(p, now);
    this.savePlayer(p);
  }

  // --- actions that take no time ---

  private place(id: string, type: BuildingId): void {
    const { p, tile, now } = this.actor(id);
    if (!BUILDING_IDS.includes(type)) throw new GameError('沒有這種建築');
    if (tile.structure) throw new GameError('這一格已經有工地或建築');
    const river = this.terrain(tile) === 'river';
    if (river && type !== 'bridge') throw new GameError('河流只能建橋梁');
    if (!river && type === 'bridge') throw new GameError('橋梁只能建在河流');
    const mats = BUILDINGS[type].mats;
    if (!hasCounts(tile.ground, mats)) throw new GameError('地面上的材料不足');
    for (const item of ITEM_IDS) takeItems(tile.ground, item, mats[item] ?? 0);
    tile.structure = { type, done: false, progress: 0, log: {}, dur: 1, durAt: now };
    this.saveTile(tile);
    this.mark(p.x, p.y);
  }

  private repair(id: string): void {
    const { p, tile, now } = this.actor(id);
    const building = tile.structure;
    if (!building?.done) throw new GameError('這一格沒有建築');
    const dur = structureDur(building, now);
    if (percent(dur) >= 100) throw new GameError('耐久度已滿');
    const cost = repairCost(building.type, dur);
    if (!hasCounts(tile.ground, cost)) throw new GameError('地面上的材料不足');
    for (const item of ITEM_IDS) takeItems(tile.ground, item, cost[item] ?? 0);
    building.dur = 1;
    building.durAt = now;
    this.saveTile(tile);
    this.mark(p.x, p.y);
  }

  private drop(id: string, rawItem: ItemId, rawQty: number): void {
    const { p, tile, now } = this.actor(id);
    const item = itemId(rawItem);
    const stack = takeItems(p.inv, item, posInt(rawQty));
    if (stack.qty <= 0) throw new GameError('背包裡沒有這個物品');
    addItems(tile.ground, item, stack.qty, stack.dur, now);
    this.saveTile(tile);
    this.savePlayer(p);
    this.mark(p.x, p.y);
  }

  private pickup(id: string, rawItem: ItemId, rawQty: number): void {
    const { p, tile, now } = this.actor(id);
    const item = itemId(rawItem);
    if (countOf(tile.ground, item) <= 0) throw new GameError('地面上沒有這個物品');
    const room = Math.floor((capacityOf(p.inv) - weightOf(p.inv)) / ITEMS[item].weight);
    if (room <= 0) throw new GameError('背包已滿');
    const stack = takeItems(tile.ground, item, Math.min(posInt(rawQty), room));
    addItems(p.inv, item, stack.qty, stack.dur, now);
    this.saveTile(tile);
    this.savePlayer(p);
    this.mark(p.x, p.y);
  }

  private eat(id: string, rawItem: ItemId): void {
    const { p, now } = this.actor(id);
    const item = itemId(rawItem);
    const minutes = ITEMS[item].fedMinutes;
    if (!minutes) throw new GameError('這個物品不能吃');
    if (takeItems(p.inv, item, 1).qty <= 0) throw new GameError('背包裡沒有這個物品');
    p.fedUntil = Math.max(p.fedUntil, now) + minutes * MINUTE;
    this.savePlayer(p);
  }

  // --- time ---

  // Brings a player's action and AP to `now`.
  private settle(p: Player, now: number): void {
    if (p.action) {
      const end = this.advance(p, p.action, now);
      if (end !== null) {
        const at = Math.max(p.apAt, Math.min(end, now));
        p.ap = apNow(p.ap, p.apAt, at, at);
        p.apAt = at;
        p.action = null;
        this.savePlayer(p);
        this.mark(p.x, p.y);
      }
    }
    p.ap = apNow(p.ap, p.apAt, p.action ? Infinity : null, now);
    p.apAt = now;
  }

  // Applies what an action has reached by `now`. Returns the time the action ended, or null while it goes on.
  private advance(p: Player, a: Action, now: number): number | null {
    const elapsed = now - a.t0 + a.skip;
    // Time at which the action reaches `ms` of its length.
    const reached = (ms: number) => Math.max(a.floorAt, a.t0 + ms - a.skip);

    if (a.kind === 'move') {
      let stepped = false;
      while (a.done < a.path.length && elapsed >= a.ends[a.done]) {
        const at = reached(a.ends[a.done]);
        const to = a.path[a.done];
        this.mark(p.x, p.y);
        p.x = to.x;
        p.y = to.y;
        this.mark(p.x, p.y);
        p.prof.walk += STEP_MINUTES;
        a.done++;
        stepped = true;
        if (a.done === a.path.length || this.animalAt(to.x, to.y, at)) return at;
      }
      if (stepped) this.savePlayer(p);
      return null;
    }

    if (a.kind === 'gather' || a.kind === 'craft') {
      if (elapsed < a.totalMs) return null;
      this.finishRounds(p, this.tile(p.x, p.y), a, a.rounds, now);
      return reached(a.totalMs);
    }

    if (a.kind === 'build') {
      const tile = this.tile(p.x, p.y);
      this.refresh(tile, now);
      const site = tile.structure;
      if (!site || site.done) return now;
      const unitMs = a.totalMs / a.minutes;
      const units = Math.min(a.minutes, Math.floor(Math.min(elapsed, a.totalMs) / unitMs + 1e-9));
      const before = a.credited;
      while (a.credited < units) {
        a.credited++;
        site.progress++;
        site.log[p.id] ??= { name: p.name, minutes: 0 };
        site.log[p.id].minutes++;
        p.prof.build++;
        if (site.progress >= BUILDINGS[site.type].minutes) {
          site.done = true;
          site.dur = 1;
          site.durAt = reached(a.credited * unitMs);
          break;
        }
      }
      if (a.credited > before) {
        this.saveTile(tile);
        this.savePlayer(p);
        this.mark(p.x, p.y);
      }
      if (site.done) return site.durAt;
      return elapsed >= a.totalMs ? reached(a.totalMs) : null;
    }

    const tile = this.tile(p.x, p.y);
    if (tile.killed === a.period) return now;
    if (elapsed < a.totalMs) return null;
    tile.killed = a.period;
    this.saveTile(tile);
    const drops = ANIMALS[a.animal].drops;
    for (const item of ITEM_IDS) this.give(p, tile, item, drops[item] ?? 0, 1, now);
    p.prof.fight += ANIMALS[a.animal].fightMinutes;
    return reached(a.totalMs);
  }

  // Ends a gathering or crafting action after `done` finished rounds: hands out the products and returns the rest.
  private finishRounds(p: Player, tile: Tile, a: Extract<Action, { kind: 'gather' | 'craft' }>, done: number, now: number): void {
    const rounds = Math.max(0, Math.min(a.rounds, done));
    const left = a.rounds - rounds;
    if (a.kind === 'gather') {
      this.give(p, tile, a.item, rounds * a.yield, 1, now);
      const resource = TERRAINS[this.terrain(tile)].resource;
      if (tile.stock && resource) tile.stock.amount = Math.min(resource.max, tile.stock.amount + left * a.yield);
      p.prof[a.attr] += a.minutes * rounds;
    } else {
      const recipe = ITEMS[a.item].recipe!;
      this.give(p, tile, a.item, rounds, 1, now);
      for (const mat of ITEM_IDS) {
        const stack = a.inputs[mat];
        if (stack) this.give(p, tile, mat, (recipe.mats[mat] ?? 0) * left, stackDur(mat, stack, now), now);
      }
      p.prof.craft += recipe.minutes * rounds;
    }
    this.saveTile(tile);
    this.mark(tile.x, tile.y);
  }

  // Puts items into the backpack. What the backpack cannot hold goes to the ground of the tile.
  private give(p: Player, tile: Tile, item: ItemId, qty: number, dur: number, now: number): void {
    if (qty <= 0) return;
    settleInv(p.inv, now);
    this.refresh(tile, now);
    const room = Math.max(0, Math.floor((capacityOf(p.inv) - weightOf(p.inv)) / ITEMS[item].weight));
    const packed = Math.min(qty, room);
    addItems(p.inv, item, packed, dur, now);
    addItems(tile.ground, item, qty - packed, dur, now);
  }

  // --- tiles ---

  // The stored state of a tile, created when the tile has none yet.
  tile(x: number, y: number): Tile {
    const key = tileKey(x, y);
    let tile = this.tiles.get(key);
    if (!tile) {
      const terrain = terrainOf(this.map, x, y);
      if (!terrain) throw new Error(`tile ${key} is outside the map`);
      const resource = TERRAINS[terrain].resource;
      tile = { x, y, stock: resource ? { amount: resource.max, at: 0 } : null, structure: null, ground: {}, killed: null };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  // The wild animal on a tile at time `t`.
  animalAt(x: number, y: number, t: number): { animal: AnimalId; period: number } | null {
    const terrain = terrainOf(this.map, x, y);
    if (!terrain || this.structureAt(x, y, t)) return null;
    const killed = this.tiles.get(tileKey(x, y))?.killed ?? null;
    const period = wildlifePeriod(this.seed, x, y, t);
    const animal = killed === period ? null : this.wildlife(x, y, terrain, period);
    if (animal) return { animal, period };
    // An animal in a fight stays until the fight ends.
    for (const p of this.players.values()) {
      const a = p.action;
      if (a?.kind === 'fight' && p.x === x && p.y === y && a.period !== killed) return { animal: a.animal, period: a.period };
    }
    return null;
  }

  // The site or building standing on a tile at time `t`.
  private structureAt(x: number, y: number, t: number): Structure | null {
    const s = this.tiles.get(tileKey(x, y))?.structure;
    return s && structureDur(s, t) > 0 ? s : null;
  }

  private terrain(tile: Tile): Terrain {
    return terrainOf(this.map, tile.x, tile.y)!;
  }

  private groundMult(tile: Tile): number {
    const effect = tile.structure?.done ? BUILDINGS[tile.structure.type].effect : null;
    return effect?.kind === 'preserve' ? effect.mult : 1;
  }

  // Brings a tile to `now`: a worn-out building disappears, items on the ground lose durability, stock regenerates.
  private refresh(tile: Tile, now: number): void {
    const s = tile.structure;
    if (s?.done && structureDur(s, now) <= 0) {
      settleInv(tile.ground, s.durAt + s.dur * STRUCTURE_LIFE_MS, this.groundMult(tile));
      tile.structure = null;
    }
    settleInv(tile.ground, now, this.groundMult(tile));
    const resource = TERRAINS[this.terrain(tile)].resource;
    if (resource && tile.stock) {
      tile.stock = regenStock(tile.stock.amount, tile.stock.at, resource.max, resource.regenPerHour, now);
    }
  }

  // --- state for clients ---

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
    const { p, tile, now } = this.actor(id);
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
        const terrain = terrainOf(this.map, x, y);
        if (!terrain) {
          view.push({ x, y, terrain: null, structure: null, animal: null, online: 0, offline: 0, enter: 1, leave: 1 });
          continue;
        }
        const s = this.structureAt(x, y, now);
        const others = present.get(tileKey(x, y)) ?? [];
        const online = others.filter((o) => this.online.has(o.id)).length;
        view.push({
          x,
          y,
          terrain,
          structure: s ? { type: s.type, done: s.done, tint: tintOf(structureDur(s, now)) } : null,
          animal: this.animalAt(x, y, now)?.animal ?? null,
          online,
          offline: others.length - online,
          ...passMults(terrain, s),
        });
      }
    }

    const resource = TERRAINS[this.terrain(tile)].resource;
    const here: Here = {
      x: tile.x,
      y: tile.y,
      terrain: this.terrain(tile),
      stock: resource && tile.stock ? { item: resource.item, amount: tile.stock.amount, max: resource.max } : null,
      structure: tile.structure,
      animal: this.animalAt(tile.x, tile.y, now)?.animal ?? null,
      ground: tile.ground,
      players: [p, ...(present.get(tileKey(tile.x, tile.y)) ?? [])].map((o) => ({
        name: o.name,
        online: this.online.has(o.id),
        action: o.action?.kind ?? null,
      })),
    };
    const { id: _id, action, ...rest } = p;
    return { t: 'state', now, me: { ...rest, action: action ? this.actionView(action) : null }, view, here };
  }

  private actionView(a: Action): ActionView {
    const endAt = a.t0 + a.totalMs - a.skip;
    const view: ActionView = { kind: a.kind, startAt: endAt - a.totalMs, endAt };
    if (a.kind === 'move') view.dest = a.path[a.path.length - 1];
    if (a.kind === 'gather' || a.kind === 'craft') {
      view.item = a.item;
      view.rounds = a.rounds;
    }
    if (a.kind === 'fight') view.animal = a.animal;
    return view;
  }

  // --- helpers ---

  // The player and the tile under it, both brought to the current time.
  private actor(id: string): { p: Player; tile: Tile; now: number } {
    const p = this.players.get(id);
    if (!p) throw new GameError('找不到角色');
    const now = this.now();
    this.settle(p, now);
    settleInv(p.inv, now);
    const tile = this.tile(p.x, p.y);
    this.refresh(tile, now);
    return { p, tile, now };
  }

  // The same, for a player that starts an action.
  private idle(id: string): { p: Player; tile: Tile; now: number } {
    const found = this.actor(id);
    if (found.p.action) throw new GameError('角色正在行動中，請先等它結束或中止');
    return found;
  }

  private start(p: Player, action: Action): void {
    p.action = action;
    this.savePlayer(p);
    this.mark(p.x, p.y);
  }

  private fedMult(p: Player, now: number): number {
    return p.fedUntil > now ? FED_MULT : 1;
  }

  private mark(x: number, y: number): void {
    this.dirtyTiles.add(tileKey(x, y));
  }

  private saveTile(tile: Tile): void {
    this.store.saveTile(tile);
  }

  private savePlayer(p: Player): void {
    this.dirtyPlayers.add(p.id);
    this.store.savePlayer(p);
  }

  private drain(): Changes {
    const changes = { tiles: [...this.dirtyTiles], players: [...this.dirtyPlayers] };
    this.dirtyTiles.clear();
    this.dirtyPlayers.clear();
    return changes;
  }
}
