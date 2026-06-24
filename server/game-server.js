/* NEON SURVIVOR — server/game-server.js
 * The authoritative game server: one SimHost per room, ticked at a fixed 60 Hz, fed by client inputs
 * and broadcasting authoritative snapshots. Pure Node built-ins (uses ./ws — no npm deps). The server
 * owns the world; clients only send inputs and render what comes back.
 *
 * Wire protocol (small JSON messages, newline-free):
 *   client → server : {t:'join', room, id?, seed?, difficulty?}  |  {t:'input', mx, my}  |  {t:'leave'}
 *   server → client : {t:'welcome', id, seed, room}  |  {t:'snap', ...authoritativeSnapshot}  |  {t:'bye'}
 *
 * Tick/broadcast: tick every 1/60 s; send a snapshot every `sendEvery` ticks (default 3 ⇒ ~20 Hz),
 * matching the ~10–20 Hz cadence the current Supabase-Realtime co-op used, but now from one authority. */
'use strict';
const { WSServer } = require('./ws');
const { SimHost } = require('./sim-host');

let _uid = 0;
const genId = () => 'p' + (++_uid) + '_' + Math.random().toString(36).slice(2, 6);

class GameServer {
  constructor({ port = 8787, server = null, tickHz = 60, sendEvery = 3 } = {}) {
    this.sendEvery = sendEvery;
    this.rooms = new Map();   // room -> { host, clients:Map(id->sock), seed, seq }
    this.wss = new WSServer({ port, server });
    this.wss.on('connection', sock => this._onConn(sock));
    this.wss.on('listening', p => { try { console.log('[game-server] listening on :' + p); } catch { /* */ } });
    this._timer = setInterval(() => this._tickAll(), 1000 / tickHz);
    if (this._timer.unref) this._timer.unref();
  }

  _ensureRoom(name, seed, difficulty, firstId) {
    let r = this.rooms.get(name);
    if (!r) {
      const s = (seed != null ? seed >>> 0 : (Math.random() * 0xffffffff) >>> 0);
      r = { host: new SimHost(s, [firstId], { difficulty }), clients: new Map(), seed: s, seq: 0 };
      this.rooms.set(name, r);
    } else if (!r.host.playerIds.includes(firstId)) {
      r.host.addPlayer(firstId);
    }
    return r;
  }

  _onConn(sock) {
    let id = null, room = null;
    sock.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'join') {
        room = String(m.room || 'GLOBAL').slice(0, 24);
        id = String(m.id || genId()).slice(0, 32);
        const r = this._ensureRoom(room, m.seed, m.difficulty, id);
        r.clients.set(id, sock);
        sock.send(JSON.stringify({ t: 'welcome', id, seed: r.seed, room }));
      } else if (m.t === 'input' && room && id) {
        const r = this.rooms.get(room);
        if (r) r.host.input(id, m.mx, m.my);
      } else if (m.t === 'leave') {
        this._drop(room, id, sock);
      }
    });
    sock.on('close', () => this._drop(room, id, sock));
  }

  _drop(room, id, sock) {
    if (!room || !id) return;
    const r = this.rooms.get(room);
    if (!r) return;
    if (r.clients.get(id) === sock) {
      r.clients.delete(id);
      r.host.removePlayer(id);
      if (r.clients.size === 0) this.rooms.delete(room);   // empty room: free the world
    }
  }

  _tickAll() {
    for (const r of this.rooms.values()) {
      if (r.clients.size === 0) continue;
      r.host.tick();
      r.seq++;
      if (r.seq % this.sendEvery === 0) {
        const str = JSON.stringify(Object.assign({ t: 'snap' }, r.host.snapshot()));
        for (const sock of r.clients.values()) sock.send(str);
      }
    }
  }

  close() { clearInterval(this._timer); this.wss.close(); }
  get port() { return this.wss.server.address() && this.wss.server.address().port; }
}

module.exports = { GameServer };

// Run directly: `node server/game-server.js [port]`
if (require.main === module) {
  const port = Number(process.argv[2]) || Number(process.env.PORT) || 8787;
  new GameServer({ port });
}
