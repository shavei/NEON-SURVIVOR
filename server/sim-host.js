/* NEON SURVIVOR — server/sim-host.js
 * The AUTHORITATIVE simulation host: the deterministic world, owned by the server, ticked headless.
 *
 * It loads ONLY the simulation layer — config-sim.js → core.js → world.js → sim.js — into an isolated
 * VM context, stubs the tiny DOM/Audio surface those files touch at load, then replaces the Fx
 * presentation port (Phase 1) with pure no-ops. Audio, sprites, canvas, HUD and menus never exist
 * server-side; the host owns enemy positions/AI/spawning, boss logic, damage, XP drops, wave
 * progression and player HP, exactly the "Server Ownership" set from the audit.
 *
 * Authority model (approved): the server runs the deterministic shared tick (updateShared) over the
 * agreed seed; clients only SEND inputs and RENDER snapshots. Inputs are the per-avatar [mx,my] the
 * lockstep tick already reads from a.input — the same seam verify-lockstep.cjs exercises — so the
 * host needs no new sim code, only a thin wrapper.
 *
 * Dependency-free (Node built-ins only), matching the project's no-deps ethos. The network transport
 * (WebSocket/HTTP) is a separate, swappable layer that drives this class; this file is pure simulation
 * so it can be unit-tested and reused by the in-page MockServerTransport and the Node server alike. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SIM_FILES = ['js/config-sim.js', 'js/core.js', 'js/world.js', 'js/sim.js'];
const STEP = 1000 / 60;   // one logical tick (mirrors world.js STEP)

// Minimal stub of the DOM/Audio/storage surface the sim files reference at LOAD time only.
function makeSandbox() {
  const any = new Proxy(function () {}, { get: () => any, apply: () => any, set: () => true, construct: () => any });
  const g = {};
  g.document = {
    getElementById: () => ({ getContext: () => any, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }),
    createElement: () => ({ getContext: () => any, width: 0, height: 0 }), body: {}, addEventListener() {}
  };
  g.localStorage = { getItem: () => null, setItem() {} };
  g.performance = { now: () => 0 };
  g.window = g; g.console = console; g.requestAnimationFrame = () => 1;
  return g;
}

class SimHost {
  /** @param {number} seed  shared world seed (mulberry32) — identical seed ⇒ identical world.
   *  @param {string[]} playerIds  authoritative roster (avatar ids).
   *  @param {{difficulty?:string, nextBoss?:number, spawn?:[number,number][]}} [opts] */
  constructor(seed, playerIds = ['p1'], opts = {}) {
    if (!Array.isArray(playerIds) || !playerIds.length) throw new Error('SimHost needs at least one playerId');
    const g = makeSandbox();
    vm.createContext(g);
    // Optional: pin the COSMETIC Math.random stream (particles/floats — never gameplay). Lets a parity
    // test run two hosts with DIFFERENT cosmetic streams and prove the authoritative world is identical.
    if (opts.mathSeed != null) vm.runInContext(
      `(function(){var s=${opts.mathSeed >>> 0};Math.random=function(){s|=0;s=(s+0x6D2B79F5)|0;var t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};})();`, g);
    const bundle = SIM_FILES.map(f => fs.readFileSync(path.resolve(ROOT, f), 'utf8')).join('\n;\n');
    vm.runInContext(bundle, g, { filename: 'sim-layer' });

    // server owns NO presentation: collapse the Fx port to no-ops, and pin the screen-space globals
    // the sim reads (camera math only — harmless headless).
    vm.runInContext('Fx.sfx=Fx.music=Fx.toast=Fx.flash=Fx.hud=Fx.loadout=Fx.levelUp=function(){};W=800;H=600;', g);

    // build the authoritative world from the seed + roster.
    const diff = opts.difficulty && ['easy', 'normal', 'hard'].includes(opts.difficulty) ? opts.difficulty : 'normal';
    const ids = JSON.stringify(playerIds);
    vm.runInContext(`
      DIFF = DIFFS[${JSON.stringify(diff)}];
      seedRng(${seed >>> 0}); reset(); state = 'play';
      players = ${ids}.map(function(id, i){ return makeAvatar(1500 + i * 220, 1500, id); });
      player = players[0];
      t0 = 0; now = 0; frame = 0; spawnTimer = 0; bossOn = false; nextBoss = ${Number(opts.nextBoss) || 60};
      // input/tick/snapshot bridge installed once; keeps all sim mutation inside the VM context.
      globalThis.__byId = {}; for (var i=0;i<players.length;i++) globalThis.__byId[players[i].id]=players[i];
      globalThis.__setInput = function(id, mx, my){ var a = globalThis.__byId[id]; if (a) a.input = [mx, my]; };
      globalThis.__tick = function(){ now += ${STEP}; updateShared(); return frame; };
      globalThis.__snapshot = function(){
        var r = function(n){ return Math.round(n * 100) / 100; };
        return {
          frame: frame, now: now, score: score, wave: wave, kills: kills, bossOn: bossOn, state: state,
          players: players.map(function(a){ return { id:a.id, x:r(a.x), y:r(a.y), hp:r(a.hp), maxhp:a.maxhp, level:a.level, xp:r(a.xp), dead:!!a.dead, vx:r(a.vx), vy:r(a.vy) }; }),
          enemies: enemies.map(function(e){ return { id:e.id, x:r(e.x), y:r(e.y), r:e.r, hp:r(e.hp), maxhp:r(e.maxhp), type:e.type, boss:!!e.boss, tele:e.tele|0, atk:e.atk|0 }; }),
          orbs: orbs.map(function(o){ return { id:o.id, x:r(o.x), y:r(o.y) }; }),
          items: items.map(function(it){ return { id:it.id, x:r(it.x), y:r(it.y), type:it.type }; }),
          bullets: bullets.map(function(b){ return { x:r(b.x), y:r(b.y), vx:r(b.vx), vy:r(b.vy) }; }),
          ebullets: ebullets.map(function(b){ return { x:r(b.x), y:r(b.y), vx:r(b.vx), vy:r(b.vy) }; }),
          missiles: missiles.map(function(m){ return { x:r(m.x), y:r(m.y), vx:r(m.vx), vy:r(m.vy) }; })
        };
      };
    `, g);

    this._g = g;
    this.seed = seed >>> 0;
    this.playerIds = playerIds.slice();
  }

  /** Record a client's input for the next tick. mx/my are the normalized move axes in [-1,1]. */
  input(id, mx, my) { this._g.__setInput(id, +mx || 0, +my || 0); return this; }

  /** Advance the authoritative world one fixed 1/60 s tick. Returns the new frame number. */
  tick() { return this._g.__tick(); }

  /** Serialize the authoritative state clients need to render (no cosmetics — those are client-local). */
  snapshot() { return this._g.__snapshot(); }

  get frame() { return this._g.frame; }
  get state() { return this._g.state; }
}

module.exports = { SimHost, STEP, SIM_FILES };
