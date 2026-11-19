import {
  AP_CAP,
  ATTRS,
  ATTR_IDS,
  BACKPACK_CAPACITY,
  BUILDINGS,
  BUILDING_IDS,
  ITEMS,
  ITEM_IDS,
  TERRAINS,
  TRANSFER_AP,
} from '../shared/data.ts';
import type { Inv, ItemId } from '../shared/data.ts';
import type { ClientMsg, Dir, ServerMsg, Structure } from '../shared/protocol.ts';
import {
  apCost,
  buildingMult,
  levelOf,
  profForLevel,
  regenAp,
  skillMult,
  toolMult,
  weightOf,
} from '../shared/rules.ts';
import { TILE, drawMap } from './sprites.ts';

type State = Extract<ServerMsg, { t: 'state' }>;

declare const google: {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
      renderButton(parent: HTMLElement, options: Record<string, string>): void;
    };
  };
};

const SESSION_KEY = 'village-session';
// Matches CLOSE_AUTH in server/app.ts.
const CLOSE_AUTH = 4401;
const RECONNECT_MS = 2000;
const CHAT_LINES = 100;
// Index in the 5x5 view of the tile next to the viewer in each direction.
const NEIGHBOUR: Record<Dir, number> = { n: 7, w: 11, e: 13, s: 17 };
const DIR_NAME: Record<Dir, string> = { n: '北', w: '西', e: '東', s: '南' };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let ws: WebSocket | null = null;
let state: State | null = null;
// Server clock minus local clock.
let clockOffset = 0;
let toastTimer = 0;

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function loadSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function saveSession(session: string | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, session);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // The session then lasts until the page closes.
  }
}

function show(screen: 'login' | 'naming' | 'game'): void {
  for (const id of ['login', 'naming', 'game']) $(id).hidden = id !== screen;
}

function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2500);
}

function send(msg: ClientMsg): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else toast('尚未連線');
}

function act(msg: ClientMsg): string {
  return `data-act="${esc(JSON.stringify(msg))}"`;
}

// --- login ---

function loadScript(src: string): Promise<void> {
  return new Promise((done, fail) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => done();
    el.onerror = () => fail(new Error(`cannot load ${src}`));
    document.head.append(el);
  });
}

let loginReady = false;

async function showLogin(): Promise<void> {
  show('login');
  if (loginReady) return;
  const msg = $('login-msg');
  try {
    const { googleClientId } = (await (await fetch('/api/config')).json()) as { googleClientId: string };
    if (!googleClientId) {
      msg.textContent = '伺服器尚未設定 GOOGLE_CLIENT_ID。';
      return;
    }
    await loadScript('https://accounts.google.com/gsi/client');
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async ({ credential }) => {
        const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ credential }) });
        if (!res.ok) {
          msg.textContent = 'Google 登入驗證失敗，請再試一次。';
          return;
        }
        const { session } = (await res.json()) as { session: string };
        saveSession(session);
        connect(session);
      },
    });
    google.accounts.id.renderButton($('google-button'), { theme: 'filled_blue', size: 'large', shape: 'rectangular' });
    loginReady = true;
  } catch {
    msg.textContent = '無法載入 Google 登入，請確認網路連線後重新整理。';
  }
}

// --- connection ---

function connect(session: string): void {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/ws?session=${encodeURIComponent(session)}`);
  ws = socket;
  socket.onmessage = (e) => handle(JSON.parse(String(e.data)) as ServerMsg);
  socket.onclose = (e) => {
    if (ws !== socket) return;
    if (e.code === CLOSE_AUTH) {
      saveSession(null);
      void showLogin();
      return;
    }
    toast('連線中斷，重新連線中');
    setTimeout(() => connect(session), RECONNECT_MS);
  };
}

function handle(msg: ServerMsg): void {
  if (msg.t === 'needName') {
    show('naming');
    $('name-input').focus();
  } else if (msg.t === 'state') {
    state = msg;
    clockOffset = msg.now - Date.now();
    show('game');
    render();
  } else if (msg.t === 'chat') {
    addChat(msg);
  } else {
    toast(msg.msg);
  }
}

// --- rendering ---

function currentAp(s: State): number {
  return regenAp(s.me.ap, s.me.apAt, Date.now() + clockOffset).ap;
}

function invText(inv: Inv): string {
  return ITEM_IDS.filter((id) => (inv[id] ?? 0) > 0)
    .map((id) => `${ITEMS[id].name} ${inv[id]}`)
    .join('、');
}

function renderStatus(s: State): void {
  $('status').innerHTML =
    `<span class="name">${esc(s.me.name)}</span>` +
    `<span>AP <b>${currentAp(s).toLocaleString()}</b> / ${AP_CAP.toLocaleString()}</span>` +
    `<span>位置 (${s.me.x}, ${s.me.y})</span>` +
    `<span>背包 ${weightOf(s.me.inv)} / ${BACKPACK_CAPACITY}</span>`;
}

function renderMap(s: State): void {
  const canvas = $<HTMLCanvasElement>('map');
  const side = Math.sqrt(s.view.length) * TILE;
  const room = Math.min($('map-panel').clientWidth - 30, 480);
  const scale = Math.max(1, Math.floor(room / side));
  canvas.style.width = `${side * scale}px`;
  canvas.style.height = `${side * scale}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) drawMap(ctx, s.view);
}

function renderDpad(s: State): void {
  const walk = skillMult(s.me.prof.walk);
  const buttons = (Object.keys(NEIGHBOUR) as Dir[]).map((dir) => {
    const tile = s.view[NEIGHBOUR[dir]];
    if (tile.terrain === null) {
      return `<button style="grid-area:${dir}" disabled>${DIR_NAME[dir]}<small>邊界</small></button>`;
    }
    const cost = apCost(tile.enterAp, walk);
    return (
      `<button style="grid-area:${dir}" ${act({ t: 'move', dir })}>` +
      `${DIR_NAME[dir]} ${TERRAINS[tile.terrain].name}<small>${cost} AP</small></button>`
    );
  });
  $('dpad').innerHTML = buttons.join('') + `<div class="center">(${s.me.x}, ${s.me.y})</div>`;
}

function bar(label: string, have: number, need: number): string {
  const pct = need > 0 ? Math.min(100, (have / need) * 100) : 100;
  return `<div class="bar"><i style="width:${pct}%"></i><span>${esc(label)} ${have}/${need}</span></div>`;
}

function renderSite(s: State, site: Structure): string {
  const def = BUILDINGS[site.type];
  const rows: string[] = [];
  for (const item of ITEM_IDS) {
    const need = def.mats[item] ?? 0;
    if (need === 0) continue;
    const have = site.mats[item] ?? 0;
    const can = Math.min(need - have, s.me.inv[item] ?? 0);
    const off = can > 0 ? '' : 'disabled';
    rows.push(
      `<div class="row">${bar(ITEMS[item].name, have, need)}` +
        `<button ${off} ${act({ t: 'giveMat', id: site.id, item, qty: 5 })}>貢獻 5</button>` +
        `<button ${off} ${act({ t: 'giveMat', id: site.id, item, qty: need })}>貢獻全部</button></div>`,
    );
  }
  const left = def.ap - site.ap;
  const off = left > 0 ? '' : 'disabled';
  const mult = skillMult(s.me.prof.build);
  rows.push(
    `<div class="row">${bar('AP', site.ap, def.ap)}` +
      [10, 60, left]
        .map((qty, n) => {
          const label = n === 2 ? '貢獻全部' : `貢獻 ${qty}`;
          const cost = apCost(Math.max(1, Math.min(qty, left)), mult);
          return `<button ${off} ${act({ t: 'giveAp', id: site.id, qty: Math.max(1, qty) })} title="花費 ${cost} AP">${label}</button>`;
        })
        .join('') +
      '</div>',
  );
  return rows.join('');
}

function renderStorage(s: State, building: Structure): string {
  const rows: string[] = [];
  const line = (where: string, item: ItemId, qty: number, verb: string, t: 'deposit' | 'withdraw') =>
    `<div class="row"><span class="grow">${where} ${ITEMS[item].name} ${qty}</span>` +
    `<button ${act({ t, id: building.id, item, qty: 5 })}>${verb} 5</button>` +
    `<button ${act({ t, id: building.id, item, qty })}>${verb}全部</button></div>`;
  for (const item of ITEM_IDS) {
    const stored = building.storage[item] ?? 0;
    if (stored > 0) rows.push(line('倉庫', item, stored, '取出', 'withdraw'));
  }
  for (const item of ITEM_IDS) {
    const carried = s.me.inv[item] ?? 0;
    if (carried > 0) rows.push(line('背包', item, carried, '存入', 'deposit'));
  }
  if (rows.length === 0) rows.push('<div class="row muted">倉庫與背包都是空的</div>');
  return rows.join('') + `<div class="row muted">每次存取花費 ${TRANSFER_AP} AP</div>`;
}

function renderCrafting(s: State): string {
  return ITEM_IDS.filter((id) => ITEMS[id].recipe)
    .map((id) => {
      const recipe = ITEMS[id].recipe!;
      const cost = apCost(recipe.ap, skillMult(s.me.prof.craft));
      const enough = ITEM_IDS.every((mat) => (s.me.inv[mat] ?? 0) >= (recipe.mats[mat] ?? 0));
      return (
        `<div class="row"><span class="grow">${ITEMS[id].name}：${invText(recipe.mats)}</span>` +
        `<button ${enough ? '' : 'disabled'} ${act({ t: 'craft', item: id })}>製作 (${cost} AP)</button></div>`
      );
    })
    .join('');
}

function renderLog(structure: Structure): string {
  const entries = Object.values(structure.log);
  if (entries.length === 0) return '';
  const lines = entries
    .map((e) => `<div>${esc(e.name)}：${[invText(e.mats), e.ap > 0 ? `AP ${e.ap}` : ''].filter(Boolean).join('、')}</div>`)
    .join('');
  return `<details data-keep="log-${structure.id}"><summary>貢獻紀錄</summary>${lines}</details>`;
}

function renderStructure(s: State, structure: Structure): string {
  const def = BUILDINGS[structure.type];
  let body: string;
  if (!structure.done) body = renderSite(s, structure);
  else {
    body = `<div class="muted">${esc(def.effectText)}</div>`;
    if (def.effect.kind === 'unlock') body += renderCrafting(s);
    if (def.effect.kind === 'storage') body += renderStorage(s, structure);
  }
  const tag = structure.done ? '<span class="tag done">建築</span>' : '<span class="tag">工地</span>';
  return `<div class="structure"><div class="structure-title">${def.name}${tag}</div>${body}${renderLog(structure)}</div>`;
}

function renderTile(s: State): void {
  const panel = $('tile-panel');
  const open = new Set(
    [...panel.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.keep ?? ''),
  );
  const { here } = s;
  const parts: string[] = [`<h2>所在格 (${here.x}, ${here.y}) ${TERRAINS[here.terrain].name}</h2>`];

  const resource = TERRAINS[here.terrain].resource;
  if (resource && here.stock) {
    const cost = apCost(
      resource.gatherAp,
      skillMult(s.me.prof[resource.attr]),
      toolMult(s.me.inv, resource.attr),
      buildingMult(here.structures, resource.attr),
    );
    parts.push(
      `<div class="row">${bar(`${ITEMS[resource.item].name}存量`, here.stock.amount, here.stock.max)}` +
        `<button ${here.stock.amount > 0 ? '' : 'disabled'} ${act({ t: 'gather' })}>${resource.action} (${cost} AP)</button></div>`,
    );
  } else {
    parts.push('<div class="row muted">這一格沒有可採集的資源</div>');
  }

  parts.push('<h3>建築與工地</h3>');
  if (here.structures.length === 0) parts.push('<div class="row muted">這一格還沒有建築</div>');
  for (const structure of here.structures) parts.push(renderStructure(s, structure));

  const menu = BUILDING_IDS.map((id) => {
    const def = BUILDINGS[id];
    return (
      `<button ${act({ t: 'place', building: id })}>${def.name}</button>` +
      `<small>${invText(def.mats)}、AP ${def.ap}<br>${esc(def.effectText)}</small>`
    );
  }).join('');
  parts.push(`<details data-keep="place"><summary>放下工地 (免費)</summary><div class="place">${menu}</div></details>`);

  parts.push('<h3>在場玩家</h3>');
  parts.push(
    `<div class="row">${here.players
      .map((p) => `<span><i class="dot ${p.online ? 'on' : ''}"></i>${esc(p.name)}${p.online ? '' : ' (離線)'}</span>`)
      .join('')}</div>`,
  );

  panel.innerHTML = parts.join('');
  for (const d of panel.querySelectorAll<HTMLDetailsElement>('details')) d.open = open.has(d.dataset.keep ?? '');
}

function renderSelf(s: State): void {
  const items = ITEM_IDS.filter((id) => (s.me.inv[id] ?? 0) > 0).map((id) => {
    const def = ITEMS[id];
    const note = def.tool ? `${ATTRS[def.tool.attr].name} AP x${def.tool.apMult}` : '材料';
    return `<div class="row"><span class="grow">${def.name} x${s.me.inv[id]}</span><span class="muted">${note}</span></div>`;
  });
  const attrs = ATTR_IDS.map((id) => {
    const prof = s.me.prof[id];
    const level = levelOf(prof);
    return `<div class="row"><span class="grow">${ATTRS[id].name} Lv${level}</span>${bar('熟練度', prof, profForLevel(level + 1))}</div>`;
  });
  $('self-panel').innerHTML =
    `<h2>背包 ${weightOf(s.me.inv)} / ${BACKPACK_CAPACITY}</h2>` +
    (items.join('') || '<div class="row muted">背包是空的</div>') +
    '<h3>屬性</h3>' +
    attrs.join('');
}

function render(): void {
  if (!state) return;
  renderStatus(state);
  renderMap(state);
  renderDpad(state);
  renderTile(state);
  renderSelf(state);
}

function addChat(msg: Extract<ServerMsg, { t: 'chat' }>): void {
  const log = $('chat-log');
  const line = document.createElement('div');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = `${msg.name} (${msg.x}, ${msg.y})：`;
  line.append(who, msg.text);
  log.append(line);
  while (log.childElementCount > CHAT_LINES) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}

// --- input ---

document.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (button?.dataset.act) send(JSON.parse(button.dataset.act) as ClientMsg);
});

const ARROWS: Record<string, Dir> = { ArrowUp: 'n', ArrowDown: 's', ArrowLeft: 'w', ArrowRight: 'e' };
document.addEventListener('keydown', (e) => {
  const dir = ARROWS[e.key];
  if (!dir || !state || $('game').hidden || e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  send({ t: 'move', dir });
});

$('name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  send({ t: 'create', name: $<HTMLInputElement>('name-input').value });
});

$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('chat-input');
  if (input.value.trim()) send({ t: 'chat', text: input.value });
  input.value = '';
});

window.addEventListener('resize', () => state && renderMap(state));
setInterval(() => state && renderStatus(state), 1000);

const session = loadSession();
if (session) connect(session);
else void showLogin();
