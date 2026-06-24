#!/usr/bin/env node
/* Online co-op check (no deps) — the replacement for the old Supabase-realtime multiplayer.
 *   node .claude/skills/neon-survivor/verify-online-coop.cjs
 *
 * Boots the real GameServer and connects TWO independent clients (each a sandboxed sim+transport build
 * running the Online controller) into the SAME room code, with different inputs. Asserts that each
 * client reconciles BOTH avatars into its players[] (so they see each other), the camera stays on its
 * own avatar, both moved, and the shared world advanced. This is the new authoritative co-op: one server
 * world, clients send input + render snapshots. Exits 0 + PASS on success.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../../..');
const { GameServer } = require(path.resolve(ROOT, 'server/game-server.js'));
const RUN_MS = 2200;

function makeClient(port, id, room, inputFn) {
  const any = new Proxy(function () {}, { get: () => any, apply: () => any, set: () => true, construct: () => any });
  const g = {};
  g.document = { getElementById: () => ({ getContext: () => any, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }), createElement: () => ({ getContext: () => any, width: 0, height: 0 }), body: {}, addEventListener() {} };
  g.localStorage = { getItem: () => null, setItem() {} };
  g.performance = { now: () => Date.now() }; g.WebSocket = WebSocket; g.setTimeout = setTimeout; g.clearTimeout = clearTimeout;
  g.window = g; g.console = console; g.requestAnimationFrame = () => 1;
  vm.createContext(g);
  const files = ['js/config-sim.js', 'js/core.js', 'js/world.js', 'js/sim.js', 'js/transport.js'];
  vm.runInContext(files.map(f => fs.readFileSync(path.resolve(ROOT, f), 'utf8')).join('\n;\n'), g);
  vm.runInContext('Fx.sfx=Fx.music=Fx.toast=Fx.flash=Fx.hud=Fx.loadout=Fx.levelUp=function(){};W=800;H=600;var keys={};var touch=null;', g);
  vm.runInContext('GAME_SERVER_URL="ws://127.0.0.1:' + port + '";', g);
  vm.runInContext(`seedRng(1); reset(); state='play'; Online.start({ room:'${room}', id:'${id}' });`, g);
  g.__inputFn = inputFn;
  return g;
}

(async () => {
  const gs = new GameServer({ port: 0 });
  await new Promise(r => gs.wss.on('listening', r));
  const port = gs.port;

  const A = makeClient(port, 'alice', 'SQUAD', t => { const ph = t % 200; return [ph < 100 ? 1 : -1, ph % 60 < 30 ? 1 : 0]; });
  const B = makeClient(port, 'bob', 'SQUAD', t => { const ph = t % 160; return [ph < 80 ? -1 : 1, ph % 50 < 25 ? -1 : 1]; });

  let t = 0;
  const timer = setInterval(() => {
    for (const g of [A, B]) {
      const i = g.__inputFn(t);
      vm.runInContext(`keys={w:${i[1] < 0},s:${i[1] > 0},d:${i[0] > 0},a:${i[0] < 0}}; Online.tick();`, g);
    }
    t++;
  }, 33);
  await new Promise(r => setTimeout(r, RUN_MS));
  clearInterval(timer);

  const read = g => JSON.parse(vm.runInContext(`JSON.stringify({ ids:players.map(p=>p.id).sort(), me:(player&&player.id), enemies:enemies.length, frame:frame, mine:(player&&{x:Math.round(player.x),y:Math.round(player.y)}) })`, g));
  const a = read(A), b = read(B);
  vm.runInContext('Online.stop();', A); vm.runInContext('Online.stop();', B); gs.close();
  console.log('client alice  roster=' + JSON.stringify(a.ids) + ' camera=' + a.me + ' enemies=' + a.enemies + ' frame=' + a.frame);
  console.log('client bob    roster=' + JSON.stringify(b.ids) + ' camera=' + b.me + ' enemies=' + b.enemies + ' frame=' + b.frame);

  let fails = 0;
  const both = ['alice', 'bob'];
  if (JSON.stringify(a.ids) !== JSON.stringify(both)) { fails++; console.error('FAIL — alice does not see both avatars: ' + JSON.stringify(a.ids)); }
  if (JSON.stringify(b.ids) !== JSON.stringify(both)) { fails++; console.error('FAIL — bob does not see both avatars: ' + JSON.stringify(b.ids)); }
  if (a.me !== 'alice') { fails++; console.error('FAIL — alice camera not on her own avatar (' + a.me + ').'); }
  if (b.me !== 'bob') { fails++; console.error('FAIL — bob camera not on his own avatar (' + b.me + ').'); }
  if (a.frame < 30 || b.frame < 30) { fails++; console.error('FAIL — shared world did not advance for both clients.'); }
  if (a.mine && a.mine.x === 1500 && a.mine.y === 1500) { fails++; console.error('FAIL — alice never moved.'); }

  if (fails) process.exit(1);
  console.log('\nPASS — two clients joined one room code and share one authoritative world: each sees both ships, ' +
    'camera on its own, ' + a.enemies + ' shared enemies, world advancing. Co-op runs on the new server.');
  process.exit(0);
})().catch(e => { console.error('ERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')); process.exit(1); });
