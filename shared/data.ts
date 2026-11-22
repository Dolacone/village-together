// Game data tables. Display names follow requirements/GLOSSARY.md.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const MAP_SIZE = 500;
export const VIEW_RADIUS = 6;

export const AP_CAP = 10_000;
export const AP_PER_MIN_ACTING = 1;
export const AP_PER_MIN_IDLE = 1.5;
export const START_AP = AP_CAP;

export const BACKPACK_CAPACITY = 50;
// Minutes to walk one step before terrain, building, attribute, and fed multipliers.
export const STEP_MINUTES = 10;
// Time multiplier of an action started while fed.
export const FED_MULT = 0.9;
// Most rounds one gathering or crafting action accepts.
export const MAX_ROUNDS = 999;

export const STRUCTURE_LIFE_MS = 30 * DAY;
export const TINT_WORN = 0.7;
export const TINT_RUINED = 0.2;

// A tile holds a wild animal in `WILDLIFE_DENSITY` of the periods of `WILDLIFE_PERIOD_MS`.
export const WILDLIFE_PERIOD_MS = 6 * HOUR;
export const WILDLIFE_DENSITY = 0.15;

export type Terrain = 'grass' | 'forest' | 'waste' | 'mountain' | 'river' | 'coast' | 'peak';
export type ItemId =
  | 'wood'
  | 'stone'
  | 'hide'
  | 'silk'
  | 'rawMeat'
  | 'roastMeat'
  | 'axe'
  | 'pickaxe'
  | 'spear'
  | 'pouch';
export type Attr = 'walk' | 'chop' | 'mine' | 'build' | 'craft' | 'fight';
export type BuildingId = 'road' | 'bridge' | 'workshop' | 'storehouse' | 'campfire';
export type AnimalId = 'rat' | 'rabbit' | 'wolf' | 'spider' | 'bear' | 'snake' | 'goat';
export type ItemKind = 'material' | 'tool' | 'food';

// Item quantities, as in a recipe or a list of drops.
export type Counts = Partial<Record<ItemId, number>>;
// Items of one kind in one place. `dur` is the durability (0 to 1) at time `at`.
export type Stack = { qty: number; dur: number; at: number };
export type Inv = Partial<Record<ItemId, Stack>>;

export const ATTRS: Record<Attr, { name: string }> = {
  walk: { name: '行走' },
  chop: { name: '伐木' },
  mine: { name: '採礦' },
  build: { name: '建造' },
  craft: { name: '製作' },
  fight: { name: '戰鬥' },
};

export type ResourceDef = {
  item: ItemId;
  action: string;
  attr: Attr;
  max: number;
  regenPerHour: number;
  // Minutes and yield of one round.
  minutes: number;
  yield: number;
};

export type TerrainDef = {
  name: string;
  passable: boolean;
  // Multipliers of the step time when a character enters or leaves the tile.
  enterMult: number;
  leaveMult: number;
  resource?: ResourceDef;
  // Wild animals of the terrain with their share. The shares add up to 1.
  animals: [AnimalId, number][];
};

export const TERRAINS: Record<Terrain, TerrainDef> = {
  grass: {
    name: '草地',
    passable: true,
    enterMult: 1,
    leaveMult: 1,
    animals: [['rat', 0.6], ['rabbit', 0.3], ['wolf', 0.1]],
  },
  forest: {
    name: '森林',
    passable: true,
    enterMult: 1,
    leaveMult: 1.25,
    resource: { item: 'wood', action: '伐木', attr: 'chop', max: 100, regenPerHour: 2, minutes: 10, yield: 1 },
    animals: [['wolf', 0.6], ['spider', 0.3], ['bear', 0.1]],
  },
  waste: {
    name: '荒地',
    passable: true,
    enterMult: 1,
    leaveMult: 1,
    animals: [['snake', 0.6], ['rat', 0.3], ['wolf', 0.1]],
  },
  mountain: {
    name: '山脈',
    passable: true,
    enterMult: 1,
    leaveMult: 1,
    resource: { item: 'stone', action: '採石', attr: 'mine', max: 100, regenPerHour: 2, minutes: 10, yield: 1 },
    animals: [['goat', 0.6], ['wolf', 0.3], ['bear', 0.1]],
  },
  river: { name: '河流', passable: true, enterMult: 1.75, leaveMult: 1.75, animals: [] },
  coast: { name: '海邊', passable: false, enterMult: 1, leaveMult: 1, animals: [] },
  peak: { name: '高山', passable: false, enterMult: 1, leaveMult: 1, animals: [] },
};

export const ANIMALS: Record<AnimalId, { name: string; fightMinutes: number; drops: Counts }> = {
  rat: { name: '老鼠', fightMinutes: 3, drops: { rawMeat: 1 } },
  rabbit: { name: '兔子', fightMinutes: 5, drops: { rawMeat: 2, hide: 1 } },
  snake: { name: '蛇', fightMinutes: 8, drops: { rawMeat: 2 } },
  goat: { name: '山羊', fightMinutes: 15, drops: { rawMeat: 4, hide: 2 } },
  spider: { name: '蜘蛛', fightMinutes: 15, drops: { silk: 2 } },
  wolf: { name: '狼', fightMinutes: 30, drops: { rawMeat: 3, hide: 2 } },
  bear: { name: '熊', fightMinutes: 90, drops: { rawMeat: 8, hide: 4 } },
};

export const ITEM_LIFE_MS: Record<ItemKind, number> = {
  food: 7 * DAY,
  material: 30 * DAY,
  tool: 30 * DAY,
};

export type ItemDef = {
  name: string;
  kind: ItemKind;
  weight: number;
  // Holding the tool multiplies the time of actions of this attribute.
  tool?: { attr: Attr; mult: number };
  // Holding the tool raises the backpack capacity by this much.
  capacity?: number;
  // Minutes of being fed that eating one adds.
  fedMinutes?: number;
  // One round turns `mats` into one item at a finished building of type `at`.
  recipe?: { mats: Counts; minutes: number; at: BuildingId };
};

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { name: '木材', kind: 'material', weight: 1 },
  stone: { name: '石頭', kind: 'material', weight: 1 },
  hide: { name: '毛皮', kind: 'material', weight: 1 },
  silk: { name: '蜘蛛絲', kind: 'material', weight: 1 },
  rawMeat: { name: '生肉', kind: 'food', weight: 1, fedMinutes: 20 },
  roastMeat: {
    name: '烤肉',
    kind: 'food',
    weight: 1,
    fedMinutes: 120,
    recipe: { mats: { rawMeat: 1 }, minutes: 5, at: 'campfire' },
  },
  axe: {
    name: '石斧',
    kind: 'tool',
    weight: 5,
    tool: { attr: 'chop', mult: 0.8 },
    recipe: { mats: { wood: 5, stone: 5 }, minutes: 30, at: 'workshop' },
  },
  pickaxe: {
    name: '石鎬',
    kind: 'tool',
    weight: 5,
    tool: { attr: 'mine', mult: 0.8 },
    recipe: { mats: { wood: 5, stone: 5 }, minutes: 30, at: 'workshop' },
  },
  spear: {
    name: '石矛',
    kind: 'tool',
    weight: 5,
    tool: { attr: 'fight', mult: 0.7 },
    recipe: { mats: { wood: 5, stone: 3 }, minutes: 30, at: 'workshop' },
  },
  pouch: {
    name: '皮袋',
    kind: 'tool',
    weight: 2,
    capacity: 50,
    recipe: { mats: { hide: 4, silk: 2 }, minutes: 60, at: 'workshop' },
  },
};

export type BuildingEffect =
  // Multiplies the step time when a character enters or leaves the tile.
  | { kind: 'passage'; mult: number }
  // Removes the terrain multipliers of the tile.
  | { kind: 'bridge' }
  // Recipes with `at` equal to the building type become available on the tile.
  | { kind: 'station' }
  // Multiplies the durability loss of items on the ground of the tile.
  | { kind: 'preserve'; mult: number };

export type BuildingDef = {
  name: string;
  mats: Counts;
  // Minutes of building the site needs.
  minutes: number;
  effect: BuildingEffect;
  effectText: string;
};

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  road: {
    name: '道路',
    mats: { stone: 10 },
    minutes: 60,
    effect: { kind: 'passage', mult: 0.8 },
    effectText: '進入與離開本格的移動時間減少 20%',
  },
  bridge: {
    name: '橋梁',
    mats: { wood: 30, stone: 10 },
    minutes: 180,
    effect: { kind: 'bridge' },
    effectText: '取消河流對移動時間的增加',
  },
  workshop: {
    name: '加工廠',
    mats: { wood: 20, stone: 10 },
    minutes: 120,
    effect: { kind: 'station' },
    effectText: '在此製作工具',
  },
  storehouse: {
    name: '倉庫',
    mats: { wood: 40, stone: 20 },
    minutes: 240,
    effect: { kind: 'preserve', mult: 0.5 },
    effectText: '本格地面上的物品，耐久度下降速度減少 50%',
  },
  campfire: {
    name: '營火',
    mats: { wood: 10, stone: 5 },
    minutes: 30,
    effect: { kind: 'station' },
    effectText: '在此烤肉',
  },
};

export const TERRAIN_IDS = Object.keys(TERRAINS) as Terrain[];
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];
export const ATTR_IDS = Object.keys(ATTRS) as Attr[];
export const ANIMAL_IDS = Object.keys(ANIMALS) as AnimalId[];
