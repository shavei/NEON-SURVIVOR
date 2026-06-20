/* NEON SURVIVOR — multiplayer-combat.js : PvE Co-op layer over the peaceful lobby.
 * Classic global. Loads AFTER network.js (uses Lobby + its channel) and BEFORE achievements/main.
 * Headless/offline-safe: every entry point no-ops while `Coop.active` is false, so verify.cjs and
 * single-player stay byte-for-byte untouched (the solo sim never enters a co-op branch).
 *
 * Model — "play as if single-player, together":
 *  · Each client owns its OWN avatar/gun/HP/XP/upgrades — the normal sim runs unchanged.
 *  · Enemies are HOST-AUTHORITATIVE: the lowest lobby id hosts, runs the real (player-count-scaled)
 *    spawner, and broadcasts the enemy roster ~10 Hz. Non-hosts render that roster and report their
 *    own weapon hits back; the host owns HP/deaths and broadcasts kills (everyone gets XP + score).
 *  · Teammates ride the lobby's existing 'pos' broadcast (Lobby.peers) — no extra position channel. */

/* build a kinematic enemy body on a client from a host roster row (enough for render + own-HP contact).
 * dmg/r/col are derived from type (not elapsed-scaled) — a known v1 fidelity gap, host stays authoritative. */
function _mkClientEnemy(type, x, y, hp, maxhp, id) {
  const T = { grunt: { r: 12, col: '#7c8cff', dmg: 8 }, fast: { r: 9, col: '#ff9d2e', dmg: 6 },
              tank: { r: 22, col: '#ff5fa2', dmg: 18 }, boss: { r: 46, col: '#ff3b6b', dmg: 22 } }[type] || { r: 12, col: '#7c8cff', dmg: 8 };
  return { id, type, x, y, px: x, py: y, tx: x, ty: y, r: T.r, col: T.col, dmg: T.dmg, hp, maxhp,
           hit: 0, scd: 0, cdmg: 0, dead: false, spd: 0,
           boss: type === 'boss', name: type === 'boss' ? 'WARDEN' : '', tele: 0, atk: 0, dashT: 0, bossT: 0, dvx: 0, dvy: 0 };
}

const Coop = {
  active: false,          // true ONLY during a co-op run — gates every branch (solo stays untouched)
  host: false,            // am I the authoritative enemy host this sync?
  _fake: null,            // debug override of player count (PvE.fake) — null = use live Presence
  SEND_MS: 100,           // host enemy-roster broadcast cadence (~10 Hz, matches the lobby pos rate)
  _lastSnap: 0, _seq: 0,

  /* effective player count for spawn scaling: debug override > live Presence (peers+self) > 1 (solo) */
  spawnP() {
    if (this._fake != null) return this._fake;
    if (this.active && typeof Lobby !== 'undefined') return Lobby.count() + 1;
    return 1;
  },
  playerCount() { return this.spawnP(); },
  /* damped-linear per-player count multiplier: P=1→1.0, 2→1.7, 3→2.4, 4→3.1 */
  scaleMul(P) { return 1 + (Math.max(1, P) - 1) * (typeof COOP !== 'undefined' ? COOP.perPlayer : 0.7); },

  /* lowest lobby id (lexicographic) among me+peers hosts the enemy sim — deterministic, no handshake */
  electHost() {
    if (typeof Lobby === 'undefined' || !Lobby.me) { this.host = true; return; }
    let lo = Lobby.me;
    for (const id in Lobby.peers) if (id < lo) lo = id;
    this.host = (lo === Lobby.me);
  },
  onSync() { if (this.active) this.electHost(); },   // Lobby calls this on every presence sync (join/leave)

  /* enter a co-op run (caller then runs startGame() as normal). Requires a joined lobby channel. */
  start() {
    if (typeof Lobby === 'undefined' || !Lobby.channel) return false;
    this.active = true; this._lastSnap = 0; this._seq = 0; this.electHost();
    return true;
  },
  stop() { this.active = false; this.host = false; },

  /* register the co-op broadcast handlers onto the lobby channel (called from Lobby.join) */
  bind(ch) {
    if (!ch || typeof ch.on !== 'function') return;
    ch.on('broadcast', { event: 'enemies' }, ({ payload }) => this.applyEnemies(payload));
    ch.on('broadcast', { event: 'ekill' }, ({ payload }) => this.applyKill(payload));
    ch.on('broadcast', { event: 'hit' }, ({ payload }) => this.applyHit(payload));
    ch.on('broadcast', { event: 'atk' }, ({ payload }) => this.applyAtk(payload));
  },
  unbind() { this.stop(); },

  /* per-frame network pump (main loop, playing only): push my position, glide peers, host broadcasts roster */
  netTick(now, dtMs) {
    if (!this.active || typeof Lobby === 'undefined') return;
    if (typeof player !== 'undefined' && player) Lobby.setLocalState(player.x, player.y, now);
    Lobby.step(dtMs / 1000, Date.now());
    if (this.host && now - this._lastSnap >= this.SEND_MS) { this._lastSnap = now; this.broadcastEnemies(); }
  },

  /* ---- HOST → CLIENTS : compact enemy roster snapshot (capped to the nearest 80 bodies) ---- */
  broadcastEnemies() {
    if (typeof enemies === 'undefined') return;
    const e = [], n = Math.min(enemies.length, 80);
    for (let i = 0; i < n; i++) { const o = enemies[i];
      e.push([o.id, o.type === 'boss' ? 3 : o.type === 'tank' ? 2 : o.type === 'fast' ? 1 : 0,
              Math.round(o.x), Math.round(o.y), Math.round(o.hp), Math.round(o.maxhp)]); }
    Lobby.send('enemies', { seq: ++this._seq, e });
  },
  /* CLIENT: reconcile local `enemies` against the host roster (add new, retarget existing, drop missing) */
  applyEnemies(payload) {
    if (this.host || !this.active || !payload || typeof enemies === 'undefined') return;
    const TYPES = ['grunt', 'fast', 'tank', 'boss'], seen = Object.create(null), byId = Object.create(null);
    for (let i = 0; i < enemies.length; i++) byId[enemies[i].id] = enemies[i];
    for (let r = 0; r < payload.e.length; r++) {
      const row = payload.e[r], id = row[0], x = row[2], y = row[3], hp = row[4], maxhp = row[5];
      seen[id] = 1; let en = byId[id];
      if (!en) { en = _mkClientEnemy(TYPES[row[1]], x, y, hp, maxhp, id); enemies.push(en); }
      else { en.hp = hp; en.maxhp = maxhp; }
      en.tx = x; en.ty = y;                       // sim.js client branch glides e.x → e.tx
    }
    for (let i = enemies.length - 1; i >= 0; i--) if (!seen[enemies[i].id]) enemies.splice(i, 1);
  },

  /* ---- CLIENT → HOST : report a weapon hit; the host applies authoritative damage ---- */
  reportHit(e, dmg) { if (typeof Lobby !== 'undefined') Lobby.send('hit', { id: e.id, dmg: Math.round(dmg) }); },
  applyHit(payload) {
    if (!this.host || !this.active || !payload || typeof enemies === 'undefined' || typeof damageEnemy !== 'function') return;
    for (let i = 0; i < enemies.length; i++) if (enemies[i].id === payload.id) { damageEnemy(enemies[i], payload.dmg, enemies[i].col); break; }
  },

  /* ---- HOST → CLIENTS : a kill (every client replays it → shared burst + XP orbs + score) ---- */
  onKill(e) { if (this.active && this.host && typeof Lobby !== 'undefined') Lobby.send('ekill', { id: e.id }); },
  applyKill(payload) {
    if (this.host || !this.active || !payload || typeof enemies === 'undefined' || typeof killEnemy !== 'function') return;
    for (let i = 0; i < enemies.length; i++) if (enemies[i].id === payload.id) { killEnemy(enemies[i], enemies[i].col); break; }
  },

  /* ---- attack VFX : a cosmetic muzzle flash at a teammate's shot (no damage) ---- */
  fireAtk(x, y) { if (this.active && typeof Lobby !== 'undefined') Lobby.send('atk', { x, y }); },
  applyAtk(payload) { if (this.active && payload && typeof burst === 'function') burst(payload.x, payload.y, '#54e6ff', 4, 3); },
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
