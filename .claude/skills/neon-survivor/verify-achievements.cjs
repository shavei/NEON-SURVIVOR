#!/usr/bin/env node
/* Headless verifier for the achievements system (NEON SURVIVOR).
 *   node .claude/skills/neon-survivor/verify-achievements.cjs
 * Checks: (1) catalog well-formed, (2) client (js/achievements.js) and server (api/verify.js)
 * catalogs are byte-identical, (3) threshold boundary table-tests (off-by-one guard),
 * (4) client.evaluate === server.evaluate over random stats, (5) server validateRun anti-spoof. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]);
const script = srcs.map(s => fs.readFileSync(path.join(ROOT, s), 'utf8')).join('\n;\n');

// minimal headless stub (same shape as verify.cjs) — enough to load every game script
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

try { eval(script + ';globalThis.Ach=Ach;'); }
catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
const server = require(path.join(ROOT, 'api/verify.js'));
const Ach = g.Ach;

let fail = 0;
const ok = (c, m) => { if (!c) { console.error('  FAIL: ' + m); fail++; } };
const rnd = n => Math.floor(Math.random() * n);
const norm = a => a.slice().sort().join(',');
const normCat = a => JSON.stringify(a.map(d => ({ id: d.id, metric: d.metric, threshold: d.threshold, difficulty: d.difficulty })));

// 1) catalog well-formed
const seen = new Set();
Ach.CATALOG.forEach(d => {
  ok(!seen.has(d.id), 'unique id ' + d.id); seen.add(d.id);
  ok(['kills', 'score', 'wave', 'level', 'bosses', 'runs'].includes(d.metric), 'valid metric ' + d.id);
  ok(Number.isInteger(d.threshold) && d.threshold >= 0, 'threshold>=0 ' + d.id);
  ok(d.difficulty === null || ['easy', 'normal', 'hard'].includes(d.difficulty), 'valid difficulty ' + d.id);
});

// 2) client/server catalog lockstep
ok(normCat(Ach.CATALOG) === normCat(server.CATALOG), 'client and server catalogs identical');

// 3) threshold boundary table-tests
const base = { kills: 0, score: 0, wave: 0, level: 0, bosses: 0, runs: 0, difficulty: 'normal' };
Ach.CATALOG.forEach(d => {
  const diff = d.difficulty || 'normal';
  const below = Object.assign({}, base, { difficulty: diff, [d.metric]: d.threshold - 1 });
  ok(Ach.evaluate(below).indexOf(d.id) < 0, d.id + ' NOT earned just below threshold');
  const at = Object.assign({}, base, { difficulty: diff, [d.metric]: d.threshold });
  ok(Ach.evaluate(at).indexOf(d.id) >= 0, d.id + ' earned AT threshold');
  if (d.difficulty) {
    const wrong = Object.assign({}, base, { difficulty: 'easy', [d.metric]: d.threshold });
    ok(Ach.evaluate(wrong).indexOf(d.id) < 0, d.id + ' NOT earned on wrong difficulty');
  }
});

// 4) client.evaluate === server.evaluate over random stats
for (let i = 0; i < 300; i++) {
  const s = { kills: rnd(600), score: rnd(60000), wave: rnd(25), level: rnd(30), bosses: rnd(12), runs: rnd(12), difficulty: ['easy', 'normal', 'hard'][i % 3] };
  ok(norm(Ach.evaluate(s)) === norm(server.evaluate(s)), 'client==server evaluate sample ' + i);
}

// 5) server validateRun anti-spoof
const now = Date.now();
const run = { started_at: new Date(now - 100000).toISOString(), difficulty: 'normal', verified: false };
ok(server.validateRun(run, { score: 1000, wave: 5, kills: 50, secs: 80, level: 5, difficulty: 'normal' }).ok, 'plausible run accepted');
ok(!server.validateRun(run, { score: 999999, wave: 5, kills: 5, secs: 10, level: 5, difficulty: 'normal' }).ok, 'spoofed score rejected');
ok(!server.validateRun(run, { score: 10, wave: 5, kills: 50, secs: 99999, level: 5, difficulty: 'normal' }).ok, 'impossible time rejected');
ok(!server.validateRun(run, { score: 10, wave: 5, kills: 50, secs: 80, level: 5, difficulty: 'hard' }).ok, 'difficulty mismatch rejected');
ok(!server.validateRun(run, { score: 10, wave: 20, kills: 2, secs: 80, level: 5, difficulty: 'normal' }).ok, 'wave/kill mismatch rejected');
ok(!server.validateRun(Object.assign({}, run, { verified: true }), { score: 10, wave: 1, kills: 0, secs: 1, level: 1, difficulty: 'normal' }).ok, 'already-verified rejected');
ok(!server.validateRun(null, { score: 10, wave: 1, kills: 0, secs: 1, level: 1, difficulty: 'normal' }).ok, 'unknown run rejected');

console.log(fail ? ('\nACHIEVEMENTS — ' + fail + ' FAILED') : '\nACHIEVEMENTS — ALL PASS (' + Ach.CATALOG.length + ' defs)');
process.exit(fail ? 1 : 0);
