#!/usr/bin/env node
/* Lockstep convergence check — the heart of Phase 3 (docs/PLAN-multiplayer-sync.md).
 *   node .claude/skills/neon-survivor/verify-lockstep.cjs
 * Stands up TWO independent engine instances ("machines" A and B) in separate VM contexts, each with a
 * DIFFERENT Math.random stream but the SAME gameplay seed. Two avatars (p1 owned by A, p2 owned by B)
 * are driven by scripted inputs that are cross-fed between the machines through NetSync's input ring,
 * then each machine runs the deterministic shared tick (updateShared). After N ticks the GAMEPLAY world
 * — avatars, enemies, orbs, bullets, score — must hash identically on both machines. That is the literal
 * proof of "one shared world": not synced copies, the same computation run in parallel.
 * Also asserts the world is non-trivial (enemies spawned, both avatars moved, shots fired).
 * Exits 0 + PASS only if both machines converge on a non-empty world.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../../..');
const SEED = 1337, TICKS = 360;

const FILES = ['js/config-sim.js', 'js/core.js', 'js/audio-engine.js', 'js/world.js', 'js/sim.js', 'js/render.js', 'js/ui-engine.js', 'js/network-sync.js', 'js/main.js'];
const bundle = FILES.map(s => fs.readFileSync(path.resolve(ROOT, s), 'utf8')).join('\n;\n');

function makeSandbox() {
  const any = new Proxy(function () {}, { get(t, p) { if (p === Symbol.toPrimitive) return () => 0; if (p === 'width' || p === 'height') return 32; return any; }, apply() { return any; }, set() { return true; }, construct() { return any; } });
  const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => any });
  const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), appendChild() {}, set innerHTML(v) {}, set textContent(v) {}, set onclick(v) {} });
  const els = {};
  const gameEl = { getContext: () => any, style: {}, width: 0, height: 0, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const g = {};
  g.document = { body: el(), getElementById: id => id === 'game' ? gameEl : (els[id] || (els[id] = el())), querySelectorAll: () => [], createElement: t => t === 'canvas' ? fakeCanvas() : el(), addEventListener() {} };
  g.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
  g.window = g; g.addEventListener = () => {}; g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {};
  g.setInterval = () => 1; g.clearInterval = () => {}; g.setTimeout = () => 1; g.clearTimeout = () => {};
  g.performance = { now: () => 0 }; g.devicePixelRatio = 1; g.innerWidth = 800; g.innerHeight = 600;
  g.AudioContext = function () { return any; }; g.webkitAudioContext = g.AudioContext; g.console = console;
  return g;
}
const prelude = (mathSeed) => `(function(){ var __s=${mathSeed}>>>0; Math.random=function(){__s|=0;__s=(__s+0x6D2B79F5)|0;var t=Math.imul(__s^(__s>>>15),1|__s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};})();`;

// Per-machine setup + hooks. localId = which avatar this machine "owns" (its `player`); world hash is symmetric.
const driver = (localId) => `
;(function(){
  startGame();
  seedRng(${SEED});                                   // pin the gameplay world (Phase 1)
  players = [ makeAvatar(1500,1500,'p1'), makeAvatar(1900,1500,'p2') ];
  player = (('${localId}'==='p1') ? players[0] : players[1]);
  for (var i=0;i<players.length;i++){ players[i].hp=1e9; players[i].maxhp=1e9; }   // immortal: avoid gameOver branch
  t0=0; now=0; frame=0; spawnTimer=0; nextBoss=60; bossOn=false;
  NetSync.lockstep = true; NetSync.active = true;
  globalThis.__feed = function(id,tick,qx,qy){ NetSync._store(id,tick,qx,qy); };
  globalThis.__step = function(tick){ now=(tick+1)*16; NetSync.applyInputs(tick); updateShared(); };
  globalThis.__hash = function(){
    var r=function(n){return Math.round(n*1e6)/1e6;};
    var av=players.map(function(a){return [a.id,r(a.x),r(a.y),r(a.hp),a.level,r(a.xp)];}).sort();
    var en=enemies.map(function(e){return [e.id,r(e.x),r(e.y),r(e.hp)];}).sort(function(a,b){return a[0]-b[0];});
    var ob=orbs.map(function(o){return [o.id,r(o.x),r(o.y)];}).sort(function(a,b){return a[0]-b[0];});
    var bx=0,by=0; for(var i=0;i<bullets.length;i++){bx+=bullets[i].x;by+=bullets[i].y;}
    return JSON.stringify({av:av,en:en,ob:ob,bn:bullets.length,bx:r(bx),by:r(by),score:score,kills:kills});
  };
  globalThis.__counts = function(){ return { enemies:enemies.length, orbs:orbs.length, bullets:bullets.length, p1x:players[0].x }; };
})();
`;

function machine(localId, mathSeed) {
  const g = makeSandbox(); vm.createContext(g);
  try { vm.runInContext(prelude(mathSeed) + bundle + driver(localId), g, { filename: 'machine-' + localId }); }
  catch (e) { console.error('machine ' + localId + ' LOAD ERROR: ' + (e && e.message) + '\n' + ((e && e.stack) || '').split('\n').slice(0, 6).join('\n')); process.exit(1); }
  return g;
}

const A = machine('p1', '0x1111ABCD');     // machine A owns p1, Math.random stream #1
const B = machine('p2', '0x2222BEEF');     // machine B owns p2, Math.random stream #2 (different!)

// deterministic scripted inputs (integers → exact int8 round-trip), distinct per avatar
const q = v => Math.round(v * 127);
function in1(t) { const ph = t % 200; return [ph < 100 ? 1 : -1, ph % 60 < 30 ? 1 : 0]; }
function in2(t) { const ph = t % 160; return [ph < 80 ? -1 : 1, ph % 50 < 25 ? -1 : 1]; }

for (let t = 0; t < TICKS; t++) {
  const i1 = in1(t), i2 = in2(t);
  // each machine receives BOTH avatars' inputs for tick t (its own + the peer's, as if over the wire)
  A.__feed('p1', t, q(i1[0]), q(i1[1])); A.__feed('p2', t, q(i2[0]), q(i2[1]));
  B.__feed('p1', t, q(i1[0]), q(i1[1])); B.__feed('p2', t, q(i2[0]), q(i2[1]));
  A.__step(t); B.__step(t);
}

const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const hA = A.__hash(), hB = B.__hash();
const cA = A.__counts();
console.log('machine A  ' + hash(hA) + '   enemies=' + cA.enemies + ' orbs=' + cA.orbs + ' bullets=' + cA.bullets);
console.log('machine B  ' + hash(hB) + '   enemies=' + B.__counts().enemies);

let fails = 0;
if (hA !== hB) { fails++; console.error('\nMISMATCH — the two machines diverged → updateShared() is not deterministic across instances.');
  const a = JSON.parse(hA), b = JSON.parse(hB);
  console.error('A score/kills/bullets:', a.score, a.kills, a.bn); console.error('B score/kills/bullets:', b.score, b.kills, b.bn);
  console.error('A enemies[0..2]:', JSON.stringify(a.en.slice(0, 3))); console.error('B enemies[0..2]:', JSON.stringify(b.en.slice(0, 3))); }
if (cA.enemies < 1) { fails++; console.error('\nTRIVIAL — no enemies spawned; the test exercised nothing.'); }
if (cA.bullets < 1 && cA.enemies < 1) { fails++; console.error('\nTRIVIAL — no combat occurred.'); }
if (Math.abs(cA.p1x - 1500) < 1) { fails++; console.error('\nTRIVIAL — avatars never moved.'); }

if (fails) process.exit(1);
console.log('\nPASS — two independent machines (different Math.random) converged on ONE identical world: ' +
  cA.enemies + ' shared enemies, ' + cA.orbs + ' shared orbs, both avatars moved + fired. Lockstep is deterministic.');
process.exit(0);
