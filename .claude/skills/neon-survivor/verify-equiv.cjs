#!/usr/bin/env node
/* Golden-snapshot equivalence check for the index.html -> css/js split.
 *   node .claude/skills/neon-survivor/verify-equiv.cjs
 * Proves the split changed ZERO game logic: runs the ORIGINAL inline build (git HEAD:index.html)
 * and the NEW split build (js/core+world+sim+render+main.js) under the same stub DOM, with Math.random
 * seeded to a fixed value and an identical scripted input run. Math.random is the only
 * nondeterminism (performance.now is stubbed), so identical logic => identical state hash.
 * Exits 0 and prints MATCH if the two hashes are equal; non-zero + MISMATCH otherwise.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../../..');

// ---- Source A: frozen verbatim copy of the original inline <script> (pre-split working tree).
// git HEAD is NOT a valid baseline here: it predates this build (no boss projectiles), because
// index.html had uncommitted changes when it was split. baseline-original.js is that exact code. ----
const scriptA = fs.readFileSync(path.resolve(__dirname, 'baseline-original.js'), 'utf8');

// ---- Source B: new split build (core → audio-engine → world → sim → render → main, index.html load order) ----
// audio-engine.js defines the `Music` facade (core.js's old Music is now SynthMusic, the fallback).
// Audio never touches game state, so the snapshot hash must still match the pre-audio baseline.
// ui-engine.js is screen-space HUD (minimap) only — reads globals, never mutates sim state, so the hash still matches.
const scriptB = ['js/core.js', 'js/audio-engine.js', 'js/world.js', 'js/sim.js', 'js/render.js', 'js/ui-engine.js', 'js/main.js']
  .map(s => fs.readFileSync(path.resolve(ROOT, s), 'utf8')).join('\n;\n');

// ---- Stub DOM / canvas / audio (mirrors verify.cjs) ----
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

// Seeded run: mulberry32 prelude overrides Math.random; scripted input; snapshot after N frames.
const PRELUDE = `
(function(){ var __s = 0x9e3779b9 >>> 0;
  Math.random = function(){ __s |= 0; __s = (__s + 0x6D2B79F5) | 0;
    var t = Math.imul(__s ^ (__s >>> 15), 1 | __s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();
`;
const DRIVER = `
;(function(){ try {
  startGame();
  Up.blaster = 0;                       // force a few weapon upgrades so all systems run
  applyUpgrade('missile'); applyUpgrade('shield'); applyUpgrade('chain'); applyUpgrade('multi');
  nextBoss = 8;                         // force a boss mid-run
  for (var f = 0; f < 900; f++) {
    // deterministic scripted input: weave the ship around so collisions/pickups vary
    var phase = f % 240;
    keys['w'] = phase < 120; keys['s'] = phase >= 120 && phase < 180;
    keys['d'] = phase % 80 < 40;        keys['a'] = phase % 80 >= 40;
    globalThis.__t = (globalThis.__t || 0) + 16;
    loop(globalThis.__t);
    if (state === 'levelup') { state = 'play'; }   // auto-dismiss level-up so sim keeps running
  }
  var r4 = function(n){ return Math.round(n * 10000) / 10000; };
  var sumXY = function(arr){ var sx=0, sy=0; for (var i=0;i<arr.length;i++){ sx+=arr[i].x||0; sy+=arr[i].y||0; } return [r4(sx), r4(sy)]; };
  var p = player;
  globalThis.__SNAP = JSON.stringify({
    score:score, wave:wave, kills:kills, frame:frame, state:state,
    p:{ x:r4(p.x), y:r4(p.y), hp:r4(p.hp), maxhp:p.maxhp, level:p.level, xp:r4(p.xp), next:p.next,
        dmg:r4(p.dmg), rate:r4(p.rate), multi:p.multi, pierce:p.pierce, bulletSpd:r4(p.bulletSpd),
        magnet:r4(p.magnet), speed:r4(p.speed), missile:p.missile, shield:p.shield, chain:p.chain },
    counts:{ enemies:enemies.length, bullets:bullets.length, orbs:orbs.length, missiles:missiles.length,
             ebullets:ebullets.length, particles:particles.length, items:items.length, bolts:bolts.length, floats:floats.length },
    sums:{ enemies:sumXY(enemies), bullets:sumXY(bullets), orbs:sumXY(orbs), ebullets:sumXY(ebullets) }
  });
} catch (e) { globalThis.__ERR = (e && e.message) + '\\n' + ((e && e.stack)||'').split('\\n').slice(0,6).join('\\n'); } })();
`;

function run(label, body) {
  const sb = makeSandbox();
  vm.createContext(sb);
  try { vm.runInContext(PRELUDE + body + DRIVER, sb, { filename: label }); }
  catch (e) { console.error(label + ' LOAD ERROR: ' + e.message); process.exit(1); }
  if (sb.__ERR) { console.error(label + ' RUNTIME ERROR:\n' + sb.__ERR); process.exit(1); }
  return sb.__SNAP;
}

const snapA = run('original(HEAD)', scriptA);
const snapB = run('split(engine+main)', scriptB);
const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const hA = hash(snapA), hB = hash(snapB);

console.log('original  ' + hA);
console.log('split     ' + hB);
if (snapA === snapB) { console.log('\nMATCH — 900 seeded frames produced byte-identical game state. Logic unchanged.'); process.exit(0); }
console.error('\nMISMATCH — the split altered game logic. Diff of snapshots:');
const a = JSON.parse(snapA), b = JSON.parse(snapB);
console.error('A:', JSON.stringify(a)); console.error('B:', JSON.stringify(b));
process.exit(1);
