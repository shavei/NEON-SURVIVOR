#!/usr/bin/env node
/* Headless verifier for the lobby networking (NEON SURVIVOR).
 *   node .claude/skills/neon-survivor/verify-net.cjs
 * Checks: (1) Lobby.* no-op safely when SB is absent (headless contract — keeps verify.cjs green),
 * (2) lerp converges monotonically to target with NO overshoot, (3) the smoothing is frame-rate
 * independent (60/144/240 Hz land identically), (4) stale peers are culled, (5) step() advances
 * peers toward their last received target. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]);
const script = srcs.map(s => fs.readFileSync(path.join(ROOT, s), 'utf8')).join('\n;\n');

const any = new Proxy(function () {}, { get(t, p) { if (p === 'width' || p === 'height') return 32; return any; }, apply() { return any; }, set() { return true; }, construct() { return any; } });
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), appendChild() {}, getContext: () => any, width: 0, height: 0, set innerHTML(v) {}, set textContent(v) {}, set onclick(v) {} });
const els = {};
const g = globalThis;
g.document = { body: el(), getElementById: id => els[id] || (els[id] = el()), querySelectorAll: () => [], createElement: () => ({ width: 0, height: 0, getContext: () => any, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), addEventListener() {} }), addEventListener() {} };
g.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
g.window = g; g.addEventListener = () => {}; g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {};
g.setInterval = () => 1; g.clearInterval = () => {}; g.setTimeout = () => 1; g.clearTimeout = () => {};
g.performance = { now: () => 0 }; g.devicePixelRatio = 1; g.innerWidth = 800; g.innerHeight = 600;
g.AudioContext = function () { return any; }; g.webkitAudioContext = g.AudioContext; g.matchMedia = () => ({ matches: false, addEventListener() {} });

try { eval(script + ';globalThis.Lobby=Lobby;'); }
catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
const Lobby = g.Lobby;

let fail = 0;
const ok = (c, m) => { if (!c) { console.error('  FAIL: ' + m); fail++; } };

// 1) headless contract: SB is absent here, so every entry point must no-op without throwing
ok(Lobby.join('room', { name: 'x' }) === false, 'join() returns false with no SB');
let threw = false; try { Lobby.setLocalState(1, 2); Lobby.leave(); Lobby.step(0.016); } catch (e) { threw = true; }
ok(!threw, 'setLocalState/leave/step are safe with no channel');

// 2) lerp converges monotonically, no overshoot
let cur = 0; const tgt = 100; let prev = -1, overshoot = false, monotonic = true;
for (let i = 0; i < 240; i++) { cur = Lobby._smooth(cur, tgt, 12, 1 / 60); if (cur > tgt + 1e-9) overshoot = true; if (cur < prev) monotonic = false; prev = cur; }
ok(!overshoot, 'lerp never overshoots target');
ok(monotonic, 'lerp is monotonic toward target');
ok(Math.abs(cur - tgt) < 0.01, 'lerp converges to target');

// 3) frame-rate independence: same elapsed time, different step counts → identical result
function settle(steps, dt) { let c = 0; for (let i = 0; i < steps; i++) c = Lobby._smooth(c, 100, 12, dt); return c; }
const at60 = settle(60, 1 / 60), at144 = settle(144, 1 / 144), at240 = settle(240, 1 / 240);
ok(Math.abs(at60 - at144) < 1e-6 && Math.abs(at60 - at240) < 1e-6, 'smoothing identical across 60/144/240 Hz (' + at60.toFixed(6) + ')');

// 4) stale-peer cull
const now = 100000;
const peers = { a: { lastSeen: now - 100 }, b: { lastSeen: now - 9000 } };
Lobby._cull(peers, now, 5000);
ok(peers.a && !peers.b, 'cull drops only the stale peer');

// 5) step() advances peers toward target and culls
Lobby.peers = { p: { x: 0, y: 0, tx: 100, ty: 50, lastSeen: Date.now() } };
Lobby.step(0.05, Date.now());
ok(Lobby.peers.p.x > 0 && Lobby.peers.p.x < 100, 'step() moves peer x toward target');
ok(Lobby.peers.p.y > 0 && Lobby.peers.p.y < 50, 'step() moves peer y toward target');

console.log(fail ? ('\nNET — ' + fail + ' FAILED') : '\nNET — ALL PASS');
process.exit(fail ? 1 : 0);
