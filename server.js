// ===== ANT SURVIVAL（アリのマイクラ） サーバー =====
'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ================= 基本設定 =================
const T = 32;                       // 1マスの大きさ
const SW = 200, SH = 150;           // 地上のマス数
const UW = 140, UH = 140;           // 地下のマス数
const TW = 36, TH = 18;             // アリ商店街のマス数
const UCX = 70, UCY = 70;           // 地下の中心
const NEST = { x: SW / 2 * T, y: SH / 2 * T, r: 36 };     // 地上の巣穴
const UENT = { tx: UCX - 1, ty: UCY - 1 };                 // 地下の出入口マス
const UENT_X = (UENT.tx + 0.5) * T, UENT_Y = (UENT.ty + 0.5) * T;
const TEXIT = { tx: 1, ty: 8 };                            // 商店街の出口マス
const TSPAWN = { x: 2.5 * T, y: 8.5 * T };
const TICK = 30, DT = 1 / TICK;
const DAY_LEN = 180, NIGHT_LEN = 90;
const PLAYER_SPEED = 150, PR = 10, REACH = 80;
const INV_SIZE = 24, HOTBAR = 8, CHEST_SIZE = 16, STACK = 50;
const SUPPORT_RANGE = 2;            // 土の壁から何マス以内なら支えられるか
const CRACK_TIME = 5;               // ヒビが入ってから崩れるまでの秒数
const ALL_DEAD_GAMEOVER = false;    // true にすると全員同時に死んだらワールドがリセット（今はオフ）
const MAX_WORLDS = 3;               // 1人が作れるワールドの数
const SAVE_INTERVAL = 60;
const SAVE_DIR = path.join(__dirname, 'saves');
const QUEST_VERSION = 2;
const CUBE_R = 18;                  // 角砂糖ブロックの大きさ
const dragSpeed = n => Math.min(130, 42 + 34 * (n - 1));   // 引っぱる人数ごとの速さ
const COLORS = ['#e74c3c', '#3498db', '#9b59b6', '#e67e22', '#1abc9c', '#f1c40f', '#ecf0f1', '#e84393'];
const LAYERS = ['s', 'u', 't'];     // 地上・巣の中・商店街
const LC = l => LAYERS.indexOf(l);

// タイル（地下と商店街で共通）
const U = { OPEN: 0, DIRT: 1, CLAY: 2, ROOT: 3, GLOW: 4, HARD: 5, RUBBLE: 6, ENT: 7, BIGROOT: 8 };
const isNatSolid = v => (v >= 1 && v <= 6) || v === 8;
const TILE_INFO = {
  1: { h: 10, drop: [['dirt', 1]] },
  2: { h: 25, jaw: 2, need: '粘土を掘るには「小石の大あご」が必要', drop: [['clay', 1]] },
  3: { h: 15, drop: [['root', 1], ['dirt', 1]] },
  4: { h: 6, drop: [['glow', 1]] },
  8: { h: 40, jaw: 3, need: '巨大な根をかじるには「甲殻の大あご」が必要', drop: [['root', 3]] },
};

const ITEMS = {
  crumb: { n: 'パンくず', food: 8 }, seed: { n: '種', food: 12 }, sugar: { n: '角砂糖のかけら', food: 35 },
  fruit: { n: '果物のかけら', food: 22 }, meat: { n: '虫の肉', food: 15 }, grass: { n: '草', food: 4 },
  cookie: { n: 'クッキーのかけら', food: 30 },
  leaf: { n: '葉っぱ' }, twig: { n: '小枝' }, pebble: { n: '小石' }, needle: { n: '松葉' },
  dirt: { n: '土' }, clay: { n: '粘土' }, root: { n: '木の根' }, glow: { n: '光るキノコ' },
  silk: { n: 'クモの糸' }, shell: { n: '甲殻' },
  honey: { n: 'ミツ玉', stack: 999, money: 1 },
  chest: { n: 'チェスト', place: 'chest' }, bench: { n: '作業台', place: 'bench' },
  barricade: { n: '土のバリケード', place: 'barricade' }, clayWall: { n: '粘土の壁', place: 'clayWall' },
  pillarD: { n: '土の柱', place: 'pillarD' }, pillarR: { n: '根っこの柱', place: 'pillarR' },
  lamp: { n: 'キノコランプ', place: 'lamp' }, spike: { n: 'トゲ罠', place: 'spike' }, net: { n: '糸のネット', place: 'net' },
  bed: { n: '葉っぱのベッド', place: 'bed' },
  jaw2: { n: '小石の大あご', jaw: 2, stack: 1 }, jaw3: { n: '甲殻の大あご', jaw: 3, stack: 1 },
  armor1: { n: '葉のマント', armor: 0.15, stack: 1 }, armor2: { n: '甲殻アーマー', armor: 0.4, stack: 1 },
};
const JAW = { 1: { dig: 12, atk: 10 }, 2: { dig: 20, atk: 18 }, 3: { dig: 30, atk: 28 } };
const OBJ = {
  chest: { solid: 1, hp: 40 }, bench: { solid: 1, hp: 40 },
  barricade: { solid: 1, hp: 60 }, clayWall: { solid: 1, hp: 180 },
  pillarD: { solid: 1, hp: 50, support: 3 }, pillarR: { solid: 1, hp: 90, support: 5 },
  lamp: { solid: 0, hp: 10, light: 1 }, spike: { solid: 0, hp: 40 }, net: { solid: 0, hp: 30 },
  bed: { solid: 0, hp: 30 },
  // 自然にあるもの（壊すと素材が出る）
  branch: { solid: 1, hp: 36, natural: 1, drop: [['twig', 5]] },               // 落ちた枝
  bigLeaf: { solid: 0, hp: 12, natural: 1, drop: [['leaf', 4]] },              // 大きな落ち葉
  husk: { solid: 1, hp: 30, natural: 1, drop: [['shell', 2], ['meat', 1]] },   // 虫の亡骸（地下の空洞）
  // 女王救出クエスト（qs＝調べられる段階）
  clue: { solid: 0, hp: 4, natural: 1, qs: 0, drop: [] },                                         // 女王の羽（地下）
  cocoon: { solid: 1, hp: 45, natural: 1, qs: 3, jaw: 2, need: '硬い糸の繭だ。「小石の大あご」を装備しないと破れない', drop: [['silk', 2]] },
  clue3: { solid: 0, hp: 4, natural: 1, qs: 4, night: 1, lamp: 1, drop: [] },                     // 空き缶の匂い（夜＋ランプ）
  queenCocoon: { solid: 1, hp: 60, natural: 1, qs: 7, drop: [['silk', 3]] },                      // 女王が閉じ込められた繭
  // アリ商店街（壊せない）
  npcShop: { solid: 1, fixed: 1, hp: 1 }, shelf: { solid: 1, fixed: 1, hp: 1 },
  gachaMachine: { solid: 1, fixed: 1, hp: 1 }, npcGacha: { solid: 1, fixed: 1, hp: 1 },
  betTable: { solid: 1, fixed: 1, hp: 1 }, npcBet: { solid: 1, fixed: 1, hp: 1 },
  board: { solid: 1, fixed: 1, hp: 1 },
  lantern: { solid: 0, fixed: 1, hp: 1, light: 1 }, stool: { solid: 0, fixed: 1, hp: 1 }, sign: { solid: 0, fixed: 1, hp: 1 },
};
const RECIPES = [
  { out: 'bench', n: 1, cost: { twig: 4, leaf: 2 } },
  { out: 'bed', n: 1, cost: { leaf: 5, grass: 3 } },
  { out: 'chest', n: 1, cost: { leaf: 3, twig: 2 } },
  { out: 'barricade', n: 1, cost: { dirt: 4 } },
  { out: 'pillarD', n: 1, cost: { dirt: 3 } },
  { out: 'lamp', n: 1, cost: { glow: 2 } },
  { out: 'armor1', n: 1, cost: { leaf: 6, twig: 2 } },
  { out: 'jaw2', n: 1, cost: { pebble: 3, twig: 2 }, bench: 1 },
  { out: 'clayWall', n: 1, cost: { clay: 3, pebble: 1 }, bench: 1 },
  { out: 'pillarR', n: 1, cost: { root: 2, clay: 1 }, bench: 1 },
  { out: 'spike', n: 2, cost: { needle: 3 }, bench: 1 },
  { out: 'net', n: 1, cost: { silk: 3 }, bench: 1 },
  { out: 'jaw3', n: 1, cost: { shell: 2, pebble: 2, silk: 2 }, bench: 1 },
  { out: 'armor2', n: 1, cost: { shell: 4, silk: 2 }, bench: 1 },
];
const EN = {
  spider: { idx: 0, n: 'クモ', hp: 45, spd: 125, dmg: 12, r: 13, detect: 260, chew: 10, drops: [['meat', 1, 1], ['silk', 1, 2]] },
  beetle: { idx: 1, n: 'カブトムシ', hp: 120, spd: 62, dmg: 22, r: 15, detect: 200, chew: 25, drops: [['meat', 1, 2], ['shell', 1, 2]] },
  boss: { idx: 2, n: '巨大グモ', hp: 900, spd: 92, dmg: 24, r: 34, detect: 520, chew: 30, drops: [['shell', 4, 5], ['silk', 6, 8], ['meat', 4, 5]] },
};
// 地上の資源（巣からの距離ゾーンごと）
const RES = [
  { z: 1, item: 'crumb', n: 40 }, { z: 1, item: 'leaf', n: 40 }, { z: 1, item: 'twig', n: 30 },
  { z: 2, item: 'seed', n: 35 }, { z: 2, item: 'pebble', n: 30 }, { z: 2, item: 'needle', n: 30 },
  { z: 2, item: 'leaf', n: 20 }, { z: 2, item: 'twig', n: 25 },
  { z: 3, item: 'fruit', n: 25 }, { z: 3, item: 'pebble', n: 20 }, { z: 3, item: 'needle', n: 20 }, { z: 3, item: 'seed', n: 15 },
];
const CUBES_WANT = 12;

// ---- アリ商店街 ----
const SHOP_BUY = [
  { id: 'crumb', n: 5, price: 3 }, { id: 'fruit', n: 1, price: 4 }, { id: 'cookie', n: 1, price: 6 },
  { id: 'glow', n: 2, price: 6 }, { id: 'silk', n: 2, price: 8 }, { id: 'shell', n: 1, price: 10 },
  { id: 'lamp', n: 1, price: 9 }, { id: 'bed', n: 1, price: 10 }, { id: 'armor1', n: 1, price: 16 }, { id: 'jaw2', n: 1, price: 22 },
];
const SELL = { crumb: 1, seed: 1, fruit: 2, meat: 2, grass: 1, leaf: 1, twig: 1, pebble: 1, needle: 1, clay: 2, root: 2, glow: 2, silk: 3, shell: 5, sugar: 3, cookie: 3 };
const GACHA_COST = 10;
const GACHA = [   // [確率%, ランク, アイテム, 個数]
  [15, 0, 'crumb', 5], [15, 0, 'leaf', 5], [15, 0, 'twig', 5], [15, 0, 'pebble', 4],
  [8, 1, 'fruit', 3], [8, 1, 'glow', 3], [7, 1, 'silk', 3], [7, 1, 'sugar', 2],
  [3, 2, 'shell', 4], [3, 2, 'lamp', 2], [3, 2, 'armor1', 1], [0.5, 3, 'jaw3', 1], [0.5, 3, 'armor2', 1],
];
const BET_AMOUNTS = [5, 10, 20];
const SIDE_ERRANDS = [
  { need: { grass: 10 }, honey: 8 }, { need: { pebble: 6 }, honey: 6 }, { need: { meat: 3 }, honey: 10 },
  { need: { clay: 5 }, honey: 10 }, { need: { glow: 3 }, honey: 9 }, { need: { silk: 4 }, honey: 14 }, { need: { seed: 6 }, honey: 7 },
];
const MAIN_ERRAND = { need: { fruit: 3, needle: 5 }, honey: 15 };

// ================= 小物 =================
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const LW = l => (l === 'u' ? UW : l === 't' ? TW : SW);
const LH = l => (l === 'u' ? UH : l === 't' ? TH : SH);
const zoneOf = (x, y) => { const d = Math.hypot(x - NEST.x, y - NEST.y) / T; return d < 30 ? 1 : d < 62 ? 2 : 3; };

// ---- インベントリ（0〜7：ホットバー、8〜23：バッグ） ----
const maxStack = id => ITEMS[id].stack || STACK;
const prefersHotbar = id => { const d = ITEMS[id]; return !!(d.food || d.place || d.jaw || d.armor); };
function addItem(inv, id, n) {
  for (const s of inv) if (s && s.id === id && s.n < maxStack(id)) {
    const k = Math.min(n, maxStack(id) - s.n); s.n += k; n -= k; if (!n) return 0;
  }
  let order = [...inv.keys()];
  if (inv.length === INV_SIZE && !prefersHotbar(id)) order = [...order.slice(HOTBAR), ...order.slice(0, HOTBAR)];  // 素材はバッグを優先
  for (const i of order) if (!inv[i]) {
    const k = Math.min(n, maxStack(id)); inv[i] = { id, n: k }; n -= k; if (!n) return 0;
  }
  return n;
}
const countItem = (inv, id) => inv.reduce((a, s) => a + (s && s.id === id ? s.n : 0), 0);
function removeItem(inv, id, n) {
  for (let i = inv.length - 1; i >= 0 && n > 0; i--) {
    const s = inv[i];
    if (s && s.id === id) { const k = Math.min(n, s.n); s.n -= k; n -= k; if (!s.n) inv[i] = null; }
  }
}
const hasAll = (inv, need) => Object.entries(need).every(([id, n]) => countItem(inv, id) >= n);
// 装備（大あご・よろい）
const jawOf = p => (p.equip && p.equip.jaw ? ITEMS[p.equip.jaw.id].jaw : 1);
const armorOf = p => (p.equip && p.equip.armor ? ITEMS[p.equip.armor.id].armor : 0);
const equipSlotOf = id => (ITEMS[id].jaw ? 'jaw' : ITEMS[id].armor ? 'armor' : null);
const newEquip = () => ({ jaw: null, armor: null });

// ================= ワールド生成 =================
function genUnder(seed) {
  const g = new Uint8Array(UW * UH).fill(U.DIRT);
  for (let ty = 0; ty < UH; ty++) for (let tx = 0; tx < UW; tx++) {
    const i = ty * UW + tx;
    if (tx < 2 || ty < 2 || tx >= UW - 2 || ty >= UH - 2) { g[i] = U.HARD; continue; }
    const d = Math.hypot(tx - UCX, ty - UCY);
    if (d < 6) continue;
    const n1 = vnoise(tx / 7, ty / 7, seed), n2 = vnoise(tx / 9, ty / 9, seed + 7);
    if (n2 > 0.72 && d > 14) g[i] = U.HARD;
    else if (n1 > 0.64 - Math.min(0.12, d / 500)) g[i] = U.CLAY;
    else if (Math.random() < 0.018) g[i] = U.GLOW;
  }
  for (let v = 0; v < 35; v++) {           // 木の根の筋
    let x = randi(4, UW - 5), y = randi(4, UH - 5), a = rand(0, 6.28);
    if (Math.hypot(x - UCX, y - UCY) < 6) continue;
    const len = randi(8, 24);
    for (let k = 0; k < len; k++) {
      const i = Math.round(y) * UW + Math.round(x);
      if (g[i] === U.DIRT) g[i] = U.ROOT;
      a += rand(-0.6, 0.6); x = clamp(x + Math.cos(a), 3, UW - 4); y = clamp(y + Math.sin(a), 3, UH - 4);
    }
  }
  for (let v = 0; v < 7; v++) {            // 巨大な木の根
    let x = randi(6, UW - 7), y = randi(6, UH - 7), a = rand(0, 6.28);
    if (Math.hypot(x - UCX, y - UCY) < 14) continue;
    const len = randi(30, 60);
    for (let k = 0; k < len; k++) {
      for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
        const tx = Math.round(x) + ox, ty = Math.round(y) + oy;
        if (tx < 2 || ty < 2 || tx >= UW - 2 || ty >= UH - 2 || Math.hypot(tx - UCX, ty - UCY) < 9) continue;
        g[ty * UW + tx] = U.BIGROOT;
      }
      a += rand(-0.25, 0.25); x = clamp(x + Math.cos(a), 3, UW - 5); y = clamp(y + Math.sin(a), 3, UH - 5);
    }
  }
  for (let ty = UCY - 2; ty < UCY + 2; ty++) for (let tx = UCX - 2; tx < UCX + 2; tx++) g[ty * UW + tx] = U.OPEN;
  g[UENT.ty * UW + UENT.tx] = U.ENT;
  return g;
}
function genCaverns(w) {                   // 地下の小さな空洞（虫の亡骸）
  let made = 0;
  for (let k = 0; k < 300 && made < 10; k++) {
    const cw = randi(3, 4), ch = 3, x0 = randi(4, UW - 8), y0 = randi(4, UH - 7);
    if (Math.hypot(x0 - UCX, y0 - UCY) < 14) continue;
    let ok = true;
    for (let y = y0 - 1; y <= y0 + ch && ok; y++) for (let x = x0 - 1; x <= x0 + cw; x++) {
      const v = w.under[y * UW + x];
      if (v !== U.DIRT && v !== U.CLAY && v !== U.ROOT) { ok = false; break; }
    }
    if (!ok) continue;
    for (let y = y0; y < y0 + ch; y++) for (let x = x0; x < x0 + cw; x++) w.under[y * UW + x] = U.OPEN;
    w.objs.u.set((y0 + 1) * UW + x0 + randi(0, cw - 1), { t: 'husk', hp: OBJ.husk.hp });
    for (let j = 0; j < 3; j++) { const gx = x0 - 1 + randi(0, cw + 1), gy = y0 - 1; if (w.under[gy * UW + gx] === U.DIRT) w.under[gy * UW + gx] = U.GLOW; }
    made++;
  }
}

// ---- アリ商店街（全ワールド共通の地図） ----
const TOWN_GRID = (() => {
  const g = new Uint8Array(TW * TH).fill(U.HARD);
  const open = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * TW + x] = U.OPEN; };
  open(1, 6, 34, 11);     // 大通り
  open(4, 2, 10, 5);      // 道具屋
  open(15, 2, 21, 5);     // ガチャ屋
  open(26, 2, 32, 5);     // けいじばん
  open(7, 12, 13, 15);    // かけ屋
  open(21, 12, 28, 15);   // 休憩所
  g[TEXIT.ty * TW + TEXIT.tx] = U.ENT;
  return g;
})();
const SHOP_NPC = { tx: 7, ty: 3 };
function genTown(w) {
  const m = new Map(), put = (tx, ty, t) => m.set(ty * TW + tx, { t, hp: 1 });
  put(SHOP_NPC.tx, SHOP_NPC.ty, 'npcShop'); put(5, 2, 'shelf'); put(9, 2, 'shelf');
  put(18, 3, 'gachaMachine'); put(16, 3, 'npcGacha');
  put(10, 13, 'betTable'); put(10, 12, 'npcBet');
  put(29, 3, 'board');
  for (const x of [3, 9, 15, 21, 27, 33]) { put(x, 6, 'lantern'); put(x, 11, 'lantern'); }
  for (const [x, y] of [[23, 13], [25, 13], [23, 15], [25, 15], [27, 14]]) put(x, y, 'stool');
  put(3, 8, 'sign');
  w.objs.t = m;
}

function inRock(w, x, y, pad) {
  for (const o of w.rocks) if (Math.hypot(o.x - x, o.y - y) < o.r + pad) return true;
  return false;
}
function genTrees(w) {
  for (let k = 0; k < 600 && w.trees.length < 8; k++) {
    let x, y;
    if (w.trees.length === 0) { const a = rand(0, 6.28), d = rand(16, 22) * T; x = NEST.x + Math.cos(a) * d; y = NEST.y + Math.sin(a) * d; }
    else { x = rand(500, SW * T - 500); y = rand(500, SH * T - 500); }
    if (Math.hypot(x - NEST.x, y - NEST.y) < 420) continue;
    if (w.trees.some(t => Math.hypot(t.x - x, t.y - y) < 1100)) continue;
    if (Math.hypot(x - w.lair.x, y - w.lair.y) < 900 || Math.hypot(x - w.townPos.x, y - w.townPos.y) < 650) continue;
    const r = rand(75, 105), tree = { x: Math.round(x), y: Math.round(y), r: Math.round(r), roots: [] };
    const n = randi(5, 7), base = rand(0, 6.28);
    for (let i = 0; i < n; i++) {
      let a = base + i / n * Math.PI * 2 + rand(-0.3, 0.3), px = x + Math.cos(a) * r * 0.8, py = y + Math.sin(a) * r * 0.8;
      const len = randi(8, 14), pts = [];
      let wdt = rand(30, 40);
      for (let s = 0; s < len; s++) {
        pts.push([Math.round(px), Math.round(py), Math.round(wdt)]);
        a += rand(-0.25, 0.25); px += Math.cos(a) * 30; py += Math.sin(a) * 30; wdt = Math.max(10, wdt - rand(1.5, 3));
        if (Math.hypot(px - NEST.x, py - NEST.y) < 150) break;
      }
      tree.roots.push(pts);
      for (const [cx, cy, cw] of pts) w.rocks.push({ x: cx, y: cy, r: Math.round(cw / 2), k: 'c' });
    }
    w.rocks.push({ x: tree.x, y: tree.y, r: tree.r, k: 'c' });
    w.trees.push(tree);
  }
}
function genDeco(w) {
  const place = (t, r, n, solid) => {
    for (let k = 0, made = 0; k < 400 && made < n; k++) {
      const x = rand(200, SW * T - 200), y = rand(200, SH * T - 200);
      if (Math.hypot(x - NEST.x, y - NEST.y) < 360 || inRock(w, x, y, r + 40)) continue;
      w.deco.push({ t, x: Math.round(x), y: Math.round(y), r });
      if (solid) w.rocks.push({ x: Math.round(x), y: Math.round(y), r, k: 'c' });
      made++;
    }
  };
  place('cap', 44, 4, true); place('can', 70, 2, true); place('mush', 30, 14, true);
  for (let k = 0; k < 90; k++) {
    const x = rand(80, SW * T - 80), y = rand(80, SH * T - 80);
    if (!inRock(w, x, y, 20)) w.deco.push({ t: 'flower', x: Math.round(x), y: Math.round(y), r: 0, c: randi(0, 3) });
  }
}
function pickSpot(w, dMin, dMax, margin) {
  for (let k = 0; k < 800; k++) {
    const x = rand(margin, SW * T - margin), y = rand(margin, SH * T - margin), d = Math.hypot(x - NEST.x, y - NEST.y) / T;
    if (d < dMin || d > dMax || inRock(w, x, y, 60)) continue;
    return { x: Math.round(x), y: Math.round(y) };
  }
  return { x: margin, y: margin };
}
function genSurface(w) {
  w.lair = pickSpot(w, 72, 999, 450);                                     // 巨大グモの巣
  for (let k = 0; k < 50; k++) { w.townPos = pickSpot(w, 42, 56, 300); if (dist(w.townPos, w.lair) > 1400) break; }   // アリ商店街の入口
  const blocks = [{ x: w.lair.x, y: w.lair.y, r: 380, k: 'block' }, { x: w.townPos.x, y: w.townPos.y, r: 200, k: 'block' }];
  w.rocks.push(...blocks);
  genTrees(w);
  genDeco(w);
  let tries = 0;
  while (w.rocks.filter(o => !o.k).length < 140 && tries++ < 4000) {
    const r = rand(18, 64), x = rand(r, SW * T - r), y = rand(r, SH * T - r);
    if (Math.hypot(x - NEST.x, y - NEST.y) < 260) continue;
    if (w.rocks.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + 40)) continue;
    w.rocks.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r) });
  }
  tries = 0;
  while (w.dens.length < 10 && tries++ < 2000) {
    const x = rand(100, SW * T - 100), y = rand(100, SH * T - 100);
    if (Math.hypot(x - NEST.x, y - NEST.y) / T < 40 || inRock(w, x, y, 40) || dist({ x, y }, w.townPos) < 600) continue;
    if (w.dens.some(o => Math.hypot(o.x - x, o.y - y) < 600)) continue;
    w.dens.push({ x: Math.round(x), y: Math.round(y) });
  }
  for (let c = 0; c < 55; c++) {
    const cx = randi(4, SW - 5), cy = randi(4, SH - 5);
    if (Math.hypot((cx + 0.5) * T - NEST.x, (cy + 0.5) * T - NEST.y) < 120) continue;
    const n = randi(5, 12);
    for (let k = 0; k < n; k++) {
      const tx = clamp(cx + randi(-2, 2), 1, SW - 2), ty = clamp(cy + randi(-2, 2), 1, SH - 2);
      if (inRock(w, (tx + 0.5) * T, (ty + 0.5) * T, 6)) continue;
      w.grass.set(ty * SW + tx, randi(0, 3));
    }
  }
  w.rocks = w.rocks.filter(o => !blocks.includes(o));
}
function randomSurfacePoint(w, z) {
  for (let k = 0; k < 60; k++) {
    const x = rand(2 * T, SW * T - 2 * T), y = rand(2 * T, SH * T - 2 * T);
    if (z && zoneOf(x, y) !== z) continue;
    if (Math.hypot(x - NEST.x, y - NEST.y) < 120 || inRock(w, x, y, 12)) continue;
    if (w.objs.s.has(Math.floor(y / T) * SW + Math.floor(x / T))) continue;
    return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
}
function pointNear(w, list, z, r0, r1) {
  const cand = list.filter(o => !z || zoneOf(o.x, o.y) === z);
  if (!cand.length) return null;
  for (let k = 0; k < 30; k++) {
    const o = cand[randi(0, cand.length - 1)], a = rand(0, 6.28), d = o.r + rand(r0, r1);
    const x = o.x + Math.cos(a) * d, y = o.y + Math.sin(a) * d;
    if (x < 2 * T || y < 2 * T || x > SW * T - 2 * T || y > SH * T - 2 * T) continue;
    if (inRock(w, x, y, 12) || w.objs.s.has(Math.floor(y / T) * SW + Math.floor(x / T))) continue;
    return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
}
function spawnRes(w, r) {
  let pt = null;
  if ((r.item === 'twig' || r.item === 'leaf') && Math.random() < 0.8) pt = pointNear(w, w.trees, r.z, 30, 330);              // 小枝・葉っぱは木の下
  if (r.item === 'pebble' && Math.random() < 0.9) pt = pointNear(w, w.rocks.filter(o => !o.k && o.r >= 30), r.z, 8, 55);    // 小石は大きい石のまわり
  if (!pt) pt = randomSurfacePoint(w, r.z);
  if (!pt) return;
  const key = r.z + ':' + r.item;
  w.resCount[key] = (w.resCount[key] || 0) + 1;
  addGroundItem(w, { layer: 's', x: pt.x, y: pt.y, item: r.item, n: 1, res: key });
}
function spawnNodes(w) {                   // 落ちた枝・大きな落ち葉（朝ごとに補充）
  const want = { branch: w.trees.length * 2 + 4, bigLeaf: w.trees.length * 3 };
  const have = { branch: 0, bigLeaf: 0 };
  for (const o of w.objs.s.values()) if (o.t in have) have[o.t]++;
  for (const t in want) {
    for (let k = 0; k < 200 && have[t] < want[t]; k++) {
      const pt = Math.random() < 0.85 ? pointNear(w, w.trees, 0, 30, 330) : randomSurfacePoint(w, randi(1, 3));
      if (!pt) continue;
      const tx = Math.floor(pt.x / T), ty = Math.floor(pt.y / T), idx = ty * SW + tx;
      if (w.objs.s.has(idx) || Math.hypot(pt.x - NEST.x, pt.y - NEST.y) < 150) continue;
      if (OBJ[t].solid && inRock(w, (tx + 0.5) * T, (ty + 0.5) * T, 18)) continue;
      setObj(w, 's', idx, { t, hp: OBJ[t].hp, a: +rand(0, 6.28).toFixed(2) });
      have[t]++;
    }
  }
}
function spawnCubes(w) {                   // 角砂糖ブロック（引っぱって運ぶ）
  const near = w.quest && w.quest.pts.bait ? w.cubes.filter(c => dist(c, w.quest.pts.bait) < 1300).length : 9;
  for (let k = 0; k < 200 && near + k < 3 + 200; k++) {
    if (w.cubes.filter(c => w.quest && dist(c, w.quest.pts.bait) < 1300).length >= 3 || !w.quest) break;
    const a = rand(0, 6.28), d = rand(640, 1100), b = w.quest.pts.bait;
    const x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d;
    if (x < 100 || y < 100 || x > SW * T - 100 || y > SH * T - 100 || inRock(w, x, y, CUBE_R + 10) || dist({ x, y }, w.lair) < 420) continue;
    w.cubes.push({ id: w.nextId++, x: Math.round(x), y: Math.round(y), grab: [] });
  }
  for (let k = 0; k < 300 && w.cubes.length < CUBES_WANT; k++) {
    const pt = randomSurfacePoint(w, 3);
    if (!pt || inRock(w, pt.x, pt.y, CUBE_R + 10) || dist(pt, w.lair) < 420) continue;
    w.cubes.push({ id: w.nextId++, x: pt.x, y: pt.y, grab: [] });
  }
}

function createWorld(code) {
  const seed = Math.floor(Math.random() * 1e9);
  const w = baseWorld(code);
  w.seed = seed;
  genSurface(w);
  w.under = genUnder(seed);
  genCaverns(w);
  genTown(w);
  genQuest(w);
  for (const r of RES) for (let k = 0; k < r.n; k++) spawnRes(w, r);
  spawnNodes(w);
  spawnCubes(w);
  recomputeSupport(w);
  return w;
}
function baseWorld(code) {
  return {
    code, seed: 0, day: 1, time: 0, isNight: false, rain: 0, owner: null, name: 'ワールド',
    rocks: [], dens: [], trees: [], deco: [], grass: new Map(), under: null, objs: { s: new Map(), u: new Map(), t: new Map() },
    items: new Map(), resCount: {}, saved: {}, players: {}, enemies: [], cracks: new Map(), cubes: [],
    lair: { x: 0, y: 0 }, townPos: { x: 0, y: 0 }, quest: null, queen: null,
    human: null, nextHuman: 2 + randi(0, 1), humanAt: rand(30, 110), prints: [],
    nextId: 1, tileQ: [], grassQ: [], objQ: new Map(), gameOver: false,
    secT: 1, saveT: 0, tickN: 0,
  };
}
