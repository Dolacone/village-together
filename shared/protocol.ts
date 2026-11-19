import type { Attr, BuildingId, Inv, ItemId, Terrain } from './data.ts';

export type Contribution = { name: string; mats: Inv; ap: number };

export type Structure = {
  id: string;
  type: BuildingId;
  // false = site (工地), true = building (建築)
  done: boolean;
  mats: Inv;
  ap: number;
  // keyed by player id
  log: Record<string, Contribution>;
  storage: Inv;
};

export type Stock = { amount: number; at: number };

export type Tile = {
  x: number;
  y: number;
  terrain: Terrain;
  stock: Stock | null;
  structures: Structure[];
};

export type Player = {
  id: string;
  name: string;
  x: number;
  y: number;
  ap: number;
  apAt: number;
  inv: Inv;
  prof: Record<Attr, number>;
};

export type Dir = 'n' | 's' | 'e' | 'w';

export type ViewTile = {
  x: number;
  y: number;
  // null = outside the map
  terrain: Terrain | null;
  feature: BuildingId | 'site' | null;
  road: boolean;
  // other players on the tile, the viewer excluded
  online: number;
  offline: number;
  // AP to enter the tile before the walk attribute applies
  enterAp: number;
};

export type Here = {
  x: number;
  y: number;
  terrain: Terrain;
  stock: { item: ItemId; amount: number; max: number } | null;
  structures: Structure[];
  players: { name: string; online: boolean }[];
};

export type Me = Omit<Player, 'id'>;

export type ServerMsg =
  | { t: 'needName' }
  | { t: 'state'; now: number; me: Me; view: ViewTile[]; here: Here }
  | { t: 'chat'; name: string; x: number; y: number; text: string; ts: number }
  | { t: 'error'; msg: string };

export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'move'; dir: Dir }
  | { t: 'gather' }
  | { t: 'place'; building: BuildingId }
  | { t: 'giveMat'; id: string; item: ItemId; qty: number }
  | { t: 'giveAp'; id: string; qty: number }
  | { t: 'craft'; item: ItemId }
  | { t: 'deposit'; id: string; item: ItemId; qty: number }
  | { t: 'withdraw'; id: string; item: ItemId; qty: number }
  | { t: 'chat'; text: string };
