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
    players: players.map(a => ({ id: a.id, x: r(a.x), y: r(a.y), hp: r(a.hp), maxhp: a.maxhp, level: a.level, xp: r(a.xp), dead: !!a.dead, vx: r(a.vx), vy: r(a.vy) })),
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
      Object.assign(o, d);
      out.push(o);
    }
    return out;
  };
  if (s.players) for (const d of s.players) { const a = players.find(p => p.id === d.id); if (a) { a.px = a.x; a.py = a.y; Object.assign(a, d); } }
  enemies = reconcile(enemies, s.enemies, d => ({ hit: 0, scd: 0, cdmg: 0, col: d.boss ? '#ff3b6b' : '#7c8cff' }));
  orbs = reconcile(orbs, s.orbs, () => ({ r: 4, xp: 1, col: '#54e6b5' }));
  items = reconcile(items, s.items, d => ({ r: 16, bob: 0 }));
  // projectiles are ephemeral/idless — replace wholesale (cheap, and they move fast enough that lerp gaps don't read)
  bullets = s.bullets.map(b => Object.assign({ r: 4, px: b.x, py: b.y }, b));
  ebullets = s.ebullets.map(b => Object.assign({ r: 7, px: b.x, py: b.y }, b));
  missiles = s.missiles.map(m => Object.assign({ r: 5, px: m.x, py: m.y }, m));
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MockServerTransport, WebSocketTransport, serializeWorld, bootWorld, applySnapshot };
