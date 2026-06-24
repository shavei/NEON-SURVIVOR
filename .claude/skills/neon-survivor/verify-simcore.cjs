#!/usr/bin/env node
/* Sim-layer decoupling guard (server-authority foundation).
 *   node .claude/skills/neon-survivor/verify-simcore.cjs
 * Proves the SIMULATION layer (core → world → sim) loads and ticks with the CLIENT presentation layer
 * ABSENT: audio-engine.js, render.js, ui-engine.js and main.js are NOT loaded, so Music / showToast /
 * flashHit / updateHUD / renderLoadout / openLevelUp are all undefined. The sim reaches presentation
 * only through the Fx port (core.js), which the "server" here overrides with no-ops. If any sim path
 * still names a presentation symbol directly, this throws → the seam regressed. Exits 0 + PASS on success.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../../..');
const files = ['js/core.js', 'js/world.js', 'js/sim.js'];   // sim layer ONLY — no audio/render/ui/main
const src = files.map(f => fs.readFileSync(path.resolve(ROOT, f), 'utf8')).join('\n;\n');

const any = new Proxy(function () {}, { get: () => any, apply: () => any, set: () => true, construct: () => any });
const g = {};
g.document = { getElementById: () => ({ getContext: () => any, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }),
  createElement: () => ({ getContext: () => any, width: 0, height: 0 }), body: {}, addEventListener() {} };
g.localStorage = { getItem: () => null, setItem() {} };
g.performance = { now: () => g.__t || 0 };
g.window = g; g.console = console; g.requestAnimationFrame = () => 1;
vm.createContext(g);

try { vm.runInContext(src, g, { filename: 'simcore' }); }
catch (e) { console.error('LOAD ERROR (sim layer references a missing presentation symbol): ' + e.message); process.exit(1); }

// the server's role: replace the presentation port with pure no-ops (no audio, no DOM).
vm.runInContext(`Fx.sfx=Fx.music=Fx.toast=Fx.flash=Fx.hud=Fx.loadout=Fx.levelUp=function(){};`, g);
vm.runInContext(`W=800;H=600;var keys={};var touch=null;`, g);

try {
  vm.runInContext(`
    seedRng(7); reset(); state='play';
    for (var f=0; f<600; f++){ globalThis.__t=(globalThis.__t||0)+16; now=globalThis.__t;
      if (state==='levelup') state='play';
      update();
    }
    globalThis.__R = JSON.stringify({ score:score, kills:kills, enemies:enemies.length, frame:frame, hp:Math.round(player.hp) });
  `, g);
} catch (e) { console.error('TICK ERROR (sim called into presentation): ' + e.message); process.exit(1); }

if (!g.__R) { console.error('FAIL — sim produced no result'); process.exit(1); }
console.log('result ' + g.__R);
console.log('\nPASS — simulation layer (core+world+sim) runs headless with the presentation layer absent. Fx seam holds.');
process.exit(0);
