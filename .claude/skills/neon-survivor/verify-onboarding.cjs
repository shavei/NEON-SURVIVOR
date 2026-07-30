#!/usr/bin/env node
/* NEON SURVIVOR — verify-onboarding.cjs : headless verifier for the FIRST-RUN experience.
 * Run after editing js/onboarding.js / js/auth-uplink.js's onAuth* hooks / the #tip + #saveprompt markup:
 *   node .claude/skills/neon-survivor/verify-onboarding.cjs
 *
 * The rule under test: PLAY FIRST, ask later. A brand-new player must reach the menu without meeting the
 * GRID ACCESS modal, and the account ask must move to the death screen. Drives, against a stub DOM:
 *   A) NEW PLAYER      — onAuthRequired() with no 'neon_acct' marker leaves #username hidden and #start up.
 *   B) KNOWN ACCOUNT   — the same call WITH the marker still shows the login modal (a lapsed session is
 *                        worth re-authing; that player's runs belong on the board).
 *   C) OFFLINE         — onAuthOffline() routes to the menu too, instead of demanding a name up front.
 *   D) GUEST IS LOCAL  — with no neon_player, Ach.openToken() no-ops, so a guest run never reaches the cloud.
 *   E) SIGN-IN ROUTE   — #signinbtn is the only way back to GRID ACCESS once the wall is optional, so it
 *                        must be visible while signed out and hidden once signed in.
 *   F) COACHING TIPS   — fire on the SIM clock, in order, first run only, and auto-hide.
 *   G) DEATH-SCREEN ASK— shown to a signed-out online player, withheld from a signed-in one.
 *   H) GUEST ADOPTION  — adoptGuest() folds the guest 'neon_ach:local' mirror into the account's mirror, so
 *                        signing up after a strong first run never costs the unlocks it earned.
 *   I) WIRING          — main.js actually calls the hooks (a passing module nobody invokes is still broken).
 * Exits non-zero on any failure. Optional arg: path to the html file.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.argv[2] || path.resolve(__dirname, '../../../index.html');
const ROOT = path.dirname(FILE);
const html = fs.readFileSync(FILE, 'utf8');

const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]).filter(s => !/^(https?:)?\/\//.test(s) && !s.startsWith('/'));
if (!srcs.length) { console.error('NO SCRIPT FOUND in ' + FILE); process.exit(1); }
const script = srcs.map(s => fs.readFileSync(path.resolve(ROOT, s), 'utf8')).join('\n;\n');
const mainSrc = fs.readFileSync(path.resolve(ROOT, 'js/main.js'), 'utf8');

try { new vm.Script(script, { filename: 'index.html#script' }); }
catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }

// ---- stub DOM/storage — records innerHTML + hidden so the tip/prompt surfaces can be asserted ----
const any = new Proxy(function () {}, { get(t, p) { if (p === Symbol.toPrimitive) return () => 0; if (p === 'toString' || p === 'valueOf') return () => ''; return any; }, apply() { return any; }, set() { return true; }, construct() { return any; } });
const mkEl = () => { const e = {
  value: '', _text: '', _html: '', hidden: false, _cls: new Set(),
  style: { setProperty() {}, removeProperty() {}, display: '' },
  classList: { add: c => e._cls.add(c), remove: c => e._cls.delete(c), toggle: (c, on) => { if (on === undefined) { e._cls.has(c) ? e._cls.delete(c) : e._cls.add(c); } else if (on) e._cls.add(c); else e._cls.delete(c); }, contains: c => e._cls.has(c) },
  addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {},
  focus() {}, blur() {}, click() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  querySelector: () => mkEl(), querySelectorAll: () => [],
  set textContent(v) { e._text = v; }, get textContent() { return e._text; },
  set innerHTML(v) { e._html = String(v); }, get innerHTML() { return e._html; },
  set onclick(v) {}, set onkeydown(v) {} }; return e; };
const els = {};
const gameEl = { getContext: () => any, style: {}, width: 0, height: 0, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
const g = globalThis;
g.document = { head: mkEl(), body: mkEl(), documentElement: {}, getElementById: id => id === 'game' ? gameEl : (els[id] || (els[id] = mkEl())), querySelector: () => mkEl(), querySelectorAll: () => [], createElement: t => t === 'canvas' ? { width: 0, height: 0, getContext: () => any } : mkEl(), addEventListener() {} };
g.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
g.window = g; g.addEventListener = () => {}; g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {};
g.performance = { now: () => 0 }; g.devicePixelRatio = 1; g.innerWidth = 800; g.innerHeight = 600;
g.AudioContext = function () { return any; }; g.webkitAudioContext = g.AudioContext;
g.crypto = { randomUUID: () => 'local-' + Math.random().toString(16).slice(2) };
g.fetch = () => Promise.reject(new Error('offline'));
// deterministic device language (an 'he' host would otherwise flip I18N and translate the asserted copy)
try { Object.defineProperty(g, 'navigator', { value: { onLine: true, language: 'en-US', languages: ['en-US'] }, configurable: true, writable: true }); } catch (e) {}

const driver = `
;(function(){
  var fails = [], $ = function(id){ return document.getElementById(id); };
  var ok = function(c, m){ if (!c) fails.push(m); };
  var LS = localStorage;
  var modalUp   = function(){ return !$('username')._cls.has('hidden'); };
  var menuUp    = function(){ return !$('start')._cls.has('hidden'); };
  var resetUI   = function(){ $('username')._cls.add('hidden'); $('start')._cls.add('hidden'); };
  if (typeof Ach !== 'undefined') { Ach.renderPanel = function(){}; }
  if (typeof LBSync !== 'undefined') { LBSync.syncAll = function(){}; }
  SB = { auth:{}, from:function(){ return { select:function(){return this}, eq:function(){return this} }; } };  // "connected" → _netOnline() true

  // ---- A) a brand-new player is NOT walled ----
  LS._d = {}; resetUI();
  onAuthRequired();
  ok(!modalUp() && menuUp(), 'A NEW PLAYER: expected the menu, got modal=' + modalUp() + ' menu=' + menuUp());

  // ---- B) a browser that has signed in before still gets the login modal ----
  LS._d = {}; LS.setItem('neon_acct', '1'); resetUI();
  onAuthRequired();
  ok(modalUp(), 'B KNOWN ACCOUNT: a lapsed session should still show GRID ACCESS');
  ok(_stage === 'login', 'B KNOWN ACCOUNT: expected _stage=login, got ' + _stage);

  // ---- C) offline first launch also lands on the menu (no name demanded up front) ----
  LS._d = {}; resetUI();
  onAuthOffline();
  ok(!modalUp() && menuUp(), 'C OFFLINE: expected the menu, got modal=' + modalUp() + ' menu=' + menuUp());

  // ---- D) a guest run opens no run token, so nothing reaches the cloud ----
  LS._d = {};
  Ach._token = null; Ach._tokenPending = false;
  Ach.openToken();
  ok(Ach._token === null && Ach._tokenPending === false,
     'D GUEST IS LOCAL: openToken must no-op without a player, got token=' + Ach._token + ' pending=' + Ach._tokenPending);

  // ---- E) the sign-in route is visible exactly while signed out ----
  _setSignedIn(false);
  ok($('signinbtn').hidden === false, 'E SIGN-IN ROUTE: #signinbtn must show while signed out');
  _setSignedIn(true);
  ok($('signinbtn').hidden === true, 'E SIGN-IN ROUTE: #signinbtn must hide once signed in');
  ok(LS.getItem('neon_acct') === '1', 'E SIGN-IN ROUTE: a successful sign-in must mark the browser account-owning');
  _setSignedIn(false);

  // ---- F) coaching tips: sim-clock ordered, first run only, auto-hiding ----
  LS._d = {};
  var shown = function(){ return $('tip')._cls.has('show'); };
  var body  = function(){ return $('tip').innerHTML; };
  Onboard.onRunStart();
  Onboard.tick(0.5);  ok(!shown(), 'F TIPS: nothing before the first cue');
  Onboard.tick(2.0);  ok(shown() && /fires by itself|\\u05d9\\u05d5\\u05e8\\u05d4/.test(body()), 'F TIPS: tip 1 at t=2, got ' + JSON.stringify(body()));
  ok(/WASD/.test(body()), 'F TIPS: desktop movement hint should name WASD, got ' + JSON.stringify(body()));
  Onboard.tick(9.5);  ok(!shown(), 'F TIPS: tip 1 should auto-hide ~7s later');
  Onboard.tick(11.0); ok(shown() && /gold orbs/.test(body()), 'F TIPS: tip 2 at t=11, got ' + JSON.stringify(body()));
  Onboard.tick(24.0); ok(/upgrade cards/.test(body()), 'F TIPS: tip 3 at t=24, got ' + JSON.stringify(body()));
  var afterLast = body();
  Onboard.tick(90.0); Onboard.tick(120.0);
  ok(body() === afterLast, 'F TIPS: must stop after the last tip, got ' + JSON.stringify(body()));
  // …and never again on a later run
  Onboard.onGameOver();
  ok(LS.getItem('neon_seen') === '1', 'F TIPS: finishing a run must mark the player as seen');
  Onboard.onRunStart(); Onboard.tick(2.0); Onboard.tick(11.0);
  ok(!shown(), 'F TIPS: second run must be silent');

  // ---- G) the account ask lands on the death screen, for guests only ----
  LS._d = {}; _setSignedIn(false);
  Onboard.onGameOver();
  ok($('saveprompt').hidden === false, 'G ASK: a signed-out online player should be offered an account');
  ok(/leaderboard/.test($('saveprompt').innerHTML), 'G ASK: the prompt should say what an account buys, got ' + JSON.stringify($('saveprompt').innerHTML));
  _setSignedIn(true);
  Onboard.onGameOver();
  ok($('saveprompt').hidden === true, 'G ASK: a signed-in player must not be nagged');
  _setSignedIn(false);

  // ---- H) guest unlocks survive the upgrade to an account ----
  LS._d = {};
  LS.setItem('neon_ach:local', JSON.stringify({ unlocked:['first_blood','wave_5'], cosmetics:['skin_ghost'], tracks:['t1'],
                                                life:{ kills: 120, runs: 3, bestScore: 4400 } }));
  savePlayer('Rookie', 'auth-uid-1');                       // what _adopt() does right before adoptGuest()
  LS.setItem('neon_ach:auth-uid-1', JSON.stringify({ unlocked:['wave_5','boss_1'], cosmetics:[], tracks:[],
                                                     life:{ kills: 40, runs: 9, bestScore: 100 } }));
  Onboard.adoptGuest();
  var m = JSON.parse(LS.getItem('neon_ach:auth-uid-1'));
  ok(['first_blood','wave_5','boss_1'].every(function(id){ return m.unlocked.indexOf(id) >= 0; }),
     'H ADOPTION: unlocked must be a union, got ' + JSON.stringify(m.unlocked));
  ok(m.unlocked.filter(function(x){ return x === 'wave_5'; }).length === 1, 'H ADOPTION: no duplicates, got ' + JSON.stringify(m.unlocked));
  ok(m.cosmetics.indexOf('skin_ghost') >= 0 && m.tracks.indexOf('t1') >= 0, 'H ADOPTION: cosmetics/tracks must carry over');
  ok(m.life.kills === 120 && m.life.runs === 9 && m.life.bestScore === 4400,
     'H ADOPTION: lifetime stats must take the max of each, got ' + JSON.stringify(m.life));
  ok(LS.getItem('neon_ach:local') === null, 'H ADOPTION: the guest mirror must be consumed, not left to merge twice');

  // ---- I) main.js actually calls the hooks ----
  var M = globalThis.__MAIN_SRC;
  [['Onboard.onRunStart()','startGame'],['Onboard.onGameOver()','gameOver'],['Onboard.tick(','updateHUD']]
    .forEach(function(p){ ok(M.indexOf(p[0]) >= 0, 'I WIRING: main.js ' + p[1] + ' must call ' + p[0]); });

  globalThis.__FAIL = fails.length ? 1 : 0;
  console.log(fails.length ? 'FAIL — ' + fails.join('\\n       | ')
    : 'PASS — new player reaches the menu unwalled (online + offline); a known account still re-auths; '
      + 'guest runs stay local (no run token); #signinbtn tracks sign-in state; 3 coaching tips fire on the '
      + 'sim clock, first run only; the account ask sits on the death screen for guests; guest unlocks survive '
      + 'adoption; main.js wires all three hooks');
  process.exit(globalThis.__FAIL);
})();
`;
g.__MAIN_SRC = mainSrc;
try { eval(script + driver); } catch (e) { console.error('LOAD ERROR:', e.message, '\n', (e.stack || '').split('\n').slice(0, 6).join('\n')); process.exit(1); }
