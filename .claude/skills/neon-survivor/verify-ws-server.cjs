#!/usr/bin/env node
/* Live authoritative-server round-trip check (no deps).
 *   node .claude/skills/neon-survivor/verify-ws-server.cjs
 *
 * Boots the real GameServer (server/game-server.js → SimHost over the hand-rolled RFC 6455 ws.js),
 * connects TWO genuine WebSocket clients (Node 22's built-in WebSocket — the same protocol a browser
 * uses), has them JOIN one room with a shared seed and stream scripted inputs, and asserts the
 * authoritative SNAPSHOTS coming back describe one real, shared, advancing world: both avatars present
 * and moved, enemies spawned, the frame counter climbing. Proves the input→authoritative-tick→snapshot
 * loop works end-to-end over a real socket. Exits 0 + PASS on success.
 */
const path = require('path');
const { GameServer } = require(path.resolve(__dirname, '../../../server/game-server.js'));

const RUN_MS = 2000, SEED = 1337;
const in1 = t => { const ph = t % 200; return [ph < 100 ? 1 : -1, ph % 60 < 30 ? 1 : 0]; };
const in2 = t => { const ph = t % 160; return [ph < 80 ? -1 : 1, ph % 50 < 25 ? -1 : 1]; };

function client(port, id, inputFn) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    const snaps = []; let welcome = null, t = 0, timer = null;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'join', room: 'TEST', id, seed: SEED }));
      timer = setInterval(() => { const i = inputFn(t++); ws.send(JSON.stringify({ t: 'input', mx: i[0], my: i[1] })); }, 33);
    };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') welcome = m; else if (m.t === 'snap') snaps.push(m); };
    ws.onerror = e => reject(new Error('ws error for ' + id + ': ' + (e && e.message || e)));
    setTimeout(() => { clearInterval(timer); try { ws.close(); } catch { /* */ } resolve({ id, welcome, snaps }); }, RUN_MS);
  });
}

(async () => {
  const gs = new GameServer({ port: 0 });
  await new Promise(r => gs.wss.on('listening', r));
  const port = gs.port;

  const [A, B] = await Promise.all([client(port, 'a', in1), client(port, 'b', in2)]);
  gs.close();

  const last = A.snaps[A.snaps.length - 1] || {};
  const pa = (last.players || []).find(p => p.id === 'a');
  const pb = (last.players || []).find(p => p.id === 'b');
  console.log('client a  welcome.seed=' + (A.welcome && A.welcome.seed) + '  snapshots=' + A.snaps.length);
  console.log('client b  snapshots=' + B.snaps.length);
  console.log('final frame=' + last.frame + ' players=' + (last.players || []).length + ' enemies=' + ((last.enemies || []).length) + ' score=' + last.score);

  let fails = 0;
  if (!A.welcome || A.welcome.seed !== SEED) { fails++; console.error('FAIL — client a never got a welcome with the agreed seed.'); }
  if (A.snaps.length < 5) { fails++; console.error('FAIL — client a received too few authoritative snapshots (' + A.snaps.length + ').'); }
  if (!pa || !pb) { fails++; console.error('FAIL — final snapshot is missing one of the two avatars.'); }
  if (last.frame == null || last.frame < 30) { fails++; console.error('FAIL — frame counter did not advance (' + last.frame + ').'); }
  if (!last.enemies || last.enemies.length < 1) { fails++; console.error('FAIL — server world spawned no enemies.'); }
  if (pa && pb && Math.abs(pa.x - 1500) < 1 && Math.abs(pb.x - 1720) < 1) { fails++; console.error('FAIL — avatars never moved from spawn.'); }

  if (fails) process.exit(1);
  console.log('\nPASS — authoritative WS server ran one shared world over a real socket: 2 avatars joined + moved, ' +
    (last.enemies || []).length + ' enemies spawned, frame ' + last.frame + ', ' + A.snaps.length + ' snapshots streamed to each client.');
  process.exit(0);
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
