#!/usr/bin/env node
/* NEON SURVIVOR — verify-censor.cjs : the "Filter Stress Test" for the cross-language Callsign Censorship
 * Engine (js/callsign-filter.js). Run after editing the filter or the auth gate it feeds:
 *   node .claude/skills/neon-survivor/verify-censor.cjs
 *
 * Proves — with NO DOM, NO Supabase, NO throwaway account — that normalizeCallsign() folds English and
 * Hebrew (and their transliterations / leet obfuscations) onto the SAME Standardized Comparison String, so
 * blocked() catches profanity however it's typed, while leaving legitimate callsigns alone. Also asserts
 * the file stays under the 28 KB silent-truncation line and that window.debugCensor is exposed.
 * Exits non-zero on any failure. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = path.resolve(__dirname, '../../../js/callsign-filter.js');
const src = fs.readFileSync(FILE, 'utf8');

try { new vm.Script(src, { filename: 'callsign-filter.js' }); }
catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }

// headless load: a bare global, no window/document — the file must guard those and still expose globals.
const ctx = { console }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(src, ctx);
const CF = ctx.CallsignFilter;
let fails = 0;
const bad = (m) => { console.error('  ✗ ' + m); fails++; };

if (!CF || typeof CF.blocked !== 'function') { console.error('CallsignFilter not exposed'); process.exit(1); }
if (typeof ctx.debugCensor !== 'function') bad('window/global debugCensor not exposed');

/* 1) BLOCKED — must be flagged. Each row also names the obfuscation/language it exercises. */
const BLOCK = [
  ['fuck', 'plain english'], ['F U C K', 'spaced'], ['sh1t', 'leet 1→i'], ['fu(k', 'paren→c'],
  ['ﬞfÜck', 'NFKD + diacritic'], ['nigger', 'run-collapse gg→g'],
  ['כוס', 'hebrew script'], ['kus', 'hebrew word, latin letters'], ['cos', 'alt transliteration'],
  ['בן זונה', 'hebrew, spaced'], ['ben zona', 'same word, latin'], ['benzona', 'no space'],
  ['שרמוטה', 'hebrew script'], ['sharmuta', 'transliterated'], ['חרא', 'hebrew'], ['chara', 'transliterated'],
  ['פאק', 'english slur in hebrew letters'], ['נאצ1', 'hebrew + leet'],
];
/* 2) ALLOWED — legitimate callsigns must pass clean (guards against over-blocking). */
const ALLOW = ['Neonblade', 'MaelstromX', 'cooldude', 'shavei', 'Phoenix', 'Hannah', 'Chen', 'Revenant', 'GridRunner', 'Zephyr'];
/* 3) CONVERGENCE — a word and its cross-language twin must produce an identical comparison string. */
const CONVERGE = [['kus', 'cos', 'hebrew'], ['ben zona', 'benzona', 'hebrew'], ['sharmuta', 'שרמוטה', 'hebrew'], ['chara', 'חרא', 'hebrew']];

console.log('— blocked (must flag) —');
for (const [t, why] of BLOCK) { const r = CF.inspect(t); if (!r.blocked) bad(JSON.stringify(t) + ' [' + why + '] NOT flagged (latin=' + JSON.stringify(r.normalized.latin) + ' heb=' + JSON.stringify(r.normalized.hebrew) + ')'); }
console.log('— allowed (must pass) —');
for (const t of ALLOW) { const r = CF.inspect(t); if (r.blocked) bad(JSON.stringify(t) + ' wrongly flagged (hit=' + JSON.stringify(r.hit) + ')'); }
console.log('— convergence (twins share a form) —');
for (const [a, b, lang] of CONVERGE) { const x = CF.normalize(a)[lang], y = CF.normalize(b)[lang]; if (x !== y) bad(JSON.stringify(a) + ' vs ' + JSON.stringify(b) + ' diverge: ' + JSON.stringify(x) + ' ≠ ' + JSON.stringify(y)); }

/* debugCensor must return an audit object (the documented stress-test entry point). */
const dc = ctx.debugCensor('בן זונה');
if (!dc || dc.blocked !== true || dc.lang !== 'he') bad('debugCensor("בן זונה") did not report a blocked he hit');

const bytes = Buffer.byteLength(src, 'utf8');
if (bytes >= 28 * 1024) bad('file is ' + bytes + ' B — over the 28 KB truncation line');

if (fails) { console.error('\nFILTER STRESS TEST FAILED — ' + fails + ' issue(s).'); process.exit(1); }
console.log('\n✓ FILTER STRESS TEST PASSED — ' + BLOCK.length + ' blocked, ' + ALLOW.length + ' allowed, ' + CONVERGE.length + ' converged, ' + bytes + ' B, stats=' + JSON.stringify(CF._stats()));
