/* NEON SURVIVOR — config-sim.js
 * Deterministic SIMULATION config + seeded RNG — difficulty/boss tunables and the seedable randomness.
 * Kept in its own file (loaded BEFORE core.js) so core.js stays well under the 28 KB silent-truncation
 * threshold. Classic script (shared globals).
 * Load order: config → config-sim → core → audio-engine → world → sim → render → ui-engine → … → main. */

/* SEEDABLE GAMEPLAY randomness. Unseeded it forwards to Math.random, so solo play and the verify-equiv
 * golden snapshot are byte-for-byte unchanged. seedRng(n) switches every gameplay draw onto a
 * deterministic mulberry32 stream (same spawns/drops/rolls); seedRng(null) reverts to Math.random. */
let _rngSeeded=false,_rngState=0;
function seedRng(n){ if(n==null){_rngSeeded=false;return;} _rngSeeded=true; _rngState=n>>>0; }
function srng(){
  if(!_rngSeeded) return Math.random();
  let t=(_rngState=(_rngState+0x6D2B79F5)|0);
  t=Math.imul(t^(t>>>15),1|t); t=(t+Math.imul(t^(t>>>7),61|t))^t;
  return ((t^(t>>>14))>>>0)/4294967296;
}
const srand=(a,b)=>a+srng()*(b-a);         // gameplay analogue of rand() — routed through the seedable stream

/* ========== DIFFICULTY ========== */
const DIFFS={
  easy:  {key:'easy', label:'Easy',   spawn:1.4,  hp:.78, dmg:.65, col:'#54e6b5'},
  normal:{key:'normal',label:'Normal', spawn:1.0,  hp:1.0,  dmg:1.0,  col:'#ffd95e'},
  hard:  {key:'hard', label:'Hard',   spawn:.68, hp:1.8,  dmg:2.0,  col:'#ff5fa2'},
};
let DIFF=DIFFS.normal;
// Shared boss tunables — base HP/dmg/speed, attack cadence+telegraph, hitbox/i-frames + per-attack params.
// Per-TYPE identity (name/colour/shape/scaling/move-set) lives in BOSSES below.
const BOSS={hpBase:500,hpTier:300,hpRamp:0.004,contactDmg:22,projDmg:0.45,speedBase:.45,speedTier:.02,
  cdBase:120,cdFloor:75,teleT:45,hitRMul:.85,invProj:30,invContact:12,
  // attack params (atk id → 0 burst · 1 dash · 2 slam · 3 spiral · 4 spread · 5 summon · 6 blink)
  dashSpd:6.4,dashT:24,slamN:24,slamR:200,slamSpd:2.4,                 // REVENANT: dash lunge + AOE shockwave ring
  spiralTicks:48,spiralRot:.3,spiralSpd:3.2,spreadN:7,spreadArc:.95,spreadSpd:4.4,   // MAELSTROM: rotating storm + aimed cone
  summonN:6,blinkDist:240,                                            // OVERSEER: drone warp-in count + blink range
  // spawn throttle while a boss is alive: longer interval + smaller batches (focus the fight)
  spawnMul:2.2,spawnCountMul:0.5};
// Three distinct boss archetypes, cycled by tier ((tier-1)%3). Each has its own colour, polygon, HP/speed
// scaling and a looping attack sequence (atk ids above) — REVENANT brawls, MAELSTROM zones, OVERSEER swarms.
const BOSSES=[
  {name:'REVENANT', col:'#ff3b6b', sides:8, hpMul:0.82, spdMul:1.5,  seq:[1,2,0,1,2]},   // relentless crimson brawler: dash/slam pressure
  {name:'MAELSTROM',col:'#38e0ff', sides:6, hpMul:1.32, spdMul:0.58, seq:[3,4,3,4]},      // slow cyan artillery: bullet-storm zoner
  {name:'OVERSEER', col:'#b14bff', sides:5, hpMul:1.05, spdMul:0.95, seq:[5,0,6,5]},       // violet swarm-lord: summons drones + blinks
];
