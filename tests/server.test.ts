import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { SPAWN } from '../shared/data.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { CLOSE_AUTH, startServer } from '../server/app.ts';
import type { RunningServer } from '../server/app.ts';

type State = Extract<ServerMsg, { t: 'state' }>;

const dir = mkdtempSync(join(tmpdir(), 'village-'));
const dbPath = join(dir, 'world.db');
let server: RunningServer;

// Stands in for Google: the credential "token:<sub>" belongs to the account <sub>.
const verifier = async (credential: string) => {
  if (!credential.startsWith('token:')) throw new Error('invalid token');
  return credential.slice('token:'.length);
};

const boot = () => startServer({ port: 0, dbPath, clientId: 'test-client', verifier, staticDir: dir, seed: 42 });

before(async () => {
  server = await boot();
});

after(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function login(sub: string): Promise<string> {
  const res = await fetch(`http://localhost:${server.port}/api/login`, {
    method: 'POST',
    body: JSON.stringify({ credential: `token:${sub}` }),
  });
  assert.equal(res.status, 200);
  return ((await res.json()) as { session: string }).session;
}

class Client {
  ws: WebSocket;
  inbox: ServerMsg[] = [];
  waiting: (() => void)[] = [];
  closed: Promise<number>;

  constructor(session: string) {
    this.ws = new WebSocket(`ws://localhost:${server.port}/ws?session=${session}`);
    this.ws.addEventListener('message', (e) => {
      this.inbox.push(JSON.parse(String(e.data)));
      for (const wake of this.waiting.splice(0)) wake();
    });
    this.closed = new Promise((done) => this.ws.addEventListener('close', (e) => done(e.code)));
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

async function enter(sub: string, name: string): Promise<Client> {
  const client = new Client(await login(sub));
  await client.next((m) => m.t === 'needName');
  client.send({ t: 'create', name });
  await client.state();
  return client;
}

// REQ-003 條件 1
test('an invalid Google credential gets no session', async () => {
  const res = await fetch(`http://localhost:${server.port}/api/login`, {
    method: 'POST',
    body: JSON.stringify({ credential: 'forged' }),
  });
  assert.equal(res.status, 401);
});

test('a connection without a known session is closed', async () => {
  const client = new Client('not-a-session');
  assert.equal(await client.closed, CLOSE_AUTH);
});

test('the page learns the Google client id from the server', async () => {
  const res = await fetch(`http://localhost:${server.port}/api/config`);
  assert.deepEqual(await res.json(), { googleClientId: 'test-client' });
});

// REQ-003 條件 2, 3, 4
test('the first login names a character at the spawn point and later logins return to it', async () => {
  const first = new Client(await login('acct-return'));
  await first.next((m) => m.t === 'needName');
  first.send({ t: 'create', name: 'Rita' });
  const spawned = await first.state();
  assert.deepEqual([spawned.me.name, spawned.me.x, spawned.me.y], ['Rita', SPAWN.x, SPAWN.y]);
  first.send({ t: 'move', dir: 'n' });
  await first.state((s) => s.me.y === SPAWN.y - 1);
  await first.close();

  await server.close();
  server = await boot();

  const again = new Client(await login('acct-return'));
  const back = await again.state();
  assert.deepEqual([back.me.name, back.me.x, back.me.y], ['Rita', SPAWN.x, SPAWN.y - 1]);
  await again.close();
});

// REQ-001 條件 1, REQ-002 條件 5, REQ-003 條件 4
test('a player sees another player arrive, act, and go offline in real time', async () => {
  const ann = await enter('acct-ann', 'Ann');
  const bob = await enter('acct-bob', 'Bob');
  await ann.state((s) => s.here.players.some((p) => p.name === 'Bob' && p.online));

  bob.send({ t: 'move', dir: 'e' });
  const moved = await ann.state((s) => s.view[13].online === 1);
  assert.equal(moved.here.players.some((p) => p.name === 'Bob'), false);

  bob.send({ t: 'place', building: 'road' });
  const site = await ann.state((s) => s.view[13].feature === 'site');
  assert.equal(site.view[13].online, 1);

  await bob.close();
  const left = await ann.state((s) => s.view[13].offline === 1);
  assert.equal(left.view[13].online, 0);
  await ann.close();
});

test('a rule violation is reported to the player who caused it', async () => {
  const eve = await enter('acct-eve', 'Eve');
  eve.send({ t: 'gather' });
  const err = await eve.next((m) => m.t === 'error');
  assert.equal(err.t === 'error' && err.msg, '這一格沒有可採集的資源');
  await eve.close();
});

// REQ-006 條件 1
test('a chat message reaches every online player with the sender name and coordinates', async () => {
  const cat = await enter('acct-cat', 'Cat');
  const dan = await enter('acct-dan', 'Dan');
  for (let i = 0; i < 3; i++) dan.send({ t: 'move', dir: 's' });
  await dan.state((s) => s.me.y === SPAWN.y + 3);

  dan.send({ t: 'chat', text: '  need stone here  ' });
  for (const client of [cat, dan]) {
    const msg = await client.next((m) => m.t === 'chat');
    assert.deepEqual(
      msg.t === 'chat' && [msg.name, msg.x, msg.y, msg.text],
      ['Dan', SPAWN.x, SPAWN.y + 3, 'need stone here'],
    );
  }
  await cat.close();
  await dan.close();
});
