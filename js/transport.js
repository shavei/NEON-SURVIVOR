/* NEON SURVIVOR — transport.js
 * The client's seam to the authoritative world. In the target architecture the client never ticks the
 * sim from its own loop; it SENDS inputs through a Transport and RENDERS the snapshots that come back.
 * Two interchangeable implementations let "the game run identically with a local mock-server as with
 * the Node.js server" (the migration plan's Determinism Check):
 *
 *   · MockServerTransport — runs the authoritative sim IN-PAGE (the elected-host / single-player path).
 *     It owns the shared globals and advances them with updateShared(); snapshot() serialises exactly
 *     what server/sim-host.js serialises, so a snapshot is host-agnostic.
 *   · WebSocketTransport  — talks to server/game-server.js: {join}/{input} up, {snap} down. applySnapshot
 *     writes the authoritative state into the in-page globals so render.js (unchanged) draws it.
 *
 * Classic script (shared globals). Load AFTER sim.js (needs updateShared/STEP/makeAvatar/seedRng/DIFFS).
 * Defining these classes has no load-time side effects, so existing solo/co-op paths are untouched until
 * the loop is switched over to drive a Transport. */
'use strict';

/* Serialise the authoritative world clients render — IDENTICAL shape + rounding to SimHost.snapshot()
 * (server/sim-host.js) so a mock-server snapshot and a Node-server snapshot compare byte-for-byte.
 * Cosmetics (particles/floats/bolts/shake) are intentionally excluded — they are client-local. */
function serializeWorld() {
  const r = n => Math.round(n * 100) / 100;
  return {
    frame: frame, now: now, score: score, wave: wave, kills: kills, bossOn: bossOn, state: state,
    players: players.map(a => ({ id: a.id, x: r(a.x), y: r(a.y), hp: r(a.hp), maxhp: a.maxhp, level: a.level, xp: r(a.xp), next: a.next, dead: !!a.dead, vx: r(a.vx), vy: r(a.vy) })),
    enemies: enemies.map(e => ({ id: e.id, x: r(e.x), y: r(e.y), r: e.r, hp: r(e.hp), maxhp: r(e.maxhp), type: e.type, boss: !!e.boss, tele: e.tele | 0, atk: e.atk | 0 })),
    orbs: orbs.map(o => ({ id: o.id, x: r(o.x), y: r(o.y) })),
    items: items.map(it => ({ id: it.id, x: r(it.x), y: r(it.y), type: it.type })),
    bullets: bullets.map(b => ({ x: r(b.x), y: r(b.y), vx: r(b.vx), vy: r(b.vy) })),
    ebullets: ebullets.map(b => ({ x: r(b.x), y: r(b.y), vx: r(b.vx), vy: r(b.vy) })),
    missiles: missiles.map(m => ({ x: r(m.x), y: r(m.y), vx: r(m.vx), vy: r(m.vy) }))
  };
}

/* Stand up the shared-world globals from a seed + roster — the one place both the in-page authority and
 * a reconnecting client agree on initial state. Mirrors server/sim-host.js construction. */
function bootWorld(opts) {
  if (opts && opts.difficulty && DIFFS[opts.difficulty]) DIFF = DIFFS[opts.difficulty];
  seedRng((opts && opts.seed) >>> 0);
  reset();
  state = 'play';
  const ids = (opts && opts.players) || ['local'];
  players = ids.map((id, i) => makeAvatar(1500 + i * 220, 1500, id));
  player = players[0];
  t0 = 0; now = 0; frame = 0; spawnTimer = 0; bossOn = false;
  nextBoss = (opts && opts.nextBoss) || 60;
}

/* ===== MockServerTransport — authoritative sim running in-page ===== */
class MockServerTransport {
  constructor() { this._cb = null; this._by = {}; this.connected = false; }
  connect(opts) {
    bootWorld(opts);
    this._by = {}; for (const a of players) this._by[a.id] = a;
    this.localId = players[0].id;
    this.connected = true;
    return this;
  }
  sendInput(mx, my, id) { const a = this._by[id || this.localId]; if (a) a.input = [mx, my]; }
  onSnapshot(cb) { this._cb = cb; return this; }
  /* advance the authoritative world one tick (the host's clock calls this at 60 Hz) */
  step() { now += STEP; updateShared(); if (this._cb) this._cb(serializeWorld()); return frame; }
  snapshot() { return serializeWorld(); }
  disconnect() { this.connected = false; this._cb = null; }
}

/* ===== WebSocketTransport — the cloud Node authority over the wire ===== */
class WebSocketTransport {
  constructor(url) { this.url = url; this._cb = null; this.ws = null; this.id = null; this.seed = null; this.connected = false; }
  connect(opts) {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => { this.ws.send(JSON.stringify({ t: 'join', room: (opts && opts.room) || 'GLOBAL', id: opts && opts.id, seed: opts && opts.seed, difficulty: opts && opts.difficulty })); };
    this.ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') { this.id = m.id; this.seed = m.seed; this.connected = true; }
      else if (m.t === 'snap') { if (this._cb) this._cb(m); } };
    this.ws.onclose = () => { this.connected = false; };
    return this;
  }
  sendInput(mx, my) { if (this.ws && this.connected) this.ws.send(JSON.stringify({ t: 'input', mx, my })); }
  onSnapshot(cb) { this._cb = cb; return this; }
  disconnect() { if (this.ws) try { this.ws.send(JSON.stringify({ t: 'leave' })); this.ws.close(); } catch { /* */ } this.connected = false; }
}

/* Write an authoritative snapshot into the in-page globals so the unchanged render.js draws it. Used by
 * WebSocketTransport clients (and reconnects): the client is a pure renderer of server state. New bodies
 * get px/py seeded so the first interpolated frame doesn't streak from the origin. */
function applySnapshot(s) {
  score = s.score; wave = s.wave; kills = s.kills; bossOn = s.bossOn; frame = s.frame;
  const reconcile = (arr, snap, make) => {
    const byId = {}; for (const o of arr) if (o.id != null) byId[o.id] = o;
    const out = [];
    for (const d of snap) {
      let o = d.id != null ? byId[d.id] : null;
      if (!o) { o = make(d); o.px = d.x; o.py = d.y; }
      else { o.px = o.x; o.py = o.y; }                 // snapshot prev pos so draw() lerps existing bodies smoothly
      Object.assign(o, d);
      out.push(o);
    }
    return out;
  };
  // players: add remote avatars we don't yet have, update existing, drop those who left — so the
  // local `players` set mirrors the authoritative roster (camera/`player` fixed up by the Online controller).
  if (s.players) players = reconcile(players, s.players, d => makeAvatar(d.x, d.y, d.id));
  enemies = reconcile(enemies, s.enemies, d => ({ hit: 0, scd: 0, cdmg: 0, col: d.boss ? '#ff3b6b' : '#7c8cff' }));
  orbs = reconcile(orbs, s.orbs, () => ({ r: 4, xp: 1, col: '#54e6b5' }));
  items = reconcile(items, s.items, d => ({ r: 16, bob: 0 }));
  // projectiles are ephemeral/idless — replace wholesale (cheap, and they move fast enough that lerp gaps don't read)
  bullets = s.bullets.map(b => Object.assign({ r: 4, px: b.x, py: b.y }, b));
  ebullets = s.ebullets.map(b => Object.assign({ r: 7, px: b.x, py: b.y }, b));
  missiles = s.missiles.map(m => Object.assign({ r: 5, px: m.x, py: m.y }, m));
}

/* ===== Online — the client loop's server-authoritative mode ===== */
/* When connected, the game loop stops simulating: each tick it just samples local input and SENDS it;
 * the world arrives as snapshots (applySnapshot writes the in-page globals, render.js draws them). Gated
 * by GAME_SERVER_URL — empty/unset means stay on the in-page paths (solo update / lockstep co-op), so
 * this is purely additive. `Online.active` is the single flag main.js's loop branches on. */
const Online = {
  transport: null, active: false, localId: null, _ready: false, _snapMs: 0, _snapInt: 50,
  _genId() { return 'web_' + Math.random().toString(36).slice(2, 9); },
  _now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); },
  /* opts: {room, seed?, difficulty?, id?}. Returns false if no server is configured. */
  start(opts) {
    opts = opts || {};
    const url = (typeof GAME_SERVER_URL !== 'undefined' && GAME_SERVER_URL) || '';
    if (!url || typeof WebSocket === 'undefined') return false;
    this.localId = opts.id || this._genId();
    this._ready = false;
    this._over = false;
    this._snapMs = 0;
    this.transport = new WebSocketTransport(url);
    this.transport.onSnapshot(s => {
      // time the snapshot so the loop can interpolate body motion across the gap between snapshots
      const t = this._now(); if (this._snapMs) this._snapInt = Math.min(200, Math.max(16, t - this._snapMs)); this._snapMs = t;
      applySnapshot(s);
      player = players.find(p => p.id === this.localId) || player;   // keep the camera on the local avatar
      this._ready = true;
      // local avatar down → end the run on this client (show the game-over screen). gameOver() lives in
      // main.js (calls Online.stop), so the camera freezes on the death frame; "Play Again" reconnects.
      if (player && player.dead && !this._over) { this._over = true; if (typeof gameOver === 'function') gameOver(); }
    });
    this.transport.connect(Object.assign({}, opts, { id: this.localId }));
    this.active = true;
    return true;
  },
  /* render interpolation factor: how far we are through the current snapshot interval (0..1). Drives the
   * same px→x lerp draw() uses, so bodies glide smoothly between 20 Hz snapshots at the display refresh. */
  alpha() { if (!this._snapMs) return 0; return clamp((this._now() - this._snapMs) / this._snapInt, 0, 1); },
  /* once-per-frame client presentation the server doesn't do for us: follow the camera on the local
   * avatar and refresh the HUD (health/XP). update() runs neither online, so without this the camera
   * stays frozen (world looks static) and the HUD never updates. `a` = the interpolation factor. */
  present(a) {
    const p = player; if (!p || typeof W === 'undefined') return;
    const px = lerp(p.px === undefined ? p.x : p.px, p.x, a), py = lerp(p.py === undefined ? p.y : p.py, p.y, a);
    const mx2 = W * 0.30, my2 = H * 0.30, sxp = px - cam.x, syp = py - cam.y;
    if (sxp < mx2) cam.x = px - mx2; else if (sxp > W - mx2) cam.x = px - (W - mx2);
    if (syp < my2) cam.y = py - my2; else if (syp > H - my2) cam.y = py - (H - my2);
    cam.x = clamp(cam.x, 0, Math.max(0, WORLD.w - W)); cam.y = clamp(cam.y, 0, Math.max(0, WORLD.h - H));
    cam.px = cam.x; cam.py = cam.y;                       // camera is followed directly — don't double-interpolate it in draw()
    if (typeof updateHUD === 'function') updateHUD((now - t0) / 1000);
  },
  /* same input sampling update() uses (keys/touch are main.js globals, resolved at call time) */
  _sample() {
    let mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) my -= 1; if (keys['s'] || keys['arrowdown']) my += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1; if (keys['d'] || keys['arrowright']) mx += 1;
    if (typeof touch !== 'undefined' && touch) { const dx = touch.x - touch.cx, dy = touch.y - touch.cy, m = Math.hypot(dx, dy); if (m > 8) { mx = dx / m; my = dy / m; } }
    return [mx, my];
  },
  /* called once per fixed tick from the loop while active: send input only (server owns the world) */
  tick() { if (!this.active || !this.transport) return; const i = this._sample(); this.transport.sendInput(i[0], i[1]); },
  stop() { if (this.transport) this.transport.disconnect(); this.transport = null; this.active = false; this._ready = false; }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { MockServerTransport, WebSocketTransport, Online, serializeWorld, bootWorld, applySnapshot };
