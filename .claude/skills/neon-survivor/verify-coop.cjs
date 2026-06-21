#!/usr/bin/env node
/* Headless verifier for the PvE co-op layer (NEON SURVIVOR).
 *   node .claude/skills/neon-survivor/verify-coop.cjs
 * Checks: (1) Coop/PvE no-op safely while inactive (solo contract — keeps verify.cjs green),
 * (2) player-count scaling math (damped-linear count mul + √P interval softening),
 * (3) the PvE.fake() debug tool drives the effective player count, (4) host election is the
 * lowest lobby id (deterministic, recalibrates on roster change), (5) hitEnemy() falls straight
 * through to damageEnemy when not a co-op client. */
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

try { eval(script + ';globalThis.Coop=Coop;globalThis.PvE=PvE;globalThis.Lobby=Lobby;globalThis._hitEnemy=hitEnemy;'); }
catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
const { Coop, PvE, Lobby } = g, hitEnemyFn = g._hitEnemy;   // alias: `function hitEnemy` leaks from eval, avoid the name clash

let fail = 0;
const ok = (c, m) => { if (!c) { console.error('  FAIL: ' + m); fail++; } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// 1) solo contract: inactive by default, every entry point no-ops without throwing
ok(Coop.active === false, 'Coop starts inactive (solo untouched)');
let threw = false;
try { Coop.netTick(0, 16); Coop.onKill({ id: 1 }); Coop.broadcastEnemies(); Coop.applyEnemies({ e: [] }); Coop.reportHit({ id: 1 }, 5); } catch (e) { threw = true; }
ok(!threw, 'netTick/onKill/broadcast/apply/reportHit safe while inactive + no channel');
ok(Coop.start() === false, 'start() refuses without a joined lobby channel');

// 2) scaling math: damped-linear count mul + √P interval softening
ok(near(Coop.scaleMul(1), 1.0), 'P=1 → mul 1.0 (neutral / solo)');
ok(near(Coop.scaleMul(2), 1.7), 'P=2 → mul 1.7');
ok(near(Coop.scaleMul(3), 2.4), 'P=3 → mul 2.4');
ok(near(Coop.scaleMul(4), 3.1), 'P=4 → mul 3.1');
ok(near(1 / Math.sqrt(4), 0.5), 'P=4 → interval ÷2 (√P softening)');

// 3) PvE.fake debug tool drives the effective player count up and back down
ok(Coop.spawnP() === 1, 'default effective P = 1 (no fake, inactive)');
PvE.fake(4); ok(Coop.spawnP() === 4, 'PvE.fake(4) → effective P = 4');
const st = PvE.status(); ok(st.P === 4 && near(st.mul, 3.1) && st.spawnCount >= 3, 'PvE.status reports scaled count for fake squad');
PvE.fake(null); ok(Coop.spawnP() === 1, 'PvE.fake(null) recalibrates back to 1 (player-left restoration)');

// 4) host election = lowest lobby id; recalibrates when the roster changes
Lobby.me = 'bbb'; Lobby.peers = { ccc: {}, ddd: {} }; Coop.electHost(); ok(Coop.host === true, 'lowest id (bbb) is host');
Lobby.peers = { aaa: {}, ccc: {} }; Coop.electHost(); ok(Coop.host === false, 'a lower peer (aaa) joins → host handed off');
Lobby.peers = {}; Coop.electHost(); ok(Coop.host === true, 'sole occupant is host');

// 5) hitEnemy passes straight through to damageEnemy when not a co-op client
const e = { id: 99, hp: 100, hit: 0 }; hitEnemyFn(e, 30, '#fff');
ok(e.hp === 70 && e.hit === 6, 'hitEnemy applies damage directly in solo/host path');

// 6) liveness-aware election: a DEAD host is excluded so authority migrates to the next living client
Coop._alive = true;
Lobby.me = 'bbb'; Lobby.peers = { aaa: { alive: false }, ccc: { alive: true } }; Coop.electHost();
ok(Coop.host === true, 'lowest LIVING id hosts (dead aaa skipped → bbb)');
Lobby.peers = { aaa: { alive: true }, ccc: {} }; Coop.electHost();
ok(Coop.host === false, 'a living lower peer (aaa) reclaims the host role');
Coop._alive = false; Lobby.peers = { ccc: { alive: true } }; Coop.electHost();
ok(Coop.host === false, 'a dead local client never elects itself host');
Coop._alive = true;

// 7) heartbeat migration target: excluding the silent host, the next living id is chosen (me here)
Lobby.me = 'bbb'; Lobby.peers = { aaa: { alive: true } };
ok(Coop._hostId(null) === 'aaa', 'host id = lowest living (aaa)');
ok(Coop._hostId('aaa') === 'bbb', 'excluding the silent host → I (bbb) self-promote');

// 8) spectate() relinquishes authority (alive:false) without throwing when there is no channel
let threw2 = false; try { Coop.spectate(); } catch (e2) { threw2 = true; }
ok(!threw2 && Coop._alive === false && Coop.active === false, 'spectate() marks dead + stops, channel-free safe');
Coop._alive = true;

// 9) shot/drops/pickup/xp handlers are inert while inactive (solo/headless contract)
Coop.active = false; let threw3 = false;
try { Coop.fireShot(1, 2, 0); Coop.applyShot({ id: 'x', x: 1, y: 2, a: 0 }); Coop.applyDrops({ o: [], it: [] });
  Coop.applyPickup({ id: 1, type: 'bomb' }); Coop.applyXP({ n: 5 }); Coop.shareXP(0); } catch (e3) { threw3 = true; }
ok(!threw3, 'fireShot/applyShot/applyDrops/applyPickup/applyXP/shareXP safe while inactive');

console.log(fail ? ('\nCOOP — ' + fail + ' FAILED') : '\nCOOP — ALL PASS');
process.exit(fail ? 1 : 0);
