// ===== アリ・サバイバル サーバー =====
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---- 定数 ----
const W = 3000, H = 2200;
const NEST = { x: W / 2, y: H / 2, r: 70 };
const TICK = 30, DT = 1 / TICK;
const DAY_LEN = 150, NIGHT_LEN = 60;        // 秒
const MAX_CARRY = 5;
const FOOD_TARGET = 90;
const MAX_WORKERS = 25;
const HATCH_COST = 8, REPAIR_COST = 5;
const COLORS = ['#c0392b', '#2c3e50', '#8e44ad', '#d35400', '#16a085', '#7f5a2a', '#2980b9', '#b03a7a'];

// 食べ物タイプ（index順でクライアントに送る）
const FOOD_TYPES = [
  { name: 'crumb', v: 1, r: 6 },   // パンくず
  { name: 'seed',  v: 2, r: 8 },   // 種
  { name: 'sugar', v: 5, r: 12 },  // 角砂糖（手ぶらの時だけ運べる）
  { name: 'meat',  v: 2, r: 9 },   // 虫の肉（敵を倒すと出る）
];
const ENEMY = {
  spider: { hp: 40, spd: 135, dmg: 10, r: 22, detect: 320, drop: 2 },
  beetle: { hp: 90, spd: 70,  dmg: 18, r: 26, detect: 220, drop: 3 },
};

// ---- 状態 ----
let rocks = [], players = {}, foods = [], enemies = [], workers = [], drops = [];
let nextId = 1;
let colony, gameOver = false, best = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const msg = (text) => io.emit('msg', text);

function newColony() {
  return { food: 20, nestHp: 100, maxNestHp: 100, day: 1, time: 0, isNight: false, rain: 0, rainSpawn: 0 };
}

function genRocks() {
  rocks = [];
  let tries = 0;
  while (rocks.length < 45 && tries < 2000) {
    tries++;
    const r = rand(30, 90);
    const x = rand(r, W - r), y = rand(r, H - r);
    if (Math.hypot(x - NEST.x, y - NEST.y) < NEST.r + r + 140) continue;
    if (rocks.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + 50)) continue;
    rocks.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r) });
  }
}
const insideRock = (x, y, pad) => rocks.some(o => Math.hypot(o.x - x, o.y - y) < o.r + pad);

function resolve(e, rad) {
  for (const o of rocks) {
    const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy), min = o.r + rad;
    if (d < min && d > 0.001) { e.x = o.x + dx / d * min; e.y = o.y + dy / d * min; }
  }
  e.x = clamp(e.x, rad, W - rad);
  e.y = clamp(e.y, rad, H - rad);
}

// ---- 食べ物 ----
function spawnFood(t, x, y) {
  foods.push({ id: nextId++, t, x, y, r: FOOD_TYPES[t].r, v: FOOD_TYPES[t].v });
}
function spawnFoodCluster() {
  let x, y, tries = 0;
  do {
    x = rand(40, W - 40); y = rand(40, H - 40); tries++;
  } while ((insideRock(x, y, 30) || Math.hypot(x - NEST.x, y - NEST.y) < 250) && tries < 50);
  const roll = Math.random();
  const t = roll < 0.6 ? 0 : roll < 0.9 ? 1 : 2;
  const n = t === 2 ? 1 : 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const fx = clamp(x + rand(-40, 40), 20, W - 20), fy = clamp(y + rand(-40, 40), 20, H - 20);
    if (!insideRock(fx, fy, 10)) spawnFood(t, fx, fy);
  }
}

// ---- プレイヤー ----
function spawnPlayer(p) {
  p.x = NEST.x + rand(-30, 30); p.y = NEST.y + rand(-30, 30);
  p.hp = 100; p.hunger = 100; p.carry = 0; p.dead = false; p.respawn = 0;
}
function killPlayer(p, why) {
  p.dead = true; p.respawn = 5;
  for (let i = 0; i < p.carry; i++) spawnFood(0, p.x + rand(-20, 20), p.y + rand(-20, 20));
  p.carry = 0;
  msg(`${p.name} が${why}`);
}

function handleAction(p, type) {
  if (!p || p.dead || gameOver) return;
  const atNest = dist(p, NEST) < NEST.r;
  if (type === 'bite') {
    if (p.biteCd > 0) return;
    p.biteCd = 0.35; p.biteAnim = 0.15;
    const fx = p.x + Math.cos(p.a) * 22, fy = p.y + Math.sin(p.a) * 22;
    for (const e of enemies) {
      if (Math.hypot(e.x - fx, e.y - fy) < e.r + 18) {
        e.hp -= 12; e.hitT = 0.15;
        const kd = Math.atan2(e.y - p.y, e.x - p.x);
        e.x += Math.cos(kd) * 10; e.y += Math.sin(kd) * 10;
        if (e.hp <= 0) killEnemy(e, p);
      }
    }
  } else if (type === 'eat') {
    if (p.hunger >= 99) return;
    if (p.carry > 0) { p.carry--; p.hunger = Math.min(100, p.hunger + 20); }
    else if (atNest && colony.food >= 1) { colony.food--; p.hunger = Math.min(100, p.hunger + 20); }
  } else if (type === 'hatch') {
    if (atNest && colony.food >= HATCH_COST && workers.length < MAX_WORKERS) {
      colony.food -= HATCH_COST;
      workers.push({ id: nextId++, x: NEST.x, y: NEST.y, a: rand(0, 6.28), hp: 20, carry: 0, target: null, wt: 0 });
      msg(`${p.name} が働きアリを誕生させた！（${workers.length}匹）`);
    }
  } else if (type === 'repair') {
    if (atNest && colony.food >= REPAIR_COST && colony.nestHp < colony.maxNestHp) {
      colony.food -= REPAIR_COST;
      colony.nestHp = Math.min(colony.maxNestHp, colony.nestHp + 15);
    }
  }
}

// ---- 敵 ----
function spawnEnemy(type, raid) {
  const s = ENEMY[type];
  let x, y, tries = 0;
  do {
    const side = Math.floor(Math.random() * 4);
    x = side === 0 ? 30 : side === 1 ? W - 30 : rand(30, W - 30);
    y = side === 2 ? 30 : side === 3 ? H - 30 : rand(30, H - 30);
    tries++;
  } while (insideRock(x, y, s.r) && tries < 20);
  enemies.push({ id: nextId++, type, x, y, a: 0, hp: s.hp, maxHp: s.hp, raid, atkCd: 0, wa: rand(0, 6.28), wt: 0, hitT: 0 });
}
function killEnemy(e, p) {
  e.dead = true;
  const s = ENEMY[e.type];
  for (let i = 0; i < s.drop; i++) spawnFood(3, e.x + rand(-15, 15), e.y + rand(-15, 15));
  if (p) p.score += e.type === 'spider' ? 3 : 5;
}

function updateEnemies() {
  for (const e of enemies) {
    if (e.dead) continue;
    const s = ENEMY[e.type];
    e.atkCd -= DT; e.hitT -= DT;
    // ターゲット探し（プレイヤー＋働きアリ）
    let target = null, best = s.detect;
    for (const id in players) {
      const p = players[id];
      if (p.dead) continue;
      const d = dist(p, e);
      if (d < best) { best = d; target = p; }
    }
    for (const w of workers) {
      const d = dist(w, e);
      if (d < best) { best = d; target = w; }
    }
    let tx = null, ty = null;
    if (target) { tx = target.x; ty = target.y; }
    else if (e.raid) { tx = NEST.x; ty = NEST.y; }

    if (tx !== null) {
      const d = Math.hypot(tx - e.x, ty - e.y);
      e.a = Math.atan2(ty - e.y, tx - e.x);
      const reach = target ? e.r + 12 : NEST.r + e.r * 0.5;
      if (d > reach) {
        e.x += Math.cos(e.a) * s.spd * DT; e.y += Math.sin(e.a) * s.spd * DT;
      } else if (target && e.atkCd <= 0) {
        e.atkCd = 1.0;
        target.hp -= s.dmg;
        if (target.hp <= 0) {
          if (target.name !== undefined) killPlayer(target, `${e.type === 'spider' ? 'クモ' : 'カブトムシ'}にやられた…`);
          else target.dead = true;
        }
      } else if (!target) {
        colony.nestHp -= 4 * DT; // 巣を攻撃
      }
    } else {
      e.wt -= DT;
      if (e.wt <= 0) { e.wa += rand(-1.5, 1.5); e.wt = rand(1, 3); }
      e.a = e.wa;
      e.x += Math.cos(e.wa) * s.spd * 0.35 * DT; e.y += Math.sin(e.wa) * s.spd * 0.35 * DT;
    }
    const bx = e.x, by = e.y;
    resolve(e, e.r * 0.7);
    if (tx === null && (bx !== e.x || by !== e.y)) e.wa += Math.PI * 0.7;
  }
  enemies = enemies.filter(e => !e.dead);
  workers = workers.filter(w => {
    if (w.dead || w.hp <= 0) { if (w.carry) spawnFood(0, w.x, w.y); return false; }
    return true;
  });
}

// ---- 働きアリ ----
function updateWorkers() {
  for (const w of workers) {
    let tx, ty;
    if (w.carry > 0) {
      tx = NEST.x; ty = NEST.y;
      if (dist(w, NEST) < NEST.r * 0.6) { colony.food += w.carry; w.carry = 0; w.target = null; }
    } else {
      if (w.target && !foods.includes(w.target)) w.target = null;
      if (!w.target) {
        let bestD = 700;
        for (const f of foods) {
          if (f.t === 2) continue; // 角砂糖は重すぎる
          const d = dist(f, w);
          if (d < bestD) { bestD = d; w.target = f; }
        }
      }
      if (w.target) {
        tx = w.target.x; ty = w.target.y;
        if (dist(w, w.target) < w.target.r + 10) {
          w.carry = w.target.v;
          foods.splice(foods.indexOf(w.target), 1);
          w.target = null;
        }
      }
    }
    if (tx !== undefined) {
      w.a = Math.atan2(ty - w.y, tx - w.x);
    } else {
      w.wt -= DT;
      if (w.wt <= 0) { w.a += rand(-1.2, 1.2); w.wt = rand(0.5, 2); }
    }
    w.x += Math.cos(w.a) * 105 * DT; w.y += Math.sin(w.a) * 105 * DT;
    const bx = w.x, by = w.y;
    resolve(w, 9);
    if (bx !== w.x || by !== w.y) w.a += 0.4; // 岩に沿って回り込む
  }
}

// ---- 雨 ----
function updateRain() {
  if (!colony.isNight && colony.rain <= 0 && colony.day >= 2 && Math.random() < DT / 45) {
    colony.rain = 15;
    msg('☔ 雨が降ってきた！巣に避難しろ！');
  }
  if (colony.rain > 0) {
    colony.rain -= DT;
    colony.rainSpawn -= DT;
    if (colony.rainSpawn <= 0) {
      colony.rainSpawn = 0.18;
      const alive = Object.values(players).filter(p => !p.dead);
      let x, y;
      if (alive.length && Math.random() < 0.7) {
        const p = alive[Math.floor(Math.random() * alive.length)];
        x = p.x + rand(-350, 350); y = p.y + rand(-250, 250);
      } else { x = rand(0, W); y = rand(0, H); }
      if (Math.hypot(x - NEST.x, y - NEST.y) > NEST.r + 20) drops.push({ x, y, t: 1.4, max: 1.4, r: 45 });
    }
  }
  for (const d of drops) {
    d.t -= DT;
    if (d.t <= 0) {
      for (const id in players) {
        const p = players[id];
        if (!p.dead && dist(p, d) < d.r && dist(p, NEST) > NEST.r) {
          p.hp -= 35;
          if (p.hp <= 0) killPlayer(p, '雨粒に潰された…');
        }
      }
      for (const w of workers) if (dist(w, d) < d.r) w.hp -= 25;
      foods = foods.filter(f => dist(f, d) > d.r * 0.8);
      io.emit('splash', { x: Math.round(d.x), y: Math.round(d.y), r: d.r });
    }
  }
  drops = drops.filter(d => d.t > 0);
}

// ---- 昼夜 ----
function updateDayCycle() {
  colony.time += DT;
  if (!colony.isNight && colony.time >= DAY_LEN) {
    colony.isNight = true; colony.time = 0; colony.rain = 0;
    msg(`🌙 ${colony.day}日目の夜。敵が巣を襲いにくる！`);
  } else if (colony.isNight && colony.time >= NIGHT_LEN) {
    colony.isNight = false; colony.time = 0; colony.day++;
    for (const e of enemies) e.raid = false;
    const need = Object.keys(players).length * 2 + workers.length;
    if (colony.food >= need) {
      colony.food -= need;
      msg(`☀ ${colony.day}日目の朝。コロニーが食料を${need}消費した`);
    } else {
      const short = need - colony.food;
      colony.food = 0;
      colony.nestHp -= short * 4;
      msg(`☀ ${colony.day}日目の朝。食料が${short}足りない！巣が弱っていく…`);
    }
  }
}

function updateSpawns() {
  const want = Math.min(40, colony.isNight ? 6 + colony.day * 2 : 3 + colony.day);
  if (enemies.length < want && Math.random() < (colony.isNight ? 0.08 : 0.02)) {
    const beetleChance = Math.min(0.5, 0.15 + colony.day * 0.04);
    spawnEnemy(Math.random() < beetleChance ? 'beetle' : 'spider', colony.isNight);
  }
  if (foods.length < FOOD_TARGET && Math.random() < 0.1) spawnFoodCluster();
}

// ---- プレイヤー更新 ----
function updatePlayers() {
  for (const id in players) {
    const p = players[id];
    if (p.dead) {
      p.respawn -= DT;
      if (p.respawn <= 0) spawnPlayer(p);
      continue;
    }
    const len = Math.hypot(p.in.dx, p.in.dy);
    if (len > 0.1) {
      const spd = 175 * (1 - p.carry * 0.07);
      p.x += p.in.dx / len * spd * DT; p.y += p.in.dy / len * spd * DT;
      p.a = Math.atan2(p.in.dy, p.in.dx);
    }
    resolve(p, 12);
    p.biteCd -= DT; p.biteAnim = Math.max(0, p.biteAnim - DT);

    p.hunger -= (colony.isNight ? 1.2 : 0.9) * DT;
    if (p.hunger <= 0) { p.hunger = 0; p.hp -= 4 * DT; }

    const atNest = dist(p, NEST) < NEST.r;
    if (atNest) {
      if (p.carry > 0) { colony.food += p.carry; p.score += p.carry; p.carry = 0; }
      if (p.hunger > 20) p.hp = Math.min(100, p.hp + 6 * DT);
    } else if (p.hunger > 50) p.hp = Math.min(100, p.hp + 1 * DT);

    // 拾う
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      if (p.carry + f.v > MAX_CARRY) continue;
      if (dist(p, f) < f.r + 14) { p.carry += f.v; foods.splice(i, 1); }
    }
    if (p.hp <= 0) killPlayer(p, '力尽きた…');
  }
}

// ---- メインループ ----
function resetWorld() {
  foods = []; enemies = []; workers = []; drops = [];
  colony = newColony();
  for (let i = 0; i < 25; i++) spawnFoodCluster();
  for (const id in players) { spawnPlayer(players[id]); players[id].score = 0; }
  gameOver = false;
  io.emit('init', { W, H, nest: NEST, rocks, dayLen: DAY_LEN, nightLen: NIGHT_LEN });
  msg('新しいコロニーが誕生した！');
}

let tickCount = 0;
function tick() {
  if (Object.keys(players).length === 0 || gameOver) return;
  updatePlayers();
  updateWorkers();
  updateEnemies();
  updateRain();
  updateDayCycle();
  updateSpawns();

  if (colony.nestHp <= 0) {
    gameOver = true;
    best = Math.max(best, colony.day);
    io.emit('gameover', { day: colony.day, best });
    setTimeout(resetWorld, 6000);
  }

  if (++tickCount % 2 === 0) broadcast();
}

function broadcast() {
  io.emit('state', {
    p: Object.values(players).map(p => ({
      id: p.id, n: p.name, col: p.color,
      x: Math.round(p.x), y: Math.round(p.y), a: +p.a.toFixed(2),
      hp: Math.round(p.hp), hu: Math.round(p.hunger), c: p.carry,
      d: p.dead ? 1 : 0, rs: Math.ceil(p.respawn), b: p.biteAnim > 0 ? 1 : 0, s: p.score,
    })),
    e: enemies.map(e => [e.id, e.type === 'spider' ? 0 : 1, Math.round(e.x), Math.round(e.y), +e.a.toFixed(2), Math.round(e.hp / e.maxHp * 100), e.hitT > 0 ? 1 : 0]),
    w: workers.map(w => [w.id, Math.round(w.x), Math.round(w.y), +w.a.toFixed(2), w.carry ? 1 : 0]),
    f: foods.map(f => [f.id, f.t, Math.round(f.x), Math.round(f.y)]),
    r: drops.map(d => [Math.round(d.x), Math.round(d.y), +(d.t / d.max).toFixed(2), d.r]),
    c: {
      food: colony.food, nh: Math.max(0, Math.round(colony.nestHp)), mnh: colony.maxNestHp,
      day: colony.day, time: +colony.time.toFixed(1), night: colony.isNight ? 1 : 0,
      rain: colony.rain > 0 ? 1 : 0, wk: workers.length, best,
    },
  });
}

// ---- 通信 ----
io.on('connection', socket => {
  socket.emit('init', { W, H, nest: NEST, rocks, dayLen: DAY_LEN, nightLen: NIGHT_LEN });
  socket.emit('you', socket.id);

  socket.on('join', name => {
    if (players[socket.id]) return;
    const p = {
      id: socket.id,
      name: String(name || 'アリ').replace(/[<>]/g, '').slice(0, 10) || 'アリ',
      color: COLORS[Object.keys(players).length % COLORS.length],
      in: { dx: 0, dy: 0 }, a: 0, biteCd: 0, biteAnim: 0, score: 0,
    };
    spawnPlayer(p);
    players[socket.id] = p;
    msg(`🐜 ${p.name} がコロニーに加わった`);
  });
  socket.on('input', d => {
    const p = players[socket.id];
    if (!p || !d) return;
    p.in.dx = clamp(+d.dx || 0, -1, 1);
    p.in.dy = clamp(+d.dy || 0, -1, 1);
  });
  socket.on('action', t => handleAction(players[socket.id], t));
  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) { msg(`${p.name} が去った`); delete players[socket.id]; }
  });
});

genRocks();
colony = newColony();
for (let i = 0; i < 25; i++) spawnFoodCluster();
setInterval(tick, 1000 / TICK);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Ant Survival running on port ${PORT}`));
