#!/usr/bin/env node
/* NetSync unit check — the Phase 2 shared-world plumbing (docs/PLAN-multiplayer-sync.md).
 *   node .claude/skills/neon-survivor/verify-netsync.cjs
 * Loads core.js (for seedRng) + network-sync.js headlessly with a stub Lobby, and asserts the pure
 * logic the lockstep cutover will depend on:
 *   1. seed agreement: the lowest LIVING id's advertised seed wins, and applying it makes srng reproducible
 *   2. input quantization round-trips within int8 tolerance
 *   3. the input ring buffers remote packets, answers inputAt/haveAll, and prunes past WINDOW
 *   4. headless/inactive safety: no throws, and nothing is recorded while inactive
 * Exits 0 + PASS only if all hold. (Assertions run INSIDE the vm context so top-level `const NetSync`
 * lexical bindings are visible — they are not properties of the context global.)
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../../..');

const any = new Proxy(function () {}, { get(t, p) { if (p === Symbol.toPrimitive) return () => 0; return any; }, apply() { return any; }, set() { return true; }, construct() { return any; } });
const g = {};
g.document = { getElementById: () => ({ getContext: () => any }), createElement: () => ({ getContext: () => any }), body: {}, addEventListener() {} };
g.window = g; g.console = console;
g.__sent = [];
g.Lobby = { me: 'bbb', channel: {}, send(event, payload) { g.__sent.push({ event, payload }); } };

const src = ['js/core.js', 'js/network-sync.js'].map(s => fs.readFileSync(path.resolve(ROOT, s), 'utf8')).join('\n;\n');

const DRIVER = `
;(function(){ var fails = 0;
  var ok = function(cond, msg){ if(!cond){ fails++; console.error('  FAIL: '+msg); } else console.log('  ok: '+msg); };
  var approx = function(a,b,eps){ return Math.abs(a-b) <= eps; };

  console.log('seed agreement:');
  var presence = { 'ccc':[{alive:true,seed:333}], 'aaa':[{alive:true,seed:111}], 'bbb':[{alive:true,seed:222}] };
  ok(NetSync.pickSeed(presence,'bbb') === 111, 'lowest id (aaa) seed wins -> 111');
  presence['aaa'][0].alive = false;
  ok(NetSync.pickSeed(presence,'bbb') === 222, 'dead lowest id skipped -> next living (bbb) -> 222');
  presence['aaa'][0].alive = true;

  NetSync.start();
  NetSync.onPresence(presence, 'bbb');
  ok(NetSync.seed === 111, 'onPresence resolved agreed seed = 111');
  var seqA = [srng(), srng(), srng()];
  seedRng(111); var seqB = [srng(), srng(), srng()];
  ok(JSON.stringify(seqA) === JSON.stringify(seqB), 'applied seed makes srng reproducible (seedRng(111) replays it)');

  console.log('input quantization:');
  NetSync.start(); NetSync.seed = 111; NetSync.active = true;
  NetSync.localInput(10, 0.5, -1);
  var q = NetSync.inputAt('bbb', 10);
  ok(q && approx(q.mx,0.5,0.01) && approx(q.my,-1,0.01), 'localInput(0.5,-1) round-trips within int8 tolerance');
  NetSync.localInput(11, 1, 0); q = NetSync.inputAt('bbb', 11);
  ok(q && approx(q.mx,1,0.01) && approx(q.my,0,0.001), 'localInput(1,0) round-trips');

  console.log('input ring:');
  NetSync.recvInput({ id:'aaa', b:[[10,127,0],[11,0,-127]] });
  var r = NetSync.inputAt('aaa', 11);
  ok(r && approx(r.mx,0,0.01) && approx(r.my,-1,0.01), 'recvInput buffers a remote peer packet');
  NetSync.recvInput({ id:'bbb', b:[[99,0,0]] });
  ok(NetSync.inputAt('bbb',99) === null, 'recvInput ignores my own id (no echo loop)');
  ok(NetSync.haveAll(10, ['aaa','bbb']) === true, 'haveAll true when every listed peer reported the tick');
  ok(NetSync.haveAll(11, ['aaa','bbb','zzz']) === false, 'haveAll false when a peer is missing');
  NetSync.recvInput({ id:'aaa', b:[[10 + NetSync.WINDOW, 1, 1]] });
  ok(NetSync.inputAt('aaa', 10) === null, 'ring prunes entries older than WINDOW');

  console.log('transport + safety:');
  __sent.length = 0; NetSync._lastFlush = 0; NetSync.flush(1000000);
  ok(__sent.length === 1 && __sent[0].event === 'input' && Array.isArray(__sent[0].payload.b), 'flush emits one batched input packet');
  NetSync.stop();
  var before = JSON.stringify(NetSync._buf['bbb'] || {});
  NetSync.localInput(500, 1, 1);
  ok(JSON.stringify(NetSync._buf['bbb'] || {}) === before, 'inactive: localInput records nothing');
  var threw = false; try { NetSync.flush(2000000); NetSync.onPresence({}, 'bbb'); } catch(e){ threw = true; }
  ok(!threw, 'inactive/empty calls do not throw');

  globalThis.__FAILS = fails;
})();
`;

vm.createContext(g);
try { vm.runInContext(src + DRIVER, g, { filename: 'netsync-bundle' }); }
catch (e) { console.error('LOAD ERROR: ' + (e && e.message)); process.exit(1); }
if (g.__FAILS) { console.error('\n' + g.__FAILS + ' FAILED'); process.exit(1); }
console.log('\nPASS — NetSync seed handshake + input ring behave correctly.');
process.exit(0);
