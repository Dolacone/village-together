// Game data tables. Display names follow requirements/GLOSSARY.md.

export const MAP_SIZE = 32;
export const SPAWN = { x: 16, y: 16 };
export const VIEW_RADIUS = 2;

export const AP_CAP = 10_000;
export const AP_REGEN_MS = 60_000;
export const START_AP = AP_CAP;

export const BACKPACK_CAPACITY = 50;
// AP for handing items to a site or a storehouse, or taking them out.
export const TRANSFER_AP = 1;

export type Terrain = 'plain' | 'forest' | 'mountain';
export type ItemId = 'wood' | 'stone' | 'axe' | 'pickaxe';
export type Attr = 'walk' | 'chop' | 'mine' | 'build' | 'craft';
export type BuildingId = 'workshop' | 'lumbercamp' | 'storehouse' | 'road';
export type Inv = Partial<Record<ItemId, number>>;

export const ATTRS: Record<Attr, { name: string }> = {
  walk: { name: '行走' },
  chop: { name: '伐木' },
  mine: { name: '採礦' },
  build: { name: '建造' },
  craft: { name: '製作' },
};

export type ResourceDef = {
  item: ItemId;
  action: string;
  attr: Attr;
  max: number;
  regenPerHour: number;
  gatherAp: number;
  yield: number;
};

export const TERRAINS: Record<Terrain, { name: string; enterAp: number; resource?: ResourceDef }> = {
  plain: { name: '平原', enterAp: 12 },
  forest: {
    name: '森林',
    enterAp: 20,
    resource: { item: 'wood', action: '砍樹', attr: 'chop', max: 100, regenPerHour: 2, gatherAp: 60, yield: 5 },
  },
  mountain: {
    name: '山地',
    enterAp: 40,
    resource: { item: 'stone', action: '採石', attr: 'mine', max: 100, regenPerHour: 2, gatherAp: 60, yield: 5 },
  },
};

export type ItemDef = {
  name: string;
  kind: 'material' | 'tool';
  weight: number;
  // Holding the tool multiplies the AP cost of actions of this attribute.
  tool?: { attr: Attr; apMult: number };
  recipe?: { mats: Inv; ap: number };
};

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { name: '木材', kind: 'material', weight: 1 },
  stone: { name: '石頭', kind: 'material', weight: 1 },
  axe: {
    name: '石斧',
    kind: 'tool',
    weight: 5,
    tool: { attr: 'chop', apMult: 0.8 },
    recipe: { mats: { wood: 5, stone: 5 }, ap: 30 },
  },
  pickaxe: {
    name: '石鎬',
    kind: 'tool',
    weight: 5,
    tool: { attr: 'mine', apMult: 0.8 },
    recipe: { mats: { wood: 5, stone: 5 }, ap: 30 },
  },
};

export type BuildingEffect =
  | { kind: 'unlock'; action: 'craft' }
  | { kind: 'efficiency'; attr: Attr; apMult: number }
  | { kind: 'storage' }
  | { kind: 'passage'; enterMult: number };

export type BuildingDef = {
  name: string;
  mats: Inv;
  ap: number;
  effect: BuildingEffect;
  effectText: string;
  // Higher wins when one tile holds several buildings and the map shows one icon.
  priority: number;
};

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  storehouse: {
    name: '倉庫',
    mats: { wood: 40, stone: 20 },
    ap: 240,
    effect: { kind: 'storage' },
    effectText: '共用倉庫：所有玩家在此存入與取出物品',
    priority: 4,
  },
  workshop: {
    name: '工坊',
    mats: { wood: 20, stone: 10 },
    ap: 120,
    effect: { kind: 'unlock', action: 'craft' },
    effectText: '解鎖動作：在此製作工具',
    priority: 3,
  },
  lumbercamp: {
    name: '伐木場',
    mats: { wood: 30 },
    ap: 180,
    effect: { kind: 'efficiency', attr: 'chop', apMult: 0.7 },
    effectText: '提高效率：此格砍樹的 AP 成本 x0.7',
    priority: 2,
  },
  road: {
    name: '道路',
    mats: { stone: 10 },
    ap: 60,
    effect: { kind: 'passage', enterMult: 0.5 },
    effectText: '改變通行：進入此格的 AP 成本 x0.5',
    priority: 1,
  },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];
export const ATTR_IDS = Object.keys(ATTRS) as Attr[];
