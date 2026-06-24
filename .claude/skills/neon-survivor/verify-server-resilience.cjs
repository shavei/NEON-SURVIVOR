#!/usr/bin/env node
/* Server crash-resilience check (no deps).
 *   node .claude/skills/neon-survivor/verify-server-resilience.cjs
 *
 * Regression guard for the bug that froze live play: the shared tick calls gameOver() when every avatar
 * is down, but gameOver lives in main.js which the server never loads — so the call threw inside the
 * 60 Hz interval and crashed the whole process (snapshots stopped, clients froze). This asserts:
 *   1. ticking a SimHost after every avatar dies does NOT throw, and ends the run (state 'over');
 *   2. restart() begins a fresh run (state 'play', frame 0, avatars alive again);
 *   3. SimHost.state / .frame are actually readable from outside the VM (they're lexical lets inside);
 *   4. end-to-end: a GameServer room whose run ends auto-restarts and keeps streaming snapshots.
 * Exits 0 + PASS only if all hold.
 */
const path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../../..');
const { SimHost } = require(path.resolve(ROOT, 'server/sim-host.js'));
const { GameServer } = require(path.resolve(ROOT, 'server/game-server.js'));

let fails = 0;

// --- unit: death must not crash; lifecycle state must be readable + correct ---
const h = new SimHost(1337, ['p1', 'p2']);
for (let i = 0; i < 10; i++) h.tick();
if (h.state !== 'play') { fails++; console.error('FAIL — state not readable as "play" during a run (got ' + h.state + ').'); }
if (h.frame !== 10) { fails++; console.error('FAIL — frame not readable (expected 10, got ' + h.frame + ').'); }
try {
  vm.runInContext('players.forEach(a=>a.dead=true); updateShared();', h._g);
} catch (e) { fails++; console.error('FAIL — ticking after all avatars died threw (the original crash): ' + e.message); }
if (h.state !== 'over') { fails++; console.error('FAIL — run did not end on total wipe (state ' + h.state + ').'); }
h.restart();
if (h.state !== 'play' || h.frame !== 0) { fails++; console.error('FAIL — restart() did not begin a fresh run (state ' + h.state + ', frame ' + h.frame + ').'); }
const after = h.snapshot();
if (after.players.length !== 2 || after.players.some(p => p.dead)) { fails++; console.error('FAIL — restart() did not revive the roster.'); }
console.log('unit: play→over (no crash)→restart→play, roster revived  ' + (fails ? 'FAIL' : 'ok'));

// --- e2e: a GameServer room that wipes must auto-restart and keep streaming ---
(async () => {
  const gs = new GameServer({ port: 0, sendEvery: 1 });
  await new Promise(r => gs.wss.on('listening', r));
  const port = gs.port;
  const snaps = [];
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.t === 'snap') snaps.push(m); };
  ws.send(JSON.stringify({ t: 'join', room: 'WIPE', id: 'a', seed: 99 }));
  await new Promise(r => setTimeout(r, 300));               // let the room come up + tick

  // force a total wipe on the server room, then keep observing
  const room = gs.rooms.get('WIPE');
  vm.runInContext('players.forEach(a=>a.dead=true);', room.host._g);
  const before = snaps.length;
  await new Promise(r => setTimeout(r, 500));               // server should flip to 'over' then restart, not crash/freeze
  const gained = snaps.length - before;
  ws.close(); gs.close();

  if (gained < 3) { fails++; console.error('FAIL — snapshots stopped after a wipe (server crashed/froze): only +' + gained + '.'); }
  const live = snaps[snaps.length - 1];
  if (!live || live.players.length < 1 || live.players[0].dead) { fails++; console.error('FAIL — room did not auto-restart with a living avatar after the wipe.'); }
  console.log('e2e: wipe → +' + gained + ' more snapshots, room restarted with a live avatar  ' + (gained >= 3 && live && !live.players[0].dead ? 'ok' : 'FAIL'));

  if (fails) process.exit(1);
  console.log('\nPASS — avatar death no longer crashes the server; runs end cleanly and rooms auto-restart. No freeze.');
  process.exit(0);
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
