#!/usr/bin/env node
/* Online client integration check (no deps).
 *   node .claude/skills/neon-survivor/verify-online-client.cjs
 *
 * Proves the server-authoritative CLIENT path end-to-end: boots the real GameServer, then in an
 * isolated VM loads the client sim + transport layer, calls Online.start() (WebSocketTransport) pointed
 * at the server, and pumps Online.tick() (input only) on a clock. The server owns the world; the client
 * must NOT simulate — its in-page globals (players/enemies/score/frame) should converge to the server's
 * snapshots via applySnapshot, with the local avatar present + moved and the camera target (`player`)
 * bound to it. Exits 0 + PASS on success.
 */
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../../..');
const { GameServer } = require(path.resolve(ROOT, 'server/game-server.js'));

const RUN_MS = 2200, SEED = 1337;

function makeClient(port) {
  const any = new Proxy(function () {}, { get: () => any, apply: () => any, set: () => true, construct: () => any });
  const g = {};
  g.document = { getElementById: () => ({ getContext: () => any, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }), createElement: () => ({ getContext: () => any, width: 0, height: 0 }), body: {}, addEventListener() {} };
  g.localStorage = { getItem: () => null, setItem() {} };
  g.performance = { now: () => Date.now() };
  g.WebSocket = WebSocket;            // expose Node 22's WebSocket client into the sandbox
  g.setTimeout = setTimeout; g.clearTimeout = clearTimeout;
  g.window = g; g.console = console; g.requestAnimationFrame = () => 1;
  vm.createContext(g);
  const files = ['js/config-sim.js', 'js/core.js', 'js/world.js', 'js/sim.js', 'js/transport.js'];
  vm.runInContext(files.map(f => fs.readFileSync(path.resolve(ROOT, f), 'utf8')).join('\n;\n'), g);
  vm.runInContext('Fx.sfx=Fx.music=Fx.toast=Fx.flash=Fx.hud=Fx.loadout=Fx.levelUp=function(){};W=800;H=600;var keys={};var touch=null;', g);
  vm.runInContext('GAME_SERVER_URL = "ws://127.0.0.1:' + port + '";', g);
  // boot the local world arrays (as startOnline does via reset()), then connect.
  vm.runInContext("seedRng(" + SEED + "); reset(); state='play'; Online.start({ room:'TEST', seed:" + SEED + ", difficulty:'normal', id:'web1' });", g);
  return g;
}

(async () => {
  const gs = new GameServer({ port: 0 });
  await new Promise(r => gs.wss.on('listening', r));
  const port = gs.port;
  const g = makeClient(port);

  // pump input on a 33 ms clock (rotating keys so the avatar moves) AND run the client present step
  // (camera follow + HUD), exactly like main.js's loop. snapshots arrive async on the host loop.
  let t = 0;
  const timer = setInterval(() => {
    const ph = t++ % 8;
    vm.runInContext(`keys = { w:${ph < 4}, s:${ph >= 4}, d:${ph % 4 < 2}, a:${ph % 4 >= 2} }; Online.tick(); Online.present(Online.alpha());`, g);
  }, 33);

  await new Promise(r => setTimeout(r, RUN_MS));
  clearInterval(timer);

  const snap = vm.runInContext(`JSON.stringify({ ready:Online._ready, localId:Online.localId,
    frame:frame, score:score, enemies:enemies.length, orbs:orbs.length,
    players:players.map(p=>({id:p.id,x:Math.round(p.x),y:Math.round(p.y)})),
    playerId:(player&&player.id), playerX:(player&&Math.round(player.x)),
    camx:Math.round(cam.x), camy:Math.round(cam.y), next:(player&&player.next), W:W, H:H });`, g);
  vm.runInContext('Online.stop();', g);
  gs.close();
  const r = JSON.parse(snap);
  console.log('client ready=' + r.ready + ' localId=' + r.localId + ' frame=' + r.frame + ' enemies=' + r.enemies + ' score=' + r.score);
  console.log('client players=' + JSON.stringify(r.players) + ' camera->' + r.playerId);
  console.log('camera=(' + r.camx + ',' + r.camy + ') player viewport-tracked, player.next=' + r.next);

  const me = r.players.find(p => p.id === 'web1');
  let fails = 0;
  if (!r.ready) { fails++; console.error('FAIL — client never applied a server snapshot.'); }
  if (r.frame < 30) { fails++; console.error('FAIL — server frame did not advance on the client (' + r.frame + ').'); }
  if (r.enemies < 1) { fails++; console.error('FAIL — client world has no enemies (snapshots not applied?).'); }
  if (!me) { fails++; console.error('FAIL — local avatar web1 missing from the reconciled roster.'); }
  if (r.playerId !== 'web1') { fails++; console.error('FAIL — camera/`player` not bound to the local avatar (' + r.playerId + ').'); }
  if (me && Math.abs(me.x - 1500) < 1 && Math.abs(me.y - 1500) < 1) { fails++; console.error('FAIL — local avatar never moved under server authority.'); }
  // camera-follow (present): the local avatar must stay inside the viewport [cam, cam+W/H], not drift off
  if (me && !(me.x >= r.camx - 1 && me.x <= r.camx + r.W + 1 && me.y >= r.camy - 1 && me.y <= r.camy + r.H + 1)) {
    fails++; console.error('FAIL — camera did not follow: player (' + me.x + ',' + me.y + ') outside viewport (' + r.camx + ',' + r.camy + ')+(' + r.W + ',' + r.H + ').'); }
  if (r.next == null) { fails++; console.error('FAIL — player.next (XP-to-level) missing from snapshot → HUD XP bar would be wrong.'); }

  if (fails) process.exit(1);
  console.log('\nPASS — online client renders the server world with camera following + HUD data (next=' + r.next + '): frame ' +
    r.frame + ', ' + r.enemies + ' enemies, avatar moved + viewport-tracked. Client simulates nothing; server is authoritative.');
  process.exit(0);
})().catch(e => { console.error('ERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')); process.exit(1); });
