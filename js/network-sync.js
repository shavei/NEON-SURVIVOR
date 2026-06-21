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
    if (!this._pending.length || now - this._lastFlush < this.FLUSH_MS) return;
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
};
