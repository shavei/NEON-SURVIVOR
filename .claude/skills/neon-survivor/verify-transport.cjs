#!/usr/bin/env node
/* Transport parity check — "identical with the in-page mock-server as with the Node server".
 *   node .claude/skills/neon-survivor/verify-transport.cjs
 *
 * Drives the client's MockServerTransport (js/transport.js, running the sim IN-PAGE) and the Node
 * SimHost (server/sim-host.js) through the SAME seed + SAME scripted per-avatar inputs for N ticks,
 * each in its own isolated VM with its own cosmetic Math.random stream. Their authoritative snapshots
 * (the exact shape render.js consumes) must be byte-identical — proving the two Transports are
 * interchangeable and the world is host-agnostic. A different seed must diverge. Exits 0 + PASS.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../../..');
const { SimHost } = require(path.resolve(ROOT, 'server/sim-host.js'));

const SEED = 4242, TICKS = 480, IDS = ['p1', 'p2'];
const in1 = t => { const ph = t % 200; return [ph < 100 ? 1 : -1, ph % 60 < 30 ? 1 : 0]; };
const in2 = t => { const ph = t % 160; return [ph < 80 ? -1 : 1, ph % 50 < 25 ? -1 : 1]; };

/* ---- MockServerTransport in a sandbox loading the sim layer + transport.js ---- */
function runMock(seed) {
  const any = new Proxy(function () {}, { get: () => any, apply: () => any, set: () => true, construct: () => any });
  const g = {};
  g.document = { getElementById: () => ({ getContext: () => any, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }), createElement: () => ({ getContext: () => any, width: 0, height: 0 }), body: {}, addEventListener() {} };
  g.localStorage = { getItem: () => null, setItem() {} };
  g.performance = { now: () => 0 }; g.window = g; g.console = console; g.requestAnimationFrame = () => 1;
  vm.createContext(g);
  const files = ['js/config-sim.js', 'js/core.js', 'js/world.js', 'js/sim.js', 'js/transport.js'];
  vm.runInContext(files.map(f => fs.readFileSync(path.resolve(ROOT, f), 'utf8')).join('\n;\n'), g);
  vm.runInContext('Fx.sfx=Fx.music=Fx.toast=Fx.flash=Fx.hud=Fx.loadout=Fx.levelUp=function(){};W=800;H=600;', g);
  g.__SEED = seed; g.__IDS = IDS; g.__in1 = in1; g.__in2 = in2; g.__TICKS = TICKS;
  vm.runInContext(`
    var mt = new MockServerTransport();
    mt.connect({ seed: __SEED, players: __IDS });
    for (var t = 0; t < __TICKS; t++) {
      var a = __in1(t), b = __in2(t);
      mt.sendInput(a[0], a[1], 'p1'); mt.sendInput(b[0], b[1], 'p2');
      mt.step();
    }
    globalThis.__SNAP = mt.snapshot();
  `, g);
  return g.__SNAP;
}

/* ---- Node SimHost ---- */
function runHost(seed) {
  const h = new SimHost(seed, IDS, { mathSeed: 0x12345 });
  for (let t = 0; t < TICKS; t++) { const a = in1(t), b = in2(t); h.input('p1', a[0], a[1]); h.input('p2', b[0], b[1]); h.tick(); }
  return h.snapshot();
}

const hash = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);
const mock = runMock(SEED), host = runHost(SEED), other = runMock(SEED + 7);
const hMock = hash(mock), hHost = hash(host), hOther = hash(other);
console.log('mock-transport   ' + hMock + '   enemies=' + mock.enemies.length + ' orbs=' + mock.orbs.length + ' score=' + mock.score);
console.log('node-simhost     ' + hHost + '   enemies=' + host.enemies.length);
console.log('mock other-seed  ' + hOther);

let fails = 0;
if (hMock !== hHost) {
  fails++; console.error('\nMISMATCH — MockServerTransport and Node SimHost diverged on the same seed → Transports are not interchangeable.');
  console.error('mock p1:', JSON.stringify(mock.players[0])); console.error('host p1:', JSON.stringify(host.players[0]));
  console.error('mock counts:', mock.enemies.length, mock.orbs.length, 'host:', host.enemies.length, host.orbs.length);
}
if (hMock === hOther) { fails++; console.error('\nTRIVIAL — a different seed produced an identical world.'); }
if (mock.enemies.length < 1) { fails++; console.error('\nTRIVIAL — no enemies spawned.'); }

if (fails) process.exit(1);
console.log('\nPASS — the in-page MockServerTransport and the Node SimHost computed ONE identical authoritative world ' +
  'from the same seed (' + mock.enemies.length + ' enemies, score ' + mock.score + '). The client transports are interchangeable.');
process.exit(0);
