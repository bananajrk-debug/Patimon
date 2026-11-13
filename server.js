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
const io = new Server(server, { maxHttpBufferSize: 8e6 });   // ワールドのバックアップ（数百KB）を受け取れるように
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
const SAVE_INTERVAL = 30;
const SAVE_DIR = path.join(__dirname, 'saves');
// バックアップの署名用の秘密の文字列（Renderの環境変数 SAVE_SECRET に好きな長い文字列を入れるとより安全）
const SAVE_SECRET = process.env.SAVE_SECRET || 'ant-survival-backup-key-v1';
const signStr = str => crypto.createHmac('sha256', SAVE_SECRET).update(str).digest('hex');
const QUEST_VERSION = 2;
const CUBE_R = 18;                  // 角砂糖ブロックの大きさ
const dragSpeed = n => Math.min(130, 42 + 34 * (n - 1));   // 引っぱる人数ごとの速さ
const COLORS = ['#e74c3c', '#3498db', '#9b59b6', '#e67e22', '#1abc9c', '#f1c40f', '#ecf0f1', '#e84393'];
const LAYERS = ['s', 'u', 't', 'u2', 'u3'];   // 地上・巣の中(地下1階)・商店街・地下2階・地下3階
const LC = l => LAYERS.indexOf(l);
const UL = ['u', 'u2', 'u3'];
const isUnder = l => UL.includes(l);
const FLOOR_NO = { u: 1, u2: 2, u3: 3 };
const SAFE_R = 10 * 32;             // 巣のまわりの安全圏（鳥・アリジゴク・カマキリが出ない）

// タイル（地下と商店街で共通）
const U = { OPEN: 0, DIRT: 1, CLAY: 2, ROOT: 3, GLOW: 4, HARD: 5, RUBBLE: 6, ENT: 7, BIGROOT: 8, STAIR_DN: 9, STAIR_UP: 10, FOSSIL: 11, CRYSTAL: 12 };
const isNatSolid = v => (v >= 1 && v <= 6) || v === 8 || v === 11 || v === 12;
const TILE_INFO = {
  1: { h: 10, drop: [['dirt', 1]] },
  2: { h: 25, jaw: 2, need: '粘土を掘るには「小石の大あご」が必要', drop: [['clay', 1]] },
  3: { h: 15, drop: [['root', 1], ['dirt', 1]] },
  4: { h: 6, drop: [['glow', 1]] },
  8: { h: 40, jaw: 3, need: '巨大な根をかじるには「甲殻の大あご」が必要', drop: [['root', 3]] },
  11: { h: 30, jaw: 2, need: '化石を掘るには「小石の大あご」が必要', drop: [['fossil', 1], ['dirt', 1]] },
  12: { h: 45, jaw: 3, need: '結晶を掘るには「甲殻の大あご」が必要', drop: [['crystal', 1]] },
};
const DIGDOWN_HARD = 40;            // 下に掘る穴の硬さ

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
  jaw2: { n: '小石の大あご', jaw: 2, stack: 1 }, jaw3: { n: '甲殻の大あご', jaw: 3, stack: 1 }, jaw4: { n: 'カマキリの大あご', jaw: 4, stack: 1 },
  armor1: { n: '葉のマント', armor: 0.15, stack: 1 }, armor2: { n: '甲殻アーマー', armor: 0.4, stack: 1 }, armor3: { n: '化石のよろい', armor: 0.55, stack: 1 },
  // 地下深く・カマキリから取れる素材
  fossil: { n: '化石のかけら' }, crystal: { n: '光る結晶' }, mantisBlade: { n: 'カマキリの鎌' },
  water: { n: '水のしずく', food: 2, cool: 60 },
  // 外の危険への対策
  shelter: { n: '葉っぱの屋根', place: 'shelter' }, flag: { n: 'フェロモンの旗', place: 'flag' }, crystalLamp: { n: '結晶ランプ', place: 'crystalLamp' },
  rope: { n: '糸のロープ', tool: 'rope' }, repel: { n: '刺激臭の玉', tool: 'repel' },
  cloak: { n: '草のかくれみの', acc: 1, stack: 1 }, parasol: { n: '葉っぱの日傘', acc: 1, stack: 1 },
  sensor: { n: 'においセンサー', acc: 1, stack: 1 }, floater: { n: '草の浮き輪', acc: 1, stack: 1 },
};
const ACC_INFO = {
  cloak: '鳥が来たとき止まっていれば見つからない', parasol: '日差しで体温が上がりにくい',
  sensor: 'アリジゴクの巣とカマキリが遠くから見える', floater: '水たまりで溺れない・遅くなりにくい',
};
const JAW = { 1: { dig: 12, atk: 10 }, 2: { dig: 20, atk: 18 }, 3: { dig: 30, atk: 28 }, 4: { dig: 34, atk: 40 } };
const OBJ = {
  chest: { solid: 1, hp: 40 }, bench: { solid: 1, hp: 40 },
  barricade: { solid: 1, hp: 60 }, clayWall: { solid: 1, hp: 180 },
  pillarD: { solid: 1, hp: 50, support: 3 }, pillarR: { solid: 1, hp: 90, support: 5 },
  lamp: { solid: 0, hp: 10, light: 1 }, spike: { solid: 0, hp: 40 }, net: { solid: 0, hp: 30 },
  bed: { solid: 0, hp: 30 },
  shelter: { solid: 0, hp: 30, cover: 1 }, flag: { solid: 0, hp: 20 }, crystalLamp: { solid: 0, hp: 20, light: 1 },
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
  // 外の危険への対策
  { out: 'shelter', n: 1, cost: { leaf: 4, twig: 2 } },
  { out: 'flag', n: 2, cost: { twig: 1, leaf: 1 } },
  { out: 'parasol', n: 1, cost: { leaf: 4, twig: 1 } },
  { out: 'rope', n: 1, cost: { silk: 2, twig: 1 } },
  { out: 'floater', n: 1, cost: { grass: 6, leaf: 2 } },
  { out: 'cloak', n: 1, cost: { grass: 8, silk: 1 }, bench: 1 },
  { out: 'sensor', n: 1, cost: { glow: 1, needle: 2, root: 1 }, bench: 1 },
  { out: 'repel', n: 2, cost: { grass: 3, needle: 2 }, bench: 1 },
  // 地下深く・カマキリの素材
  { out: 'crystalLamp', n: 1, cost: { crystal: 1, glow: 1 }, bench: 1 },
  { out: 'jaw4', n: 1, cost: { mantisBlade: 2, shell: 2, silk: 2 }, bench: 1 },
  { out: 'armor3', n: 1, cost: { fossil: 4, shell: 2, silk: 2 }, bench: 1 },
];
const EN = {
  spider: { idx: 0, n: 'クモ', hp: 45, spd: 125, dmg: 12, r: 13, detect: 260, chew: 10, drops: [['meat', 1, 1], ['silk', 1, 2]] },
  beetle: { idx: 1, n: 'カブトムシ', hp: 120, spd: 62, dmg: 22, r: 15, detect: 200, chew: 25, drops: [['meat', 1, 2], ['shell', 1, 2]] },
  mantis: { idx: 3, n: 'カマキリ', hp: 150, spd: 0, dmg: 10, r: 16, detect: 64, chew: 0, drops: [['mantisBlade', 1, 2], ['meat', 1, 2]] },
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
  { id: 'water', n: 2, price: 4 }, { id: 'rope', n: 1, price: 6 }, { id: 'parasol', n: 1, price: 10 }, { id: 'floater', n: 1, price: 10 },
];
const SELL = { crumb: 1, seed: 1, fruit: 2, meat: 2, grass: 1, leaf: 1, twig: 1, pebble: 1, needle: 1, clay: 2, root: 2, glow: 2, silk: 3, shell: 5, sugar: 3, cookie: 3, water: 1, fossil: 12, crystal: 22, mantisBlade: 8 };
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
const LW = l => (isUnder(l) ? UW : l === 't' ? TW : SW);
const LH = l => (isUnder(l) ? UH : l === 't' ? TH : SH);
const zoneOf = (x, y) => { const d = Math.hypot(x - NEST.x, y - NEST.y) / T; return d < 30 ? 1 : d < 62 ? 2 : 3; };

// ---- インベントリ（0〜7：ホットバー、8〜23：バッグ） ----
const maxStack = id => ITEMS[id].stack || STACK;
const prefersHotbar = id => { const d = ITEMS[id]; return !!(d.food || d.place || d.jaw || d.armor || d.tool || d.acc); };
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
const equipSlotOf = id => (ITEMS[id].jaw ? 'jaw' : ITEMS[id].armor ? 'armor' : ITEMS[id].acc ? 'acc' : null);
const newEquip = () => ({ jaw: null, armor: null, acc1: null, acc2: null });
const hasAcc = (p, id) => !!(p.equip && ((p.equip.acc1 && p.equip.acc1.id === id) || (p.equip.acc2 && p.equip.acc2.id === id)));

// ================= ワールド生成 =================
function genUnder(seed, depth = 1) {
  const g = new Uint8Array(UW * UH).fill(U.DIRT);
  const hardTh = [0, 0.72, 0.64, 0.58][depth], clayBase = [0, 0.64, 0.56, 0.5][depth];
  for (let ty = 0; ty < UH; ty++) for (let tx = 0; tx < UW; tx++) {
    const i = ty * UW + tx;
    if (tx < 2 || ty < 2 || tx >= UW - 2 || ty >= UH - 2) { g[i] = U.HARD; continue; }
    const d = Math.hypot(tx - UCX, ty - UCY);
    if (d < 6 && depth === 1) continue;
    const n1 = vnoise(tx / 7, ty / 7, seed), n2 = vnoise(tx / 9, ty / 9, seed + 7);
    if (n2 > hardTh && (d > 14 || depth > 1)) g[i] = U.HARD;
    else if (n1 > clayBase - Math.min(0.12, d / 500)) g[i] = U.CLAY;
    else if (depth >= 2 && Math.random() < (depth === 2 ? 0.014 : 0.006)) g[i] = U.FOSSIL;
    else if (depth === 3 && Math.random() < 0.012) g[i] = U.CRYSTAL;
    else if (Math.random() < (depth === 1 ? 0.018 : 0.01)) g[i] = U.GLOW;
  }
  for (let v = 0; v < (depth === 1 ? 35 : 12); v++) {           // 木の根の筋
    let x = randi(4, UW - 5), y = randi(4, UH - 5), a = rand(0, 6.28);
    if (Math.hypot(x - UCX, y - UCY) < 6) continue;
    const len = randi(8, 24);
    for (let k = 0; k < len; k++) {
      const i = Math.round(y) * UW + Math.round(x);
      if (g[i] === U.DIRT) g[i] = U.ROOT;
      a += rand(-0.6, 0.6); x = clamp(x + Math.cos(a), 3, UW - 4); y = clamp(y + Math.sin(a), 3, UH - 4);
    }
  }
  for (let v = 0; v < (depth === 3 ? 2 : 7); v++) {            // 巨大な木の根
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
  if (depth === 1) {
    for (let ty = UCY - 2; ty < UCY + 2; ty++) for (let tx = UCX - 2; tx < UCX + 2; tx++) g[ty * UW + tx] = U.OPEN;
    g[UENT.ty * UW + UENT.tx] = U.ENT;
  }
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
  put(10, 13, 'betTable'); put(10, 14, 'npcBet');
  put(29, 3, 'board');
  for (const x of [3, 9, 15, 21, 27, 33]) { put(x, 6, 'lantern'); put(x, 11, 'lantern'); }
  for (const [x, y] of [[23, 13], [25, 13], [23, 15], [25, 15], [27, 14]]) put(x, y, 'stool');
  put(3, 8, 'sign');
  w.objs.t = m;
}

const inPit = (w, x, y, pad) => (w.pits || []).some(q => Math.hypot(q.x - x, q.y - y) < q.r + pad);
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
    if (Math.hypot(x - NEST.x, y - NEST.y) < 120 || inRock(w, x, y, 12) || inPit(w, x, y, 40)) continue;
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
    if (inRock(w, x, y, 12) || inPit(w, x, y, 40) || w.objs.s.has(Math.floor(y / T) * SW + Math.floor(x / T))) continue;
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
  const b = w.quest && w.quest.pts.bait;
  const ok = (x, y) => x > 100 && y > 100 && x < SW * T - 100 && y < SH * T - 100 && !inRock(w, x, y, CUBE_R + 10) && Math.hypot(x - w.lair.x, y - w.lair.y) > 420;
  if (b && w.quest.stage <= 5) {           // おびき台のそこそこ近くに3つは用意する
    for (let k = 0; k < 300 && w.cubes.filter(c => dist(c, b) < 1300).length < 3; k++) {
      const a = rand(0, 6.28), d = rand(640, 1100), x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d;
      if (ok(x, y)) w.cubes.push({ id: w.nextId++, x: Math.round(x), y: Math.round(y), grab: [] });
    }
  }
  for (let k = 0; k < 300 && w.cubes.length < CUBES_WANT; k++) {
    const pt = randomSurfacePoint(w, 3);
    if (pt && ok(pt.x, pt.y)) w.cubes.push({ id: w.nextId++, x: pt.x, y: pt.y, grab: [] });
  }
}

function createWorld(code) {
  const seed = Math.floor(Math.random() * 1e9);
  const w = baseWorld(code);
  w.seed = seed;
  genSurface(w);
  w.under = genUnder(seed, 1);
  w.grids = { u: w.under, u2: genUnder(seed + 101, 2), u3: genUnder(seed + 202, 3) };
  genCaverns(w);
  genTown(w);
  genQuest(w);
  genHazards(w);
  spawnMantises(w);
  for (const r of RES) for (let k = 0; k < r.n; k++) spawnRes(w, r);
  spawnNodes(w);
  spawnCubes(w);
  recomputeSupport(w);
  return w;
}
function baseWorld(code) {
  return {
    code, seed: 0, day: 1, time: 0, isNight: false, rain: 0, owner: null, name: 'ワールド',
    rocks: [], dens: [], trees: [], deco: [], grass: new Map(), under: null, grids: {}, objs: { s: new Map(), u: new Map(), t: new Map(), u2: new Map(), u3: new Map() },
    items: new Map(), resCount: {}, saved: {}, players: {}, enemies: [], cracks: { u: new Map(), u2: new Map(), u3: new Map() }, cubes: [],
    lair: { x: 0, y: 0 }, townPos: { x: 0, y: 0 }, quest: null, queen: null,
    human: null, nextHuman: 2 + randi(0, 1), humanAt: rand(30, 110), prints: [],
    sand: [], pits: [], puddles: [], mantisSpots: [], wet: 0, bird: null, birdCd: 40, army: null, nextArmy: 4 + randi(0, 1), armyAt: rand(20, 120), repels: [],
    nextId: 1, tileQ: [], grassQ: [], objQ: new Map(), gameOver: false,
    secT: 1, saveT: 0, tickN: 0,
  };
}

// ================= 保存（MongoDB or ローカルファイル） =================
let mongoCol = null, accCol = null, dbError = false;
async function initDB() {
  if (!process.env.MONGODB_URI) { console.warn('⚠ MONGODB_URI 未設定：saves/ フォルダに保存します（Renderでは再起動・更新でデータが消えます）'); return; }
  const { MongoClient } = require('mongodb');
  for (let k = 1; k <= 5; k++) {
    try {
      const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
      await c.connect();
      const db = c.db('antsurvival');
      await db.command({ ping: 1 });
      mongoCol = db.collection('worlds'); accCol = db.collection('accounts');
      console.log('MongoDBに接続しました');
      return;
    } catch (e) { console.error(`MongoDB接続失敗 (${k}/5)`, e.message); await sleep(3000); }
  }
  dbError = true;
  console.error('⚠ MongoDBに接続できません。一時保存モードで起動します（再起動でデータが消えます）');
}
async function dbLoad(code) {
  if (mongoCol) { const d = await mongoCol.findOne({ _id: code }); return d ? d.data : null; }
  const f = path.join(SAVE_DIR, code + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
async function dbSave(code, data) {
  if (mongoCol) { await mongoCol.updateOne({ _id: code }, { $set: { data, updatedAt: new Date() } }, { upsert: true }); return; }
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  fs.writeFileSync(path.join(SAVE_DIR, code + '.json'), JSON.stringify(data));
}
async function dbDelete(code) {
  if (mongoCol) { await mongoCol.deleteOne({ _id: code }); return; }
  const f = path.join(SAVE_DIR, code + '.json');
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
function playerSave(p) {
  if (p.dead) return { inv: new Array(INV_SIZE).fill(null), equip: newEquip(), hp: 100, hunger: 70, layer: 'u', x: UCX * T, y: UCY * T, bed: p.bed, respawnAtBed: 1 };
  return { inv: p.inv, equip: p.equip, hp: p.hp, hunger: p.hunger, layer: p.layer, x: p.x, y: p.y, bed: p.bed };
}
function serialize(w) {
  for (const p of Object.values(w.players)) w.saved[p.name] = playerSave(p);
  return {
    v: 2, code: w.code, savedAt: Date.now(), seed: w.seed, day: w.day, time: w.time, isNight: w.isNight, nextId: w.nextId, owner: w.owner, name: w.name,
    rocks: w.rocks, dens: w.dens, trees: w.trees, deco: w.deco, grass: [...w.grass],
    under: Buffer.from(w.under).toString('base64'),
    under2: Buffer.from(w.grids.u2).toString('base64'), under3: Buffer.from(w.grids.u3).toString('base64'),
    objs: { s: [...w.objs.s], u: [...w.objs.u], u2: [...w.objs.u2], u3: [...w.objs.u3] },
    items: [...w.items.values()].map(({ id, noPickId, noPickUntil, ...rest }) => rest),
    cubes: w.cubes.map(c => ({ x: Math.round(c.x), y: Math.round(c.y) })),
    saved: w.saved, lair: w.lair, townPos: w.townPos, quest: w.quest, queen: w.queen,
    nextHuman: w.nextHuman, humanAt: w.humanAt,
    sand: w.sand, pits: w.pits, puddles: w.puddles, mantisSpots: w.mantisSpots, nextArmy: w.nextArmy, armyAt: w.armyAt,
  };
}
function deserialize(code, d) {
  const w = baseWorld(code);
  Object.assign(w, {
    seed: d.seed, day: d.day, time: d.time, isNight: d.isNight, nextId: d.nextId || 1, rocks: d.rocks, dens: d.dens,
    trees: d.trees || [], deco: d.deco || [], saved: d.saved || {}, owner: d.owner || null, name: d.name || 'ワールド',
    nextHuman: d.nextHuman || d.day + 2, humanAt: d.humanAt || 60,
  });
  w.grass = new Map(d.grass);
  w.under = new Uint8Array(Buffer.from(d.under, 'base64'));
  w.grids = {
    u: w.under,
    u2: d.under2 ? new Uint8Array(Buffer.from(d.under2, 'base64')) : genUnder(d.seed + 101, 2),
    u3: d.under3 ? new Uint8Array(Buffer.from(d.under3, 'base64')) : genUnder(d.seed + 202, 3),
  };
  w.objs = { s: new Map(d.objs.s), u: new Map(d.objs.u), t: new Map(), u2: new Map(d.objs.u2 || []), u3: new Map(d.objs.u3 || []) };
  for (const it of d.items) {
    it.id = w.nextId++;
    w.items.set(it.id, it);
    if (it.res) w.resCount[it.res] = (w.resCount[it.res] || 0) + 1;
  }
  w.cubes = (d.cubes || []).map(c => ({ id: w.nextId++, x: c.x, y: c.y, grab: [] }));
  // 古いデータの変換
  for (const l of ['s', 'u', 'u2', 'u3']) for (const [i, o] of [...w.objs[l]]) {
    if (o.t === 'sugarNode') { w.objs[l].delete(i); w.cubes.push({ id: w.nextId++, x: (i % SW + 0.5) * T, y: (Math.floor(i / SW) + 0.5) * T, grab: [] }); }
    else if (!OBJ[o.t] || OBJ[o.t].fixed) w.objs[l].delete(i);
  }
  w.lair = d.lair || pickSpot(w, 72, 999, 450);
  w.townPos = d.townPos || pickSpot(w, 42, 56, 300);
  genTown(w);
  if (d.quest && d.quest.v === QUEST_VERSION) { w.quest = d.quest; w.queen = d.queen; }
  else {
    for (const l of ['s', 'u']) for (const [i, o] of [...w.objs[l]]) if (OBJ[o.t].qs !== undefined) w.objs[l].delete(i);
    genQuest(w);
  }
  if (w.quest.stage === 6 && !w.quest.bossDead) spawnBoss(w);
  if (w.cubes.length < CUBES_WANT) spawnCubes(w);
  if (d.pits) Object.assign(w, { sand: d.sand, pits: d.pits, puddles: d.puddles, mantisSpots: d.mantisSpots, nextArmy: d.nextArmy || w.day + 4, armyAt: d.armyAt || 60 });
  else genHazards(w);
  spawnMantises(w);
  recomputeSupport(w);
  return w;
}
function makeBackup(w, data) {
  const str = JSON.stringify(data || serialize(w));
  return { code: w.code, name: w.name, s: str, sig: signStr(str), at: Date.now() };
}
function saveWorld(w) {
  if (w.gameOver) return Promise.resolve();
  w.savePromise = (w.savePromise || Promise.resolve())       // 保存は順番に1つずつ
    .then(() => {
      const data = serialize(w);
      if (Object.keys(w.players).length) io.to(w.code).emit('backup', makeBackup(w, data));   // 遊んでいる人のブラウザにも控えを保存
      return dbSave(w.code, data);
    })
    .catch(e => console.error('保存失敗', w.code, e.message));
  return w.savePromise;
}
function unloadIfEmpty(w) {                 // 誰もいなくなったワールドは保存してメモリから外す
  if (Object.keys(w.players).length) return;
  saveWorld(w).then(() => { if (!Object.keys(w.players).length && rooms[w.code] === w) delete rooms[w.code]; });
}

// ================= アカウント =================
const ACC_DIR = path.join(SAVE_DIR, 'accounts');
const accCache = new Map();
const online = new Map();                   // アカウントID → socket.id
const accKey = n => String(n || '').trim().toLowerCase();
async function accGet(name) {
  const k = accKey(name);
  if (!k) return null;
  if (accCache.has(k)) return accCache.get(k);
  let a = null;
  if (accCol) a = await accCol.findOne({ _id: k });
  else { const f = path.join(ACC_DIR, encodeURIComponent(k) + '.json'); if (fs.existsSync(f)) a = JSON.parse(fs.readFileSync(f, 'utf8')); }
  if (a) accCache.set(k, a);
  return a;
}
function sendAccBackup(a) {
  const sk = socketOf(a._id);
  if (!sk) return;
  const str = JSON.stringify(a);
  sk.emit('accBackup', { name: a.name, s: str, sig: signStr(str) });
}
async function accPut(a) {
  accCache.set(a._id, a);
  setTimeout(() => sendAccBackup(a), 0);
  if (accCol) { await accCol.replaceOne({ _id: a._id }, a, { upsert: true }); return; }
  fs.mkdirSync(ACC_DIR, { recursive: true });
  fs.writeFileSync(path.join(ACC_DIR, encodeURIComponent(a._id) + '.json'), JSON.stringify(a));
}
const hashPass = (pass, salt) => crypto.scryptSync(String(pass), salt, 32).toString('hex');
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
function sameHex(a, b) { const A = Buffer.from(a, 'hex'), B = Buffer.from(b, 'hex'); return A.length === B.length && crypto.timingSafeEqual(A, B); }
function validName(n) {
  n = String(n || '').trim();
  if (n.length < 2 || n.length > 12 || /[\s<>&"'\/\\]/.test(n)) return null;
  return n;
}
function issueToken(a) {
  const t = crypto.randomBytes(24).toString('hex');
  a.tokens = [sha(t), ...(a.tokens || [])].slice(0, 20);    // 端末20台まで自動ログイン
  return t;
}
function socketOf(accId) { const id = online.get(accId); return id ? io.sockets.sockets.get(id) : null; }
async function lobbyData(a) {
  const wInfo = c => ({ code: c.code, name: c.name, players: rooms[c.code] ? Object.keys(rooms[c.code].players).length : 0 });
  const friends = [];
  for (const fk of a.friends) {
    const f = await accGet(fk);
    if (!f) continue;
    const mutual = f.friends.includes(a._id), fs2 = socketOf(fk);
    const inCode = fs2 && fs2.data.code, inW = inCode && f.worlds.concat(a.worlds).find(x => x.code === inCode);
    friends.push({ name: f.name, mutual, online: !!fs2, inWorld: mutual && fs2 ? (inW ? inW.name : inCode ? '友達のワールド' : null) : null, worlds: mutual ? f.worlds.map(wInfo) : [] });
  }
  const incoming = [];
  for (const k of a.followers || []) if (!a.friends.includes(k)) { const f = await accGet(k); if (f) incoming.push(f.name); }
  return { name: a.name, max: MAX_WORLDS, worlds: a.worlds.map(wInfo), friends, incoming };
}
async function sendLobby(socket) {
  const a = await accGet(socket.data.user);
  if (a) socket.emit('lobby', await lobbyData(a));
}
function refreshLobbyOf(accId) { const s2 = socketOf(accId); if (s2 && !s2.data.code) sendLobby(s2); }
async function canJoin(a, w) {              // 自分のワールド or お互いフレンドの人のワールド
  if (!w.owner || w.owner === a._id) return true;
  const o = await accGet(w.owner);
  return !!(o && o.friends.includes(a._id) && a.friends.includes(o._id));
}

// ================= 部屋 =================
const rooms = {}, loading = {};
async function getWorld(code) {
  if (rooms[code]) return rooms[code];
  if (!loading[code]) loading[code] = dbLoad(code).then(d => (d ? deserialize(code, d) : null)).catch(e => { console.error('読み込み失敗', code, e); return null; });
  const w = await loading[code];
  delete loading[code];
  if (w && !rooms[code]) rooms[code] = w;
  return rooms[code] || null;
}

// ================= 送信ヘルパー =================
const msg = (w, text) => io.to(w.code).emit('msg', text);
const msgTo = (p, text) => io.to(p.id).emit('msg', text);
const compactItem = it => [it.id, LC(it.layer), it.x, it.y, it.bag ? 'bag' : it.item, it.n || 0];
function addGroundItem(w, it) {
  it.id = w.nextId++;
  w.items.set(it.id, it);
  io.to(w.code).emit('item+', compactItem(it));
  return it;
}
function removeGroundItem(w, id) {
  const it = w.items.get(id);
  if (!it) return;
  if (it.res) w.resCount[it.res]--;
  w.items.delete(id);
  io.to(w.code).emit('item-', id);
}
function dropItems(w, layer, x, y, stacks) {
  const list = stacks.filter(Boolean);
  if (!list.length) return;
  if (list.length === 1) addGroundItem(w, { layer, x, y, item: list[0].id, n: list[0].n });
  else addGroundItem(w, { layer, x, y, bag: list.map(s => ({ id: s.id, n: s.n })) });
}
function give(w, p, id, n) {
  const left = addItem(p.inv, id, n);
  if (left) dropItems(w, p.layer, p.x, p.y, [{ id, n: left }]);
}
const emitInv = p => io.to(p.id).emit('inv', { inv: p.inv, sel: p.sel, equip: p.equip });
function setObj(w, l, idx, o) {
  if (o) w.objs[l].set(idx, o); else w.objs[l].delete(idx);
  w.objQ.set(l + idx, { l, i: idx, o: o ? { t: o.t, hp: Math.round(o.hp), a: o.a || 0 } : null });
}

// ================= 衝突 =================
const gridOf = (w, l) => (isUnder(l) ? w.grids[l] : l === 't' ? TOWN_GRID : null);
function solidAt(w, l, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= LW(l) || ty >= LH(l)) return true;
  const idx = ty * LW(l) + tx, g = gridOf(w, l);
  if (g && isNatSolid(g[idx])) return true;
  const o = w.objs[l].get(idx);
  return !!(o && OBJ[o.t].solid);
}
function collide(w, l, e, r) {
  let hit = null;
  if (l === 's') for (const o of w.rocks) {
    const dx = e.x - o.x, dy = e.y - o.y, min = o.r + r;
    if (Math.abs(dx) < min && Math.abs(dy) < min) {
      const d = Math.hypot(dx, dy);
      if (d < min && d > 0.001) { e.x = o.x + dx / d * min; e.y = o.y + dy / d * min; }
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const tx0 = Math.floor((e.x - r) / T), tx1 = Math.floor((e.x + r) / T);
    const ty0 = Math.floor((e.y - r) / T), ty1 = Math.floor((e.y + r) / T);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (!solidAt(w, l, tx, ty)) continue;
      const cx = clamp(e.x, tx * T, tx * T + T), cy = clamp(e.y, ty * T, ty * T + T);
      const dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d < 0.001) {
        const mx = e.x - (tx + 0.5) * T, my = e.y - (ty + 0.5) * T;
        if (Math.abs(mx) > Math.abs(my)) e.x = mx > 0 ? tx * T + T + r : tx * T - r;
        else e.y = my > 0 ? ty * T + T + r : ty * T - r;
      } else { e.x = cx + dx / d * r; e.y = cy + dy / d * r; }
      hit = { tx, ty };
    }
  }
  e.x = clamp(e.x, r, LW(l) * T - r);
  e.y = clamp(e.y, r, LH(l) * T - r);
  return hit;
}
function circleHitsTile(x, y, r, tx, ty) {
  const cx = clamp(x, tx * T, tx * T + T), cy = clamp(y, ty * T, ty * T + T);
  return Math.hypot(x - cx, y - cy) < r;
}

// ================= 崩落（支えのない空間はまとめて崩れる。地下1〜3階それぞれ） =================
const isProtected = (w, l, i) => { const o = w.objs[l].get(i); return !!(o && OBJ[o.t].qs !== undefined); };
function recomputeSupport(w, only) {
  for (const l of only ? [only] : UL) {
    const g = w.grids[l], cracks = w.cracks[l], pillars = [];
    for (const [i, o] of w.objs[l]) if (OBJ[o.t].support) pillars.push([i % UW, (i / UW) | 0, OBJ[o.t].support]);
    const R = SUPPORT_RANGE, fresh = [];
    for (let ty = 0; ty < UH; ty++) for (let tx = 0; tx < UW; tx++) {
      const i = ty * UW + tx;
      if (g[i] !== U.OPEN) { cracks.delete(i); continue; }
      let ok = isProtected(w, l, i);
      for (let dy = -R; dy <= R && !ok; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= UW || y >= UH || isNatSolid(g[y * UW + x])) { ok = true; break; }
      }
      if (!ok) for (const [px, py, r] of pillars) if ((px - tx) ** 2 + (py - ty) ** 2 <= r * r + 0.5) { ok = true; break; }
      if (ok) cracks.delete(i);
      else if (!cracks.has(i)) fresh.push(i);
    }
    for (const i of fresh) {                  // 隣のヒビと同じタイミングで崩れる
      let t = CRACK_TIME;
      for (const j of [i - 1, i + 1, i - UW, i + UW]) if (cracks.has(j)) t = Math.min(t, cracks.get(j));
      cracks.set(i, t);
    }
  }
}
function updateCracks(w) {
  for (const l of UL) {
    const cracks = w.cracks[l], g = w.grids[l];
    if (!cracks.size) continue;
    const due = [];
    for (const [i, t] of cracks) { const nt = t - DT; cracks.set(i, nt); if (nt <= 0) due.push(i); }
    if (!due.length) continue;
    const area = new Set(), stack = [...due];         // つながっているヒビ全部＋まわり1マス
    while (stack.length) {
      const i = stack.pop();
      if (area.has(i)) continue;
      area.add(i);
      const x = i % UW, y = (i / UW) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = (y + dy) * UW + x + dx; if (cracks.has(j) && !area.has(j)) stack.push(j); }
    }
    const ring = new Set();
    for (const i of area) {
      const x = i % UW, y = (i / UW) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = (y + dy) * UW + x + dx;
        if (!area.has(j) && g[j] === U.OPEN && !isProtected(w, l, j)) ring.add(j);
      }
    }
    const fell = [...area, ...ring];
    for (const i of fell) collapseTile(w, l, i);
    io.to(w.code).emit('collapse', { l, list: fell });
    recomputeSupport(w, l);
  }
}
function collapseTile(w, l, i) {
  w.grids[l][i] = U.RUBBLE;
  w.cracks[l].delete(i);
  w.tileQ.push([LC(l), i, U.RUBBLE]);
  const tx = i % UW, ty = (i / UW) | 0;
  if (w.objs[l].has(i)) setObj(w, l, i, null);            // 置いてあった物は中身ごと消える
  for (const it of [...w.items.values()]) if (it.layer === l && Math.floor(it.x / T) === tx && Math.floor(it.y / T) === ty) removeGroundItem(w, it.id);
  for (const p of Object.values(w.players)) {
    if (!p.dead && p.layer === l && circleHitsTile(p.x, p.y, PR * 0.7, tx, ty)) killPlayer(w, p, '崩落に巻き込まれた…', true);
  }
}
// 下に掘る（地下1階→2階→3階）
function handleDigDown(w, p) {
  const l = p.layer;
  const warn = t => { if (p.warnT <= 0) { msgTo(p, t); p.warnT = 3; } p.dig = null; };
  if (!isUnder(l)) return warn('下に掘れるのは巣の中だけ');
  if (l === 'u3') return warn('これより下は硬い岩盤で掘れない');
  const g = w.grids[l], tx = Math.floor(p.x / T), ty = Math.floor(p.y / T), idx = ty * UW + tx;
  if (g[idx] === U.STAIR_DN) return warn('もう穴が開いている。Fで降りよう');
  if (g[idx] !== U.OPEN || w.objs[l].has(idx) || tx < 3 || ty < 3 || tx > UW - 4 || ty > UH - 4) return warn('何も置いていない床の上で下に掘ろう');
  if (l === 'u' && Math.hypot(tx - UENT.tx, ty - UENT.ty) < 3) return warn('出入口のすぐ近くは掘れない');
  const need = l === 'u' ? 2 : 3;
  if (jawOf(p) < need) return warn(`地下${FLOOR_NO[l] + 1}階へ掘るには「${need === 2 ? '小石' : '甲殻'}の大あご」が必要`);
  if (!p.dig || p.dig.idx !== idx || p.dig.kind !== 'down') p.dig = { idx, kind: 'down', prog: 0, hard: DIGDOWN_HARD };
  p.dig.prog += JAW[jawOf(p)].dig * DT;
  p.biteT = 0.1;
  if (p.dig.prog < DIGDOWN_HARD) return;
  p.dig = null;
  const below = l === 'u' ? 'u2' : 'u3', gb = w.grids[below];
  g[idx] = U.STAIR_DN; w.tileQ.push([LC(l), idx, U.STAIR_DN]);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const j = (ty + dy) * UW + tx + dx;
    if (gb[j] !== U.STAIR_UP && gb[j] !== U.STAIR_DN) { gb[j] = U.OPEN; w.tileQ.push([LC(below), j, U.OPEN]); }
  }
  gb[idx] = U.STAIR_UP; w.tileQ.push([LC(below), idx, U.STAIR_UP]);
  recomputeSupport(w, l); recomputeSupport(w, below);
  msg(w, `⛏ ${p.name}が地下${FLOOR_NO[below]}階への穴を掘った！（穴の上でFで降りる）`);
}

// ================= プレイヤー =================
function makePlayer(w, id, name) {
  const s = w.saved[name];
  const p = {
    id, name, color: COLORS[Object.keys(w.players).length % COLORS.length],
    layer: 'u', x: UCX * T, y: UCY * T, a: 0, hp: 100, hunger: 100, equip: newEquip(), slowT: 0, grab: null,
    heat: 0, trap: null, immuneT: 0, lastMoveAt: Date.now(), ddown: false,
    inv: new Array(INV_SIZE).fill(null), sel: 0, dead: false, respawn: 0, bed: null, sleep: false,
    ax: 0, ay: 0, lmb: false, atkCd: 0, biteT: 0, dig: null, tpSeq: 1, lastPos: Date.now(), openChest: null, warnT: 0,
  };
  if (s) {
    Object.assign(p, { inv: s.inv, equip: Object.assign(newEquip(), s.equip || {}), hp: s.hp, hunger: s.hunger, layer: s.layer, x: s.x, y: s.y, bed: s.bed || null });
    if (s.respawnAtBed) { const b = bedPos(w, p); if (b) Object.assign(p, { layer: b.l, x: b.x, y: b.y }); }
  } else { addItem(p.inv, 'crumb', 5); }
  return p;
}
function teleport(p, l, x, y) {
  p.layer = l; p.x = x; p.y = y; p.tpSeq++; p.dig = null; p.openChest = null;
  io.to(p.id).emit('tp', { s: p.tpSeq, l, x, y });
}
function killPlayer(w, p, why, buried) {
  if (p.dead) return;
  if (p.grab) releaseGrab(w, p);
  p.dead = true; p.respawn = 6; p.dig = null; p.lmb = false; p.sleep = false;
  if (!buried) dropItems(w, p.layer, Math.round(p.x), Math.round(p.y), [...p.inv, p.equip.jaw, p.equip.armor, p.equip.acc1, p.equip.acc2]);
  p.inv = new Array(INV_SIZE).fill(null);
  p.equip = newEquip();
  emitInv(p);
  msg(w, `💀 ${p.name}が${why}${buried ? '（持ち物は土の中に消えた）' : ''}`);
}
function bedPos(w, p) {
  if (!p.bed) return null;
  const o = w.objs[p.bed.l] && w.objs[p.bed.l].get(p.bed.i);
  if (!o || o.t !== 'bed') return null;
  const W = LW(p.bed.l);
  return { l: p.bed.l, x: (p.bed.i % W + 0.5) * T, y: (Math.floor(p.bed.i / W) + 0.5) * T };
}
function respawnPlayer(w, p) {
  p.dead = false; p.hp = 100; p.hunger = 70;
  const b = bedPos(w, p);
  if (b) teleport(p, b.l, b.x, b.y); else teleport(p, 'u', UCX * T, UCY * T);
}
function wake(p) { if (p.sleep) p.sleep = false; }
function nearObj(w, p, types, range) {
  for (const [i, o] of w.objs[p.layer]) {
    if (!types.includes(o.t)) continue;
    const W = LW(p.layer), tx = i % W, ty = Math.floor(i / W);
    if (Math.hypot((tx + 0.5) * T - p.x, (ty + 0.5) * T - p.y) < T * (range || 3.5)) return true;
  }
  return false;
}
function canPlace(w, l, tx, ty, t) {
  if (l === 't') return false;
  if (tx < 0 || ty < 0 || tx >= LW(l) || ty >= LH(l)) return false;
  const idx = ty * LW(l) + tx, cx = (tx + 0.5) * T, cy = (ty + 0.5) * T;
  if (isUnder(l)) { if (w.grids[l][idx] !== U.OPEN) return false; }
  else {
    if (inRock(w, cx, cy, 6)) return false;
    if (Math.hypot(cx - NEST.x, cy - NEST.y) < NEST.r + 24 || dist({ x: cx, y: cy }, w.townPos) < 60) return false;
    if (w.dens.some(d => Math.hypot(d.x - cx, d.y - cy) < 50)) return false;
  }
  if (w.objs[l].has(idx)) return false;
  if (OBJ[t].solid) {
    for (const p of Object.values(w.players)) if (!p.dead && p.layer === l && circleHitsTile(p.x, p.y, PR, tx, ty)) return false;
    for (const e of w.enemies) if (e.layer === l && circleHitsTile(e.x, e.y, EN[e.type].r * 0.8, tx, ty)) return false;
  }
  return true;
}
function destroyObj(w, l, idx, byPlayer) {
  const o = w.objs[l].get(idx);
  if (!o || OBJ[o.t].fixed) return;
  const tx = idx % LW(l), ty = Math.floor(idx / LW(l)), cx = (tx + 0.5) * T, cy = (ty + 0.5) * T;
  setObj(w, l, idx, null);
  if (o.items) dropItems(w, l, cx, cy, o.items);
  if (byPlayer) {
    if (OBJ[o.t].drop) for (const [id, n] of OBJ[o.t].drop) give(w, byPlayer, id, n);
    else give(w, byPlayer, o.t, 1);
    emitInv(byPlayer);
  } else if (!OBJ[o.t].natural) msg(w, `⚠ ${ITEMS[o.t].n}が壊された！`);
  if (OBJ[o.t].support && isUnder(l)) recomputeSupport(w, l);
  if (byPlayer && OBJ[o.t].qs !== undefined) {
    const next = { clue: 1, cocoon: 4, clue3: 5, queenCocoon: 8 }[o.t];
    advanceQuest(w, next, byPlayer);
  }
}
function damageObj(w, l, idx, amount) {
  const o = w.objs[l].get(idx);
  if (!o || OBJ[o.t].fixed || OBJ[o.t].natural) return;
  o.hp -= amount;
  if (o.hp <= 0) destroyObj(w, l, idx, null);
  else w.objQ.set(l + idx, { l, i: idx, o: { t: o.t, hp: Math.round(o.hp), a: o.a || 0 } });
}

function handleHold(w, p) {
  if (Math.hypot(p.ax - p.x, p.ay - p.y) > REACH + 8) { p.dig = null; return; }
  const jawLv = jawOf(p), jaw = JAW[jawLv];
  if (p.atkCd <= 0) for (const e of w.enemies) {           // 1) 敵を攻撃
    if (e.layer !== p.layer) continue;
    const r = EN[e.type].r;
    if (Math.hypot(e.x - p.ax, e.y - p.ay) < r + 14 && Math.hypot(e.x - p.x, e.y - p.y) < REACH + r) {
      p.atkCd = 0.4; p.biteT = 0.15;
      e.hp -= jaw.atk; e.hitT = 0.15;
      if (e.type === 'mantis') {                         // 攻撃されたカマキリは獲物を放す
        e.revealT = 4;
        const h = e.holding && w.players[e.holding];
        if (h && h.trap && h.trap.kind === 'mantis') releaseTrap(w, h);
      }
      if (e.type !== 'boss') { const k = Math.atan2(e.y - p.y, e.x - p.x); e.x += Math.cos(k) * 8; e.y += Math.sin(k) * 8; collide(w, e.layer, e, r * 0.8); }
      if (e.hp <= 0) killEnemy(w, e);
      p.dig = null;
      return;
    }
  }
  const l = p.layer;
  if (l === 't') return;                                    // 商店街は壊せない
  const tx = Math.floor(p.ax / T), ty = Math.floor(p.ay / T);
  if (tx < 0 || ty < 0 || tx >= LW(l) || ty >= LH(l)) return;
  const idx = ty * LW(l) + tx, o = w.objs[l].get(idx);
  let kind, hard;
  if (o) {                                                  // 2) 置物
    if (OBJ[o.t].fixed) return;
    if (OBJ[o.t].qs !== undefined) {
      const why = questBlock(w, o, p);
      if (why) { if (p.warnT <= 0) { msgTo(p, why); p.warnT = 3; } p.dig = null; return; }
    }
    kind = 'o'; hard = OBJ[o.t].hp;
  } else if (isUnder(l)) {                                  // 3) 地面
    const info = TILE_INFO[w.grids[l][idx]];
    if (!info) { p.dig = null; return; }
    if (info.jaw && jawLv < info.jaw) { if (p.warnT <= 0) { msgTo(p, info.need); p.warnT = 3; } p.dig = null; return; }
    kind = 't'; hard = info.h;
  } else if (inPuddle(w, p.ax, p.ay)) {                     // 4) 水たまりの水をくむ
    kind = 'w'; hard = 5;
  } else {                                                  // 5) 草
    const g = w.grass.get(idx);
    if (g === undefined || g < 2) { p.dig = null; return; }
    kind = 'g'; hard = 4;
  }
  if (!p.dig || p.dig.idx !== idx || p.dig.kind !== kind) p.dig = { idx, kind, prog: 0, hard };
  p.dig.prog += jaw.dig * DT;
  p.biteT = 0.1;
  if (p.dig.prog < hard) return;
  p.dig = null;
  if (kind === 'o') destroyObj(w, l, idx, p);
  else if (kind === 'w') { give(w, p, 'water', 1); emitInv(p); }
  else if (kind === 't') {
    for (const [id, n] of TILE_INFO[w.grids[l][idx]].drop) give(w, p, id, n);
    w.grids[l][idx] = U.OPEN;
    w.tileQ.push([LC(l), idx, U.OPEN]);
    recomputeSupport(w, l);
    emitInv(p);
  } else {
    const g = w.grass.get(idx);
    give(w, p, 'grass', g === 3 ? 3 : 1);
    if (g === 3 && Math.random() < 0.3) give(w, p, 'seed', 1);
    w.grass.set(idx, 0); w.grassQ.push([idx, 0]);
    emitInv(p);
  }
}

function updatePlayers(w) {
  for (const p of Object.values(w.players)) {
    if (p.dead) { p.respawn -= DT; if (p.respawn <= 0) respawnPlayer(w, p); continue; }
    p.atkCd -= DT; p.biteT -= DT; p.warnT -= DT; p.slowT -= DT; p.immuneT -= DT;
    if (p.trap) { updateTrap(w, p); continue; }                 // つかまっている間はもがくだけ
    updateOutdoor(w, p);
    if (p.dead) continue;
    p.hunger -= (p.sleep ? 0.14 : 0.28) * DT;
    if (p.sleep) p.hp = Math.min(100, p.hp + 4 * DT);
    if (p.hunger <= 0) { p.hunger = 0; p.hp -= 3 * DT; }
    else if (p.hunger > 50) p.hp = Math.min(100, p.hp + 1 * DT);
    let changed = false;                                    // 拾う
    for (const it of w.items.values()) {
      if (it.layer !== p.layer || Math.abs(it.x - p.x) > 22 || Math.abs(it.y - p.y) > 22) continue;
      if (it.noPickId === p.id && Date.now() < it.noPickUntil) continue;
      if (it.bag) {
        for (const s of it.bag) if (s.n) { s.n = addItem(p.inv, s.id, s.n); changed = true; }
        it.bag = it.bag.filter(s => s.n > 0);
        if (!it.bag.length) removeGroundItem(w, it.id);
      } else {
        const left = addItem(p.inv, it.item, it.n);
        if (left < it.n) { changed = true; if (left) it.n = left; else removeGroundItem(w, it.id); }
      }
    }
    if (changed) emitInv(p);
    if (p.ddown && !p.grab) handleDigDown(w, p);
    else if (p.lmb && !p.grab) handleHold(w, p); else p.dig = null;
    if (p.hp <= 0) killPlayer(w, p, p.hunger <= 0 ? '飢え死にした…' : '力尽きた…');
  }
}

// ================= 敵（巣の中には入ってこない） =================
function spawnEnemy(w, type, den, raider) {
  const s = EN[type];
  const e = {
    id: w.nextId++, type, layer: 's', x: den.x + rand(-20, 20), y: den.y + rand(-20, 20), a: rand(0, 6.28),
    hp: s.hp, maxHp: s.hp, atkCd: 0, hitT: 0, raider, retreat: false, home: den, wa: rand(0, 6.28), wt: 0, avoidT: 0, avoidDir: 0, life: 0, loiter: null,
  };
  w.enemies.push(e);
  return e;
}
function killEnemy(w, e, eaten) {               // eaten: 軍隊アリに食べられた（何も落とさない）
  if (e.dead) return;
  e.dead = true;
  if (e.type === 'boss') { w.quest.bossDead = true; advanceQuest(w, 7, null); }
  if (e.type === 'mantis') {
    if (w.mantisSpots[e.spot]) w.mantisSpots[e.spot].back = w.day + 2;
    const h = e.holding && w.players[e.holding];
    if (h && h.trap && h.trap.kind === 'mantis') releaseTrap(w, h);
    if (!eaten) msg(w, '🦗 カマキリを倒した！ 「カマキリの鎌」が手に入る');
  }
  if (eaten) return;
  for (const [id, a, b] of EN[e.type].drops) {
    const n = randi(a, b);
    for (let k = 0; k < n; k++) addGroundItem(w, { layer: e.layer, x: Math.round(e.x + rand(-12, 12)), y: Math.round(e.y + rand(-12, 12)), item: id, n: 1 });
  }
}
function updateEnemies(w) {
  const alive = Object.values(w.players).filter(p => !p.dead);
  for (const e of w.enemies) {
    if (e.dead) continue;
    if (e.type === 'boss') { if (e.hp <= 0) killEnemy(w, e); else updateBoss(w, e, alive); continue; }
    if (e.type === 'mantis') { updateMantis(w, e, alive); continue; }
    const s = EN[e.type];
    e.atkCd -= DT; e.hitT -= DT; e.avoidT -= DT; e.life += DT;
    if (e.retreat && e.life > 400) { e.dead = true; continue; }
    const ftx = Math.floor(e.x / T), fty = Math.floor(e.y / T), fidx = fty * SW + ftx;   // 足元の罠
    const fo = w.objs.s.get(fidx);
    let spd = s.spd;
    if (fo && fo.t === 'net') { spd *= 0.35; damageObj(w, 's', fidx, 1 * DT); }
    if (fo && fo.t === 'spike') { e.hp -= 18 * DT; e.hitT = 0.05; damageObj(w, 's', fidx, 2 * DT); }
    if (e.hp <= 0) { killEnemy(w, e); continue; }
    const q = w.queen, targets = q && q.state === 'follow' && q.faint <= 0 ? [...alive, q] : alive;
    let tgt = null, best = s.detect;
    if (!e.retreat) for (const p of targets) {
      if (p.layer !== 's' || p.trap || repelled(w, p.x, p.y)) continue;
      const d = dist(p, e);
      if (d < best) { best = d; tgt = p; }
    }
    if (tgt && best < s.r + PR + 6) {
      e.a = Math.atan2(tgt.y - e.y, tgt.x - e.x);
      if (e.atkCd <= 0) {
        e.atkCd = 1.0;
        tgt.hp -= s.dmg * (1 - (tgt === q ? 0 : armorOf(tgt)));
        if (tgt.sleep) { wake(tgt); msgTo(tgt, '⚠ 攻撃されて目が覚めた！'); }
        if (tgt === q) { if (q.hp <= 0) { q.faint = 10; q.hp = 0; msg(w, '⚠ 女王が気を失った！ 10秒守り抜け！'); } }
        else if (tgt.hp <= 0) killPlayer(w, tgt, `${s.n}にやられた…`);
      }
      continue;
    }
    let gx = null, gy = null;
    if (tgt) { gx = tgt.x; gy = tgt.y; }
    else if (e.retreat || (!e.raider && dist(e, e.home) > 260)) {
      gx = e.home.x; gy = e.home.y;
      if (e.retreat && dist(e, e.home) < 26) { e.dead = true; continue; }
    } else if (e.raider && w.isNight) {                      // 夜は巣の入口のまわりをうろつく（中には入らない）
      if (!e.loiter || dist(e, e.loiter) < 30) { const a = rand(0, 6.28), d = rand(110, 300); e.loiter = { x: NEST.x + Math.cos(a) * d, y: NEST.y + Math.sin(a) * d }; }
      gx = e.loiter.x; gy = e.loiter.y;
    }
    let ang, mv = spd;
    if (gx !== null) ang = Math.atan2(gy - e.y, gx - e.x) + (e.avoidT > 0 ? e.avoidDir : 0);
    else { e.wt -= DT; if (e.wt <= 0) { e.wa += rand(-1.5, 1.5); e.wt = rand(1, 3); } ang = e.wa; mv = spd * 0.35; }
    e.a = ang;
    const ox = e.x, oy = e.y;
    e.x += Math.cos(ang) * mv * DT; e.y += Math.sin(ang) * mv * DT;
    for (const r of w.repels) {                                // 刺激臭の中には入れない
      const d = dist(e, r);
      if (d < r.r && d > 0.1) { e.x = r.x + (e.x - r.x) / d * r.r; e.y = r.y + (e.y - r.y) / d * r.r; }
    }
    const hit = collide(w, 's', e, s.r * 0.8);
    if (hit && tgt) {
      const hidx = hit.ty * SW + hit.tx, o = w.objs.s.get(hidx);
      if (o && OBJ[o.t].solid && !OBJ[o.t].natural) { damageObj(w, 's', hidx, s.chew * DT); continue; }
    }
    if (Math.hypot(e.x - ox, e.y - oy) < mv * DT * 0.3) {
      if (gx !== null && e.avoidT <= 0) { e.avoidT = 0.8; e.avoidDir = (Math.random() < 0.5 ? 1 : -1) * 1.3; e.loiter = null; }
      if (gx === null) e.wa += Math.PI * 0.6;
    }
  }
  w.enemies = w.enemies.filter(e => !e.dead);
}

// ================= 女王救出クエスト =================
// 0 地下で女王の羽 → 1 商店街の道具屋へ → 2 お使い → 3 巨木の繭 → 4 夜の空き缶（ランプ）
// → 5 角砂糖3個をおびき台へ → 6 巨大グモ戦 → 7 女王の繭を破る → 8 護衛 → 9 クリア
function genQuest(w) {
  const q = { v: QUEST_VERSION, stage: 0, bossDead: false, pts: {}, clearDay: 0, baitN: 0, errand: null, errandDay: 0 };
  for (let k = 0; k < 800 && !q.pts.c1; k++) {             // ① 地下の小部屋に女王の羽
    const a = rand(0, 6.28), d = rand(22, 34);
    const cx = Math.round(UCX + Math.cos(a) * d), cy = Math.round(UCY + Math.sin(a) * d);
    if (cx < 6 || cy < 6 || cx > UW - 7 || cy > UH - 7) continue;
    let ok = true;
    for (let y = cy - 3; y <= cy + 3 && ok; y++) for (let x = cx - 3; x <= cx + 3; x++) {
      const v = w.under[y * UW + x];
      if (v === U.HARD || v === U.BIGROOT || v === U.OPEN) { ok = false; break; }
    }
    if (!ok && k < 700) continue;
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) w.under[y * UW + x] = U.OPEN;
    w.under[(cy - 2) * UW + cx - 1] = U.GLOW; w.under[(cy + 2) * UW + cx + 1] = U.GLOW;
    w.objs.u.set(cy * UW + cx, { t: 'clue', hp: OBJ.clue.hp });
    q.pts.c1 = { l: 'u', x: (cx + 0.5) * T, y: (cy + 0.5) * T };
  }
  const placeNear = (cx, cy, r0, r1, t) => {
    for (let k = 0; k < 80; k++) {
      const a = rand(0, 6.28), d = rand(r0, r1);
      const tx = Math.floor((cx + Math.cos(a) * d) / T), ty = Math.floor((cy + Math.sin(a) * d) / T);
      if (tx < 2 || ty < 2 || tx >= SW - 2 || ty >= SH - 2 || inRock(w, (tx + 0.5) * T, (ty + 0.5) * T, 16) || w.objs.s.has(ty * SW + tx)) continue;
      w.objs.s.set(ty * SW + tx, { t, hp: OBJ[t].hp });
      return { l: 's', x: (tx + 0.5) * T, y: (ty + 0.5) * T };
    }
    return null;
  };
  const far = () => randomSurfacePoint(w, 3) || { x: 400, y: 400 };
  for (const t of [...w.trees].sort((a, b) => dist(b, NEST) - dist(a, NEST))) { q.pts.c2 = placeNear(t.x, t.y, t.r + 30, t.r + 80, 'cocoon'); if (q.pts.c2) break; }
  if (!q.pts.c2) { const p = far(); q.pts.c2 = placeNear(p.x, p.y, 0, 60, 'cocoon'); }
  for (const c of w.deco.filter(d => d.t === 'can').concat(w.deco.filter(d => d.t === 'cap'))) { q.pts.c3 = placeNear(c.x, c.y, c.r + 20, c.r + 45, 'clue3'); if (q.pts.c3) break; }
  if (!q.pts.c3) { const p = far(); q.pts.c3 = placeNear(p.x, p.y, 0, 60, 'clue3'); }
  const ltx = Math.floor(w.lair.x / T), lty = Math.floor(w.lair.y / T);
  w.objs.s.set(lty * SW + ltx, { t: 'queenCocoon', hp: OBJ.queenCocoon.hp });
  q.pts.lair = { l: 's', x: (ltx + 0.5) * T, y: (lty + 0.5) * T };
  const toNest = Math.atan2(NEST.y - w.lair.y, NEST.x - w.lair.x);      // おびき台：クモの巣の手前
  for (let k = 0; k < 80 && !q.pts.bait; k++) {
    const a = toNest + rand(-0.6, 0.6), d = rand(540, 680);
    const x = w.lair.x + Math.cos(a) * d, y = w.lair.y + Math.sin(a) * d;
    if (x < 100 || y < 100 || x > SW * T - 100 || y > SH * T - 100 || inRock(w, x, y, 50)) continue;
    q.pts.bait = { l: 's', x: Math.round(x), y: Math.round(y) };
  }
  if (!q.pts.bait) q.pts.bait = { l: 's', x: w.lair.x + Math.cos(toNest) * 600, y: w.lair.y + Math.sin(toNest) * 600 };
  q.pts.shop = { l: 't', x: (SHOP_NPC.tx + 0.5) * T, y: (SHOP_NPC.ty + 0.5) * T };
  w.quest = q;
  w.queen = { state: 'captive', layer: 's', x: q.pts.lair.x, y: q.pts.lair.y, hp: 200, faint: 0, a: 0 };
}
function questTarget(w) {
  const q = w.quest, P = q.pts;
  return [P.c1, P.shop, P.shop, P.c2, P.c3, P.bait, P.lair, P.lair, { l: 's', x: NEST.x, y: NEST.y }][q.stage] || null;
}
function questBlock(w, o, p) {
  const d = OBJ[o.t];
  if (w.quest.stage !== d.qs) return 'かすかに女王の匂いがする…でも今はまだ手がかりがつながらない（Jキーの手帳で目標を確認）';
  if (d.jaw && jawOf(p) < d.jaw) return d.need;
  if (d.night && !w.isNight) return '昼間は匂いが弱くて分からない…夜にもう一度調べよう';
  if (d.lamp && countItem(p.inv, 'lamp') < 1) return '暗くて何も見えない…「キノコランプ」を持ってこよう';
  return null;
}
function advanceQuest(w, to, p) {
  const q = w.quest;
  if (q.stage !== to - 1) return;
  q.stage = to;
  const who = p ? p.name : '';
  const text = {
    1: `🔍 ${who}が「女王の羽」を見つけた！ かすかにミツの香りがする…アリ商店街の道具屋なら何か知っているかも`,
    2: `🗨 ハチミツばあさん「その羽は女王さまの…！ お使いを頼まれてくれたら、知っていることを教えてあげよう」`,
    3: `📜 お使い完了！ ばあさん「遠くの大きな木の根元で、クモの糸の繭を見たよ。硬いから『小石の大あご』がいるねぇ」`,
    4: `🔍 ${who}が繭の中から「女王の触角のかけら」を見つけた！ 匂いは空き缶の方へ…夜にランプで照らそう`,
    5: `🔍 ${who}が夜の空き缶で女王の匂いの跡を見つけた！ 巨大グモの巣が分かった。甘い角砂糖でおびき出そう！`,
    6: '🕷 角砂糖の匂いにつられて、巨大グモが巣から出てきた！',
    7: '🏆 巨大グモを倒した！ 巣の中心の繭を破って女王を助け出せ！',
    8: '👑 女王を助け出した！ 巣の入口まで護衛しろ！',
  }[to];
  if (text) msg(w, text);
  io.to(w.code).emit('questUp', to);
  if (to === 6) spawnBoss(w);
  if (to === 8) { w.queen.state = 'follow'; w.queen.hp = 200; }
}
function spawnBoss(w) {
  if (w.quest.bossDead || w.enemies.some(e => e.type === 'boss')) return;
  const e = spawnEnemy(w, 'boss', { x: w.lair.x + 120, y: w.lair.y }, false);
  Object.assign(e, { home: w.lair, sumT: 5, webT: 3 });
}
function updateBoss(w, e, alive) {
  const s = EN.boss;
  e.atkCd -= DT; e.hitT -= DT; e.sumT -= DT; e.webT -= DT;
  const near = alive.filter(p => p.layer === 's' && dist(p, w.lair) < 700);
  let tgt = null, best = 1e9;
  for (const p of near) { const d = dist(p, e); if (d < best) { best = d; tgt = p; } }
  let gx = w.lair.x, gy = w.lair.y;
  if (tgt) {
    if (best < s.r + PR + 8) {
      e.a = Math.atan2(tgt.y - e.y, tgt.x - e.x);
      if (e.atkCd <= 0) {
        e.atkCd = 1.1;
        tgt.hp -= s.dmg * (1 - armorOf(tgt)); wake(tgt);
        if (tgt.hp <= 0) killPlayer(w, tgt, '巨大グモにやられた…');
      }
      gx = null;
    } else if (dist(e, w.lair) < 650) { gx = tgt.x; gy = tgt.y; }
    if (e.webT <= 0) {                                       // 糸を吐いて足止め
      e.webT = 4.5;
      const v = near[randi(0, near.length - 1)];
      if (v && dist(v, e) < 430) { v.slowT = 2.5; io.to(w.code).emit('web', [Math.round(e.x), Math.round(e.y), Math.round(v.x), Math.round(v.y)]); }
    }
    if (e.sumT <= 0) {                                       // 子グモを呼ぶ
      e.sumT = 8;
      if (w.enemies.filter(x => x.home === w.lair && x.type === 'spider').length < 6) {
        for (let k = 0; k < 2; k++) spawnEnemy(w, 'spider', { x: e.x, y: e.y }, false).home = w.lair;
        msg(w, '🕷 巨大グモが子グモを呼んだ！');
      }
    }
  } else e.hp = Math.min(e.maxHp, e.hp + 6 * DT);
  if (gx !== null && Math.hypot(gx - e.x, gy - e.y) > 30) {
    e.a = Math.atan2(gy - e.y, gx - e.x);
    e.x += Math.cos(e.a) * s.spd * DT; e.y += Math.sin(e.a) * s.spd * DT;
  }
  collide(w, 's', e, s.r * 0.7);
}
function updateQueen(w) {
  const q = w.queen;
  if (!q || q.state === 'captive') return;
  const alive = Object.values(w.players).filter(p => !p.dead);
  if (q.state === 'home') {                                 // 巣に戻った女王のそばにいると回復
    for (const p of alive) if (p.layer === 'u' && dist(p, q) < 130) p.hp = Math.min(100, p.hp + 3 * DT);
    return;
  }
  if (q.faint > 0) { q.faint -= DT; if (q.faint <= 0) { q.hp = 100; msg(w, '👑 女王が目を覚ました'); } return; }
  let tgt = null, best = 700;
  for (const p of alive) if (p.layer === q.layer) { const d = dist(p, q); if (d < best) { best = d; tgt = p; } }
  if (q.layer === 's' && dist(q, NEST) < 260 && tgt) { tgt = { x: NEST.x, y: NEST.y }; best = 999; }   // 巣が見えたら自分で入っていく
  if (tgt && best > 55) {
    q.a = Math.atan2(tgt.y - q.y, tgt.x - q.x);
    q.x += Math.cos(q.a) * 78 * DT; q.y += Math.sin(q.a) * 78 * DT;
    collide(w, q.layer, q, 9);
  }
  if (dist(q, NEST) < NEST.r + 12) {                        // 巣に到着！
    q.state = 'home'; q.layer = 'u'; q.x = (UCX + 1) * T; q.y = (UCY + 1) * T;
    w.quest.stage = 9; w.quest.clearDay = w.day;
    msg(w, `🎉 女王が巣に帰ってきた！ ${w.day}日目でクリア！`);
    io.to(w.code).emit('clear', { day: w.day });
    io.to(w.code).emit('questUp', 9);
  }
}

// ================= 角砂糖ブロック（後ろ向きに引っぱって運ぶ） =================
function releaseGrab(w, p) {
  const c = w.cubes.find(cb => cb.id === p.grab);
  if (c) c.grab = c.grab.filter(id => id !== p.id);
  p.grab = null;
}
function deliverCube(w, c, where, gs) {
  c.gone = true;
  for (const p of gs) p.grab = null;
  const names = gs.map(p => p.name).join('・');
  if (where === 'nest') {
    for (let k = 0; k < 5; k++) addGroundItem(w, { layer: 's', x: Math.round(NEST.x + rand(-50, 50)), y: Math.round(NEST.y + NEST.r + rand(10, 50)), item: 'sugar', n: 1 });
    msg(w, `🍬 ${names}が角砂糖を巣に運んだ！ 角砂糖のかけらが手に入った`);
  } else if (where === 'town') {
    for (const p of gs) { give(w, p, 'honey', 8); emitInv(p); }
    msg(w, `🍯 ${names}が角砂糖を商店街に売った！ ミツ玉 +8（ひとりずつ）`);
  } else {
    w.quest.baitN++;
    msg(w, `🍬 おびき台に角砂糖を置いた！（${w.quest.baitN}/3）`);
    if (w.quest.baitN >= 3) advanceQuest(w, 6, gs[0]);
  }
}
function updateCubes(w) {
  for (const c of w.cubes) {
    const gs = c.grab.map(id => w.players[id]).filter(p => p && !p.dead && p.layer === 's' && p.grab === c.id && dist(p, c) < 120);
    for (const id of c.grab) { const p = w.players[id]; if (p && !gs.includes(p) && p.grab === c.id) p.grab = null; }
    c.grab = gs.map(p => p.id);
    if (!gs.length) continue;
    let tx = 0, ty = 0;
    for (const p of gs) {
      const d = Math.max(1, dist(p, c)), k = (CUBE_R + PR + 6) / d;
      tx += p.x + (c.x - p.x) * k; ty += p.y + (c.y - p.y) * k;
    }
    tx /= gs.length; ty /= gs.length;
    const dx = tx - c.x, dy = ty - c.y, dd = Math.hypot(dx, dy), mx = dragSpeed(gs.length) * 1.25 * DT;
    if (dd > 0.5) { const k = Math.min(1, mx / dd); c.x += dx * k; c.y += dy * k; collide(w, 's', c, CUBE_R); }
    if (dist(c, NEST) < NEST.r + 30) deliverCube(w, c, 'nest', gs);
    else if (dist(c, w.townPos) < 70) deliverCube(w, c, 'town', gs);
    else if (w.quest.stage === 5 && dist(c, w.quest.pts.bait) < 70) deliverCube(w, c, 'bait', gs);
  }
  w.cubes = w.cubes.filter(c => !c.gone);
}

// ================= 人間がやってくる（足跡） =================
function startHuman(w) {
  const m = 150, Wd = SW * T, Hd = SH * T;
  const side = randi(0, 3);
  const start = side === 0 ? { x: -m, y: rand(0, Hd) } : side === 1 ? { x: Wd + m, y: rand(0, Hd) } : side === 2 ? { x: rand(0, Wd), y: -m } : { x: rand(0, Wd), y: Hd + m };
  const goal = Math.random() < 0.35 ? { x: NEST.x + rand(-300, 300), y: NEST.y + rand(-300, 300) } : { x: rand(Wd * 0.25, Wd * 0.75), y: rand(Hd * 0.25, Hd * 0.75) };
  const a = Math.atan2(goal.y - start.y, goal.x - start.x), px = -Math.sin(a), py = Math.cos(a);
  const steps = [];
  for (let k = 0; k < 60; k++) {
    const off = k % 2 ? 58 : -58;
    const x = start.x + Math.cos(a) * k * 260 + px * off, y = start.y + Math.sin(a) * k * 260 + py * off;
    if (k > 2 && (x < -m || y < -m || x > Wd + m || y > Hd + m)) break;
    steps.push({ x: Math.round(x), y: Math.round(y), a: +a.toFixed(2), side: k % 2 });
  }
  w.human = { steps, t: -6, i: 0, wn: 0 };
  msg(w, '🦶 ドスン…ドスン…地響きがする。人間が来る！ 大きな影に気をつけろ！（巣の中なら安全）');
  io.to(w.code).emit('humanCome');
}
function stomp(w, s) {
  const c = Math.cos(-s.a), sn = Math.sin(-s.a);
  const inPrint = (x, y) => { const dx = x - s.x, dy = y - s.y, lx = dx * c - dy * sn, ly = dx * sn + dy * c; return (lx / 125) ** 2 + (ly / 55) ** 2 < 1; };
  for (const p of Object.values(w.players)) {
    if (p.dead || p.layer !== 's' || !inPrint(p.x, p.y)) continue;
    p.hp -= 80 * (1 - armorOf(p));
    wake(p);
    if (p.hp <= 0) killPlayer(w, p, '人間に踏まれた…'); else msgTo(p, '💥 人間に踏まれた！');
  }
  for (const e of w.enemies) if (e.type !== 'boss' && inPrint(e.x, e.y)) killEnemy(w, e);
  w.enemies = w.enemies.filter(e => !e.dead);
  const tx0 = Math.floor((s.x - 130) / T), ty0 = Math.floor((s.y - 130) / T);
  for (let ty = ty0; ty < ty0 + 9; ty++) for (let tx = tx0; tx < tx0 + 9; tx++) {
    const i = ty * SW + tx;
    if (w.grass.has(i) && w.grass.get(i) > 0 && inPrint((tx + 0.5) * T, (ty + 0.5) * T)) { w.grass.set(i, 0); w.grassQ.push([i, 0]); }
  }
  w.prints.push(s);
  io.to(w.code).emit('hprint', s);
}
function updateHuman(w) {
  const h = w.human;
  if (!h) return;
  h.t += DT;
  const STEP = 0.8, WARN = 1.3;
  while (h.wn < h.steps.length && h.t >= h.wn * STEP - WARN) { const s = h.steps[h.wn]; io.to(w.code).emit('hwarn', [s.x, s.y, s.a, s.side, WARN]); h.wn++; }
  while (h.i < h.steps.length && h.t >= h.i * STEP) { stomp(w, h.steps[h.i]); h.i++; }
  if (h.i >= h.steps.length && h.t > h.i * STEP + 1) {
    const inside = h.steps.filter(s => s.x > 60 && s.y > 60 && s.x < SW * T - 60 && s.y < SH * T - 60);
    for (let k = 0; k < Math.min(6, inside.length); k++) {    // 人間の落とし物
      const s = inside[randi(0, inside.length - 1)];
      for (let j = 0; j < randi(1, 2); j++) addGroundItem(w, { layer: 's', x: Math.round(s.x + rand(-90, 90)), y: Math.round(s.y + rand(-90, 90)), item: 'cookie', n: 1 });
      for (let j = 0; j < 3; j++) addGroundItem(w, { layer: 's', x: Math.round(s.x + rand(-120, 120)), y: Math.round(s.y + rand(-120, 120)), item: 'crumb', n: 1 });
    }
    msg(w, '🍪 人間が去っていった。足跡のまわりに何か落としていったようだ…');
    w.human = null;
    w.nextHuman = w.day + randi(3, 4);
    w.humanAt = rand(30, 110);
  }
}

// ================= 外の危険 =================
function sunInfo(w) {                       // 太陽の向き（影がのびる方向）と日差しの強さ
  const r = clamp(w.time / DAY_LEN, 0, 1), ang = Math.PI * (1 - r);
  return { dx: Math.cos(ang), dy: Math.sin(ang) * 0.5 + 0.35, len: 0.35 + Math.abs(r - 0.5) * 1.3, I: (w.isNight || w.rain > 0) ? 0 : Math.max(0, Math.sin(Math.PI * r)) };
}
function shadeAt(w, x, y) {                 // 上に何かあって、鳥と日差しから守られているか
  for (const t of w.trees) if (Math.hypot(t.x - x, t.y - y) < t.r + 240) return true;
  const sd = sunInfo(w);
  for (const o of w.rocks) {
    if (o.k || o.r < 26 || Math.abs(o.x - x) > o.r * 3 || Math.abs(o.y - y) > o.r * 3) continue;
    if (Math.hypot(o.x + sd.dx * o.r * sd.len - x, o.y + sd.dy * o.r * sd.len - y) < o.r * 0.95) return true;
  }
  for (const d of w.deco) {
    if (d.t === 'flower') continue;
    if (Math.hypot(d.x + sd.dx * d.r * sd.len - x, d.y + sd.dy * d.r * sd.len - y) < d.r * 0.95) return true;
  }
  const tx = Math.floor(x / T), ty = Math.floor(y / T), g = w.grass.get(ty * SW + tx);
  if (g !== undefined && g >= 2) return true;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const o = w.objs.s.get((ty + dy) * SW + tx + dx);
    if (!o) continue;
    const d2 = Math.hypot((tx + dx + 0.5) * T - x, (ty + dy + 0.5) * T - y);
    if ((o.t === 'bigLeaf' && d2 < 46) || (o.t === 'shelter' && d2 < 60)) return true;
  }
  return false;
}
const inSafeZone = (x, y) => Math.hypot(x - NEST.x, y - NEST.y) < SAFE_R;
const inPuddle = (w, x, y) => w.wet > 0.12 && w.puddles.some(q => Math.hypot(q.x - x, q.y - y) < q.r * w.wet - 4);
const repelled = (w, x, y) => w.repels.some(r => Math.hypot(r.x - x, r.y - y) < r.r);
function genHazards(w) {
  const far = (x, y, pad) => x > 200 && y > 200 && x < SW * T - 200 && y < SH * T - 200 && Math.hypot(x - NEST.x, y - NEST.y) > SAFE_R + pad
    && !inRock(w, x, y, 20) && dist({ x, y }, w.lair) > 520 && dist({ x, y }, w.townPos) > 320;
  w.sand = []; w.pits = [];                  // 砂地とアリジゴク
  for (let k = 0; k < 500 && w.sand.length < 12; k++) {
    const x = rand(0, SW * T), y = rand(0, SH * T), r = rand(130, 210);
    if (zoneOf(x, y) === 1 || !far(x, y, r) || w.sand.some(s => Math.hypot(s.x - x, s.y - y) < s.r + r + 120)) continue;
    w.sand.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r) });
    for (let j = randi(1, 2); j > 0; j--) {
      const a = rand(0, 6.28), d = rand(0, r * 0.45), px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (!inRock(w, px, py, 75) && !inPit(w, px, py, 130)) w.pits.push({ id: w.nextId++, x: Math.round(px), y: Math.round(py), r: 70 });
    }
  }
  w.puddles = [];                            // 雨が降るとできる水たまり（くぼみ）
  for (let k = 0; k < 500 && w.puddles.length < 26; k++) {
    const x = rand(150, SW * T - 150), y = rand(150, SH * T - 150), r = rand(55, 120);
    if (Math.hypot(x - NEST.x, y - NEST.y) < 160 + r || inRock(w, x, y, r * 0.6) || w.sand.some(sd => Math.hypot(sd.x - x, sd.y - y) < sd.r + r) || dist({ x, y }, w.townPos) < 200 || w.puddles.some(q => Math.hypot(q.x - x, q.y - y) < q.r + r + 60)) continue;
    w.puddles.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r) });
  }
  w.mantisSpots = [];                        // 草むらにひそむカマキリ
  const cells = [...w.grass.keys()].filter(i => { const x = (i % SW + 0.5) * T, y = (Math.floor(i / SW) + 0.5) * T; return zoneOf(x, y) >= 2 && far(x, y, 0); });
  for (let k = 0; k < 300 && w.mantisSpots.length < 10 && cells.length; k++) {
    const i = cells[randi(0, cells.length - 1)], x = (i % SW + 0.5) * T, y = (Math.floor(i / SW) + 0.5) * T;
    if (w.mantisSpots.some(m => Math.hypot(m.x - x, m.y - y) < 600)) continue;
    w.mantisSpots.push({ x: Math.round(x), y: Math.round(y), back: 0 });
  }
}
function spawnMantises(w) {
  w.mantisSpots.forEach((m, i) => {
    if (m.back > w.day || w.enemies.some(e => e.type === 'mantis' && e.spot === i)) return;
    const e = spawnEnemy(w, 'mantis', m, false);
    Object.assign(e, { x: m.x, y: m.y, spot: i, holding: null, revealT: 0 });
  });
}
function safeTp(w, p, x, y) { const pos = { x, y }; collide(w, p.layer, pos, PR); teleport(p, p.layer, pos.x, pos.y); }
function setTrap(w, p, tr) {
  if (p.grab) releaseGrab(w, p);
  p.trap = { n: 0, ...tr }; p.lmb = false; p.dig = null; p.sleep = false;
  if (tr.x !== undefined) teleport(p, p.layer, tr.x, tr.y);
}
function releaseTrap(w, p) {
  const tr = p.trap;
  if (!tr) return;
  p.trap = null; p.immuneT = 2.5;
  if (tr.kind === 'pit') {
    const pit = w.pits.find(x => x.id === tr.pid);
    if (pit) {                                                 // 岩などに押し戻されない向きを探して、すり鉢の外へ
      let best = null;
      for (let k = 0; k < 12 && !best; k++) {
        const a = rand(0, 6.28), pos = { x: clamp(pit.x + Math.cos(a) * (pit.r + 22), 40, SW * T - 40), y: clamp(pit.y + Math.sin(a) * (pit.r + 22), 40, SH * T - 40) };
        collide(w, 's', pos, PR);
        if (!inPit(w, pos.x, pos.y, 4)) best = pos;
      }
      if (best) teleport(p, 's', best.x, best.y); else p.immuneT = 6;
    }
    msgTo(p, '🕳 アリジゴクの巣から這い上がった！');
  } else if (tr.kind === 'mantis') {
    const e = w.enemies.find(x => x.id === tr.eid);
    if (e) { e.holding = null; e.atkCd = 4; const a = Math.atan2(p.y - e.y, p.x - e.x); safeTp(w, p, e.x + Math.cos(a) * 95, e.y + Math.sin(a) * 95); }
    msgTo(p, '🦗 カマキリから逃げ出した！');
  } else if (tr.kind === 'bird') {
    p.hp -= 20 * (1 - armorOf(p));
    safeTp(w, p, clamp(p.x, 40, SW * T - 40), clamp(p.y, 40, SH * T - 40));
    if (w.bird) { w.bird.st = 'leave'; w.bird.t = 2; }
    msg(w, `🐦 ${p.name}が鳥を振りほどいて地面に落ちた！`);
    if (p.hp <= 0) killPlayer(w, p, '落ちたときの衝撃で力尽きた…');
  }
}
function updateTrap(w, p) {
  const tr = p.trap;
  if (tr.kind === 'pit') {
    p.hp -= 7 * DT * (1 - armorOf(p));
    if (p.hp <= 0) { p.trap = null; killPlayer(w, p, 'アリジゴクに食べられた…'); }
  } else if (tr.kind === 'mantis') {
    const e = w.enemies.find(x => x.id === tr.eid);
    if (!e || e.dead) { releaseTrap(w, p); return; }
    p.hp -= 10 * DT * (1 - armorOf(p));
    if (p.hp <= 0) { p.trap = null; killPlayer(w, p, 'カマキリに食べられた…'); }
  } else if (tr.kind === 'bird') {
    tr.t -= DT;
    if (tr.t <= 0) {
      p.x = tr.gx; p.y = tr.gy; p.trap = null;
      killPlayer(w, p, '鳥にさらわれた…');
      if (w.bird) { w.bird.st = 'leave'; w.bird.t = 2; }
    }
  }
}
function updateMantis(w, e, alive) {
  e.hitT -= DT; e.atkCd -= DT; e.revealT -= DT;
  if (e.hp <= 0) { killEnemy(w, e); return; }
  const h = e.holding && w.players[e.holding];
  if (h) {
    if (h.dead || !h.trap || h.trap.kind !== 'mantis') { e.holding = null; e.atkCd = 3; }
    return;
  }
  if (e.atkCd > 0) return;
  for (const p of alive) {
    if (p.layer !== 's' || p.trap || p.immuneT > 0 || p.sleep || dist(p, e) > 62) continue;
    e.holding = p.id; e.revealT = 5; e.a = Math.atan2(p.y - e.y, p.x - e.x);
    setTrap(w, p, { kind: 'mantis', need: 14, eid: e.id, x: e.x + Math.cos(e.a) * 26, y: e.y + Math.sin(e.a) * 26 });
    msg(w, `🦗 ${p.name}がカマキリにつかまった！ スペース連打で逃げろ！ 仲間はカマキリを攻撃して助けろ！`);
    return;
  }
}
// ---- 鳥 ----
function updateBird(w) {
  const sunny = !w.isNight && w.rain <= 0 && w.time > 15 && w.time < DAY_LEN - 15;
  const b = w.bird;
  if (!b) {
    w.birdCd -= DT;
    if (!sunny || w.birdCd > 0) return;
    const cands = Object.values(w.players).filter(p => !p.dead && p.layer === 's' && !p.trap && !inSafeZone(p.x, p.y) && dist(p, w.townPos) > 120);
    if (!cands.length) { w.birdCd = 4; return; }
    const tgt = cands[randi(0, cands.length - 1)];
    w.bird = { st: 'circle', t: 5, tid: tgt.id, x: tgt.x + 180, y: tgt.y, a: 0 };
    w.birdCd = zoneOf(tgt.x, tgt.y) === 3 ? rand(25, 45) : rand(40, 70);
    msg(w, `🐦 空に大きな鳥の影！ ${tgt.name}が狙われている！ 石の影・草むら・木の下に隠れろ！`);
    return;
  }
  const tgt = w.players[b.tid];
  if (b.st === 'circle') {
    b.t -= DT;
    if (!tgt || tgt.dead || tgt.layer !== 's') { b.st = 'leave'; b.t = 2.5; return; }
    b.a += DT * 2.2;
    b.x = tgt.x + Math.cos(b.a) * 170 * (b.t / 5 + 0.3); b.y = tgt.y + Math.sin(b.a) * 110 * (b.t / 5 + 0.3);
    if (b.t <= 0) { b.st = 'dive'; b.t = 0.9; }
  } else if (b.st === 'dive') {
    b.t -= DT;
    if (!tgt || tgt.dead || tgt.layer !== 's') { b.st = 'leave'; b.t = 2.5; return; }
    const k = Math.min(1, DT * 6); b.x += (tgt.x - b.x) * k; b.y += (tgt.y - b.y) * k;
    if (b.t > 0) return;
    const hidden = shadeAt(w, tgt.x, tgt.y) || inSafeZone(tgt.x, tgt.y) || (hasAcc(tgt, 'cloak') && Date.now() - tgt.lastMoveAt > 700);
    if (hidden || tgt.trap || tgt.immuneT > 0) { msg(w, `🐦 鳥は${tgt.name}を見失って飛んでいった`); b.st = 'leave'; b.t = 2.5; return; }
    setTrap(w, tgt, { kind: 'bird', need: 12, t: 3, gx: tgt.x, gy: tgt.y });
    b.st = 'carry'; b.ang = rand(0, 6.28);
    msg(w, `🐦 ${tgt.name}が鳥につかまった！ スペース連打で振りほどけ！`);
  } else if (b.st === 'carry') {
    b.x += Math.cos(b.ang) * 150 * DT; b.y += Math.sin(b.ang) * 150 * DT;
    if (tgt && tgt.trap && tgt.trap.kind === 'bird') { tgt.x = clamp(b.x, 20, SW * T - 20); tgt.y = clamp(b.y, 20, SH * T - 20); }
    else { b.st = 'leave'; b.t = 2.5; }
  } else {
    b.x += 260 * DT; b.y -= 120 * DT; b.t -= DT;
    if (b.t <= 0) w.bird = null;
  }
}
// ---- 軍隊アリの大行進 ----
function startArmy(w) {
  const axis = Math.random() < 0.5 ? 'x' : 'y', dir = Math.random() < 0.5 ? 1 : -1, max = axis === 'x' ? SW * T : SH * T;
  w.army = { axis, dir, pos: dir > 0 ? -250 : max + 250, speed: 85, warn: 15, max };
  msg(w, '🐜 遠くから地鳴り…赤い軍隊アリの大行進が来る！ 巣に逃げるか「刺激臭の玉」で身を守れ！');
  io.to(w.code).emit('armyCome');
}
function updateArmy(w) {
  const a = w.army;
  if (!a) return;
  if (a.warn > 0) { a.warn -= DT; return; }
  a.pos += a.dir * a.speed * DT;
  const inBand = (x, y) => Math.abs((a.axis === 'x' ? x : y) - a.pos) < 130;
  for (const p of Object.values(w.players)) {
    if (p.dead || p.layer !== 's' || !inBand(p.x, p.y) || repelled(w, p.x, p.y)) continue;
    p.hp -= 18 * DT * (1 - armorOf(p)); wake(p);
    if (p.warnT <= 0) { msgTo(p, '⚠ 軍隊アリに噛まれている！ 列から逃げろ！'); p.warnT = 3; }
    if (p.hp <= 0) killPlayer(w, p, '軍隊アリの大行進に飲み込まれた…');
  }
  for (const e of w.enemies) if (e.type !== 'boss' && e.layer === 's' && inBand(e.x, e.y) && !repelled(w, e.x, e.y)) killEnemy(w, e, true);
  w.enemies = w.enemies.filter(e => !e.dead);
  if (w.tickN % 15 === 0) {                  // 食べ物・置いた物・草を食い荒らす
    for (const it of [...w.items.values()]) if (it.layer === 's' && !it.bag && ITEMS[it.item].food && inBand(it.x, it.y) && !repelled(w, it.x, it.y)) removeGroundItem(w, it.id);
    for (const [i, o] of [...w.objs.s]) {
      if (OBJ[o.t].natural || OBJ[o.t].fixed) continue;
      const x = (i % SW + 0.5) * T, y = (Math.floor(i / SW) + 0.5) * T;
      if (inBand(x, y) && !repelled(w, x, y)) damageObj(w, 's', i, 8);
    }
    for (const [i, g] of w.grass) if (g > 0 && inBand((i % SW + 0.5) * T, (Math.floor(i / SW) + 0.5) * T)) { w.grass.set(i, 0); w.grassQ.push([i, 0]); }
  }
  if ((a.dir > 0 && a.pos > a.max + 250) || (a.dir < 0 && a.pos < -250)) {
    w.army = null; w.nextArmy = w.day + randi(4, 6); w.armyAt = rand(20, 120);
    msg(w, '軍隊アリの行進が通り過ぎていった…');
  }
}
// ---- 毎フレームの外の危険（暑さ・水たまり・アリジゴク） ----
function updateOutdoor(w, p) {
  if (p.layer !== 's') { p.heat = Math.max(0, p.heat - 8 * DT); return; }
  const sun = sunInfo(w), wet = inPuddle(w, p.x, p.y);
  if (sun.I > 0.25 && !wet && !shadeAt(w, p.x, p.y)) p.heat += 3.4 * sun.I * (hasAcc(p, 'parasol') ? 0.35 : 1) * DT;
  else p.heat -= 7 * DT;
  p.heat = clamp(p.heat, 0, 100);
  if (p.heat >= 100) { p.hp -= 4 * DT; if (p.warnT <= 0) { msgTo(p, '🥵 暑すぎる！ 日陰に入るか、水を飲もう'); p.warnT = 4; } if (p.hp <= 0) return killPlayer(w, p, '暑さで倒れた…'); }
  if (wet && !hasAcc(p, 'floater')) {
    p.hp -= 5 * DT;
    if (p.warnT <= 0) { msgTo(p, '💧 溺れそう！ 水たまりから出ろ！'); p.warnT = 3; }
    if (p.hp <= 0) return killPlayer(w, p, '水たまりで溺れた…');
  }
  if (!p.trap && p.immuneT <= 0) for (const pit of w.pits) {
    if (Math.abs(pit.x - p.x) < 20 && Math.abs(pit.y - p.y) < 20 && dist(pit, p) < 18) {
      setTrap(w, p, { kind: 'pit', need: 10, pid: pit.id, x: pit.x, y: pit.y });
      msg(w, `🕳 ${p.name}がアリジゴクにつかまった！ スペース連打で這い上がれ！（仲間は「糸のロープ」で助けられる）`);
      break;
    }
  }
}

// ================= 環境（昼夜・雨・草・資源・湧き） =================
function sideErrand(w) {
  const q = w.quest;
  if (q.stage === 2) return { main: true, ...MAIN_ERRAND };
  if (q.stage < 3) return null;
  if (!q.errand || q.errandDay !== w.day) { q.errand = { ...SIDE_ERRANDS[randi(0, SIDE_ERRANDS.length - 1)], done: false }; q.errandDay = w.day; }
  return q.errand;
}
function updateEnv(w) {
  w.time += DT;
  const alive = Object.values(w.players).filter(p => !p.dead);
  w.skipping = w.isNight && alive.length > 0 && alive.every(p => p.sleep);   // 全員ベッドで寝ていたら夜を早送り
  if (w.skipping) w.time += DT * 11;
  if (!w.isNight && w.time >= DAY_LEN) {
    w.isNight = true; w.time = 0; w.rain = 0;
    msg(w, `🌙 ${w.day}日目の夜。モンスターが巣穴から出てくる…（巣の中は安全）`);
  } else if (w.isNight && w.time >= NIGHT_LEN) {
    w.isNight = false; w.time = 0; w.day++;
    for (const e of w.enemies) if (e.raider) e.retreat = true;
    for (const p of Object.values(w.players)) wake(p);
    spawnNodes(w); spawnCubes(w); spawnMantises(w);
    if (w.prints.length) { w.prints = []; io.to(w.code).emit('prints', []); }
    msg(w, `☀ ${w.day}日目の朝。モンスターが巣穴へ帰っていく${w.day === w.nextHuman ? '…今日は地面が少し揺れている気がする' : ''}`);
  }
  if (w.rain > 0) { w.rain -= DT; if (w.rain <= 0) msg(w, '雨がやんだ'); }
  w.wet = clamp(w.wet + (w.rain > 0 ? DT / 12 : -DT / 70), 0, 1);       // 雨で水たまりが広がる
  for (const r of w.repels) r.t -= DT;
  w.repels = w.repels.filter(r => r.t > 0);
  updateBird(w);
  if (!w.army && !w.human && !w.isNight && w.day >= w.nextArmy && w.time >= w.armyAt && w.time < DAY_LEN - 60) startArmy(w);
  updateArmy(w);
  if (!w.isNight && !w.human && !w.army && w.day >= w.nextHuman && w.time >= w.humanAt && w.time < DAY_LEN - 40) startHuman(w);
  updateHuman(w);

  w.secT -= DT;
  if (w.secT > 0) return;
  w.secT = 1;
  if (!w.isNight && w.rain <= 0 && !w.human && Math.random() < 1 / 100) { w.rain = 30; msg(w, '☔ 雨が降ってきた。草がぐんぐん育つ！'); }
  const chance = w.rain > 0 ? 1 / 5 : 1 / 150;               // 草の成長
  for (const [i, g] of w.grass) if (g < 3 && Math.random() < chance) { w.grass.set(i, g + 1); w.grassQ.push([i, g + 1]); }
  for (let k = 0; k < 2; k++) {                              // 資源の補充
    const r = RES[randi(0, RES.length - 1)];
    if ((w.resCount[r.z + ':' + r.item] || 0) < r.n) spawnRes(w, r);
  }
  if (w.isNight) {                                           // モンスター
    const cap = Math.min(36, 5 + w.day * 3);
    const raiders = w.enemies.filter(e => e.raider && !e.retreat).length;
    if (raiders < cap && Math.random() < 0.6) spawnEnemy(w, Math.random() < Math.min(0.5, 0.15 + w.day * 0.04) ? 'beetle' : 'spider', w.dens[randi(0, w.dens.length - 1)], true);
  }
  if (w.enemies.filter(e => !e.raider && e.home !== w.lair && e.type !== 'mantis').length < 8 && Math.random() < 0.2) {
    const far = w.dens.filter(d => zoneOf(d.x, d.y) === 3), list = far.length ? far : w.dens;
    spawnEnemy(w, Math.random() < 0.4 ? 'beetle' : 'spider', list[randi(0, list.length - 1)], false);
  }
}

// ================= メインループ =================
function broadcast(w) {
  const t = questTarget(w);
  io.to(w.code).emit('st', {
    p: Object.values(w.players).map(p => [
      p.id, p.name, p.color, LC(p.layer), Math.round(p.x), Math.round(p.y), +p.a.toFixed(2),
      Math.round(p.hp), Math.round(p.hunger), p.dead ? 1 : 0, Math.ceil(p.respawn), p.biteT > 0 ? 1 : 0,
      p.dig ? p.dig.idx : -1, p.dig ? +(p.dig.prog / p.dig.hard).toFixed(2) : 0, jawOf(p), armorOf(p),
      p.sleep ? 1 : 0, p.slowT > 0 ? 1 : 0, p.grab || 0,
      p.trap ? { pit: 1, mantis: 2, bird: 3 }[p.trap.kind] : 0, p.trap ? +(p.trap.n / p.trap.need).toFixed(2) : 0, Math.round(p.heat), p.immuneT > 0 ? 1 : 0,
    ]),
    e: w.enemies.map(e => [e.id, EN[e.type].idx, LC(e.layer), Math.round(e.x), Math.round(e.y), +e.a.toFixed(2), Math.round(e.hp / e.maxHp * 100), e.hitT > 0 ? 1 : 0, e.type !== 'mantis' || e.holding || e.revealT > 0 ? 1 : 0]),
    b: w.bird ? [['circle', 'dive', 'carry', 'leave'].indexOf(w.bird.st), Math.round(w.bird.x), Math.round(w.bird.y), w.bird.tid] : null,
    ar: w.army ? [w.army.axis === 'x' ? 0 : 1, w.army.dir, Math.round(w.army.pos), Math.ceil(w.army.warn)] : null,
    rp: w.repels.map(r => [r.x, r.y, r.r, Math.ceil(r.t)]),
    wet: +w.wet.toFixed(2),
    cb: w.cubes.map(c => [c.id, Math.round(c.x), Math.round(c.y), c.grab.length]),
    k: UL.flatMap(l => [...w.cracks[l]].map(([i, t2]) => [LC(l), i, +t2.toFixed(1)])),
    c: [w.day, +w.time.toFixed(1), w.isNight ? 1 : 0, w.rain > 0 ? 1 : 0, w.skipping ? 1 : 0],
    q: [w.quest.stage, t ? LC(t.l) : -1, t ? Math.round(t.x) : 0, t ? Math.round(t.y) : 0, w.quest.bossDead ? 1 : 0, w.quest.baitN],
    qn: w.queen ? [Math.round(w.queen.x), Math.round(w.queen.y), LC(w.queen.layer), ['captive', 'follow', 'home'].indexOf(w.queen.state), Math.round(w.queen.hp / 2), w.queen.faint > 0 ? 1 : 0, +(w.queen.a || 0).toFixed(2)] : null,
  });
}
function flush(w) {
  if (w.tileQ.length) { io.to(w.code).emit('tiles', w.tileQ); w.tileQ = []; }
  if (w.grassQ.length) { io.to(w.code).emit('grass', w.grassQ); w.grassQ = []; }
  if (w.objQ.size) { io.to(w.code).emit('objs', [...w.objQ.values()]); w.objQ.clear(); }
}
function tickWorld(w) {
  if (w.gameOver) return;
  const ps = Object.values(w.players);
  if (!ps.length) return;
  w.tickN++;
  updatePlayers(w);
  updateCubes(w);
  updateEnemies(w);
  updateQueen(w);
  updateCracks(w);
  updateEnv(w);
  flush(w);
  if (w.tickN % 2 === 0) broadcast(w);
  w.saveT += DT;
  if (w.saveT >= SAVE_INTERVAL) { w.saveT = 0; saveWorld(w); }
}
setInterval(() => { for (const code in rooms) { try { tickWorld(rooms[code]); } catch (e) { console.error('tick error', code, e); } } }, 1000 / TICK);

function fullSync(w, p) {
  const ob = l => [...w.objs[l]].map(([i, o]) => [i, o.t, Math.round(o.hp), o.a || 0]);
  return {
    code: w.code, me: p.id, worldName: w.name,
    defs: {
      T, SW, SH, UW, UH, TW, TH, NEST, UENT, TEXIT, PLAYER_SPEED, PR, REACH, ITEMS, OBJ, RECIPES, JAW, DAY_LEN, NIGHT_LEN,
      INV_SIZE, HOTBAR, CHEST_SIZE, SUPPORT_RANGE, CUBE_R, DRAG: [42, 34, 130], SHOP_BUY, SELL, GACHA_COST, BET_AMOUNTS, SAFE_R, ACC_INFO,
    },
    rocks: w.rocks, dens: w.dens, trees: w.trees, deco: w.deco, grass: [...w.grass],
    under: Buffer.from(w.under).toString('base64'), town: Buffer.from(TOWN_GRID).toString('base64'),
    under2: Buffer.from(w.grids.u2).toString('base64'), under3: Buffer.from(w.grids.u3).toString('base64'),
    objs: { s: ob('s'), u: ob('u'), t: ob('t'), u2: ob('u2'), u3: ob('u3') },
    items: [...w.items.values()].map(compactItem),
    cubes: w.cubes.map(c => [c.id, Math.round(c.x), Math.round(c.y), c.grab.length]),
    prints: w.prints, sand: w.sand, pits: w.pits, puddles: w.puddles,
    you: { l: p.layer, x: p.x, y: p.y, s: p.tpSeq },
    lair: w.lair, townPos: w.townPos, bait: w.quest.pts.bait,
    quest: { stage: w.quest.stage, clearDay: w.quest.clearDay },
    inv: p.inv, sel: p.sel, equip: p.equip,
  };
}

// ================= アリ商店街のお店 =================
const SHOP_LINES = [
  'いらっしゃい。ここはアリ商店街の道具屋だよ。ミツ玉で買い物ができるよ。いらない物は買い取るよ',
  '',
  '『果物のかけら』3つと『松葉』5本を持ってきておくれ。果物は遠くのエリア、松葉は中くらいの距離に落ちているよ',
  '大きな木の根元の繭は硬いよ。作業台で『小石の大あご』を作るか、うちで買って装備しな',
  '空き缶の匂いは夜にしか分からないよ。光るキノコで『キノコランプ』を作って、持って行って照らしてごらん',
  '巨大グモは甘い物に目がないのさ。角砂糖を3つ、クモの巣の手前の『おびき台』まで引っぱって行けば出てくるよ。仲間と引っぱると速いよ',
  '巨大グモと戦うなら『甲殻の大あご』と『甲殻アーマー』があると安心だよ。食べ物も忘れずにね',
  '早く女王さまを繭から助けておあげ！',
  '女王さまを巣まで送り届けるんだよ。夜は危ないからね',
  '女王さまが戻ったんだってね！ 本当にありがとうよ。これからもごひいきに',
];
const STAGE_SHORT = ['地下に残る女王の羽を探す', '羽を商店街の道具屋に見せる', '道具屋のお使い', '巨木の根元の繭を調べる', '夜の空き缶をランプで調べる', '角砂糖をおびき台へ運ぶ', '巨大グモを倒す', '女王の繭を破る', '女王を巣まで護衛する', 'クリア済み！'];
function npcPayload(w, kind) {
  if (kind === 'shop') {
    const e = sideErrand(w);
    return { kind, stage: w.quest.stage, line: SHOP_LINES[w.quest.stage], errand: e ? { main: !!e.main, need: e.need, honey: e.honey, done: !!e.done } : null };
  }
  if (kind === 'board') return {
    kind, lines: [
      `📌 女王さまの捜索：いまは「${STAGE_SHORT[w.quest.stage]}」`,
      `🦶 うわさ：人間は ${w.nextHuman}日目ごろにやって来るらしい（今日は${w.day}日目）。足跡のまわりには食べ物が落ちる`,
      '🍬 角砂糖ブロックは、巣に運ぶと「かけら」に、商店街の入口に運ぶとミツ玉になるよ',
      '⛏ 地下で広い部屋を掘るときは柱を立てないと、部屋ごと崩れるよ',
      '🌙 夜はモンスターが巣のまわりをうろつく。巣の中までは入ってこない',
    ],
  };
  return { kind };
}
const NPC_KIND = { npcShop: 'shop', shelf: 'shop', gachaMachine: 'gacha', npcGacha: 'gacha', betTable: 'bet', npcBet: 'bet', board: 'board' };
const NPC_TYPES = { shop: ['npcShop', 'shelf'], gacha: ['gachaMachine', 'npcGacha'], bet: ['betTable', 'npcBet'], board: ['board'] };
const atNpc = (w, p, kind) => p.layer === 't' && nearObj(w, p, NPC_TYPES[kind], 3.6);

// ================= 通信 =================
io.on('connection', socket => {
  socket.emit('serverInfo', { persistent: !!mongoCol, uriSet: !!process.env.MONGODB_URI, dbError });
  const ctx = () => {
    const w = rooms[socket.data.code];
    const p = w && w.players[socket.id];
    return p && !w.gameOver ? { w, p } : null;
  };

  // ---------- アカウント ----------
  socket.data.fails = 0;
  const loginOK = async (a, token) => {
    if (socket.data.user && socket.data.user !== a._id) {        // 同じ接続で別アカウントに切り替え
      leaveWorld(socket);
      if (online.get(socket.data.user) === socket.id) online.delete(socket.data.user);
    }
    const prev = socketOf(a._id);
    if (prev && prev.id !== socket.id) { prev.emit('kicked', '別の端末でログインしたので切断しました'); leaveWorld(prev); prev.disconnect(true); }
    online.set(a._id, socket.id);
    socket.data.user = a._id;
    socket.emit('loggedIn', { name: a.name, token });
    sendAccBackup(a);
    sendLobby(socket);
    for (const fk of a.followers || []) refreshLobbyOf(fk);
  };
  const authErr = t => socket.emit('authErr', t);
  socket.on('register', async (d = {}) => {
    const name = validName(d.name);
    if (!name) return authErr('ユーザーネームは2〜12文字（空白・記号なし）');
    const pass = String(d.pass || '');
    if (pass.length < 4 || pass.length > 64) return authErr('パスワードは4文字以上にしてね');
    if (await accGet(name)) return authErr('その名前はもう使われています。自分のアカウントなら「アカウント復元」からログインしてね');
    const salt = crypto.randomBytes(16).toString('hex');
    const a = { _id: accKey(name), name, salt, hash: hashPass(pass, salt), friends: [], followers: [], worlds: [], tokens: [], created: Date.now() };
    const token = issueToken(a);
    await accPut(a);
    loginOK(a, token);
  });
  socket.on('login', async (d = {}) => {                         // アカウント復元
    const a = await accGet(d.name);
    if (!a || !sameHex(hashPass(d.pass || '', a.salt), a.hash)) {
      socket.data.fails++;
      await sleep(Math.min(5000, socket.data.fails * 400));
      return authErr(a ? 'パスワードが違います' : 'そのユーザーネームのアカウントが見つかりません' + (mongoCol ? '' : '（サーバーのデータが消えた可能性があります）'));
    }
    socket.data.fails = 0;
    const token = issueToken(a);
    await accPut(a);
    loginOK(a, token);
  });
  socket.on('auth', async (d = {}) => {                          // 保存済みトークンで自動ログイン
    const a = await accGet(d.name);
    if (!a) return socket.emit('authFail', { reason: 'noAccount', name: d.name, persistent: !!mongoCol });
    if (!d.token || !(a.tokens || []).includes(sha(d.token))) return socket.emit('authFail', { reason: 'badToken', name: a.name });
    loginOK(a, null);
  });
  socket.on('logout', async (d = {}) => {
    const a = await accGet(socket.data.user);
    if (a && d.token) { a.tokens = (a.tokens || []).filter(t => t !== sha(d.token)); await accPut(a); }
    leaveWorld(socket);
    if (online.get(socket.data.user) === socket.id) online.delete(socket.data.user);
    socket.data.user = null;
  });
  socket.on('lobby', () => { if (socket.data.user) sendLobby(socket); });

  // ---------- ブラウザのバックアップから復元 ----------
  socket.on('restoreAccount', async (d = {}) => {
    try {
      if (typeof d.s !== 'string' || d.s.length > 2e5 || signStr(d.s) !== d.sig) return socket.emit('authFail', { reason: 'noAccount', persistent: !!mongoCol });
      const a = JSON.parse(d.s);
      if (!a || !a._id || !a.salt || !a.hash || a._id !== accKey(a.name)) return;
      const cur = await accGet(a._id);
      const acc = cur || a;
      if (!cur) { await accPut(a); console.log('アカウントをブラウザのバックアップから復元', a._id); }
      if (d.token && (acc.tokens || []).includes(sha(d.token))) { socket.emit('info', 'この端末に残っていたデータからアカウントを復元しました'); loginOK(acc, null); }
      else socket.emit('authFail', { reason: 'badToken', name: acc.name });
    } catch (e) { console.error('restoreAccount', e.message); }
  });
  socket.on('restoreWorld', async (d = {}) => {
    try {
      const a = await accGet(socket.data.user);
      if (!a || typeof d.s !== 'string' || signStr(d.s) !== d.sig) return socket.emit('err', 'バックアップが壊れていて復元できません');
      const data = JSON.parse(d.s), code = String(data.code || '');
      if (!code || !data.under) return;
      const member = data.owner === a._id || Object.keys(data.saved || {}).map(accKey).includes(a._id);
      if (!member) return socket.emit('err', 'このワールドのバックアップは復元できません');
      if ((a.deleted || []).includes(code)) return socket.emit(d.silent ? 'wbDrop' : 'err', d.silent ? { code } : 'このワールドは削除されています');
      if (data.owner === a._id && !a.worlds.some(x => x.code === code)) {          // 一覧から消えていたら戻す
        if (a.worlds.length >= MAX_WORLDS) return d.silent ? null : socket.emit('err', `ワールドは${MAX_WORLDS}つまで。1つ削除してから復元してね`);
        a.worlds.push({ code, name: String(data.name || 'ワールド').slice(0, 20) }); await accPut(a);
      }
      if (!rooms[code]) {
        const cur = await dbLoad(code).catch(() => null);
        if (!cur || (cur.savedAt || 0) < (data.savedAt || 0)) { await dbSave(code, data); console.log('ワールドをブラウザのバックアップから復元', code); }
      }
      if (d.silent) sendLobby(socket); else socket.emit('worldRestored', { code });
    } catch (e) { console.error('restoreWorld', e.message); socket.emit('err', '復元に失敗しました'); }
  });

  // ---------- ワールド ----------
  socket.on('createWorld', async (d = {}) => {
    const a = await accGet(socket.data.user); if (!a) return;
    if (a.worlds.length >= MAX_WORLDS) return socket.emit('err', `ワールドは${MAX_WORLDS}つまでしか作れません`);
    const name = String(d.name || '').replace(/[<>&"']/g, '').trim().slice(0, 16) || `${a.name}のワールド${a.worlds.length + 1}`;
    let code;
    do { code = crypto.randomBytes(5).toString('hex'); } while (rooms[code] || await dbLoad(code).catch(() => null));
    const w = createWorld(code);
    w.owner = a._id; w.name = name;
    const data = serialize(w);
    await dbSave(code, data);
    socket.emit('backup', makeBackup(w, data));
    a.worlds.push({ code, name });
    await accPut(a);
    sendLobby(socket);
    for (const fk of a.followers || []) refreshLobbyOf(fk);
  });
  socket.on('deleteWorld', async (d = {}) => {
    const a = await accGet(socket.data.user); if (!a) return;
    if (!a.worlds.find(x => x.code === d.code)) return;
    const w = rooms[d.code];
    if (w) {
      w.gameOver = true;                                    // これ以降は保存しない
      for (const id of Object.keys(w.players)) { const s2 = io.sockets.sockets.get(id); if (s2) { s2.emit('kicked', 'ワールドが削除されました'); leaveWorld(s2, true); } }
      delete rooms[d.code];
      await w.savePromise;
    }
    await dbDelete(d.code).catch(() => {});
    a.worlds = a.worlds.filter(x => x.code !== d.code);
    a.deleted = [...(a.deleted || []), d.code].slice(-30);           // バックアップから生き返らないように
    await accPut(a);
    sendLobby(socket);
  });
  socket.on('join', async (d = {}) => {
    if (socket.data.joining) return;
    const a = await accGet(socket.data.user);
    if (!a) return socket.emit('err', 'ログインしてね');
    socket.data.joining = true;
    try {
      const code = String(d.code || '');
      const w = await getWorld(code);
      if (!w) return socket.emit('worldMissing', { code });       // ブラウザのバックアップから戻せるか聞く
      if (!(await canJoin(a, w))) return socket.emit('err', 'お互いにフレンド登録すると参加できます');
      leaveWorld(socket);
      const p = makePlayer(w, socket.id, a.name);
      w.players[socket.id] = p;
      socket.data.code = code;
      socket.join(code);
      socket.emit('world', fullSync(w, p));
      msg(w, `🐜 ${a.name} が入ってきた`);
      for (const fk of a.followers || []) refreshLobbyOf(fk);
    } finally { socket.data.joining = false; }
  });
  socket.on('leave', () => { leaveWorld(socket); sendLobby(socket); });

  // ---------- フレンド ----------
  socket.on('addFriend', async (d = {}) => {
    const a = await accGet(socket.data.user); if (!a) return;
    const f = await accGet(d.name);
    if (!f) return socket.emit('err', 'そのユーザーは見つかりません');
    if (f._id === a._id) return socket.emit('err', '自分は追加できません');
    if (a.friends.includes(f._id)) return socket.emit('err', 'もう追加しています');
    if (a.friends.length >= 50) return socket.emit('err', 'フレンドは50人まで');
    a.friends.push(f._id);
    f.followers = [...new Set([...(f.followers || []), a._id])];
    await accPut(a); await accPut(f);
    socket.emit('info', f.friends.includes(a._id) ? `${f.name}とフレンドになりました！` : `${f.name}を追加しました（相手も追加するとワールドに参加できます）`);
    sendLobby(socket);
    refreshLobbyOf(f._id);
  });
  socket.on('removeFriend', async (d = {}) => {
    const a = await accGet(socket.data.user); if (!a) return;
    const f = await accGet(d.name);
    if (!f) return;
    a.friends = a.friends.filter(x => x !== f._id);
    f.followers = (f.followers || []).filter(x => x !== a._id);
    await accPut(a); await accPut(f);
    sendLobby(socket);
    refreshLobbyOf(f._id);
  });

  // ---------- ゲーム中 ----------
  socket.on('p', d => {
    const c = ctx(); if (!c || !d) return;
    const { w, p } = c;
    p.ax = +d.ax || 0; p.ay = +d.ay || 0; p.lmb = !!d.l && !p.sleep && !p.trap; p.ddown = !!d.dd && !p.sleep && !p.trap;
    if (p.dead || p.sleep || p.trap || d.s !== p.tpSeq) return;
    const x = +d.x, y = +d.y;
    if (!isFinite(x) || !isFinite(y)) return;
    const now = Date.now(), el = Math.min(0.5, (now - p.lastPos) / 1000);
    p.lastPos = now;
    if (Math.hypot(x - p.x, y - p.y) > PLAYER_SPEED * Math.max(el, 0.05) * 1.8 + 12) { teleport(p, p.layer, p.x, p.y); return; }
    const tmp = { x, y };
    collide(w, p.layer, tmp, PR - 1);
    if (Math.hypot(tmp.x - x, tmp.y - y) > 6) { teleport(p, p.layer, tmp.x, tmp.y); return; }
    if (Math.hypot(tmp.x - p.x, tmp.y - p.y) > 1.5) p.lastMoveAt = now;
    p.x = tmp.x; p.y = tmp.y; p.a = +d.a || 0;
  });
  socket.on('sel', i => { const c = ctx(); if (c && i >= 0 && i < HOTBAR) c.p.sel = i | 0; });
  socket.on('wake', () => { const c = ctx(); if (c) wake(c.p); });

  socket.on('use', d => {
    const c = ctx(); if (!c || !d || c.p.dead || c.p.sleep) return;
    const { w, p } = c;
    const x = +d.x, y = +d.y;
    if (!isFinite(x) || !isFinite(y)) return;
    const held = p.inv[p.sel];
    if (held && ITEMS[held.id].tool) { useTool(w, p, held); return; }
    if (p.trap) return;
    if (p.grab) { releaseGrab(w, p); return; }                    // 角砂糖を離す
    if (p.layer === 's') {                                        // 角砂糖をつかむ
      const cube = w.cubes.find(cb => Math.hypot(cb.x - x, cb.y - y) < CUBE_R + 26 && dist(cb, p) < CUBE_R + PR + 50);
      if (cube) {
        if (cube.grab.length >= 4) return msgTo(p, 'これ以上はつかめない');
        cube.grab.push(p.id); p.grab = cube.id; p.lmb = false; p.dig = null;
        return;
      }
    }
    if (Math.hypot(x - p.x, y - p.y) > REACH + 8) return;
    const l = p.layer, tx = Math.floor(x / T), ty = Math.floor(y / T);
    const idx = ty * LW(l) + tx, o = w.objs[l].get(idx);
    if (o) {
      if (o.t === 'chest') { p.openChest = { l, idx }; socket.emit('chest', { l, i: idx, items: o.items }); return; }
      if (o.t === 'bench') { socket.emit('openCraft'); return; }
      if (NPC_KIND[o.t]) {
        const kind = NPC_KIND[o.t];
        if (kind === 'shop' && w.quest.stage === 1) { advanceQuest(w, 2, p); give(w, p, 'honey', 5); emitInv(p); msgTo(p, 'ばあさん「お小遣いにミツ玉を5つあげよう」'); }
        socket.emit('npc', npcPayload(w, kind));
        return;
      }
      if (o.t === 'bed') {
        p.bed = { l, i: idx };
        if (!w.isNight) { msgTo(p, '🛏 ここを復活地点にした（夜になったら眠れる）'); return; }
        if (w.enemies.some(e => e.layer === l && Math.hypot(e.x - p.x, e.y - p.y) < 200)) { msgTo(p, '近くに敵がいて眠れない！'); return; }
        teleport(p, l, (tx + 0.5) * T, (ty + 0.5) * T);
        p.sleep = true; p.lmb = false; p.dig = null;
        msg(w, `💤 ${p.name}が眠った（全員が眠ると夜が早く過ぎる）`);
        return;
      }
      if (OBJ[o.t].qs !== undefined) {
        const why = questBlock(w, o, p);
        if (why) msgTo(p, why);
        else if (OBJ[o.t].solid) msgTo(p, '長押し（Kキー）でかじって破ろう');
        else destroyObj(w, l, idx, p);
        return;
      }
    }
    const s = p.inv[p.sel];
    if (!s) return;
    const def = ITEMS[s.id];
    if (def.food) { eat(p); return; }
    if (def.place && canPlace(w, l, tx, ty, def.place)) {
      const no = { t: def.place, hp: OBJ[def.place].hp };
      if (def.place === 'chest') no.items = new Array(CHEST_SIZE).fill(null);
      removeItem(p.inv, s.id, 1);
      setObj(w, l, idx, no);
      if (OBJ[def.place].support && isUnder(l)) recomputeSupport(w, l);
      emitInv(p);
    }
  });
  function useTool(w, p, held) {
    const kind = ITEMS[held.id].tool;
    if (kind === 'rope') {                                      // 糸のロープ：つかまった仲間（自分）を助ける
      const near = Object.values(w.players).filter(q => !q.dead && q.layer === p.layer && q.trap && q.trap.kind !== 'bird' && dist(q, p) < 120);
      if (near.length) {
        removeItem(p.inv, held.id, 1); emitInv(p);
        for (const q of near) { releaseTrap(w, q); msg(w, q === p ? `🪢 ${p.name}が糸のロープで自力で抜け出した！` : `🪢 ${p.name}が糸のロープで${q.name}を助け出した！`); }
        return;
      }
      if (p.layer === 's' && w.pits.some(pit => dist(pit, p) < pit.r + 6)) {
        removeItem(p.inv, held.id, 1); emitInv(p); p.immuneT = 5;
        msgTo(p, '🪢 ロープで体を固定した。すべり落ちない！');
        return;
      }
      return msgTo(p, 'ロープはアリジゴクやカマキリにつかまったときに使おう');
    }
    if (kind === 'repel' && !p.trap) {                          // 刺激臭の玉：敵と軍隊アリが近づけない
      if (p.layer !== 's') return msgTo(p, '外で使おう');
      removeItem(p.inv, held.id, 1); emitInv(p);
      w.repels.push({ x: Math.round(p.x), y: Math.round(p.y), r: 110, t: 25 });
      msg(w, `💨 ${p.name}が刺激臭の玉を割った！ しばらく敵が近づけない`);
    }
  }
  socket.on('mash', () => {                                     // スペース連打でもがく
    const c = ctx(); if (!c || !c.p.trap) return;
    const now = Date.now();
    if (now - (c.p.lastMash || 0) < 45) return;
    c.p.lastMash = now;
    if (++c.p.trap.n >= c.p.trap.need) releaseTrap(c.w, c.p);
  });
  function eat(p) {
    const s = p.inv[p.sel];
    if (!s || !ITEMS[s.id].food || (p.hunger >= 99.5 && !ITEMS[s.id].cool)) return;
    p.hunger = Math.min(100, p.hunger + ITEMS[s.id].food);
    if (ITEMS[s.id].cool) { p.heat = Math.max(0, p.heat - ITEMS[s.id].cool); msgTo(p, '💧 水を飲んで体が冷えた'); }
    s.n--; if (!s.n) p.inv[p.sel] = null;
    emitInv(p);
  }
  socket.on('eat', () => { const c = ctx(); if (c && !c.p.dead) eat(c.p); });

  socket.on('craft', ri => {
    const c = ctx(); if (!c || c.p.dead) return;
    const { w, p } = c, r = RECIPES[ri];
    if (!r) return;
    if (r.bench && !nearObj(w, p, ['bench'])) { msgTo(p, '作業台の近くでないと作れない'); return; }
    if (!hasAll(p.inv, r.cost)) return;
    for (const id in r.cost) removeItem(p.inv, id, r.cost[id]);
    let slot = equipSlotOf(r.out);
    if (slot === 'acc') slot = !p.equip.acc1 ? 'acc1' : !p.equip.acc2 ? 'acc2' : null;
    if (slot && !p.equip[slot]) { p.equip[slot] = { id: r.out, n: 1 }; msgTo(p, `${ITEMS[r.out].n}を装備した`); }   // 空いていれば自動で装備
    else give(w, p, r.out, r.n);
    emitInv(p);
  });
  socket.on('swap', d => {
    const c = ctx(); if (!c || !d) return;
    const { p } = c, a = d.a | 0, b = d.b | 0;
    if (a < 0 || b < 0 || a >= INV_SIZE || b >= INV_SIZE || a === b) return;
    const A = p.inv[a], B = p.inv[b];
    if (A && B && A.id === B.id && B.n < maxStack(B.id)) { const k = Math.min(A.n, maxStack(B.id) - B.n); B.n += k; A.n -= k; if (!A.n) p.inv[a] = null; }
    else { p.inv[a] = B; p.inv[b] = A; }
    emitInv(p);
  });
  socket.on('moveSlot', i => {                                   // ホットバー ⇄ バッグ
    const c = ctx(); if (!c) return;
    const { p } = c, s = p.inv[i | 0];
    if (!s) return;
    const toBag = (i | 0) < HOTBAR, range = toBag ? [HOTBAR, INV_SIZE] : [0, HOTBAR];
    for (let k = range[0]; k < range[1] && s.n; k++) {
      const t = p.inv[k];
      if (t && t.id === s.id && t.n < maxStack(s.id)) { const m = Math.min(s.n, maxStack(s.id) - t.n); t.n += m; s.n -= m; }
    }
    for (let k = range[0]; k < range[1] && s.n; k++) if (!p.inv[k]) { p.inv[k] = { id: s.id, n: s.n }; s.n = 0; }
    if (!s.n) p.inv[i | 0] = null;
    emitInv(p);
  });
  socket.on('equip', d => {
    const c = ctx(); if (!c || !d || c.p.dead) return;
    const { p } = c;
    if (['jaw', 'armor', 'acc1', 'acc2'].includes(d.unequip)) {
      const cur = p.equip[d.unequip];
      if (!cur) return;
      if (addItem(p.inv, cur.id, 1)) { msgTo(p, '持ち物がいっぱいで外せない'); return; }
      p.equip[d.unequip] = null;
    } else {
      const i = d.slot | 0, s = p.inv[i];
      if (!s) return;
      let slot = equipSlotOf(s.id);
      if (!slot) return;
      if (slot === 'acc') {
        if (hasAcc(p, s.id)) return msgTo(p, 'もう同じ物を装備している');
        slot = d.to === 'acc2' || (p.equip.acc1 && !p.equip.acc2) ? 'acc2' : 'acc1';
      }
      const old = p.equip[slot];
      p.equip[slot] = { id: s.id, n: 1 };
      p.inv[i] = old;
    }
    emitInv(p);
  });
  socket.on('drop', i => {
    const c = ctx(); if (!c || c.p.dead) return;
    const { w, p } = c, s = p.inv[i | 0];
    if (!s) return;
    p.inv[i | 0] = null;
    addGroundItem(w, { layer: p.layer, x: Math.round(p.x), y: Math.round(p.y), item: s.id, n: s.n, noPickId: p.id, noPickUntil: Date.now() + 2000 });
    emitInv(p);
  });
  socket.on('chestMove', d => {
    const c = ctx(); if (!c || !d || c.p.dead) return;
    const { w, p } = c, oc = p.openChest;
    if (!oc || oc.l !== p.layer) return;
    const o = w.objs[oc.l].get(oc.idx);
    if (!o || o.t !== 'chest') { p.openChest = null; return; }
    const tx = oc.idx % LW(oc.l), ty = Math.floor(oc.idx / LW(oc.l));
    if (Math.hypot((tx + 0.5) * T - p.x, (ty + 0.5) * T - p.y) > T * 4) return;
    const from = d.from === 'chest' ? o.items : p.inv, to = d.from === 'chest' ? p.inv : o.items;
    const s = from[d.slot | 0];
    if (!s) return;
    const left = addItem(to, s.id, s.n);
    if (left) s.n = left; else from[d.slot | 0] = null;
    emitInv(p);
    io.to(w.code).emit('chest', { l: oc.l, i: oc.idx, items: o.items, update: 1 });
  });
  socket.on('enter', () => {
    const c = ctx(); if (!c || c.p.dead || c.p.sleep || c.p.trap) return;
    const { w, p } = c;
    if (p.grab) releaseGrab(w, p);
    if (p.layer === 's' && dist(p, NEST) < NEST.r + 30) teleport(p, 'u', UENT_X, UENT_Y);
    else if (p.layer === 's' && dist(p, w.townPos) < 60) { teleport(p, 't', TSPAWN.x, TSPAWN.y); msgTo(p, '🏮 アリ商店街へようこそ！'); }
    else if (isUnder(p.layer)) {                                  // 出入口・階段（いちばん近いもの）
      let best = null, bd = T * 1.3;
      if (p.layer === 'u') { const d = Math.hypot(p.x - UENT_X, p.y - UENT_Y); if (d < bd) { bd = d; best = { out: 1 }; } }
      const g = w.grids[p.layer], ptx = Math.floor(p.x / T), pty = Math.floor(p.y / T);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = ptx + dx, ty = pty + dy, v = g[ty * UW + tx];
        if (v !== U.STAIR_DN && v !== U.STAIR_UP) continue;
        const d = Math.hypot((tx + 0.5) * T - p.x, (ty + 0.5) * T - p.y);
        if (d < bd) { bd = d; best = { tx, ty, v }; }
      }
      if (!best) return;
      if (best.out) { teleport(p, 's', NEST.x, NEST.y + NEST.r + 14); return; }
      const to = UL[UL.indexOf(p.layer) + (best.v === U.STAIR_DN ? 1 : -1)];
      teleport(p, to, (best.tx + 0.5) * T, (best.ty + 0.5) * T);
      msgTo(p, `地下${FLOOR_NO[to]}階${to === 'u' ? '（巣）' : ''}`);
    }
    else if (p.layer === 't' && Math.hypot(p.x - (TEXIT.tx + 0.5) * T, p.y - (TEXIT.ty + 0.5) * T) < T * 1.6) teleport(p, 's', w.townPos.x, w.townPos.y + 56);
  });

  // ---------- お店 ----------
  socket.on('shopBuy', i => {
    const c = ctx(); if (!c || !atNpc(c.w, c.p, 'shop')) return;
    const { w, p } = c, it = SHOP_BUY[i | 0];
    if (!it) return;
    if (countItem(p.inv, 'honey') < it.price) return msgTo(p, 'ミツ玉が足りない');
    removeItem(p.inv, 'honey', it.price);
    give(w, p, it.id, it.n);
    emitInv(p);
  });
  socket.on('shopSell', d => {
    const c = ctx(); if (!c || !d || !atNpc(c.w, c.p, 'shop')) return;
    const { w, p } = c, price = SELL[d.id];
    if (!price) return;
    const n = d.all ? countItem(p.inv, d.id) : Math.min(1, countItem(p.inv, d.id));
    if (!n) return;
    removeItem(p.inv, d.id, n);
    give(w, p, 'honey', n * price);
    emitInv(p);
  });
  socket.on('errand', () => {
    const c = ctx(); if (!c || !atNpc(c.w, c.p, 'shop')) return;
    const { w, p } = c, e = sideErrand(w);
    if (!e || e.done) return;
    if (!hasAll(p.inv, e.need)) return msgTo(p, 'まだ足りないよ');
    for (const id in e.need) removeItem(p.inv, id, e.need[id]);
    give(w, p, 'honey', e.honey);
    if (e.main) advanceQuest(w, 3, p);
    else { e.done = true; msg(w, `📦 ${p.name}が道具屋のお使いを達成！ ミツ玉 +${e.honey}`); }
    emitInv(p);
    socket.emit('npc', npcPayload(w, 'shop'));
  });
  socket.on('gacha', () => {
    const c = ctx(); if (!c || !atNpc(c.w, c.p, 'gacha')) return;
    const { w, p } = c;
    if (countItem(p.inv, 'honey') < GACHA_COST) return msgTo(p, 'ミツ玉が足りない');
    removeItem(p.inv, 'honey', GACHA_COST);
    let r = Math.random() * 100, pick = GACHA[0];
    for (const g of GACHA) { if (r < g[0]) { pick = g; break; } r -= g[0]; }
    const [, rank, id, n] = pick;
    give(w, p, id, n);
    emitInv(p);
    socket.emit('gachaResult', { rank, id, n });
    if (rank >= 2) setTimeout(() => msg(w, `🎉 ${p.name}がガチャで「${ITEMS[id].n}」を当てた！`), 1600);
  });
  socket.on('bet', d => {
    const c = ctx(); if (!c || !d || !atNpc(c.w, c.p, 'bet')) return;
    const { w, p } = c, amount = d.amount | 0, pick = d.pick | 0;
    if (!BET_AMOUNTS.includes(amount) || pick < 0 || pick > 2) return;
    if (countItem(p.inv, 'honey') < amount) return msgTo(p, 'ミツ玉が足りない');
    removeItem(p.inv, 'honey', amount);
    const cup = randi(0, 2), win = cup === pick, payout = win ? Math.floor(amount * 2.5) : 0;
    if (payout) give(w, p, 'honey', payout);
    emitInv(p);
    socket.emit('betResult', { cup, pick, win, payout, amount });
  });

  // テスト用（環境変数 ANT_DEBUG=1 のときだけ有効）
  if (process.env.ANT_DEBUG) socket.on('dbg', d => {
    const c = ctx(); if (!c) return;
    const { w, p } = c;
    if (d.night) { w.isNight = false; w.time = DAY_LEN - 0.1; }
    if (d.day) { w.isNight = false; w.time = 1; }
    if (d.give) { give(w, p, d.give, d.n || 1); emitInv(p); }
    if (d.pos) teleport(p, d.pos.l, d.pos.x, d.pos.y);
    if (d.heal) { p.hp = 100; p.hunger = 100; }
    if (d.queen && w.queen) { w.queen.x = d.queen.x; w.queen.y = d.queen.y; }
    if (d.stage !== undefined) w.quest.stage = d.stage;
    if (d.human) { w.nextHuman = w.day; w.humanAt = 0; w.isNight = false; if (w.time > DAY_LEN - 60) w.time = 10; }
    if (d.cube) w.cubes.push({ id: w.nextId++, x: d.cube.x, y: d.cube.y, grab: [] });
    if (d.bird) { w.isNight = false; w.rain = 0; if (w.time < 20 || w.time > DAY_LEN - 20) w.time = 60; w.birdCd = 0; w.bird = null; }
    if (d.army) { startArmy(w); w.army.warn = 2; if (d.army.pos !== undefined) { w.army.axis = 'x'; w.army.dir = 1; w.army.pos = d.army.pos; } }
    if (d.rain) { w.rain = 30; w.wet = 1; }
    if (d.noon) { w.isNight = false; w.rain = 0; w.time = DAY_LEN / 2; }
    if (d.clear) { const { l, x0, y0, x1, y1 } = d.clear, g = gridOf(w, l); for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) { const i = ty * UW + tx; if (g[i] !== U.STAIR_UP && g[i] !== U.STAIR_DN) { g[i] = U.OPEN; w.tileQ.push([LC(l), i, U.OPEN]); } } recomputeSupport(w, l); }
  });

  socket.on('disconnect', async () => {
    leaveWorld(socket);
    const u = socket.data.user;
    if (u && online.get(u) === socket.id) {
      online.delete(u);
      const acc = await accGet(u);
      if (acc) for (const fk of acc.followers || []) refreshLobbyOf(fk);
    }
  });
});

// ワールドから抜ける（保存して、誰もいなければメモリから外す）
function leaveWorld(socket, silent) {
  const w = rooms[socket.data.code];
  socket.leave(socket.data.code || '');
  socket.data.code = null;
  if (!w || !w.players[socket.id]) return;
  const p = w.players[socket.id];
  if (p.grab) releaseGrab(w, p);
  if (p.trap) p.trap = null;
  w.saved[p.name] = playerSave(p);
  delete w.players[socket.id];
  if (socket.connected && !w.gameOver) socket.emit('backup', makeBackup(w));
  if (!silent) msg(w, `${p.name} が出ていった`);
  unloadIfEmpty(w);
}

const PORT = process.env.PORT || 3000;
initDB().then(() => server.listen(PORT, () => console.log(`Ant Survival running on port ${PORT}`)));
