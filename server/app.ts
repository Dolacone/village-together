import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { Db } from './db.ts';
import { generateMap } from './mapgen.ts';
import { GameError, World, tileKey } from './world.ts';

export type ServerOptions = {
  port: number;
  dbPath: string;
  staticDir: string;
  // Used when the database holds no world yet.
  seed?: number;
  now?: () => number;
};

export type RunningServer = { port: number; world: World; close: () => Promise<void> };

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Set by the authenticating proxy in front of the game. The game trusts it as the account identity.
export const IDENTITY_HEADER = 'x-auth-request-email';
// WebSocket close code telling the client the request carried no identity.
export const CLOSE_AUTH = 4401;
const STATE_PUSH_MS = 60_000;
const MAX_CHAT = 200;

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const now = opts.now ?? Date.now;
  const db = new Db(opts.dbPath);

  if (!db.getMeta('seed')) {
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    db.saveTiles(generateMap(seed, now()));
    db.setMeta('seed', String(seed));
  }
  const world = new World(db.loadTiles(), db.loadPlayers(), db, now);

  const sockets = new Map<string, Set<WebSocket>>();
  const send = (ws: WebSocket, msg: ServerMsg) => ws.send(JSON.stringify(msg));
  const push = (ids: Iterable<string>) => {
    for (const id of new Set(ids)) {
      const set = sockets.get(id);
      if (!set) continue;
      const state = JSON.stringify(world.stateFor(id));
      for (const ws of set) ws.send(state);
    }
  };

  const staticRoot = resolve(opts.staticDir);
  const serveStatic = async (pathname: string, res: ServerResponse) => {
    const file = resolve(join(staticRoot, normalize(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(staticRoot)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  };

  const server = createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    void serveStatic(new URL(req.url ?? '/', 'http://localhost').pathname, res);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const header = req.headers[IDENTITY_HEADER];
    const email = typeof header === 'string' ? header.trim() : '';
    if (!email) {
      ws.close(CLOSE_AUTH, 'no identity');
      return;
    }
    let playerId = db.playerIdFor(email);

    const here = (id: string): string[] => {
      const p = world.players.get(id);
      return p ? [tileKey(p.x, p.y)] : [];
    };
    const join = (id: string) => {
      let set = sockets.get(id);
      if (!set) sockets.set(id, (set = new Set()));
      set.add(ws);
      world.online.add(id);
      push([id, ...world.viewersOf(here(id))]);
    };

    if (playerId) join(playerId);
    else send(ws, { t: 'needName' });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMsg;
        if (!msg || typeof msg !== 'object') throw new SyntaxError('not an object');
        if (!playerId) {
          if (msg.t !== 'create') return;
          const existing = db.playerIdFor(email);
          if (existing) {
            playerId = existing;
          } else {
            const id = randomUUID();
            world.createPlayer(id, msg.name);
            db.link(email, id);
            playerId = id;
          }
          join(playerId);
          return;
        }
        if (msg.t === 'chat') {
          const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT) : '';
          const p = world.players.get(playerId);
          if (!text || !p) return;
          const line = JSON.stringify({ t: 'chat', name: p.name, x: p.x, y: p.y, text, ts: now() } satisfies ServerMsg);
          for (const set of sockets.values()) for (const peer of set) peer.send(line);
          return;
        }
        const affected = world.act(playerId, msg);
        push([playerId, ...world.viewersOf(affected)]);
      } catch (err) {
        if (err instanceof GameError) send(ws, { t: 'error', msg: err.message });
        else if (err instanceof SyntaxError) send(ws, { t: 'error', msg: '訊息格式錯誤' });
        else {
          console.error('action failed', err);
          send(ws, { t: 'error', msg: '伺服器處理動作時發生錯誤' });
        }
      }
    });

    ws.on('close', () => {
      if (!playerId) return;
      const set = sockets.get(playerId);
      set?.delete(ws);
      if (set && set.size > 0) return;
      sockets.delete(playerId);
      world.online.delete(playerId);
      push(world.viewersOf(here(playerId)));
    });
  });

  // Resource regeneration reaches clients through this periodic push.
  const tick = setInterval(() => push(sockets.keys()), STATE_PUSH_MS);
  tick.unref();

  await new Promise<void>((done) => server.listen(opts.port, done));

  return {
    port: (server.address() as AddressInfo).port,
    world,
    close: async () => {
      clearInterval(tick);
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((done) => wss.close(() => done()));
      await new Promise<void>((done) => server.close(() => done()));
      db.close();
    },
  };
}
