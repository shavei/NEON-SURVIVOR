/* NEON SURVIVOR — network-sync.js : the shared-world synchronization layer.
 * Classic global. Loads AFTER multiplayer-combat.js (reuses Lobby + its channel) and BEFORE
 * achievements/main. Headless/offline-safe: every entry point no-ops while a shared-world run is
 * inactive, so verify.cjs loads it with no DOM/network and solo play is byte-for-byte untouched.
 *
 * PHASE 2 (docs/PLAN-multiplayer-sync.md): agree ONE worldSeed across peers via Presence, and pump
 * each player's per-tick movement input over a batched 'input' broadcast into a bounded ring buffer.
 * It does NOT yet drive the sim — that is the Phase 3 lockstep cutover. This proves the handshake +
 * the input pipe: a single agreed seed, and every peer's inputs queryable by tick on every machine. */

const NetSync = {
  WINDOW: 240,          // ring depth in ticks (~4 s @60) — covers input delay + network jitter
  FLUSH_MS: 50,         // outbound input cadence (~20 Hz); each packet batches the ticks since last flush
  active: false,        // true only while a shared-world run wants sync (set from Coop.start)
  seed: null,           // the AGREED world seed (null until the Presence handshake resolves)
  _localSeed: null,     // this client's proposed seed, advertised via Presence metadata
  _applied: false,      // have we seedRng()'d the agreed seed yet?
  _pending: [],         // [[tick,qx,qy]...] local inputs captured but not yet flushed
  _lastFlush: 0,
  _buf: Object.create(null),                       // id -> { tick -> [qx,qy] }  the input ring
  _stats: { sent: 0, recv: 0, lastTick: -1, peers: 0 },

  /* a 32-bit seed this client proposes; generated once. Math.random is fine here — only the AGREED
   * seed (the lowest living id's) actually drives the world, so a loser's proposal never matters. */
  localSeed() { if (this._localSeed == null) this._localSeed = (Math.random() * 0x100000000) >>> 0; return this._localSeed; },

  /* deterministic agreement: the seed advertised by the lowest living id wins — same rule as Coop's
   * host election, so the seed authority IS the spawn authority. Pure given the presence map + my id. */
  pickSeed(presence, me) {
    let lo = null, seed = null;
    for (const id in presence) {
      const meta = presence[id] && presence[id][0];
      if (meta && meta.alive === false) continue;                  // dead peers can't anchor the seed
      if (lo === null || id < lo) { lo = id; seed = (meta && meta.seed != null) ? meta.seed : seed; }
    }
    if (lo === null && presence[me]) { const m = presence[me][0]; seed = m && m.seed; }   // solo-in-room fallback
    return (seed == null) ? null : (seed >>> 0);
  },

  /* Lobby's presence 'sync' calls this with the raw presenceState() — resolve, and (when active) apply */
  onPresence(presence, me) {
    let n = 0; for (const id in presence) n++; this._stats.peers = n;
    const s = this.pickSeed(presence, me);
    if (s != null && s !== this.seed) { this.seed = s; this._applied = false; }   // seed changed → re-apply
    this._applySeed();
    if (this.lockstep) this.syncRoster();    // a peer joined/left → add/remove their avatar
  },
  _applySeed() {
    if (!this.active || this._applied || this.seed == null || typeof seedRng !== 'function') return;
    seedRng(this.seed); this._applied = true;        // the agreed world is now reproducible from this seed
  },

  /* register the 'input' broadcast handler onto the lobby channel (called from Lobby.join, beside Coop.bind) */
  bind(ch) { if (ch && typeof ch.on === 'function') ch.on('broadcast', { event: 'input' }, ({ payload }) => this.recvInput(payload)); },

  /* enter a shared-world run (called from Coop.start). Clears the ring, applies the seed if known. */
  start() { this.active = true; this._applied = false; this._pending.length = 0; this._lastFlush = 0;
    this._buf = Object.create(null); this._stats.lastTick = -1; this._applySeed(); return this.seed; },
  stop() { this.active = false; this._pending.length = 0; },

  /* one-line sim seam (sim.js): record this tick's local movement vector. Quantize to int8 — keyboard is
   * already -1/0/1, touch is analog in [-1,1]. No-op unless a shared-world run is active. */
  localInput(tick, mx, my) {
    if (!this.active) return;
    const qx = mx < -1 ? -127 : mx > 1 ? 127 : Math.round(mx * 127);
    const qy = my < -1 ? -127 : my > 1 ? 127 : Math.round(my * 127);
    this._pending.push([tick, qx, qy]);
    if (typeof Lobby !== 'undefined' && Lobby.me) this._store(Lobby.me, tick, qx, qy);   // echo own input into the ring
  },

  /* flush the batched inputs on the outbound cadence — call once per render frame from the loop pump */
  flush(now) {
    if (!this.active || typeof Lobby === 'undefined' || !Lobby.channel || !Lobby.me) return;
    now = now || Date.now();
    if (!this._pending.length) return;
    if (!this.lockstep && now - this._lastFlush < this.FLUSH_MS) return;   // lockstep sends every frame (delay budget is tight); legacy throttles
    this._lastFlush = now;
    Lobby.send('input', { id: Lobby.me, b: this._pending.slice() });
    this._stats.sent += this._pending.length; this._pending.length = 0;
  },

  recvInput(payload) {
    if (!payload || !payload.id || !payload.b || (typeof Lobby !== 'undefined' && payload.id === Lobby.me)) return;
    for (let i = 0; i < payload.b.length; i++) { const r = payload.b[i]; this._store(payload.id, r[0], r[1], r[2]); }
    this._stats.recv += payload.b.length;
  },
  _store(id, tick, qx, qy) {
    const ring = this._buf[id] || (this._buf[id] = Object.create(null));
    ring[tick] = [qx, qy]; if (tick > this._stats.lastTick) this._stats.lastTick = tick;
    const old = tick - this.WINDOW; if (ring[old] !== undefined) delete ring[old];        // bounded memory
  },

  /* Phase 3 consumes these: the dequantized input for a peer at a tick (null if not yet received), and a
   * readiness gate for lockstep (have ALL listed peers reported tick T yet?). */
  inputAt(id, tick) { const ring = this._buf[id], v = ring && ring[tick]; return v ? { mx: v[0] / 127, my: v[1] / 127 } : null; },
  haveAll(tick, ids) { for (let i = 0; i < ids.length; i++) { const r = this._buf[ids[i]]; if (!r || r[tick] === undefined) return false; } return true; },
  stats() { return this._stats; },

  /* ===== lockstep stepper (Phase 3) =====
   * The control core the shared-world tick (sim.js updateShared) runs on. INPUT_DELAY buffers a couple
   * of ticks so a peer's input for tick T has arrived by the time everyone simulates T. ready() gates
   * the advance; applyInputs() loads each avatar's input for the tick from the ring (holding the last
   * known value if a packet is late, so a brief drop coasts rather than freezes). */
  INPUT_DELAY: 2,
  lockstep: false,
  _ids() { const out = []; if (typeof players !== 'undefined') for (let i = 0; i < players.length; i++) out.push(players[i].id); out.sort(); return out; },
  ready(tick) { return this.haveAll(tick, this._ids()); },        // is every avatar's input for `tick` present?
  applyInputs(tick) {
    if (typeof players === 'undefined') return;
    for (let i = 0; i < players.length; i++) { const a = players[i], v = this.inputAt(a.id, tick);
      if (v) a.input = [v.mx, v.my]; else if (!a.input) a.input = [0, 0]; }   // late packet → hold last input
  },
  _tick: 0,

  /* ===== live cutover (Phase 3) — co-op IS the shared world ===== */
  /* enter lockstep at run start: build the avatar roster, prime INPUT_DELAY empty ticks so the gate can open */
  enterLockstep() {
    this.lockstep = true; this._tick = 0; this._buf = Object.create(null); this._pending.length = 0;
    this._sentThru = this.INPUT_DELAY - 1;   // priming below "sends" ticks [0,INPUT_DELAY); real input starts at INPUT_DELAY
    this.syncRoster();
    // prime ONLY ticks [0, INPUT_DELAY) with empty input. Real inputs (scheduled at T+INPUT_DELAY) start
    // exactly at tick INPUT_DELAY, so they must NOT collide with a prime — else a peer satisfies ready()
    // with a stale [0,0] instead of waiting for the real value, and the two worlds fork on that tick.
    for (let t = 0; t < this.INPUT_DELAY; t++) this._sendInput(t, 0, 0);
  },
  exitLockstep() { this.lockstep = false; },

  /* rebuild players[] = local avatar + one full avatar per living peer (stable ids, sorted). Preserves
   * existing avatar bodies so their sim state survives a roster change; keeps `player` = my avatar. */
  syncRoster() {
    if (typeof players === 'undefined' || typeof makeAvatar !== 'function') return;
    const me = (typeof Lobby !== 'undefined' && Lobby.me) || 'local';
    if (typeof player !== 'undefined' && player) player.id = me;
    const byId = Object.create(null); for (let i = 0; i < players.length; i++) byId[players[i].id] = players[i];
    const want = Object.create(null);
    want[me] = byId[me] || (typeof player !== 'undefined' && player) || makeAvatar(WORLD.w / 2, WORLD.h / 2, me);
    // NEW avatars start at the world centre — a position EVERY machine agrees on (a peer's broadcast x/y
    // is a per-machine view and would fork the world); they then diverge only via synced inputs.
    if (typeof Lobby !== 'undefined') for (const id in Lobby.peers) want[id] = byId[id] || makeAvatar(WORLD.w / 2, WORLD.h / 2, id);
    const next = []; for (const id in want) next.push(want[id]);
    next.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    players = next;
    for (let i = 0; i < players.length; i++) if (players[i].id === me && typeof player !== 'undefined') player = players[i];
  },

  /* read the LOCAL movement vector straight from the live input globals (mirrors sim.js update()) */
  localMoveVec() {
    let mx = 0, my = 0;
    if (typeof keys !== 'undefined') { if (keys['w'] || keys['arrowup']) my -= 1; if (keys['s'] || keys['arrowdown']) my += 1;
      if (keys['a'] || keys['arrowleft']) mx -= 1; if (keys['d'] || keys['arrowright']) mx += 1; }
    if (typeof touch !== 'undefined' && touch) { const dx = touch.x - touch.cx, dy = touch.y - touch.cy, m = Math.hypot(dx, dy); if (m > 8) { mx = dx / m; my = dy / m; } }
    return [mx, my];
  },
  _sendInput(tick, mx, my) {
    const qx = mx < -1 ? -127 : mx > 1 ? 127 : Math.round(mx * 127), qy = my < -1 ? -127 : my > 1 ? 127 : Math.round(my * 127);
    if (typeof Lobby !== 'undefined' && Lobby.me) this._store(Lobby.me, tick, qx, qy);   // echo into my own ring
    this._pending.push([tick, qx, qy]);
  },

  /* the per-substep lockstep gate the loop calls instead of update(): schedule my future input, then advance
   * iff EVERY avatar's input for this tick has arrived. Returns false to STALL the frame (we wait, not desync). */
  _sentThru: -1,
  stepShared() {
    if (!this.lockstep) return true;
    const T = this._tick, target = T + this.INPUT_DELAY;
    if (target > this._sentThru) {                    // schedule each tick's local input EXACTLY ONCE — never
      const v = this.localMoveVec();                  // re-derive a tick already sent (re-deriving could capture a
      this._sendInput(target, v[0], v[1]);            // changed key mid-stall and fork after a peer consumed the old one)
      this._sentThru = target;
    }
    if (!this.ready(T)) return false;                 // a peer's input is late → stall; the world never forks
    this.applyInputs(T);
    if (typeof updateShared === 'function') updateShared();
    this._tick++;
    return true;
  },

  /* ===== desync guard ===== a compact world digest; the seed-authority compares peers' hashes (debug overlay
   * for now — auto hard-reset to a snapshot is the conservative follow-up, see world_state below). */
  worldHash() {
    if (typeof enemies === 'undefined') return 0;
    let h = 2166136261 >>> 0;
    const mix = n => { h ^= n | 0; h = Math.imul(h, 16777619) >>> 0; };
    mix(this._tick); if (typeof score !== 'undefined') mix(score);
    for (let i = 0; i < enemies.length; i++) { const e = enemies[i]; mix(e.id); mix(e.x * 8); mix(e.y * 8); mix(e.hp); }
    if (typeof orbs !== 'undefined') for (let i = 0; i < orbs.length; i++) { mix(orbs[i].id ? 1 : 0); mix(orbs[i].x * 4); mix(orbs[i].y * 4); }
    // M5: hash each avatar's upgrade/level/build, not just its position — an upgrade fork (C1) changes
    // dmg/multi/pierce/level and the bullet volley but leaves positions equal for a while, so a
    // position-only digest is blind to it. Bullets are part of the shared world, so fold them in too.
    if (typeof players !== 'undefined') for (let i = 0; i < players.length; i++) { const a = players[i];
      mix(a.x * 8); mix(a.y * 8); mix(a.hp); mix(a.level); mix(a.dmg * 100); mix(a.multi); mix(a.pierce);
      mix(a.missile); mix(a.shield); mix(a.chain); }
    if (typeof bullets !== 'undefined') { mix(bullets.length);
      for (let i = 0; i < bullets.length; i++) { const b = bullets[i]; mix(b.x * 4); mix(b.y * 4); mix(b.pierce); } }
    return h >>> 0;
  },

  /* ===== persistence (Supabase) ===== durable snapshot so a late-joiner / reconnect hydrates into the world
   * in progress. Headless/offline-safe: no-ops when SB is absent so verify.cjs + solo are untouched. */
  _lastSave: 0, SAVE_MS: 2000,
  /* host-only, ~0.5 Hz: upsert the live world snapshot for late-join/reconnect hydration. Called every
   * frame from the loop; self-throttles. Headless/offline-safe (no SB → no-op). */
  saveWorld(now) {
    if (typeof SB === 'undefined' || !SB || !this.lockstep || this.seed == null) return;
    if (typeof Coop !== 'undefined' && !Coop.host) return;          // only the seed-authority/host persists
    const room = (typeof Lobby !== 'undefined' && Lobby.room); if (!room) return;
    now = now || Date.now(); if (now - this._lastSave < this.SAVE_MS) return; this._lastSave = now;
    const snap = { seed: this.seed, tick: this._tick,
      en: (typeof enemies !== 'undefined' ? enemies : []).slice(0, 80).map(e => [e.id, e.type, Math.round(e.x), Math.round(e.y), Math.round(e.hp)]) };
    try { SB.from('world_state').upsert({ room, seed: this.seed, tick: this._tick, snapshot: snap }).then(() => {}, () => {}); } catch (e) {}
  },
  async loadWorld(room) {
    if (typeof SB === 'undefined' || !SB || !room) return null;
    try { const { data } = await SB.from('world_state').select('snapshot').eq('room', room).maybeSingle(); return data ? data.snapshot : null; } catch (e) { return null; }
  },
};
