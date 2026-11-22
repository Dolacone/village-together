import {
  ANIMALS,
  AP_CAP,
  ATTRS,
  ATTR_IDS,
  BUILDINGS,
  BUILDING_IDS,
  FED_MULT,
  ITEMS,
  ITEM_IDS,
  MAX_ROUNDS,
  MINUTE,
  RESOURCES,
  STEP_MINUTES,
  TERRAINS,
  VIEW_RADIUS,
} from '../shared/data.ts';
import type { BuildingId, Counts, ItemId } from '../shared/data.ts';
import type { ActionKind, ActionView, ClientMsg, Pos, ServerMsg, Structure } from '../shared/protocol.ts';
import {
  actionMs,
  apNow,
  capacityOf,
  countOf,
  findPath,
  hasCounts,
  levelOf,
  percent,
  profForLevel,
  repairCost,
  skillMult,
  structureDur,
  toolMult,
  weightOf,
} from '../shared/rules.ts';
import { TILE, drawMap } from './sprites.ts';

type State = Extract<ServerMsg, { t: 'state' }>;

// Matches CLOSE_AUTH in server/app.ts.
const CLOSE_AUTH = 4401;
const RECONNECT_MS = 2000;
const CHAT_LINES = 100;
const SPEED_STEP = 10;
const ACTION_NAME: Record<ActionKind, string> = {
  move: '移動',
  gather: '採集',
  craft: '製作',
  build: '建造',
  fight: '戰鬥',
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let ws: WebSocket | null = null;
let state: State | null = null;
// Server clock minus local clock.
let clockOffset = 0;
let toastTimer = 0;
// Tile chosen on the map as the destination.
let selected: Pos | null = null;

const serverNow = () => Date.now() + clockOffset;

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function show(screen: 'notice' | 'naming' | 'game'): void {
  for (const id of ['notice', 'naming', 'game']) $(id).hidden = id !== screen;
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

function button(label: string, msg: ClientMsg, enabled = true): string {
  return `<button ${enabled ? '' : 'disabled'} data-act="${esc(JSON.stringify(msg))}">${label}</button>`;
}

// 1:05:09 or 5:09
function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function countsText(counts: Counts): string {
  return ITEM_IDS.filter((id) => (counts[id] ?? 0) > 0)
    .map((id) => `${ITEMS[id].name} ${counts[id]}`)
    .join('、');
}

// --- connection ---

// The proxy in front of the game attaches the player's identity to the connection.
function connect(): void {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/ws`);
  ws = socket;
  socket.onmessage = (e) => handle(JSON.parse(String(e.data)) as ServerMsg);
  socket.onclose = (e) => {
    if (e.code === CLOSE_AUTH) {
      show('notice');
      return;
    }
    toast('連線中斷，重新連線中');
    setTimeout(connect, RECONNECT_MS);
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

function fedMult(s: State): number {
  return s.me.fedUntil > serverNow() ? FED_MULT : 1;
}

function renderStatus(s: State): void {
  const now = serverNow();
  const ap = Math.floor(apNow(s.me.ap, s.me.apAt, s.me.action ? s.me.action.endAt : null, now));
  const fed = s.me.fedUntil > now ? `<span>飽足 ${clock(s.me.fedUntil - now)}</span>` : '';
  $('status').innerHTML =
    `<span class="name">${esc(s.me.name)}</span>` +
    `<span>AP <b>${ap.toLocaleString()}</b> / ${AP_CAP.toLocaleString()}</span>` +
    `<span>位置 (${s.me.x}, ${s.me.y})</span>` +
    `<span>背包 ${weightOf(s.me.inv)} / ${capacityOf(s.me.inv)}</span>` +
    fed;
}

function actionLabel(a: ActionView): string {
  if (a.kind === 'move' && a.dest) return `移動到 (${a.dest.x}, ${a.dest.y})`;
  if (a.kind === 'fight' && a.animal) return `戰鬥 ${ANIMALS[a.animal].name}`;
  if (a.item) return `${ACTION_NAME[a.kind]} ${ITEMS[a.item].name} x${a.rounds}`;
  return ACTION_NAME[a.kind];
}

// The panel is built once per state. `tickAction` updates the numbers every second, so the buttons stay in place.
function renderAction(s: State): void {
  const a = s.me.action;
  if (!a) {
    $('action-panel').innerHTML = '<div class="row"><span id="action-label">閒置</span><span class="muted">AP 每分鐘 +1.5</span></div>';
    return;
  }
  $('action-panel').innerHTML =
    `<div class="row"><span id="action-label">${esc(actionLabel(a))}</span>` +
    '<div class="bar"><i id="action-bar"></i><span id="action-time"></span></div>' +
    button('中止', { t: 'cancel' }) +
    `<button id="action-speed"></button><button id="action-finish"></button></div>`;
  tickAction(s);
}

function tickAction(s: State): void {
  const a = s.me.action;
  const time = document.getElementById('action-time');
  if (!a || !time) return;
  const now = serverNow();
  const leftMs = Math.max(0, a.endAt - now);
  const ap = Math.floor(apNow(s.me.ap, s.me.apAt, a.endAt, now));
  const finish = Math.max(1, Math.ceil(leftMs / MINUTE));
  time.textContent = `剩餘 ${clock(leftMs)}`;
  $('action-bar').style.width = `${Math.min(100, ((now - a.startAt) / (a.endAt - a.startAt)) * 100)}%`;
  const set = (id: string, label: string, cost: number) => {
    const el = $<HTMLButtonElement>(id);
    el.textContent = label;
    el.disabled = ap < cost || leftMs <= 0;
    el.dataset.act = JSON.stringify({ t: 'speed', ap: cost } satisfies ClientMsg);
  };
  set('action-speed', `加速 ${Math.min(SPEED_STEP, finish)} AP`, Math.min(SPEED_STEP, finish));
  set('action-finish', `立即完成 ${finish} AP`, finish);
}

function renderMap(s: State): void {
  const canvas = $<HTMLCanvasElement>('map');
  const side = Math.sqrt(s.view.length) * TILE;
  const room = $('map-panel').clientWidth - 30;
  const scale = room >= side ? Math.floor(room / side) : room / side;
  canvas.style.width = `${side * scale}px`;
  canvas.style.height = `${side * scale}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) drawMap(ctx, s.view, selected);
}

// Route to a tile in view and its time for this character, or null when no route exists.
function routeTo(s: State, to: Pos): number | null {
  const tiles = new Map(s.view.map((t) => [`${t.x},${t.y}`, t]));
  const cell = (x: number, y: number) => {
    const t = tiles.get(`${x},${y}`);
    if (!t || t.terrain === null) return null;
    return { enter: t.enter, leave: t.leave, passable: TERRAINS[t.terrain].passable, avoid: t.animal !== null };
  };
  const route = findPath(cell, s.me, to, VIEW_RADIUS);
  if (!route) return null;
  const walk = skillMult(s.me.prof.walk);
  return route.mults.reduce((sum, mult) => sum + actionMs(STEP_MINUTES, mult, walk, fedMult(s)), 0);
}

function renderTarget(s: State): void {
  const tile = selected && s.view.find((t) => t.x === selected!.x && t.y === selected!.y);
  if (!tile || tile.terrain === null || (tile.x === s.me.x && tile.y === s.me.y)) {
    selected = null;
    $('target').innerHTML = '<div class="row muted">點選地圖上的格子作為目的地</div>';
    return;
  }
  const notes = [TERRAINS[tile.terrain].name];
  if (tile.structure) notes.push(BUILDINGS[tile.structure.type].name + (tile.structure.done ? '' : '工地'));
  if (tile.animal) notes.push(ANIMALS[tile.animal].name);
  const ms = routeTo(s, tile);
  let go: string;
  if (!TERRAINS[tile.terrain].passable) go = '<span class="muted">無法進入</span>';
  else if (ms === null) go = '<span class="muted">走不到那裡</span>';
  else go = button(`前往 (${clock(ms)})`, { t: 'move', x: tile.x, y: tile.y }, !s.me.action && !s.here.animal);
  $('target').innerHTML = `<div class="row"><span class="grow">(${tile.x}, ${tile.y}) ${notes.join('、')}</span>${go}</div>`;
}

function bar(label: string, have: number, need: number): string {
  const pct = need > 0 ? Math.min(100, (have / need) * 100) : 100;
  return `<div class="bar"><i style="width:${pct}%"></i><span>${esc(label)} ${have}/${need}</span></div>`;
}

// Buttons that start one, five, or as many rounds as possible.
function roundButtons(max: number, msg: (rounds: number) => ClientMsg, idle: boolean): string {
  const most = Math.min(max, MAX_ROUNDS);
  return (
    button('x1', msg(1), idle && most >= 1) +
    button('x5', msg(5), idle && most >= 5) +
    button(`最多 x${Math.max(most, 0)}`, msg(Math.max(most, 1)), idle && most >= 1)
  );
}

function renderSite(s: State, site: Structure, idle: boolean): string {
  const def = BUILDINGS[site.type];
  const left = def.minutes - site.progress;
  const mult = skillMult(s.me.prof.build) * fedMult(s);
  const buttons = [10, 60, left]
    .map((minutes, n) => {
      const amount = Math.max(1, Math.min(minutes, left));
      const label = n === 2 ? '建到完成' : `建造 ${minutes} 分`;
      return button(`${label} (${clock(actionMs(amount, mult))})`, { t: 'build', minutes: amount }, idle && left > 0);
    })
    .join('');
  return `<div class="row">${bar('建造時間', site.progress, def.minutes)}</div><div class="row">${buttons}</div>`;
}

function renderRecipes(s: State, type: BuildingId, idle: boolean): string {
  return ITEM_IDS.filter((id) => ITEMS[id].recipe?.at === type)
    .map((id) => {
      const recipe = ITEMS[id].recipe!;
      const ms = actionMs(recipe.minutes, skillMult(s.me.prof.craft), fedMult(s));
      const max = Math.min(
        ...ITEM_IDS.filter((mat) => recipe.mats[mat]).map((mat) => Math.floor(countOf(s.me.inv, mat) / recipe.mats[mat]!)),
      );
      return (
        `<div class="row"><span class="grow">${ITEMS[id].name}：${countsText(recipe.mats)}（${clock(ms)}）</span>` +
        roundButtons(max, (rounds) => ({ t: 'craft', item: id, rounds }), idle) +
        '</div>'
      );
    })
    .join('');
}

function renderBuilding(s: State, building: Structure, idle: boolean): string {
  const def = BUILDINGS[building.type];
  const dur = structureDur(building, serverNow());
  const cost = repairCost(building.type, dur);
  const full = percent(dur) >= 100;
  const repair =
    `<div class="row"><span class="grow">耐久度 ${percent(dur)}%` +
    (full ? '' : `，維修需要地面上的 ${countsText(cost)}`) +
    `</span>${button('維修', { t: 'repair' }, !full && hasCounts(s.here.ground, cost))}</div>`;
  return `<div class="muted">${esc(def.effectText)}</div>${repair}${renderRecipes(s, building.type, idle)}`;
}

function renderLog(structure: Structure): string {
  const entries = Object.values(structure.log);
  if (entries.length === 0) return '';
  const lines = entries.map((e) => `<div>${esc(e.name)}：建造 ${e.minutes} 分鐘</div>`).join('');
  return `<details data-keep="log"><summary>貢獻紀錄</summary>${lines}</details>`;
}

function renderPlaceMenu(s: State): string {
  const river = s.here.terrain === 'river';
  const menu = BUILDING_IDS.filter((id) => (id === 'bridge') === river)
    .map((id) => {
      const def = BUILDINGS[id];
      const mats = ITEM_IDS.filter((item) => def.mats[item])
        .map((item) => `${ITEMS[item].name} ${countOf(s.here.ground, item)}/${def.mats[item]}`)
        .join('、');
      return (
        button(def.name, { t: 'place', building: id }, hasCounts(s.here.ground, def.mats)) +
        `<small>地面材料 ${mats}、建造 ${def.minutes} 分鐘<br>${esc(def.effectText)}</small>`
      );
    })
    .join('');
  return `<details data-keep="place"><summary>放下工地（材料須備齊在地面）</summary><div class="place">${menu}</div></details>`;
}

function renderTile(s: State): void {
  const panel = $('tile-panel');
  const open = new Set(
    [...panel.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.keep ?? ''),
  );
  const { here } = s;
  const idle = !s.me.action;
  const parts: string[] = [`<h2>所在格 (${here.x}, ${here.y}) ${TERRAINS[here.terrain].name}</h2>`];

  if (here.animal) {
    const def = ANIMALS[here.animal];
    const ms = actionMs(def.fightMinutes, skillMult(s.me.prof.fight), toolMult(s.me.inv, 'fight'), fedMult(s));
    parts.push(
      `<div class="row"><span class="grow"><span class="tag wild">野生動物</span> ${def.name}，掉落 ${countsText(def.drops)}` +
        `<br><span class="muted">打倒牠才能離開這一格</span></span>` +
        `${button(`戰鬥 (${clock(ms)})`, { t: 'fight' }, idle)}</div>`,
    );
  }

  parts.push('<h3>資源</h3>');
  for (const { item, available } of here.resources) {
    const resource = RESOURCES[item];
    const ms = actionMs(resource.minutes, skillMult(s.me.prof[resource.attr]), toolMult(s.me.inv, resource.attr), fedMult(s));
    const note = available ? `${resource.action}，每次 ${clock(ms)}` : '<span class="muted">現在沒有可採集的</span>';
    const buttons = [1, 5, 20].map((rounds) => button(`x${rounds}`, { t: 'gather', item, rounds }, idle && available)).join('');
    parts.push(`<div class="row"><span class="grow">${ITEMS[item].name}：${note}</span>${buttons}</div>`);
  }

  parts.push('<h3>建築</h3>');
  const structure = here.structure;
  if (structure) {
    const def = BUILDINGS[structure.type];
    const tag = structure.done ? '<span class="tag done">建築</span>' : '<span class="tag">工地</span>';
    const body = structure.done ? renderBuilding(s, structure, idle) : renderSite(s, structure, idle);
    parts.push(`<div class="structure"><div class="structure-title">${def.name}${tag}</div>${body}${renderLog(structure)}</div>`);
  } else {
    parts.push('<div class="row muted">這一格還沒有建築</div>', renderPlaceMenu(s));
  }

  parts.push('<h3>地面</h3>');
  const ground = ITEM_IDS.filter((id) => countOf(here.ground, id) > 0).map((id) => {
    const stack = here.ground[id]!;
    return (
      `<div class="row"><span class="grow">${ITEMS[id].name} x${stack.qty}</span><span class="muted">${percent(stack.dur)}%</span>` +
      button('撿取 1', { t: 'pickup', item: id, qty: 1 }) +
      button('撿取全部', { t: 'pickup', item: id, qty: stack.qty }) +
      '</div>'
    );
  });
  parts.push(ground.join('') || '<div class="row muted">地面上沒有物品</div>');

  parts.push('<h3>在場玩家</h3>');
  parts.push(
    `<div class="row">${here.players
      .map((p) => {
        const note = [p.action ? ACTION_NAME[p.action] : '閒置', p.online ? '' : '離線'].filter(Boolean).join('、');
        return `<span><i class="dot ${p.online ? 'on' : ''}"></i>${esc(p.name)} (${note})</span>`;
      })
      .join('')}</div>`,
  );

  panel.innerHTML = parts.join('');
  for (const d of panel.querySelectorAll<HTMLDetailsElement>('details')) d.open = open.has(d.dataset.keep ?? '');
}

function itemNote(id: ItemId): string {
  const def = ITEMS[id];
  if (def.tool) return `${ATTRS[def.tool.attr].name}時間 x${def.tool.mult}`;
  if (def.capacity) return `背包上限 +${def.capacity}`;
  if (def.fedMinutes) return `飽足 ${def.fedMinutes} 分鐘`;
  return '材料';
}

function renderSelf(s: State): void {
  const items = ITEM_IDS.filter((id) => countOf(s.me.inv, id) > 0).map((id) => {
    const stack = s.me.inv[id]!;
    return (
      `<div class="row"><span class="grow">${ITEMS[id].name} x${stack.qty}</span>` +
      `<span class="muted">${percent(stack.dur)}%、${itemNote(id)}</span>` +
      (ITEMS[id].fedMinutes ? button('吃', { t: 'eat', item: id }) : '') +
      button('放下 1', { t: 'drop', item: id, qty: 1 }) +
      button('放下全部', { t: 'drop', item: id, qty: stack.qty }) +
      '</div>'
    );
  });
  const attrs = ATTR_IDS.map((id) => {
    const prof = s.me.prof[id];
    const level = levelOf(prof);
    return `<div class="row"><span class="grow">${ATTRS[id].name} Lv${level}</span>${bar('熟練度', prof, profForLevel(level + 1))}</div>`;
  });
  $('self-panel').innerHTML =
    `<h2>背包 ${weightOf(s.me.inv)} / ${capacityOf(s.me.inv)}</h2>` +
    (items.join('') || '<div class="row muted">背包是空的</div>') +
    '<h3>屬性</h3>' +
    attrs.join('');
}

function render(): void {
  if (!state) return;
  renderStatus(state);
  renderAction(state);
  renderTarget(state);
  renderMap(state);
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
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (el?.dataset.act) send(JSON.parse(el.dataset.act) as ClientMsg);
});

$('map').addEventListener('click', (e) => {
  if (!state) return;
  const canvas = e.currentTarget as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const side = Math.sqrt(state.view.length);
  const col = Math.floor(((e.clientX - rect.left - canvas.clientLeft) / canvas.clientWidth) * side);
  const row = Math.floor(((e.clientY - rect.top - canvas.clientTop) / canvas.clientHeight) * side);
  const tile = state.view[row * side + col];
  if (!tile || col < 0 || col >= side) return;
  selected = tile.x === state.me.x && tile.y === state.me.y ? null : { x: tile.x, y: tile.y };
  renderTarget(state);
  renderMap(state);
});

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};
document.addEventListener('keydown', (e) => {
  const delta = ARROWS[e.key];
  if (!delta || !state || $('game').hidden || e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  send({ t: 'move', x: state.me.x + delta[0], y: state.me.y + delta[1] });
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
setInterval(() => {
  if (!state) return;
  renderStatus(state);
  tickAction(state);
}, 1000);

connect();
