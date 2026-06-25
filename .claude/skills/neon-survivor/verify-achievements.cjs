#!/usr/bin/env node
/* Headless verifier for the achievements system (NEON SURVIVOR).
 *   node .claude/skills/neon-survivor/verify-achievements.cjs
 * Checks: (1) catalog well-formed (conds schema), (2) client (js/achievements.js) and server
 * (api/verify.js) catalogs share a byte-identical {id,conds,difficulty} projection, (3) per-cond
 * boundary table-tests across >=/<=/== (off-by-one guard), (4) client.evaluate === server.evaluate
 * over random stats, (5) server validateRun anti-spoof, (6) intent-field clamps + gold→cosmetic map. */
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

try { eval(script + ';globalThis.Ach=Ach;globalThis.COSMETIC_MAP=COSMETIC_MAP;globalThis.COSMETICS=COSMETICS;'); }
catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
const server = require(path.join(ROOT, 'api/verify.js'));
const Ach = g.Ach;

let fail = 0;
const ok = (c, m) => { if (!c) { console.error('  FAIL: ' + m); fail++; } };
const rnd = n => Math.floor(Math.random() * n);
const norm = a => a.slice().sort().join(',');
const METRICS = ['kills','score','wave','level','bosses','runs','secs','noHitWave','starterWave','soloWave',
  'asceticWave','glassWave','flawlessBoss','peakWeapons','bossKillSecs','cameback','unlockedPct'];
// lockstep projection: only id/conds/difficulty are cross-checked (cat/tier/ico/etc. are client-only UI meta)
const normCat = a => JSON.stringify(a.map(d => ({ id: d.id, conds: d.conds, difficulty: d.difficulty })));
const condOp = c => (c.length === 2 ? '>=' : c[1]);
const condVal = c => (c.length === 2 ? c[1] : c[2]);

// 1) catalog well-formed (conds schema)
const seen = new Set();
Ach.CATALOG.forEach(d => {
  ok(!seen.has(d.id), 'unique id ' + d.id); seen.add(d.id);
  ok(Array.isArray(d.conds) && d.conds.length >= 1, 'has conds ' + d.id);
  (d.conds || []).forEach(c => {
    ok(METRICS.includes(c[0]), 'valid metric ' + c[0] + ' in ' + d.id);
    ok(['>=', '<=', '=='].includes(condOp(c)), 'valid op in ' + d.id);
    ok(Number.isInteger(condVal(c)), 'integer value in ' + d.id);
  });
  ok(d.difficulty === null || ['easy', 'normal', 'hard'].includes(d.difficulty), 'valid difficulty ' + d.id);
});

// 2) client/server catalog lockstep
ok(normCat(Ach.CATALOG) === normCat(server.CATALOG), 'client and server catalogs identical');

// 3) per-cond boundary table-tests (off-by-one across >= / <= / ==). bagFor builds a stats object that
//    satisfies every cond exactly; mutateFirst nudges the FIRST cond just past its boundary so it fails.
const base = {}; METRICS.forEach(m => base[m] = 0);
const bagFor = (d, mutateFirst) => {
  const bag = Object.assign({}, base, { difficulty: d.difficulty || 'normal' });
  d.conds.forEach((c, idx) => {
    const op = condOp(c), v = condVal(c);
    bag[c[0]] = (mutateFirst && idx === 0) ? (op === '>=' ? v - 1 : v + 1) : v;   // '<='/'==' fail by +1
  });
  return bag;
};
Ach.CATALOG.forEach(d => {
  ok(Ach.evaluate(bagFor(d, false)).indexOf(d.id) >= 0, d.id + ' earned when all conds met');
  ok(Ach.evaluate(bagFor(d, true)).indexOf(d.id) < 0, d.id + ' NOT earned when first cond just fails');
  if (d.difficulty) {
    const wrong = bagFor(d, false); wrong.difficulty = 'easy';
    ok(Ach.evaluate(wrong).indexOf(d.id) < 0, d.id + ' NOT earned on wrong difficulty');
  }
});

// 4) client.evaluate === server.evaluate over random stats (every metric, incl. intent + inverted)
for (let i = 0; i < 400; i++) {
  const s = { difficulty: ['easy', 'normal', 'hard'][i % 3] };
  s.kills = rnd(1400); s.score = rnd(110000); s.wave = rnd(32); s.level = rnd(30); s.bosses = rnd(60);
  s.runs = rnd(12); s.secs = rnd(420); s.noHitWave = rnd(25); s.starterWave = rnd(25); s.soloWave = rnd(12);
  s.asceticWave = rnd(15); s.glassWave = rnd(16); s.flawlessBoss = rnd(3); s.peakWeapons = rnd(4);
  s.bossKillSecs = rnd(9999); s.cameback = rnd(2); s.unlockedPct = rnd(101);
  ok(norm(Ach.evaluate(s)) === norm(server.evaluate(s)), 'client==server evaluate sample ' + i);
}

// 4b) server sanitizeIntent clamps forged intent fields to plausible bounds (cosmetic-only trust)
const sc = { score: 0, wave: 12, secs: 400, kills: 10, level: 5, bosses: 1, runs: 1, difficulty: 'normal' };
server.sanitizeIntent(sc, { noHitWave: 99, flawlessBoss: 9, peakWeapons: 9, bossKillSecs: 3, cameback: 1 });
ok(sc.noHitWave === 12, 'noHitWave clamped to wave reached');
ok(sc.flawlessBoss === 1, 'flawlessBoss clamped to bosses felled');
ok(sc.peakWeapons === 3, 'peakWeapons clamped to min(3, level-1)');
ok(sc.bossKillSecs === 3, 'bossKillSecs kept (a boss was killed)');
const noBoss = Object.assign({}, sc, { bosses: 0 });
server.sanitizeIntent(noBoss, { bossKillSecs: 3, flawlessBoss: 2 });
ok(noBoss.bossKillSecs === 9999 && noBoss.flawlessBoss === 0, 'no boss → no fast/flawless kill');

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

// 6) tier/chain integrity + gold→cosmetic mapping (client COSMETIC_MAP === server COSMETIC_MAP, all gold)
const C = g.COSMETIC_MAP, COS = g.COSMETICS;
ok(JSON.stringify(C) === JSON.stringify(server.COSMETIC_MAP), 'client and server COSMETIC_MAP identical');
const byId = Object.fromEntries(Ach.CATALOG.map(d => [d.id, d]));
Object.keys(C).forEach(id => {
  ok(!!byId[id], 'cosmetic source achievement exists: ' + id);
  ok(byId[id] && byId[id].tier === 'gold', 'cosmetic source is a GOLD tier: ' + id);
  ok(COS.some(c => c.id === C[id]), 'cosmetic def exists for ' + C[id]);
});
COS.forEach(c => {
  ok(['skin', 'trail'].includes(c.kind), 'valid cosmetic kind ' + c.id);
  ok(C[c.from] === c.id, 'cosmetic ' + c.id + ' maps back from gold ' + c.from);
});
ok(norm(server.cosmeticsFor(['annihilator', 'first_blood'])) === 'crimson_husk', 'cosmeticsFor returns only mapped gold rewards');
// every chain has exactly one gold cap
const golds = {}; Ach.CATALOG.forEach(d => { if (d.chain && d.tier === 'gold') golds[d.chain] = (golds[d.chain] || 0) + 1; });
Object.keys(golds).forEach(ch => ok(golds[ch] === 1, 'chain ' + ch + ' has one gold cap'));

console.log(fail ? ('\nACHIEVEMENTS — ' + fail + ' FAILED') : '\nACHIEVEMENTS — ALL PASS (' + Ach.CATALOG.length + ' defs · ' + COS.length + ' cosmetics)');
process.exit(fail ? 1 : 0);
