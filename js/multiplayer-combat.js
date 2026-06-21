/* NEON SURVIVOR — multiplayer-combat.js : PvE Co-op layer over the peaceful lobby.
 * Classic global. Loads AFTER network.js (uses Lobby + its channel) and BEFORE achievements/main.
 * Headless/offline-safe: every entry point no-ops while `Coop.active` is false, so verify.cjs and
 * single-player stay byte-for-byte untouched (the solo sim never enters a co-op branch).
 *
 * Model — "play as if single-player, together":
 *  · Each client owns its OWN avatar/gun/HP/upgrades — the normal sim runs unchanged.
 *  · The world (enemies + XP orbs + items) is HOST-AUTHORITATIVE: the lowest LIVING lobby id hosts,
 *    runs the real (player-count-scaled) spawner, and broadcasts the rosters ~10 Hz. Non-hosts render
 *    those rosters and report their own weapon hits + pickups back; the host owns HP/deaths/drops.
 *  · XP is a SHARED POOL — when any player banks an orb the host grants XP to everyone ('xp' event).
 *  · HOST MIGRATION: a host that dies broadcasts alive:false (Presence) → peers re-elect off it; a host
 *    that hard-crashes stops snapshotting → a heartbeat timeout self-promotes the next living client.
 *  · Teammates ride the lobby's existing 'pos' broadcast (Lobby.peers) — no extra position channel. */

/* type table — visual + gameplay defaults for a client-side enemy body (host stays authoritative on HP) */
const _ETYPE = { grunt: { r: 12, col: '#7c8cff', dmg: 8, xp: 1, sc: 5, spd: 1.15 },
                 fast:  { r: 9,  col: '#ff9d2e', dmg: 6, xp: 1, sc: 7, spd: 2.25 },
                 tank:  { r: 22, col: '#ff5fa2', dmg: 18, xp: 4, sc: 20, spd: 0.7 },
                 boss:  { r: 46, col: '#ff3b6b', dmg: 22, xp: 35, sc: 400, spd: 1.2 } };

/* build a kinematic enemy body on a client from a host roster row (enough for render, own-HP contact,
 * AND a clean takeover if this client is promoted to host — spd/dash carry so movement resumes seamlessly).
 * dmg/r/xp/sc are type-derived (not elapsed-scaled) — a known v1 fidelity gap; host stays authoritative. */
function _mkClientEnemy(type, x, y, hp, maxhp, id) {
  const T = _ETYPE[type] || _ETYPE.grunt;
  return { id, type, x, y, px: x, py: y, tx: x, ty: y, r: T.r, col: T.col, dmg: T.dmg, xp: T.xp, sc: T.sc,
           hp, maxhp, hit: 0, scd: 0, cdmg: 0, dead: false, spd: T.spd,
           boss: type === 'boss', name: type === 'boss' ? 'WARDEN' : '', tele: 0, atk: 0, dashT: 0, bossT: 0, dvx: 0, dvy: 0 };
}

const Coop = {
  active: false,          // true ONLY during a co-op run — gates every branch (solo stays untouched)
  host: false,            // am I the authoritative host this sync?
  _alive: true,           // false once my run ends — a dead host relinquishes authority (migration)
  _fake: null,            // debug override of player count (PvE.fake) — null = use live Presence
  SEND_MS: 100,           // host roster broadcast cadence (~10 Hz, matches the lobby pos rate)
  HOST_TIMEOUT: 1100,     // ms without a host snapshot → the next living client self-promotes (hard-crash cover)
  _lastSnap: 0, _seq: 0,
  _lastRecv: 0, _recvHost: null, _rseq: 0, _migrations: 0,   // client liveness/diagnostics
  _lastShot: 0, _lastPing: 0, _lat: 0,                       // shot throttle + round-trip latency probe

  /* effective player count for spawn scaling: debug override > live Presence (peers+self) > 1 (solo) */
  spawnP() {
    if (this._fake != null) return this._fake;
    if (this.active && typeof Lobby !== 'undefined') return Lobby.count() + 1;
    return 1;
  },
  playerCount() { return this.spawnP(); },
  /* damped-linear per-player count multiplier: P=1→1.0, 2→1.7, 3→2.4, 4→3.1 */
  scaleMul(P) { return 1 + (Math.max(1, P) - 1) * (typeof COOP !== 'undefined' ? COOP.perPlayer : 0.7); },

  /* lowest LIVING lobby id, optionally excluding one (a presumed-dead host) — null if nobody alive */
  _hostId(exclude) {
    if (typeof Lobby === 'undefined' || !Lobby.me) return null;
    let lo = this._alive ? Lobby.me : null;
    for (const id in Lobby.peers) {
      const pr = Lobby.peers[id];
      if (pr && pr.alive === false) continue;     // dead peers can't host
      if (id === exclude) continue;
      if (lo === null || id < lo) lo = id;
    }
    return lo;
  },
  /* deterministic election: lowest living id hosts — no handshake. Solo → always host. */
  electHost() {
    if (typeof Lobby === 'undefined' || !Lobby.me) { this.host = true; return; }
    const lo = this._hostId(null);
    this.host = (lo === null) ? false : (lo === Lobby.me);
  },
  onSync() { if (this.active) this.electHost(); },   // Lobby calls this on every presence sync (join/leave/alive)

  /* enter a co-op run (caller then runs startGame() as normal). Requires a joined lobby channel. */
  start() {
    if (typeof Lobby === 'undefined' || !Lobby.channel) return false;
    this.active = true; this._alive = true; this._lastSnap = 0; this._seq = 0;
    this._lastRecv = Date.now(); this._recvHost = null; this._rseq = 0; this._migrations = 0;
    if (typeof Lobby.setAlive === 'function') Lobby.setAlive(true);
    this.electHost();
    if (typeof NetSync !== 'undefined' && NetSync.start) NetSync.start();   // begin shared-world seed/input sync
    return true;
  },
  stop() { this.active = false; this.host = false; if (typeof NetSync !== 'undefined' && NetSync.stop) NetSync.stop(); },
  /* my run ended: relinquish authority so peers re-elect off me, but stay in the lobby as a spectator */
  spectate() { this._alive = false; if (typeof Lobby !== 'undefined' && Lobby.setAlive) Lobby.setAlive(false); this.stop(); },

  /* register the co-op broadcast handlers onto the lobby channel (called from Lobby.join) */
  bind(ch) {
    if (!ch || typeof ch.on !== 'function') return;
    ch.on('broadcast', { event: 'enemies' }, ({ payload }) => this.applyEnemies(payload));
    ch.on('broadcast', { event: 'drops' }, ({ payload }) => this.applyDrops(payload));
    ch.on('broadcast', { event: 'ekill' }, ({ payload }) => this.applyKill(payload));
    ch.on('broadcast', { event: 'hit' }, ({ payload }) => this.applyHit(payload));
    ch.on('broadcast', { event: 'pickup' }, ({ payload }) => this.applyPickup(payload));
    ch.on('broadcast', { event: 'xp' }, ({ payload }) => this.applyXP(payload));
    ch.on('broadcast', { event: 'shot' }, ({ payload }) => this.applyShot(payload));
    ch.on('broadcast', { event: 'ping' }, ({ payload }) => this.applyPing(payload));
    ch.on('broadcast', { event: 'pong' }, ({ payload }) => this.applyPong(payload));
  },
  unbind() { this.stop(); },

  /* per-frame network pump (main loop, playing only): push my position, glide peers, host snapshots the world,
   * clients watch the host heartbeat and self-promote on timeout (hard-crash cover). */
  netTick(now, dtMs) {
    if (!this.active || typeof Lobby === 'undefined') return;
    if (typeof player !== 'undefined' && player) Lobby.setLocalState(player.x, player.y, now);
    Lobby.step(dtMs / 1000, Date.now());
    if (this.host) {
      if (now - this._lastSnap >= this.SEND_MS) { this._lastSnap = now; this.broadcastEnemies(); this.broadcastDrops(); }
    } else {
      const wall = Date.now();
      if (this._lastRecv && wall - this._lastRecv > this.HOST_TIMEOUT) {       // host went silent → promote next living client
        if (this._hostId(this._recvHost) === Lobby.me) { this.host = true; this._lastSnap = 0; this._migrations++; }
        this._lastRecv = wall;                                                  // re-arm so we don't thrash every frame
      }
      if (now - this._lastPing > 1000) { this._lastPing = now; Lobby.send('ping', { id: Lobby.me, t: Date.now() }); }
    }
  },

  /* ---- HOST → CLIENTS : compact enemy roster (capped to the nearest 80 bodies). Rows carry spd + dash
   * so a promoted client resumes movement seamlessly. h=host id, t=clock → clients track liveness + RTT. ---- */
  broadcastEnemies() {
    if (typeof enemies === 'undefined') return;
    const e = [], n = Math.min(enemies.length, 80);
    for (let i = 0; i < n; i++) { const o = enemies[i];
      e.push([o.id, o.type === 'boss' ? 3 : o.type === 'tank' ? 2 : o.type === 'fast' ? 1 : 0,
              Math.round(o.x), Math.round(o.y), Math.round(o.hp), Math.round(o.maxhp),
              Math.round((o.spd || 0) * 100), o.dashT | 0, Math.round((o.dvx || 0) * 10), Math.round((o.dvy || 0) * 10)]); }
    Lobby.send('enemies', { seq: ++this._seq, h: Lobby.me, t: Date.now(), e });
  },
  /* CLIENT: reconcile local `enemies` against the host roster (add new, retarget existing, drop missing) */
  applyEnemies(payload) {
    if (this.host || !this.active || !payload || typeof enemies === 'undefined') return;
    this._lastRecv = Date.now(); this._recvHost = payload.h; this._rseq = payload.seq || 0;
    const TYPES = ['grunt', 'fast', 'tank', 'boss'], seen = Object.create(null), byId = Object.create(null);
    for (let i = 0; i < enemies.length; i++) byId[enemies[i].id] = enemies[i];
    for (let r = 0; r < payload.e.length; r++) {
      const row = payload.e[r], id = row[0], x = row[2], y = row[3], hp = row[4], maxhp = row[5];
      seen[id] = 1; let en = byId[id];
      if (!en) { en = _mkClientEnemy(TYPES[row[1]], x, y, hp, maxhp, id); enemies.push(en); }
      else { en.hp = hp; en.maxhp = maxhp; }
      en.tx = x; en.ty = y;                                       // sim.js client branch glides e.x → e.tx
      if (row.length > 6) { en.spd = row[6] / 100; en.dashT = row[7] | 0; en.dvx = row[8] / 10; en.dvy = row[9] / 10; }
    }
    for (let i = enemies.length - 1; i >= 0; i--) if (!seen[enemies[i].id]) enemies.splice(i, 1);
  },

  /* ---- HOST → CLIENTS : XP orb + item rosters (reconciled by id, exactly like enemies) ---- */
  broadcastDrops() {
    const o = [], it = [];
    if (typeof orbs !== 'undefined') { const n = Math.min(orbs.length, 140);
      for (let i = 0; i < n; i++) { const q = orbs[i]; o.push([q.id, Math.round(q.x), Math.round(q.y)]); } }
    if (typeof items !== 'undefined') for (let i = 0; i < items.length; i++) { const q = items[i];
      it.push([q.id, this._itemCode(q.type), Math.round(q.x), Math.round(q.y)]); }
    Lobby.send('drops', { o, it });
  },
  _itemCode(type) { if (typeof ITEMS === 'undefined') return 0; for (let i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === type) return i; return 0; },
  applyDrops(payload) {
    if (this.host || !this.active || !payload) return;
    if (typeof orbs !== 'undefined' && payload.o) {                 // reconcile XP orbs
      const seen = Object.create(null), by = Object.create(null);
      for (let i = 0; i < orbs.length; i++) by[orbs[i].id] = orbs[i];
      for (let r = 0; r < payload.o.length; r++) { const row = payload.o[r], id = row[0]; seen[id] = 1;
        let q = by[id];
        if (!q) orbs.push({ id, x: row[1], y: row[2], px: row[1], py: row[2], tx: row[1], ty: row[2], r: 4, xp: 1, col: '#54e6b5' });
        else { q.tx = row[1]; q.ty = row[2]; } }
      for (let i = orbs.length - 1; i >= 0; i--) if (!seen[orbs[i].id]) orbs.splice(i, 1);
    }
    if (typeof items !== 'undefined' && payload.it) {               // reconcile items
      const seen = Object.create(null), by = Object.create(null);
      for (let i = 0; i < items.length; i++) by[items[i].id] = items[i];
      for (let r = 0; r < payload.it.length; r++) { const row = payload.it[r], id = row[0]; seen[id] = 1;
        if (!by[id] && typeof ITEMS !== 'undefined') { const t = ITEMS[row[1]] || ITEMS[0];
          items.push({ id, x: row[2], y: row[3], type: t.id, ico: t.ico, col: t.col, label: t.label, r: 16, life: 900, bob: 0 }); }
        else if (by[id]) { by[id].x = row[2]; by[id].y = row[3]; } }
      for (let i = items.length - 1; i >= 0; i--) if (!seen[items[i].id]) items.splice(i, 1);
    }
  },

  /* nearest player position to an orb (host magnets toward whichever teammate is closest) */
  nearestPlayer(o) {
    let best = (typeof player !== 'undefined' && player) ? player : { x: o.x, y: o.y };
    let bd = (best.x - o.x) * (best.x - o.x) + (best.y - o.y) * (best.y - o.y);
    if (typeof Lobby !== 'undefined') for (const id in Lobby.peers) { const pr = Lobby.peers[id];
      const d = (pr.x - o.x) * (pr.x - o.x) + (pr.y - o.y) * (pr.y - o.y); if (d < bd) { bd = d; best = pr; } }
    return best;
  },
  /* HOST collects an orb → SHARED pool: grant XP locally + broadcast so every client levels too */
  orbCollected(o) { this.shareXP(o.xp); },
  shareXP(n) { if (!n) return; if (typeof gainXP === 'function') gainXP(n); if (this.active && typeof Lobby !== 'undefined') Lobby.send('xp', { n }); },
  applyXP(payload) { if (this.host || !this.active || !payload || typeof gainXP !== 'function') return; gainXP(payload.n); },

  /* ---- CLIENT → HOST : report a weapon hit; the host applies authoritative damage ---- */
  reportHit(e, dmg) { if (typeof Lobby !== 'undefined') Lobby.send('hit', { id: e.id, dmg: Math.round(dmg) }); },
  applyHit(payload) {
    if (!this.host || !this.active || !payload || typeof enemies === 'undefined' || typeof damageEnemy !== 'function') return;
    for (let i = 0; i < enemies.length; i++) if (enemies[i].id === payload.id) { damageEnemy(enemies[i], payload.dmg, enemies[i].col); break; }
  },

  /* ---- HOST → CLIENTS : a kill (every client replays it → shared burst + score; orbs come via 'drops') ---- */
  onKill(e) { if (this.active && this.host && typeof Lobby !== 'undefined') Lobby.send('ekill', { id: e.id }); },
  applyKill(payload) {
    if (this.host || !this.active || !payload || typeof enemies === 'undefined' || typeof killEnemy !== 'function') return;
    for (let i = 0; i < enemies.length; i++) if (enemies[i].id === payload.id) { killEnemy(enemies[i], enemies[i].col); break; }
  },

  /* ---- CLIENT → HOST : report an item pickup; host removes it + applies GLOBAL effects (bomb/magnet) ---- */
  reportPickup(it) { if (this.active && typeof Lobby !== 'undefined') Lobby.send('pickup', { id: it.id, type: it.type }); },
  applyPickup(payload) {
    if (!this.host || !this.active || !payload || typeof items === 'undefined') return;
    for (let i = items.length - 1; i >= 0; i--) if (items[i].id === payload.id) {
      items.splice(i, 1);
      if (payload.type === 'bomb' && typeof enemies !== 'undefined' && typeof hitEnemy === 'function') {
        for (let j = enemies.length - 1; j >= 0; j--) hitEnemy(enemies[j], 150, '#ffd95e');
      } else if (payload.type === 'magnet' && typeof orbs !== 'undefined') {
        let tot = 0; for (let k = orbs.length - 1; k >= 0; k--) tot += orbs[k].xp; orbs.length = 0; this.shareXP(tot);
      }
      break;
    }
  },

  /* ---- shot tracers : a lightweight, fire-and-forget muzzle line at a teammate's volley (no damage) ---- */
  fireShot(x, y, a) {
    if (!this.active || typeof Lobby === 'undefined') return;
    const w = Date.now(); if (w - this._lastShot < 70) return; this._lastShot = w;     // throttle: one tracer per ~14 Hz
    Lobby.send('shot', { id: Lobby.me, x: Math.round(x), y: Math.round(y), a: +a.toFixed(2) });
  },
  applyShot(payload) {
    if (!this.active || !payload || (typeof Lobby !== 'undefined' && payload.id === Lobby.me)) return;
    if (typeof bolts !== 'undefined') bolts.push({ a: { x: payload.x, y: payload.y },
      b: { x: payload.x + Math.cos(payload.a) * 46, y: payload.y + Math.sin(payload.a) * 46 }, life: 6, col: '#54e6ff' });
    if (typeof burst === 'function') burst(payload.x, payload.y, '#54e6ff', 3, 3);
  },

  /* ---- latency probe : client pings, host echoes, client measures the round trip for the debug overlay ---- */
  applyPing(payload) { if (this.host && this.active && payload && typeof Lobby !== 'undefined') Lobby.send('pong', { to: payload.id, t: payload.t }); },
  applyPong(payload) { if (payload && typeof Lobby !== 'undefined' && payload.to === Lobby.me) this._lat = Date.now() - payload.t; },
};

/* ===== Scaling Debug Tool — drive spawn scaling from the console with a fake player count ===== */
const PvE = {
  fake(n) { Coop._fake = (n == null ? null : Math.max(1, n | 0)); return this.status(); },
  status() {
    const realP = (typeof Lobby !== 'undefined') ? Lobby.count() + 1 : 1;
    const P = Coop.spawnP(), mul = Coop.scaleMul(P);
    const elapsed = (typeof now !== 'undefined' && typeof t0 !== 'undefined') ? (now - t0) / 1000 : 0;
    const interval = Math.max(22, 72 - elapsed * 0.42) * (typeof DIFF !== 'undefined' ? DIFF.spawn : 1) / Math.sqrt(Math.max(1, P));
    const spawnCount = Math.max(1, Math.round((1 + Math.floor(elapsed / 70)) * mul));
    const o = { realP, fakeP: Coop._fake, P, mul: +mul.toFixed(2), intervalTicks: +interval.toFixed(1), spawnCount };
    if (typeof console !== 'undefined') console.log('[PvE]', JSON.stringify(o));
    return o;
  },
};
