#!/usr/bin/env node
/* NEON SURVIVOR — verify-fullcycle.cjs : the System Integrity "Full-Cycle Test".
 * Walks the whole post-game identity arc end-to-end and PRINTS EVIDENCE at each step (state, not just
 * "looks correct"):  fresh login → unique-callsign profile → achievement unlock → reward grant → Showcase.
 *
 *   node .claude/skills/neon-survivor/verify-fullcycle.cjs          # STUB mode (default, CI gate)
 *   node .claude/skills/neon-survivor/verify-fullcycle.cjs --live   # LIVE mode (opt-in, real Supabase)
 *
 * STUB mode drives the REAL production code (js/auth-uplink.js confirmUsername/_stage, js/achievement-sync.js
 * AchSync._adopt/_setProfile, js/reward-granting-engine.js RewardEngine.onUnlock, debugAchievement) against a
 * programmable stub Supabase — so it runs anywhere, offline, with no secrets, and can exercise BOTH the happy
 * path AND the UNIQUE-constraint (Postgres 23505) rejection in one run. It asserts in-code behavior + the
 * local mirror + the optimistic user_inventory insert.
 *
 * LIVE mode (env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) invokes api/verify.js against a real project with
 * a throwaway player id, then READS BACK player_achievements / user_inventory rows for true DB-state evidence,
 * and self-cleans. It SKIPS (exit 0, with reason) when unconfigured or when the host isn't egress-allowlisted,
 * so it never breaks CI. Exits non-zero only on a genuine failure.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../../..');
const LIVE = process.argv.includes('--live');

/* ============================== LIVE MODE ============================== */
async function runLive() {
  const URL = process.env.SUPABASE_URL || process.env.SUPA_URL || '';
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!URL || !KEY) { console.log('LIVE — SKIP: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run the real round-trip.'); process.exit(0); }
  process.env.SUPABASE_URL = URL; process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;

  const sb = async (pq, opts = {}) => {
    const res = await fetch(URL + '/rest/v1/' + pq, { ...opts, headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const t = await res.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch (e) { b = t; }
    if (!res.ok) throw new Error('supabase ' + res.status + ': ' + t);
    return b;
  };
  const PID = '00000000-0000-4000-8000-fullcycletest';     // throwaway test player id (cleaned up below)
  const TOKEN = (require('crypto').randomUUID && require('crypto').randomUUID()) || ('fc-' + Date.now());
  const cleanup = async () => { for (const q of [
      'player_achievements?player_id=eq.' + PID, 'cosmetics_inventory?player_id=eq.' + PID,
      'user_inventory?player_id=eq.' + PID, 'runs?player_id=eq.' + PID])
    { try { await sb(q, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); } catch (e) {} } };

  try {
    await cleanup();
    // open a trusted run row in the past so a small `secs` claim validates
    await sb('runs', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ run_token: TOKEN, player_id: PID, difficulty: 'normal', started_at: new Date(Date.now() - 120000).toISOString() }) });
    console.log('  [live] opened run token ' + TOKEN.slice(0, 8) + '… for test player');

    const handler = require(path.join(ROOT, 'api/verify.js'));
    const claim = { player_id: PID, run_token: TOKEN, score: 2000, wave: 20, kills: 25, secs: 30, level: 5, bosses: 0, runs: 1, difficulty: 'normal' };
    let payload = null;
    const res = { status: () => ({ json: o => { payload = o; } }) };
    await handler({ method: 'POST', body: claim }, res);
    console.log('  [live] /api/verify →', JSON.stringify(payload));

    let fail = 0; const ok = (c, m) => { if (!c) { console.error('  FAIL: ' + m); fail++; } else console.log('  ✔ ' + m); };
    ok(payload && payload.accepted, 'run accepted by api/verify');
    ok(payload && (payload.newAchievements || []).indexOf('wave_master') >= 0, 'wave_master in newAchievements');

    const pa = await sb('player_achievements?select=achievement_id&player_id=eq.' + PID);
    console.log('  [live] player_achievements rows:', JSON.stringify(pa));
    ok(Array.isArray(pa) && pa.some(r => r.achievement_id === 'wave_master'), 'wave_master row persisted in player_achievements');

    try {
      const inv = await sb('user_inventory?select=reward_id,kind&player_id=eq.' + PID);
      console.log('  [live] user_inventory rows:', JSON.stringify(inv));
      ok(Array.isArray(inv) && inv.some(r => r.reward_id === 'maelstrom_waltz'), 'maelstrom_waltz reward persisted in user_inventory');
    } catch (e) { console.log('  [live] user_inventory not present (' + e.message + ') — reward is mirror-only on this deployment'); }

    await cleanup();
    console.log(fail ? ('\nLIVE — ' + fail + ' FAILED') : '\nLIVE — ALL PASS (real DB grant verified + cleaned up)');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    await cleanup().catch(() => {});
    if (/allowlist|egress|ENOTFOUND|EAI_AGAIN|403|407|fetch failed/i.test(String(e.message))) {
      console.log('LIVE — SKIP: backend not reachable from here (' + e.message + '). Add the host to the egress allowlist to run live.');
      process.exit(0);
    }
    console.error('LIVE — ERROR:', e.message); process.exit(1);
  }
}

/* ============================== STUB MODE ============================== */
function runStub() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]);
  const script = srcs.map(s => fs.readFileSync(path.join(ROOT, s), 'utf8')).join('\n;\n');
  try { new vm.Script(script, { filename: 'index.html#script' }); }
  catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }

  const any = new Proxy(function () {}, { get(t, p) { if (p === Symbol.toPrimitive) return () => 0; if (p === 'toString' || p === 'valueOf') return () => ''; return any; }, apply() { return any; }, set() { return true; }, construct() { return any; } });
  const mkEl = () => { const e = {
    value: '', _text: '', _cls: new Set(),
    style: { setProperty() {}, removeProperty() {}, display: '' },
    classList: { add: c => e._cls.add(c), remove: c => e._cls.delete(c), toggle: c => e._cls.has(c) ? e._cls.delete(c) : e._cls.add(c), contains: c => e._cls.has(c) },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {},
    focus() {}, blur() {}, click() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    querySelector: () => mkEl(), querySelectorAll: () => [],
    set textContent(v) { e._text = v; }, get textContent() { return e._text; },
    set innerHTML(v) {}, set onclick(v) {}, set onkeydown(v) {} }; return e; };
  const els = {};
  const gameEl = { getContext: () => any, style: {}, width: 0, height: 0, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const g = globalThis;
  g.document = { head: mkEl(), body: mkEl(), getElementById: id => id === 'game' ? gameEl : (els[id] || (els[id] = mkEl())), querySelector: () => mkEl(), querySelectorAll: () => [], createElement: t => t === 'canvas' ? { width: 0, height: 0, getContext: () => any } : mkEl(), addEventListener() {} };
  g.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
  g.window = g; g.addEventListener = () => {}; g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {};
  g.performance = { now: () => 0 }; g.devicePixelRatio = 1; g.innerWidth = 800; g.innerHeight = 600;
  g.AudioContext = function () { return any; }; g.webkitAudioContext = g.AudioContext;
  g.crypto = { randomUUID: () => 'local-' + Math.random().toString(16).slice(2) };
  g.fetch = () => Promise.reject(new Error('offline'));

  const driver = `
;(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var $ = function(id){ return document.getElementById(id); };
  var fails = [], step = 0;
  var ok = function(c, m){ if (c) console.log('  ✔ ' + m); else { console.error('  FAIL: ' + m); fails.push(m); } };
  var head = function(t){ step++; console.log('\\nSTEP ' + step + ' — ' + t); };

  // ---- programmable stub backend: state.taken flips the callsign upsert to a Postgres 23505 duplicate ----
  var state = { taken: false };
  var calls = { upserts: [], inserts: [] };
  var newUser = { id: 'auth-uid-FRESH', email: 'newpilot@neon.gg' };
  var query = function(table, rows){ var t = {
    select:function(){return t}, eq:function(){return t}, order:function(){return t}, limit:function(){return t},
    single:function(){ return Promise.resolve({data:null,error:null}); },
    upsert:function(row){ calls.upserts.push({table:table,row:row}); return Promise.resolve(state.taken ? {error:{code:'23505',message:'duplicate key value violates unique constraint'}} : {error:null}); },
    insert:function(row){ calls.inserts.push({table:table,row:row}); return Promise.resolve({error:null}); },
    then:function(f,r){ return Promise.resolve({data:rows||[],error:null}).then(f,r); } }; return t; };
  SB = { auth: {
      signUp:function(){ return Promise.resolve({data:{user:newUser, session:null},error:null}); },
      signInWithPassword:function(){ return Promise.resolve({data:{user:newUser},error:null}); },
      signInWithOtp:function(){ return Promise.resolve({data:{},error:null}); },
      verifyOtp:function(args){ return Promise.resolve({data:{user:newUser},error:null}); },
      resend:function(){ return Promise.resolve({error:null}); },
      getSession:function(){ return Promise.resolve({data:{session:null}}); },
      signOut:function(){ return Promise.resolve(); } },
    rpc:function(){ return Promise.resolve({data:true,error:null}); },
    from:function(table){ return query(table, []); } };

  if (typeof onAuthResolved === 'function') globalThis.onAuthResolved = onAuthResolved;
  if (typeof onAuthRequired === 'function') globalThis.onAuthRequired = onAuthRequired;
  if (typeof Ach !== 'undefined') Ach.renderPanel = function(){};
  if (typeof LBSync !== 'undefined') LBSync.syncAll = function(){};
  var closed = function(){ return $('username').classList.contains('hidden') && !$('start').classList.contains('hidden'); };
  var open = function(){ $('username').classList.remove('hidden'); $('start').classList.add('hidden'); };

  try {
    // ===== STEP 1: a fresh user signs up (email+password+callsign) → emailed-code stage =====
    head('Fresh signup → modal advances to the emailed-code stage');
    open(); showAuth('signup');
    $('authemail').value = newUser.email; $('authpass').value = 'hunter2pw'; $('uname').value = 'Nova';
    confirmUsername(); await sleep(50);
    ok(_stage === 'signup-code', 'stage advanced to signup-code (Supabase emailed a 6-digit code)');
    ok(_pendingCallsign === 'Nova', 'chosen callsign "Nova" held pending until the code verifies');

    // ===== STEP 2: confirm the code → profile created with the unique callsign, id adopted =====
    head('Confirm code → profile created with a UNIQUE callsign, durable id adopted');
    $('authcode').value = '123456'; confirmUsername(); await sleep(60);
    var prof = calls.upserts.filter(function(u){ return u.table === 'profiles'; }).pop();
    ok(prof && prof.row.username === 'Nova', 'profiles upsert wrote callsign "Nova" (profiles.upsert)');
    ok((getPlayer()||{}).id === newUser.id, 'neon_player adopted the durable auth user_id ' + newUser.id);
    ok((getPlayer()||{}).name === 'Nova', 'local profile name = "Nova"');
    ok(closed(), 'GRID ACCESS modal closed onto the menu');
    console.log('  evidence: player=' + JSON.stringify(getPlayer()));

    // ===== STEP 3: a SECOND player tries the same callsign → DB UNIQUE index rejects it (23505) =====
    head('Duplicate callsign → Postgres UNIQUE index rejects it (no local write leaks)');
    state.taken = true;
    savePlayer('Veteran', 'auth-uid-OTHER');               // a different signed-in player…
    open(); _render('callsign'); $('uname').value = 'Nova'; // …tries to claim the taken "Nova"
    confirmUsername(); await sleep(60);
    ok($('uname').classList.contains('taken'), '#uname shows the red "taken" state');
    ok($('unameerr').textContent === 'CALLSIGN ALREADY CLAIMED', 'error reads "CALLSIGN ALREADY CLAIMED"');
    ok((getPlayer()||{}).name === 'Veteran', 'no local rename leaked through the rejected claim');
    ok(!closed(), 'modal stays open so the player can pick another callsign');
    state.taken = false;

    // ===== STEP 4: an achievement unlocks → the reward handshake fires + persists (optimistic insert) =====
    head('Achievement unlock → grantReward handshake (AchUI.unlockToast → RewardEngine.onUnlock)');
    calls.inserts = [];
    var r = (typeof debugAchievement === 'function') ? debugAchievement('wave_master', 100) : null;
    await sleep(20);
    console.log('  evidence: debugAchievement →', JSON.stringify(r));
    ok(r && r.unlocked, 'wave_master is unlocked');
    ok(r && r.reward && r.reward.id === 'maelstrom_waltz' && r.reward.kind === 'music', 'reward = Maelstrom Waltz (music track)');
    ok(r && r.inMirror, 'reward written to the local mirror (Ach._grantRewards)');
    var invIns = calls.inserts.filter(function(i){ return i.table === 'user_inventory'; }).pop();
    ok(invIns && invIns.row.reward_id === 'maelstrom_waltz' && invIns.row.kind === 'music', 'optimistic user_inventory insert sent {reward_id:maelstrom_waltz, kind:music}');

    // ===== STEP 5: the reward shows up + is selectable in the Showcase =====
    head('Showcase → the unlocked reward appears and is equippable');
    RewardEngine.renderTrackGallery();
    ok(RewardEngine.owns('maelstrom_waltz'), 'RewardEngine.owns(maelstrom_waltz) = true (visible in the Soundtrack tab)');
    ok(r && r.selectable, 'reward is selectable (equip surface live)');
    ok(RewardEngine.equippedMusic() === 'maelstrom_waltz', 'track equips → equippedMusic() = maelstrom_waltz');

    console.log(fails.length ? ('\\nFULL-CYCLE (stub) — ' + fails.length + ' FAILED') : '\\nFULL-CYCLE (stub) — ALL PASS (login → unique callsign → unlock → reward → showcase)');
    process.exit(fails.length ? 1 : 0);
  } catch (e) { console.error('\\nFULL-CYCLE (stub) — ERROR:', e && e.message, e && e.stack); process.exit(1); }
})();
`;
  try { eval(script + driver); } catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
}

if (LIVE) runLive(); else runStub();
