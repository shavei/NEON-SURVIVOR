#!/usr/bin/env node
/* Upgrade state-sweep regression test for NEON SURVIVOR.
 *   node .claude/skills/neon-survivor/verify-upgrades.cjs
 * For EVERY id in UPGRADES[], snapshots player, calls applyUpgrade(id) on a fresh run, and asserts
 *   (a) the expected field(s) changed by the expected delta, and
 *   (b) NO other player stat changed (an upgrade must not leak into unrelated fields).
 * This permanently locks the Vitality-class bug shut (maxhp += 30 & hp += 30) and proves the rest.
 * Exits non-zero on any mismatch, or if UPGRADES contains an id with no expectation (new upgrade, no test).
 * Optional arg: path to the html file. Mirrors verify.cjs's headless DOM/canvas/audio stub.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.argv[2] || path.resolve(__dirname, '../../../index.html');
const ROOT = path.dirname(FILE);
const html = fs.readFileSync(FILE, 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>/);
let script;
if (inline) { script = inline[1]; }
else {
  const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]);
  if (!srcs.length) { console.error('NO SCRIPT FOUND in ' + FILE); process.exit(1); }
  script = srcs.map(s => fs.readFileSync(path.resolve(ROOT, s), 'utf8')).join('\n;\n');
}

try { new vm.Script(script, { filename: 'index.html#script' }); }
catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }

// headless DOM/canvas/audio stub (identical posture to verify.cjs)
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
  // Each entry returns ONLY the fields that id should change, computed from the pre-apply snapshot 'b'.
  // Mirror of applyUpgrade() in world.js — kept in lockstep so a logic change here forces a test update.
  var EXP = {
    dmg:       function(b){ return { dmg: b.dmg*1.35 }; },
    rate:      function(b){ return { rate: Math.max(6, b.rate*0.78) }; },
    multi:     function(b){ return { multi: b.multi+1 }; },
    pierce:    function(b){ return { pierce: b.pierce+1 }; },
    spd:       function(b){ return { speed: b.speed*1.12 }; },
    maxhp:     function(b){ return { maxhp: b.maxhp+30, hp: Math.min(b.maxhp+30, b.hp+30) }; },
    magnet:    function(b){ var m=b.magnet*1.6; return { magnet: m, magnetSq: m*m }; },
    regen:     function(b){ return { regen: b.regen+1 }; },
    lifesteal: function(b){ return { lifesteal: b.lifesteal+1 }; },
    velocity:  function(b){ return { bulletSpd: b.bulletSpd*1.3, dmg: b.dmg*1.08 }; },
    missile:   function(b){ return { missile: b.missile+1 }; },
    shield:    function(b){ return { shield: b.shield+1 }; },
    chain:     function(b){ return { chain: b.chain+1 }; }
  };
  var WATCH = ['dmg','rate','multi','pierce','speed','maxhp','hp','magnet','magnetSq','regen','lifesteal','bulletSpd','missile','shield','chain'];
  var EPS = 1e-9, fails = [], n = 0;
  function snap(){ var s={}; for (var i=0;i<WATCH.length;i++) s[WATCH[i]]=player[WATCH[i]]; return s; }

  // every shipped upgrade must have an expectation — catches a new upgrade added without a test
  for (var u=0; u<UPGRADES.length; u++){ if(!EXP[UPGRADES[u].id]) fails.push('NO TEST for upgrade id "'+UPGRADES[u].id+'"'); }

  for (var u=0; u<UPGRADES.length; u++){
    var id = UPGRADES[u].id; if(!EXP[id]) continue;
    reset();                                  // fresh player each id → predictable deltas, no cross-contamination
    var before = snap();
    var want = Object.assign({}, before, EXP[id](before));   // expected full post-state
    applyUpgrade(id);
    n++;
    for (var f=0; f<WATCH.length; f++){
      var k = WATCH[f], got = player[k], exp = want[k];
      if (Math.abs(got-exp) > EPS) fails.push(id+': '+k+' = '+got+' but expected '+exp+(before[k]===exp?' (unexpectedly CHANGED)':''));
    }
  }
  // ---- LEVEL-AWARE: multi-level absolute-recalc golden values + getLabel↔applyLogic sync ----
  // applyLogic must reproduce the OLD incremental math at every stacked level, and the number a player
  // READS in getLabel(level) must be derived from the SAME scalar (no drift).
  for (var kk in Up) delete Up[kk];
  var GOLD = {
    dmg:       function(n){ return {dmg: 10*Math.pow(1.35,n)}; },
    rate:      function(n){ return {rate: Math.max(6, 34*Math.pow(0.78,n))}; },
    multi:     function(n){ return {multi: 1+n}; },
    pierce:    function(n){ return {pierce: n}; },
    spd:       function(n){ return {speed: 4.1*Math.pow(1.12,n)}; },
    maxhp:     function(n){ return {maxhp: 100+30*n}; },
    magnet:    function(n){ var m=90*Math.pow(1.6,n); return {magnet:m, magnetSq:m*m}; },
    regen:     function(n){ return {regenRate: n}; },
    lifesteal: function(n){ return {lifesteal: n}; },
    velocity:  function(n){ return {bulletSpd: 7.5*Math.pow(1.3,n), dmg: 10*Math.pow(1.08,n)}; },
    missile:   function(n){ return {missile: n}; },
    shield:    function(n){ return {shield: n}; },
    chain:     function(n){ return {chain: n}; }
  };
  // expected integer that MUST appear in getLabel(n) — same scalar the stat is built from
  var LBL = {
    dmg:function(n){return Math.round((Math.pow(1.35,n)-1)*100);}, rate:function(n){return Math.round((Math.pow(1/0.78,n)-1)*100);},
    multi:function(n){return 1+n;}, pierce:function(n){return n;}, spd:function(n){return Math.round((Math.pow(1.12,n)-1)*100);},
    maxhp:function(n){return 30*n;}, magnet:function(n){return Math.round((Math.pow(1.6,n)-1)*100);},
    regen:function(n){return n;}, lifesteal:function(n){return n;}, velocity:function(n){return Math.round((Math.pow(1.3,n)-1)*100);}
  };
  for (var u2=0; u2<UPGRADES.length; u2++){
    var rec=UPGRADES[u2], id2=rec.id; if(!GOLD[id2]){ fails.push('NO GOLD for upgrade id "'+id2+'"'); continue; }
    for (var L=1; L<=8; L++){
      var dbg=debugUpgrade(id2, L);               // fresh avatar, replays applyLogic to level L, restores Up
      var p2=makeAvatar(0,0);
      for (var i=0;i<L;i++){ Up[id2]=i+1; rec.applyLogic(p2,i+1); } delete Up[id2];
      var want2=GOLD[id2](L);
      for (var k in want2) if (Math.abs(p2[k]-want2[k]) > 1e-6) fails.push(id2+' Lv'+L+': '+k+'='+p2[k]+' want '+want2[k]);
      if (LBL[id2] && dbg.plain.indexOf(String(LBL[id2](L))) < 0)
        fails.push(id2+' Lv'+L+': label "'+dbg.plain+'" missing expected number '+LBL[id2](L));
    }
  }
  n += UPGRADES.length;

  if (fails.length){ globalThis.__R = 'FAIL ('+fails.length+'):\\n  '+fails.join('\\n  '); globalThis.__FAIL = 1; }
  else { globalThis.__R = 'PASS — '+n+' upgrades, each mutates only its own field(s) by the exact delta'; }
} catch (e) { globalThis.__R = 'RUNTIME ERROR: ' + (e && e.message) + '\\n' + ((e && e.stack)||'').split('\\n').slice(0,5).join('\\n'); globalThis.__FAIL = 1; } })();
`;
try { eval(script + driver); } catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
console.log(g.__R);
process.exit(g.__FAIL ? 1 : 0);
