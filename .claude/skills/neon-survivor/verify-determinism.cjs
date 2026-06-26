#!/usr/bin/env node
/* Determinism check for the shared-world foundation (docs/PLAN-multiplayer-sync.md, Phase 1).
 *   node .claude/skills/neon-survivor/verify-determinism.cjs
 * Proves seedRng() makes GAMEPLAY a pure function of the world seed, INDEPENDENT of Math.random:
 *   · Run the split build twice with the SAME seedRng() seed but DIFFERENT Math.random streams.
 *     Gameplay state (enemies/orbs/items/bullets/missiles/ebullets, score, player) must be identical
 *     → confirms no gameplay path still leaks Math.random (cosmetic particles/floats/bolts excluded).
 *   · Run with a DIFFERENT seed → gameplay state must change → confirms the seed actually drives it.
 * Exits 0 + PASS only if both hold.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../../..');

const scriptB = ['js/config-sim.js', 'js/core.js', 'js/audio-orchestrator.js', 'js/world.js', 'js/sim.js', 'js/render.js', 'js/ui-engine.js', 'js/main.js']
  .map(s => fs.readFileSync(path.resolve(ROOT, s), 'utf8')).join('\n;\n');

function makeSandbox() {
  const any = new Proxy(function () {}, {
    get(t, p) { if (p === Symbol.toPrimitive) return () => 0; if (p === 'toString' || p === 'valueOf') return () => ''; if (p === 'width' || p === 'height') return 32; return any; },
    apply() { return any; }, set() { return true; }, construct() { return any; }
  });
  const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => any });
  const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), appendChild() {}, set innerHTML(v) {}, set textContent(v) {}, set onclick(v) {} });
  const els = {};
  const gameEl = { getContext: () => any, style: {}, width: 0, height: 0, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const g = {};
  g.document = { body: el(), getElementById: id => id === 'game' ? gameEl : (els[id] || (els[id] = el())), querySelectorAll: () => [], createElement: t => t === 'canvas' ? fakeCanvas() : el(), addEventListener() {} };
  g.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
  g.window = g; g.addEventListener = () => {}; g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {};
  g.setInterval = () => 1; g.clearInterval = () => {}; g.setTimeout = () => 1; g.clearTimeout = () => {};
  g.performance = { now: () => g.__t || 0 }; g.devicePixelRatio = 1; g.innerWidth = 800; g.innerHeight = 600;
  g.AudioContext = function () { return any; }; g.webkitAudioContext = g.AudioContext;
  g.console = console;
  return g;
}

// mulberry32 prelude seeding Math.random to a chosen constant — lets us vary the COSMETIC stream
// between two runs while holding the GAMEPLAY seed fixed, to prove the two are decoupled.
const prelude = (mathSeed) => `
(function(){ var __s = ${mathSeed} >>> 0;
  Math.random = function(){ __s |= 0; __s = (__s + 0x6D2B79F5) | 0;
    var t = Math.imul(__s ^ (__s >>> 15), 1 | __s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();
`;

// GAMEPLAY-ONLY snapshot (cosmetic particles/floats/bolts intentionally excluded — they may diverge).
const driver = (worldSeed) => `
;(function(){ try {
  startGame();
  seedRng(${worldSeed});                  // <-- the foundation under test: pin the gameplay world
  Up.blaster = 0; applyUpgrade('missile'); applyUpgrade('multi');
  nextBoss = 8;
  for (var f = 0; f < 900; f++) {
    var phase = f % 240;
    keys['w'] = phase < 120; keys['s'] = phase >= 120 && phase < 180;
    keys['d'] = phase % 80 < 40;        keys['a'] = phase % 80 >= 40;
    globalThis.__t = (globalThis.__t || 0) + 16;
    loop(globalThis.__t);
    if (state === 'levelup') { state = 'play'; }
  }
  var r4 = function(n){ return Math.round(n * 10000) / 10000; };
  var sumXY = function(arr){ var sx=0, sy=0; for (var i=0;i<arr.length;i++){ sx+=arr[i].x||0; sy+=arr[i].y||0; } return [r4(sx), r4(sy)]; };
  var p = player;
  globalThis.__SNAP = JSON.stringify({
    score:score, wave:wave, kills:kills,
    p:{ x:r4(p.x), y:r4(p.y), hp:r4(p.hp), level:p.level, xp:r4(p.xp), missile:p.missile, multi:p.multi },
    counts:{ enemies:enemies.length, bullets:bullets.length, orbs:orbs.length, missiles:missiles.length, ebullets:ebullets.length, items:items.length },
    sums:{ enemies:sumXY(enemies), bullets:sumXY(bullets), orbs:sumXY(orbs), missiles:sumXY(missiles), ebullets:sumXY(ebullets), items:sumXY(items) }
  });
} catch (e) { globalThis.__ERR = (e && e.message) + '\\n' + ((e && e.stack)||'').split('\\n').slice(0,6).join('\\n'); } })();
`;

function run(label, mathSeed, worldSeed) {
  const sb = makeSandbox(); vm.createContext(sb);
  try { vm.runInContext(prelude(mathSeed) + scriptB + driver(worldSeed), sb, { filename: label }); }
  catch (e) { console.error(label + ' LOAD ERROR: ' + e.message); process.exit(1); }
  if (sb.__ERR) { console.error(label + ' RUNTIME ERROR:\n' + sb.__ERR); process.exit(1); }
  return sb.__SNAP;
}
const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// Same world seed, DIFFERENT Math.random streams → gameplay must be identical.
const a = run('seed=1 math=A', '0x11111111', 1);
const b = run('seed=1 math=B', '0x22222222', 1);
// Different world seed → gameplay must differ.
const c = run('seed=2 math=A', '0x11111111', 2);

console.log('seed=1 mathA  ' + hash(a));
console.log('seed=1 mathB  ' + hash(b));
console.log('seed=2 mathA  ' + hash(c));

let ok = true;
if (a !== b) { ok = false; console.error('\nFAIL — same seed, different Math.random produced DIFFERENT gameplay → a gameplay path still leaks Math.random.');
  const x = JSON.parse(a), y = JSON.parse(b); console.error('A:', JSON.stringify(x)); console.error('B:', JSON.stringify(y)); }
if (a === c) { ok = false; console.error('\nFAIL — different world seed produced IDENTICAL gameplay → seedRng() is not driving the sim.'); }
if (ok) { console.log('\nPASS — gameplay is seed-deterministic and Math.random-independent. Seed drives the world.'); process.exit(0); }
process.exit(1);
