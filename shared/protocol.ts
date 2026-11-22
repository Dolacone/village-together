import type { AnimalId, Attr, BuildingId, Inv, ItemId, Terrain } from './data.ts';

export type Pos = { x: number; y: number };

export type Structure = {
  type: BuildingId;
  // false = site (工地), true = building (建築)
  done: boolean;
  // minutes of building put into the site
  progress: number;
  // minutes of building, keyed by player id
  log: Record<string, { name: string; minutes: number }>;
  // durability (0 to 1) of a building at time `durAt`
  dur: number;
  durAt: number;
};

export type Stock = { amount: number; at: number };

// Stored state of a tile. A tile without stored state has full stock and nothing on it.
export type Tile = {
  x: number;
  y: number;
  stock: Stock | null;
  structure: Structure | null;
  ground: Inv;
  // wildlife period in which the animal of the tile was defeated
  killed: number | null;
};

// `t0` is the start time, `skip` the time removed by acceleration, `floorAt` the time of the last acceleration.
// The action ends at `t0 + totalMs - skip`.
type ActionBase = { t0: number; skip: number; floorAt: number; totalMs: number };

export type Action = ActionBase &
  (
    | { kind: 'move'; path: Pos[]; ends: number[]; done: number }
    | { kind: 'gather'; item: ItemId; attr: Attr; rounds: number; roundMs: number; minutes: number; yield: number }
    | { kind: 'craft'; item: ItemId; rounds: number; roundMs: number; inputs: Inv }
    | { kind: 'build'; minutes: number; credited: number }
    | { kind: 'fight'; animal: AnimalId; period: number }
  );

export type ActionKind = Action['kind'];

export type Player = {
  id: string;
  name: string;
  x: number;
  y: number;
  ap: number;
  apAt: number;
  inv: Inv;
  prof: Record<Attr, number>;
  action: Action | null;
  fedUntil: number;
};

export type ViewStructure = { type: BuildingId; done: boolean; tint: 0 | 1 | 2 };

export type ViewTile = {
  x: number;
  y: number;
  // null = outside the map
  terrain: Terrain | null;
  structure: ViewStructure | null;
  animal: AnimalId | null;
  // other players on the tile, the viewer excluded
  online: number;
  offline: number;
  // step time multipliers of the tile, buildings included
  enter: number;
  leave: number;
};

export type Here = {
  x: number;
  y: number;
  terrain: Terrain;
  stock: { item: ItemId; amount: number; max: number } | null;
  structure: Structure | null;
  animal: AnimalId | null;
  ground: Inv;
  players: { name: string; online: boolean; action: ActionKind | null }[];
};

export type ActionView = {
  kind: ActionKind;
  // `endAt` minus the full length of the action
  startAt: number;
  endAt: number;
  item?: ItemId;
  rounds?: number;
  animal?: AnimalId;
  dest?: Pos;
};

export type Me = Omit<Player, 'id' | 'action'> & { action: ActionView | null };

export type ServerMsg =
  | { t: 'needName' }
  | { t: 'state'; now: number; me: Me; view: ViewTile[]; here: Here }
  | { t: 'chat'; name: string; x: number; y: number; text: string; ts: number }
  | { t: 'error'; msg: string };

export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'move'; x: number; y: number }
  | { t: 'gather'; rounds: number }
  | { t: 'craft'; item: ItemId; rounds: number }
  | { t: 'build'; minutes: number }
  | { t: 'fight' }
  | { t: 'cancel' }
  | { t: 'speed'; ap: number }
  | { t: 'place'; building: BuildingId }
  | { t: 'repair' }
  | { t: 'drop'; item: ItemId; qty: number }
  | { t: 'pickup'; item: ItemId; qty: number }
  | { t: 'eat'; item: ItemId }
  | { t: 'chat'; text: string };
