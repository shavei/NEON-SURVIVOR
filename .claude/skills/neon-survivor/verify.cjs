#!/usr/bin/env node
/* Reusable headless verifier for index.html (NEON SURVIVOR).
 * Run after ANY edit instead of re-writing a throwaway harness:
 *   node .claude/skills/neon-survivor/verify.cjs
 * Does: (1) syntax check, (2) headless load (catches ReferenceErrors like out-of-scope vars),
 *       (3) starts a game, forces a boss, runs ~200 frames, kills the boss — exercises every system.
 * Exits non-zero on any failure. Optional arg: path to the html file.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.argv[2] || path.resolve(__dirname, '../../../index.html');
const ROOT = path.dirname(FILE);
const html = fs.readFileSync(FILE, 'utf8');
// Inline build = read the <script> body. Split build = concat external JS in <script defer src> order
// (engine.js before main.js). Concatenation reproduces the page's shared classic-script global scope.
const inline = html.match(/<script>([\s\S]*?)<\/script>/);
let script;
if (inline) {
  script = inline[1];
} else {
  const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]);
  if (!srcs.length) { console.error('NO SCRIPT FOUND in ' + FILE); process.exit(1); }
  script = srcs.map(s => fs.readFileSync(path.resolve(ROOT, s), 'utf8')).join('\n;\n');
}

// 1) syntax check
try { new vm.Script(script, { filename: 'index.html#script' }); }
catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }

// 2/3) headless run with a stub DOM/canvas/audio
const any = new Proxy(function () {}, {
  get(t, p) { if (p === Symbol.toPrimitive) return () => 0; if (p === 'toString' || p === 'valueOf') return () => ''; if (p === 'width' || p === 'height') return 32; return any; },
  apply() { return any; }, set() { return true; }, construct() { return any; }
});
const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => any });
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), appendChild() {}, set innerHTML(v) {}, set textContent(v) {}, set onclick(v) {} });
const els = {};
const gameEl = { getContext: () => any, style: {}, width: 0, height: 0, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
const g = globalThis;
g.document = { body: el(), getElementById: id => id === 'game' ? gameEl : (els[id] || (els[id] = el())), querySelectorAll: () => [], createElement: t => t === 'canvas' ? fakeCanvas() : el(), addEventListener() {} };
g.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
g.window = g; g.addEventListener = () => {}; g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {};
g.setInterval = () => 1; g.clearInterval = () => {}; g.setTimeout = () => 1; g.clearTimeout = () => {};
g.performance = { now: () => g.__t || 0 }; g.devicePixelRatio = 1; g.innerWidth = 800; g.innerHeight = 600;
g.AudioContext = function () { return any; }; g.webkitAudioContext = g.AudioContext;

const driver = `
;(function(){ try {
  startGame();
  if (typeof Up !== 'undefined') Up.blaster = 2;
  if (typeof nextBoss !== 'undefined') nextBoss = 0;     // force a boss
  __frames(220);
  var hadBoss = enemies.some(function(e){return e.boss;});
  var eb = (typeof ebullets!=='undefined') ? ebullets.length : 0;
  if (typeof showPause === 'function') { state='pause'; if(typeof needsDraw!=='undefined') needsDraw=true; showPause(); }
  state='play';
  var b = enemies.find(function(e){return e.boss;}); if (b) killEnemy(b, '#fff');
  __frames(5);
  globalThis.__R = 'PASS — bossSpawned='+hadBoss+' ebullets='+eb+' enemies='+enemies.length+' orbs='+orbs.length+' items='+items.length;
} catch (e) { globalThis.__R = 'RUNTIME ERROR: ' + (e && e.message) + '\\n' + ((e && e.stack)||'').split('\\n').slice(0,5).join('\\n'); globalThis.__FAIL = 1; } })();
function __frames(n){ for (var f=0; f<n; f++){ globalThis.__t = (globalThis.__t||0) + 16; loop(globalThis.__t); } }
`;
try { eval(script + driver); } catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
console.log(g.__R);
process.exit(g.__FAIL ? 1 : 0);
