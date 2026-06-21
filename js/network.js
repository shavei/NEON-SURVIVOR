/* NEON SURVIVOR — network.js : peaceful multiplayer LOBBY (Supabase Realtime Presence).
 * Classic global (loads AFTER net.js — shares its lazily-loaded `supabase` SDK / `SB` client —
 * and BEFORE achievements/main). Headless/offline-safe: every entry point no-ops when SB is
 * absent, so verify.cjs loads it without a DOM or network and single-player is untouched.
 *
 * Peaceful = soft state only. No combat, no authoritative sim: each client owns ONLY its own
 * avatar. Roster (who's here) rides Presence; movement rides a throttled `broadcast 'pos'` at
 * ~10 Hz. Remote avatars arrive at 10 Hz but render at display refresh, so we interpolate toward
 * the last received target with frame-rate-independent exponential smoothing (see step()/_smooth). */

const Lobby = {
  room: null, channel: null, me: null, profile: null, _alive: true,
  peers: Object.create(null),       // id -> { name,color, alive, x,y, tx,ty, lastSeen }
  onRoster: null,                   // callback(peers) on join/leave
  SMOOTH: 12,                       // lerp stiffness — higher = snappier, lower = floatier
  SEND_MS: 100,                     // outbound position cadence (~10 Hz)
  TIMEOUT: 5000,                    // drop a peer silent this long (covers missed disconnects)
  _lastSend: 0, _lx: 0, _ly: 0,

  /* pure, frame-rate-INDEPENDENT smoothing: converges cur->tgt by a fraction set by dt, not frame
   * count, so 60/144/240 Hz land identically (CLAUDE.md: never naively frame-scale movement). */
  _smooth(cur, tgt, smooth, dt) { return cur + (tgt - cur) * (1 - Math.exp(-smooth * dt)); },

  /* pure: evict peers unheard-from past `timeout`. Returns the same map (mutated). */
  _cull(peers, now, timeout) {
    for (const id in peers) if (now - peers[id].lastSeen > timeout) delete peers[id];
    return peers;
  },

  /* join a named room. profile = {name,color}. Returns false when networking is unavailable. */
  join(roomId, profile) {
    if (typeof SB === 'undefined' || !SB || typeof SB.channel !== 'function') return false;
    this.leave();
    const p = (typeof getPlayer === 'function') && getPlayer();
    this.me = (p && p.id) || (profile && profile.id) || 'me';
    this.room = roomId; this._alive = true;
    this.profile = { name: (profile && profile.name) || (p && p.name) || 'Player', color: (profile && profile.color) || '#54e6ff' };
    this.peers = Object.create(null);
    const ch = SB.channel('lobby:' + roomId, { config: { presence: { key: this.me } } });

    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState(), now = Date.now(), seen = {};
      for (const key in st) {
        if (key === this.me) continue;
        const meta = (st[key] && st[key][0]) || {}; seen[key] = 1;
        const peer = this.peers[key] || (this.peers[key] = {
          name: meta.name || '???', color: meta.color || '#54e6ff', alive: meta.alive !== false,
          x: meta.x || 0, y: meta.y || 0, tx: meta.x || 0, ty: meta.y || 0, lastSeen: now,
        });
        peer.name = meta.name || peer.name; peer.color = meta.color || peer.color;
        peer.alive = meta.alive !== false; peer.lastSeen = now;   // liveness drives co-op host election (dead hosts excluded)
      }
      for (const key in this.peers) if (!seen[key]) delete this.peers[key];   // left the room
      if (typeof this.onRoster === 'function') this.onRoster(this.peers);
      if (typeof Coop !== 'undefined' && Coop.onSync) Coop.onSync();          // re-elect the enemy host on join/leave
    });

    ch.on('broadcast', { event: 'pos' }, ({ payload }) => {
      if (!payload || payload.id === this.me) return;
      const peer = this.peers[payload.id]; if (!peer) return;
      peer.tx = payload.x; peer.ty = payload.y; peer.lastSeen = Date.now();   // set target; step() lerps to it
    });

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        try { ch.track({ name: this.profile.name, color: this.profile.color, alive: true, x: 0, y: 0 }); } catch (e) {}
      }
    });
    if (typeof Coop !== 'undefined' && Coop.bind) Coop.bind(ch);   // attach PvE co-op broadcast handlers
    this.channel = ch;
    return true;
  },

  leave() {
    if (typeof Coop !== 'undefined' && Coop.unbind) Coop.unbind();
    if (this.channel) { try { this.channel.unsubscribe(); } catch (e) {} }
    this.channel = null; this.room = null; this.peers = Object.create(null);
  },

  /* re-track presence with a new alive flag — a dead host broadcasts alive:false so peers re-elect off it */
  setAlive(a) {
    this._alive = a;
    if (!this.channel) return;
    try { this.channel.track({ name: this.profile.name, color: this.profile.color, alive: a, x: this._lx, y: this._ly }); } catch (e) {}
  },

  /* generic broadcast send on the lobby channel (used by the PvE co-op layer); quiet when not joined */
  send(event, payload) {
    if (!this.channel) return;
    try { this.channel.send({ type: 'broadcast', event, payload }); } catch (e) {}
  },

  /* push the local avatar — throttled to SEND_MS and only when it actually moved (quiet when idle) */
  setLocalState(x, y, ts) {
    if (!this.channel) return;
    const now = ts || Date.now();
    if (now - this._lastSend < this.SEND_MS) return;
    if (Math.abs(x - this._lx) < 0.5 && Math.abs(y - this._ly) < 0.5 && this._lastSend) return;
    this._lastSend = now; this._lx = x; this._ly = y;
    try { this.channel.send({ type: 'broadcast', event: 'pos', payload: { id: this.me, x, y } }); } catch (e) {}
  },

  /* advance every peer toward its last received target; cull the stale. Call once per render frame. */
  step(dt, now) {
    now = now || Date.now();
    for (const id in this.peers) {
      const peer = this.peers[id];
      peer.x = this._smooth(peer.x, peer.tx, this.SMOOTH, dt);
      peer.y = this._smooth(peer.y, peer.ty, this.SMOOTH, dt);
    }
    this._cull(this.peers, now, this.TIMEOUT);
    return this.peers;
  },

  count() { let n = 0; for (const id in this.peers) n++; return n; },
};
