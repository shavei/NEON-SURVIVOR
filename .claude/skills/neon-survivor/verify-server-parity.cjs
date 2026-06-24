#!/usr/bin/env node
/* Authoritative-server Determinism Check (migration plan, Phase 3/4 gate).
 *   node .claude/skills/neon-survivor/verify-server-parity.cjs
 *
 * Proves the plan's requirement: "the game runs identically with a local mock-server as it will with
 * the Node.js server." Stands up TWO independent SimHost authorities (server/sim-host.js) from the SAME
 * world seed and SAME scripted per-avatar inputs, but with DIFFERENT cosmetic Math.random streams — one
 * standing in for the in-page mock-server, one for the cloud Node server. Each is a fully isolated VM
 * running the real config-sim+core+world+sim layer headless (Fx no-op'd, no audio/render/DOM). After N
 * ticks their AUTHORITATIVE snapshots (positions/HP/XP/score/enemies/orbs — cosmetics excluded) must
 * hash identically: same computation, any host. A different seed must produce a different world (so the
 * test isn't vacuously matching empty state). Exits 0 + PASS only if parity holds and the world is real.
 */
const path = require('path'), crypto = require('crypto');
const { SimHost } = require(path.resolve(__dirname, '../../../server/sim-host.js'));

const SEED = 1337, TICKS = 480, IDS = ['p1', 'p2'];
// deterministic scripted inputs, distinct per avatar (mirrors verify-lockstep)
const in1 = t => { const ph = t % 200; return [ph < 100 ? 1 : -1, ph % 60 < 30 ? 1 : 0]; };
const in2 = t => { const ph = t % 160; return [ph < 80 ? -1 : 1, ph % 50 < 25 ? -1 : 1]; };

function run(seed, mathSeed) {
  const h = new SimHost(seed, IDS, { mathSeed });
  for (let t = 0; t < TICKS; t++) {
    const a = in1(t), b = in2(t);
    h.input('p1', a[0], a[1]); h.input('p2', b[0], b[1]);
    h.tick();
  }
  return h.snapshot();
}
const hash = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

const mock = run(SEED, 0xAAAA1111);   // "in-page mock-server"  (cosmetic stream A)
const node = run(SEED, 0xBBBB2222);   // "cloud Node server"    (cosmetic stream B)
const other = run(SEED + 1, 0xAAAA1111);

const hMock = hash(mock), hNode = hash(node), hOther = hash(other);
console.log('mock-server   ' + hMock + '   enemies=' + mock.enemies.length + ' orbs=' + mock.orbs.length + ' score=' + mock.score);
console.log('node-server   ' + hNode + '   enemies=' + node.enemies.length);
console.log('other-seed    ' + hOther);

let fails = 0;
if (hMock !== hNode) {
  fails++; console.error('\nMISMATCH — mock-server and Node-server authorities diverged from the same seed.');
  console.error('mock p1:', JSON.stringify(mock.players[0])); console.error('node p1:', JSON.stringify(node.players[0]));
}
if (hMock === hOther) { fails++; console.error('\nTRIVIAL — a different seed produced the IDENTICAL world; the seed is not driving the sim.'); }
if (mock.enemies.length < 1) { fails++; console.error('\nTRIVIAL — no enemies spawned; the test exercised nothing.'); }
if (Math.abs(mock.players[0].x - 1500) < 1 && Math.abs(mock.players[1].x - 1720) < 1) { fails++; console.error('\nTRIVIAL — avatars never moved.'); }

if (fails) process.exit(1);
console.log('\nPASS — two independent authorities (different cosmetic RNG) computed ONE identical world from the seed: ' +
  mock.enemies.length + ' enemies, ' + mock.orbs.length + ' orbs, score ' + mock.score + '. The server is host-agnostic and deterministic.');
process.exit(0);
