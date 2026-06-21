#!/usr/bin/env node
/* Live lockstep gate check — exercises the loop-facing stepper (NetSync.stepShared) end to end.
 *   node .claude/skills/neon-survivor/verify-lockstep-live.cjs
 * Two machines (A owns p1, B owns p2), each driving its OWN avatar via stepShared() — which schedules
 * the local input INPUT_DELAY ticks ahead, gates the advance on every avatar's input being present, and
 * STALLS rather than forking when one is late. Inputs are exchanged through NetSync's ring each frame.
 * Asserts:
 *   1. Convergence: after N frames both machines are on the same tick and hash the same world.
 *   2. Stall safety: withhold B's inputs → A's tick FREEZES (it waits, never desyncs); deliver the
 *      backlog → A catches up and re-converges with B.
 * Exits 0 + PASS only if both hold.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../../..');
const SEED = 4242;
// Full index.html load order (matches the page exactly) — main.js references confirmUsername/showAuth from
// achievement-sync.js at load, so the bundle must match the page or it ReferenceErrors at boot.
const FILES = ['js/config.js', 'js/core.js', 'js/audio-engine.js', 'js/world.js', 'js/sim.js', 'js/render.js', 'js/ui-engine.js', 'js/net.js', 'js/network.js', 'js/multiplayer-combat.js', 'js/network-sync.js', 'js/achievements.js', 'js/achievement-sync.js', 'js/leaderboard-sync.js', 'js/leaderboard-engine.js', 'js/netdebug.js', 'js/main.js'];
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

const driver = (me, other) => `
;(function(){
  startGame(); seedRng(${SEED});
  Lobby.me='${me}'; Lobby.peers=Object.create(null); Lobby.peers['${other}'] = { x:1500, y:1500 };   // mutate the real const Lobby (network.js) — don't reassign
  NetSync.enterLockstep();                          // builds players[p1,p2] @ world centre, primes 0..DELAY
  for(var i=0;i<players.length;i++){players[i].hp=1e9;players[i].maxhp=1e9;}   // immortal: isolate lockstep mechanics from death/end path
  t0=0; now=0;
  globalThis.__mv=[0,0]; NetSync.localMoveVec=function(){return globalThis.__mv;};
  globalThis.__stepOnce=function(){ now=(NetSync._tick+1)*16; return NetSync.stepShared(); };
  globalThis.__drain=function(){ var p=NetSync._pending.slice(); NetSync._pending.length=0; return p; };
  globalThis.__deliver=function(id,packets){ if(packets&&packets.length) NetSync.recvInput({id:id,b:packets}); };
  globalThis.__tick=function(){ return NetSync._tick; };
  globalThis.__hash=function(){ return NetSync.worldHash(); };
  globalThis.__setmv=function(x,y){ globalThis.__mv=[x,y]; };
  globalThis.__enemies=function(){ return enemies.length; };
})();
`;

function machine(me, other, mathSeed) {
  const g = makeSandbox(); vm.createContext(g);
  try { vm.runInContext(prelude(mathSeed) + bundle + driver(me, other), g, { filename: 'machine-' + me }); }
  catch (e) { console.error('machine ' + me + ' LOAD ERROR: ' + (e && e.message) + '\n' + ((e && e.stack) || '').split('\n').slice(0, 6).join('\n')); process.exit(1); }
  return g;
}

const A = machine('p1', 'p2', '0x1111ABCD');
const B = machine('p2', 'p1', '0x2222BEEF');

// exchange the priming packets so both rings hold p1 AND p2 for ticks 0..DELAY
function exchange() { B.__deliver('p1', A.__drain()); A.__deliver('p2', B.__drain()); }
exchange();

const mvA = t => [t % 100 < 50 ? 1 : -1, t % 60 < 30 ? 1 : 0];
const mvB = t => [t % 80 < 40 ? -1 : 1, t % 40 < 20 ? -1 : 1];
const DELAY = 2;   // mirrors NetSync.INPUT_DELAY
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('  FAIL: ' + m); } else console.log('  ok: ' + m); };
// one render frame on a machine: run substeps until the gate stalls (mirrors the real while-loop, capped)
const stepFrame = (M, mv) => { M.__setmv(...mv(M.__tick())); let c = 0; while (c < 8 && M.__stepOnce()) c++; return c; };

// --- 1. convergence: step both each frame, exchange inputs each frame ---
console.log('convergence:');
for (let f = 0; f < 300; f++) { stepFrame(A, mvA); stepFrame(B, mvB); exchange(); }
ok(A.__tick() === B.__tick() && A.__tick() > 250, 'both machines advanced to the same tick (' + A.__tick() + ')');
ok(A.__hash() === B.__hash(), 'identical world hash on both machines (' + (A.__hash() >>> 0) + ')');
ok(A.__enemies() > 0, 'world is non-trivial (' + A.__enemies() + ' shared enemies)');

// --- 2. stall safety: cut ALL exchange. True lockstep is symmetric → BOTH stall (the world never forks),
//        each draining only its buffered window. Then deliver the backlog → both resume, still converged. ---
console.log('stall + recovery:');
const before = A.__tick();
for (let f = 0; f < 12; f++) { stepFrame(A, mvA); stepFrame(B, mvB); }   // no exchange: inputs accumulate in _pending
ok(A.__tick() === B.__tick(), 'both machines stayed on the same tick while starved (no fork)');
ok(A.__tick() - before <= DELAY + 1, 'the world STALLED on missing input (advanced only the buffered window, then froze)');
const frozen = A.__tick();
exchange();                                                            // deliver the whole backlog both ways
for (let f = 0; f < 60; f++) { stepFrame(A, mvA); stepFrame(B, mvB); exchange(); }
ok(A.__tick() > frozen + 10, 'both resumed advancing once the backlog arrived (' + frozen + ' → ' + A.__tick() + ')');
ok(A.__tick() === B.__tick() && A.__hash() === B.__hash(), 'world re-converged after the stall (same tick + same hash)');

if (fails) { console.error('\n' + fails + ' FAILED'); process.exit(1); }
console.log('\nPASS — live stepper holds lockstep: peers converge, a silent peer stalls the world (never forks), and it recovers on delivery.');
process.exit(0);
