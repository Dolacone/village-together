import { DatabaseSync } from 'node:sqlite';
import type { Player, Tile } from '../shared/protocol.ts';
import { tileKey } from './world.ts';
import type { Store } from './world.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tiles (key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (email TEXT PRIMARY KEY, player_id TEXT NOT NULL);
`;

export class Db implements Store {
  db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? String(row.value) : undefined;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  loadTiles(): Tile[] {
    return this.db.prepare('SELECT data FROM tiles').all().map((row) => JSON.parse(String(row.data)) as Tile);
  }

  loadPlayers(): Player[] {
    return this.db.prepare('SELECT data FROM players').all().map((row) => JSON.parse(String(row.data)) as Player);
  }

  saveTile(tile: Tile): void {
    this.db
      .prepare('INSERT INTO tiles (key, data) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET data = excluded.data')
      .run(tileKey(tile.x, tile.y), JSON.stringify(tile));
  }

  savePlayer(player: Player): void {
    this.db
      .prepare('INSERT INTO players (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data')
      .run(player.id, JSON.stringify(player));
  }

  playerIdFor(email: string): string | undefined {
    const row = this.db.prepare('SELECT player_id FROM accounts WHERE email = ?').get(email);
    return row ? String(row.player_id) : undefined;
  }

  link(email: string, playerId: string): void {
    this.db.prepare('INSERT INTO accounts (email, player_id) VALUES (?, ?)').run(email, playerId);
  }

  close(): void {
    this.db.close();
  }
}
