import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { HOUR, MINUTE } from '../shared/data.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { wildlifeAt, wildlifePeriod } from '../shared/rules.ts';
import { CLOSE_AUTH, IDENTITY_HEADER, startServer } from '../server/app.ts';
import type { RunningServer } from '../server/app.ts';
import { generateMap, terrainOf } from '../server/mapgen.ts';

type State = Extract<ServerMsg, { t: 'state' }>;

const SEED = 42;
const map = generateMap(SEED);
const SPAWN = map.spawn;
// Index of the viewer's tile in the 13x13 view, and of the tile east of it.
const CENTRE = 84;
const EAST = 85;

// A moment at which no wild animal stands within 3 tiles of the spawn point.
function quietTime(): number {
  for (let t = 1_800_000_000_000; ; t += HOUR) {
    let animals = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const [x, y] = [SPAWN.x + dx, SPAWN.y + dy];
        if (wildlifeAt(SEED, x, y, terrainOf(map, x, y)!, wildlifePeriod(SEED, x, y, t))) animals++;
      }
    }
    if (animals === 0) return t;
  }
}

const clock = { now: quietTime() };
const dir = mkdtempSync(join(tmpdir(), 'village-'));
const dbPath = join(dir, 'world.db');
let server: RunningServer;

const boot = () => startServer({ port: 0, dbPath, staticDir: dir, seed: SEED, now: () => clock.now });

before(async () => {
  server = await boot();
});

after(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

// A connection as the proxy delivers it: the identity header carries the player's email.
class Client {
  ws: WebSocket;
  inbox: ServerMsg[] = [];
  waiting: (() => void)[] = [];
  closed: Promise<number>;

  constructor(email: string | null) {
    const headers = email === null ? {} : { [IDENTITY_HEADER]: email };
    this.ws = new WebSocket(`ws://localhost:${server.port}/ws`, { headers });
    this.ws.on('message', (data) => {
      this.inbox.push(JSON.parse(String(data)));
      for (const wake of this.waiting.splice(0)) wake();
    });
    this.closed = new Promise((done) => this.ws.on('close', (code) => done(code)));
  }

  // Resolves with the first unread message that matches, dropping the ones before it.
  async next<T extends ServerMsg>(match: (m: ServerMsg) => m is T): Promise<T>;
  async next(match: (m: ServerMsg) => boolean): Promise<ServerMsg>;
  async next(match: (m: ServerMsg) => boolean): Promise<ServerMsg> {
    const deadline = Date.now() + 3000;
    for (;;) {
      const i = this.inbox.findIndex(match);
      if (i >= 0) return this.inbox.splice(0, i + 1)[i];
      if (Date.now() > deadline) throw new Error(`no matching message, inbox: ${JSON.stringify(this.inbox)}`);
      await new Promise<void>((wake) => {
        this.waiting.push(wake);
        setTimeout(wake, 100);
      });
    }
  }

  state(match: (s: State) => boolean = () => true): Promise<State> {
    return this.next((m): m is State => m.t === 'state' && match(m));
  }

  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  async close(): Promise<void> {
    this.ws.close();
    await this.closed;
  }
}

async function enter(email: string, name: string): Promise<Client> {
  const client = new Client(email);
  await client.next((m) => m.t === 'needName');
  client.send({ t: 'create', name });
  await client.state();
  return client;
}

// REQ-003 條件 1
test('a connection without the identity from the proxy is closed', async () => {
  const client = new Client(null);
  assert.equal(await client.closed, CLOSE_AUTH);
});

// REQ-003 條件 2, 3, 4
test('the first visit with an email names a character at the spawn point and later visits return to it', async () => {
  const first = new Client('rita@example.com');
  await first.next((m) => m.t === 'needName');
  first.send({ t: 'create', name: 'Rita' });
  const spawned = await first.state();
  assert.deepEqual([spawned.me.name, spawned.me.x, spawned.me.y], ['Rita', SPAWN.x, SPAWN.y]);
  assert.equal(spawned.view.length, 169);
  first.send({ t: 'move', x: SPAWN.x, y: SPAWN.y - 1 });
  await first.state((s) => s.me.action?.kind === 'move');
  first.send({ t: 'speed', ap: 10 });
  await first.state((s) => s.me.y === SPAWN.y - 1);
  await first.close();

  await server.close();
  server = await boot();

  const again = new Client('rita@example.com');
  const back = await again.state();
  assert.deepEqual([back.me.name, back.me.x, back.me.y], ['Rita', SPAWN.x, SPAWN.y - 1]);
  await again.close();
});

// REQ-001 條件 1, REQ-002 條件 7, REQ-003 條件 5
test('a player sees another player act, arrive when the time is up, and go offline in real time', async () => {
  const ann = await enter('ann@example.com', 'Ann');
  const bob = await enter('bob@example.com', 'Bob');
  await ann.state((s) => s.here.players.some((p) => p.name === 'Bob' && p.online));

  bob.send({ t: 'move', x: SPAWN.x + 1, y: SPAWN.y });
  await ann.state((s) => s.here.players.some((p) => p.name === 'Bob' && p.action === 'move'));

  clock.now += 10 * MINUTE;
  const moved = await ann.state((s) => s.view[EAST].online === 1);
  assert.equal(moved.here.players.some((p) => p.name === 'Bob'), false);
  const arrived = await bob.state((s) => s.me.x === SPAWN.x + 1);
  assert.equal(arrived.me.action, null);
  assert.deepEqual([arrived.view[CENTRE].x, arrived.view[CENTRE].y], [SPAWN.x + 1, SPAWN.y]);

  await bob.close();
  const left = await ann.state((s) => s.view[EAST].offline === 1);
  assert.equal(left.view[EAST].online, 0);
  await ann.close();
});

test('a rule violation is reported to the player who caused it', async () => {
  const eve = await enter('eve@example.com', 'Eve');
  eve.send({ t: 'gather', rounds: 1 });
  const err = await eve.next((m) => m.t === 'error');
  assert.equal(err.t === 'error' && err.msg, '這一格沒有可採集的資源');
  await eve.close();
});

// REQ-006 條件 1
test('a chat message reaches every online player with the sender name and coordinates', async () => {
  const cat = await enter('cat@example.com', 'Cat');
  const dan = await enter('dan@example.com', 'Dan');
  dan.send({ t: 'move', x: SPAWN.x, y: SPAWN.y + 1 });
  await dan.state((s) => s.me.action?.kind === 'move');
  dan.send({ t: 'speed', ap: 10 });
  await dan.state((s) => s.me.y === SPAWN.y + 1);

  dan.send({ t: 'chat', text: '  need stone here  ' });
  for (const client of [cat, dan]) {
    const msg = await client.next((m) => m.t === 'chat');
    assert.deepEqual(
      msg.t === 'chat' && [msg.name, msg.x, msg.y, msg.text],
      ['Dan', SPAWN.x, SPAWN.y + 1, 'need stone here'],
    );
  }
  await cat.close();
  await dan.close();
});

test('a database written by another version of the game is refused', async () => {
  const old = join(dir, 'old.db');
  const db = new DatabaseSync(old);
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('seed', '1')");
  db.close();
  await assert.rejects(startServer({ port: 0, dbPath: old, staticDir: dir }), /another version/);
});
