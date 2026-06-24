/* NEON SURVIVOR — server/ws.js
 * Minimal RFC 6455 WebSocket server on Node's built-in http — ZERO npm dependencies (the project is
 * "no deps, offline"). Handles the upgrade handshake, single-frame text messages (ample for our small
 * JSON control/input/snapshot messages), ping/pong and close. Not a general-purpose WS library; it
 * implements exactly what the authoritative game server (server/game-server.js) needs.
 *
 * Usage:
 *   const { WSServer } = require('./ws');
 *   const wss = new WSServer({ port: 8787 });
 *   wss.on('connection', sock => { sock.on('message', s => ...); sock.send('hi'); sock.on('close', ()=>...); });
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const accept = key => crypto.createHash('sha1').update(key + GUID).digest('base64');

/* Encode a server→client frame (unmasked, per spec). opcode 0x1=text, 0x8=close, 0x9=ping, 0xA=pong. */
function encode(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | opcode;   // FIN + opcode
  return Buffer.concat([header, payload]);
}

/* One connected client. Buffers incoming bytes and emits 'message'(string) / 'close' / 'pong'. */
class WSSocket extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.open = true;
    this._buf = Buffer.alloc(0);
    socket.on('data', d => this._onData(d));
    socket.on('close', () => { this.open = false; this.emit('close'); });
    socket.on('error', () => { this.open = false; });
  }
  send(str) { if (this.open) try { this.socket.write(encode(str, 0x1)); } catch { /* peer gone */ } }
  ping() { if (this.open) try { this.socket.write(encode(Buffer.alloc(0), 0x9)); } catch { /* */ } }
  close() { if (this.open) { try { this.socket.write(encode(Buffer.alloc(0), 0x8)); this.socket.end(); } catch { /* */ } this.open = false; } }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    // decode as many whole frames as are buffered
    while (this._buf.length >= 2) {
      const b0 = this._buf[0], b1 = this._buf[1];
      const opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this._buf.length < 4) return; len = this._buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this._buf.length < 10) return; len = Number(this._buf.readBigUInt64BE(2)); off = 10; }
      const maskLen = masked ? 4 : 0;
      if (this._buf.length < off + maskLen + len) return;   // wait for the rest of the frame
      let payload = this._buf.slice(off + maskLen, off + maskLen + len);
      if (masked) { const mask = this._buf.slice(off, off + 4); const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]; payload = out; }
      this._buf = this._buf.slice(off + maskLen + len);
      if (opcode === 0x8) { this.close(); return; }                              // close
      else if (opcode === 0x9) { try { this.socket.write(encode(payload, 0xA)); } catch { /* */ } }  // ping → pong
      else if (opcode === 0xA) { this.emit('pong'); }                            // pong
      else if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) { this.emit('message', payload.toString()); }  // text/bin/cont
    }
  }
}

class WSServer extends EventEmitter {
  constructor({ port = 8787, server = null } = {}) {
    super();
    // Default HTTP handler: 200 on health probes (Fly.io checks hit a path), 426 on everything else.
    // WebSocket upgrades are handled by the 'upgrade' listener below regardless of this handler.
    this.server = server || http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/healthz')) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('neon-survivor authoritative server: ok'); }
      else { res.writeHead(426); res.end('Upgrade Required'); }
    });
    this.server.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key'];
      if (!key) { socket.destroy(); return; }
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept(key) + '\r\n\r\n');
      this.emit('connection', new WSSocket(socket), req);
    });
    if (!server) this.server.listen(port, () => { const a = this.server.address(); this.emit('listening', a && a.port || port); });
  }
  close() { try { this.server.close(); } catch { /* */ } }
}

module.exports = { WSServer, WSSocket, encode, accept };
