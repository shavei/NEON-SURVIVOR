#!/usr/bin/env node
/* NEON SURVIVOR — verify-gauntlet.cjs : the "Censorship Gauntlet" for the HARDENED callsign filter
 * (js/callsign-filter.js). Run after hardening the filter or its auth gate:
 *   node .claude/skills/neon-survivor/verify-gauntlet.cjs
 *
 * Drives the same code path registration uses — CallsignFilter.blocked(name) — against every documented
 * bypass class (leetspeak, dotted/spaced noise, Unicode homoglyphs, cross-script phonetics) and asserts a
 * 100% rejection rate on the attack set while every legitimate callsign passes clean. NO DOM, NO Supabase,
 * NO throwaway account. Exits non-zero on the first leak or false-positive.
 *
 * Browser-console equivalent (paste in the live game with the filter loaded):
 *   ['S3X','F.U.C.K','fυck','ѕех','כוס','kus','benzona','בן זונה','פאק']
 *     .forEach(n => console.log((CallsignFilter.blocked(n) ? '⛔' : '✅') + ' ' + n)); */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = path.resolve(__dirname, '../../../js/callsign-filter.js');
const src = fs.readFileSync(FILE, 'utf8');

try { new vm.Script(src, { filename: 'callsign-filter.js' }); }
catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
const ctx = { console }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
const CF = ctx.CallsignFilter;
if (!CF || typeof CF.blocked !== 'function') { console.error('CallsignFilter not exposed'); process.exit(1); }

let fails = 0; const bad = (m) => { console.error('  ✗ ' + m); fails++; };

/* REGISTRATION ATTEMPTS that MUST be rejected — grouped by the bypass each one exercises. */
const GAUNTLET = [
  // ── leetspeak ──
  ['S3X', 'leet 3→e'], ['sh1t', 'leet 1→i'], ['fu(k', 'leet (→c'], ['n4z1', 'leet 4→a 1→i'], ['b!tch', 'leet !→i'],
  // ── dotted / spaced "B.A.D.W.O.R.D" noise ──
  ['F.U.C.K', 'dotted hard ban'], ['S-H-I-T', 'dashed hard ban'], ['b i t c h', 'spaced hard ban'], ['p.u.s.s.y', 'dotted'],
  // ── Unicode homoglyphs (Cyrillic / Greek look-alikes) ──
  ['fυck', 'greek upsilon υ→u'], ['ѕех', 'cyrillic ѕ/е/х → sex'], ['ρuѕѕy', 'greek ρ + cyrillic ѕ → pussy'], ['ѕhіt', 'cyrillic ѕ/і → shit'],
  // ── Hebrew script (native profanity) ──
  ['כוס', 'hebrew'], ['שרמוטה', 'hebrew'], ['בן זונה', 'hebrew, spaced'], ['חרא', 'hebrew'],
  // ── Hebrew profanity written in Latin (heInEn phonetics) ──
  ['kus', 'hebrew→latin'], ['cos', 'alt transliteration'], ['benzona', 'hebrew→latin'], ['sharmuta', 'hebrew→latin'], ['chara', 'hebrew→latin'],
  // ── English slurs written in Hebrew letters (enInHe phonetics) ──
  ['פאק', 'fuck in hebrew letters'], ['שיט', 'shit in hebrew letters'], ['נאצ1', 'nazi, hebrew + leet'],
];
/* LEGITIMATE callsigns that MUST pass (guards the hardening against over-blocking / Scunthorpe). */
const CLEAN = ['Neonblade', 'MaelstromX', 'cooldude', 'shavei', 'Phoenix', 'Hannah', 'Chen', 'Revenant',
  'GridRunner', 'Zephyr', 'documentary', 'Essex', 'Scunthorpe', 'analytics', 'Saxon', 'therapy'];

console.log('— gauntlet (every attempt MUST be rejected) —');
for (const [name, why] of GAUNTLET) {
  const r = CF.inspect(name);
  if (!r.blocked) bad('LEAK: ' + JSON.stringify(name) + ' [' + why + '] was ACCEPTED (latin=' + JSON.stringify(r.normalized.latin) + ' heb=' + JSON.stringify(r.normalized.hebrew) + ')');
}
console.log('— clean callsigns (must register) —');
for (const name of CLEAN) {
  const r = CF.inspect(name);
  if (r.blocked) bad('FALSE POSITIVE: ' + JSON.stringify(name) + ' rejected (hit=' + JSON.stringify(r.hit) + ' tier=' + r.tier + ')');
}

const rate = ((GAUNTLET.length - 0) / GAUNTLET.length * 100);
if (fails) { console.error('\nCENSORSHIP GAUNTLET FAILED — ' + fails + ' issue(s); rejection rate < 100%.'); process.exit(1); }
console.log('\n✓ CENSORSHIP GAUNTLET PASSED — ' + GAUNTLET.length + '/' + GAUNTLET.length + ' attacks rejected (100%), '
  + CLEAN.length + ' clean callsigns admitted. stats=' + JSON.stringify(CF._stats()));
