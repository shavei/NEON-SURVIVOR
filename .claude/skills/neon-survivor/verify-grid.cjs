#!/usr/bin/env node
/* NEON SURVIVOR — verify-grid.cjs : the 'Grid-Grade' Full-System Regression.
 * Validates the Supabase auth-to-reward handshake end-to-end, plus the in-run JUICE layer, by driving
 * the REAL production code against a programmable stub Supabase (offline, no secrets, CI-safe):
 *
 *   STEP 1 — OTP login: showAuth('login') → _startOtpLogin() → otp-code stage → confirmUsername()
 *            → AchSync.verifyOtp → _adopt (durable id), modal closes onto the menu.
 *   STEP 2 — Tier-3 synergy: startGame(), earn RAILGUN (velocity 2 + pierce 2), transformToEvolved()
 *            → screen-shake escalates, #pulse fires, 'COMING ONLINE' toast, stingSynergy chord.
 *   STEP 3 — Gold reward: debugAchievement('warden_legend') → Warden Halo trail in the local mirror,
 *            owned + equippable, and the optimistic user_inventory upsert captured (the "cloud write").
 *
 *   node .claude/skills/neon-survivor/verify-grid.cjs
 *
 * For a REAL Supabase round-trip use verify-fullcycle.cjs --live (env-gated) — this harness stays stub-only. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../../..');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]).filter(s => !/^(https?:)?\/\//.test(s) && !s.startsWith('/'));   // repo files only — skip CDN + platform routes (/_vercel/…)
const script = srcs.map(s => fs.readFileSync(path.join(ROOT, s), 'utf8')).join('\n;\n');
try { new vm.Script(script, { filename: 'index.html#script' }); }
catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }

/* ---- headless stub DOM/env (same shape as verify-fullcycle.cjs) ---- */
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

  // ---- programmable stub Supabase: captures every upsert/insert = the "cloud write" evidence ----
  var calls = { upserts: [], inserts: [] };
  var otpUser = { id: 'auth-uid-GRIDTEST', email: 'gridpilot@neon.gg' };
  var query = function(table, rows){ var t = {
    select:function(){return t}, eq:function(){return t}, order:function(){return t}, limit:function(){return t},
    single:function(){ return Promise.resolve({data:null,error:null}); },
    upsert:function(row){ calls.upserts.push({table:table,row:row}); return Promise.resolve({error:null}); },
    insert:function(row){ calls.inserts.push({table:table,row:row}); return Promise.resolve({error:null}); },
    then:function(f,r){ return Promise.resolve({data:rows||[],error:null}).then(f,r); } }; return t; };
  SB = { auth: {
      signInWithOtp:function(){ return Promise.resolve({data:{},error:null}); },
      verifyOtp:function(){ return Promise.resolve({data:{user:otpUser},error:null}); },
      signInWithPassword:function(){ return Promise.resolve({data:{user:otpUser},error:null}); },
      signUp:function(){ return Promise.resolve({data:{user:otpUser,session:null},error:null}); },
      resend:function(){ return Promise.resolve({error:null}); },
      getSession:function(){ return Promise.resolve({data:{session:null}}); },
      signOut:function(){ return Promise.resolve(); } },
    rpc:function(){ return Promise.resolve({data:true,error:null}); },
    from:function(table){ return query(table, []); } };

  if (typeof onAuthResolved === 'function') globalThis.onAuthResolved = onAuthResolved;
  if (typeof Ach !== 'undefined') Ach.renderPanel = function(){};
  if (typeof LBSync !== 'undefined') LBSync.syncAll = function(){};
  // tap the Fx facade so toast text + music stings become assertable evidence (still call through)
  var toasts = [], stings = [];
  if (typeof Fx !== 'undefined') {
    var _t = Fx.toast, _m = Fx.music;
    Fx.toast = function(i, m, c){ toasts.push(m); if (_t) try { _t.apply(Fx, arguments); } catch(e){} };
    Fx.music = function(n){ stings.push(n); if (_m) try { _m.apply(Fx, arguments); } catch(e){} };
  }

  try {
    // ===== STEP 1: mock user logs in via the OTP flow → durable id adopted =====
    head('OTP login → code stage → verify → durable id adopted');
    $('username').classList.remove('hidden'); $('start').classList.add('hidden');
    showAuth('login'); $('authemail').value = otpUser.email;
    _startOtpLogin(); await sleep(50);
    ok(_stage === 'otp-code', 'stage advanced to otp-code (signInWithOtp requested a 6-digit code)');
    $('authcode').value = '424242'; confirmUsername(); await sleep(60);
    ok((getPlayer()||{}).id === otpUser.id, 'neon_player adopted the durable auth user_id ' + otpUser.id);
    ok($('username').classList.contains('hidden'), 'GRID ACCESS modal closed onto the menu');
    console.log('  evidence: player=' + JSON.stringify(getPlayer()));

    // ===== STEP 2: Tier-3 synergy → visual JUICE (screen-shake + neon pulse) =====
    head('Tier-3 synergy (RAILGUN) → shake + pulse + COMING ONLINE toast + sting');
    startGame();
    Up.velocity = 2; Up.pierce = 2;                        // meet the RAILGUN thresholds
    var s = Synergy.ready();
    ok(!!s && s.id === 'railgun', 'Synergy earned: ' + (s && s.name));
    var preShake = shake; toasts.length = 0; stings.length = 0;
    Synergy.transformToEvolved(s);
    ok(shake > preShake, 'Juice: screen-shake escalated (' + preShake + ' → ' + shake + ')');
    ok($('pulse').classList.contains('go'), 'Juice: #pulse neon overlay fired (class "go")');
    ok(player.evo.bullet === 'railgun', 'weapon slot evolved: player.evo.bullet = railgun');
    ok(toasts.some(function(t){ return /COMING ONLINE/.test(t); }), 'toast reads "… — COMING ONLINE"');
    ok(stings.indexOf('stingSynergy') >= 0, 'orchestral synergy sting dispatched (Fx.music stingSynergy)');
    ok(typeof LANG_HE !== 'undefined' && !!LANG_HE['COMING ONLINE'], 'i18n lockstep: LANG_HE["COMING ONLINE"] present');

    // ===== STEP 3: gold achievement → reward granted → Supabase write confirmation (captured upsert) =====
    head('Gold achievement (warden_legend) → Warden Halo trail → user_inventory write');
    calls.upserts = [];
    var r = (typeof debugAchievement === 'function') ? debugAchievement('warden_legend', 100) : null;
    await sleep(20);
    console.log('  evidence: debugAchievement →', JSON.stringify(r));
    ok(r && r.unlocked, 'warden_legend (gold) is unlocked');
    ok(r && r.reward && r.reward.kind === 'trail' && r.reward.id === 'warden_halo', 'reward = Warden Halo (trail)');
    ok(r && r.inMirror, 'reward written to the local mirror (Ach._grantRewards)');
    ok(RewardEngine.owns('warden_halo'), 'RewardEngine.owns(warden_halo) = true (visible in the Trails gallery)');
    ok(RewardEngine.equippedTrailColor() === '#b98cff', 'trail equips → equippedTrailColor() = #b98cff (render.js hue)');
    var inv = calls.upserts.filter(function(u){ return u.table === 'user_inventory'; }).pop();
    ok(inv && inv.row.reward_id === 'warden_halo' && inv.row.kind === 'trail', 'Supabase write confirmed: user_inventory upsert {reward_id:warden_halo, kind:trail}');

    console.log(fails.length ? ('\\nGRID-GRADE — ' + fails.length + ' FAILED') : '\\nGRID-GRADE — ALL PASS (OTP login → synergy juice → gold reward → cloud write)');
    process.exit(fails.length ? 1 : 0);
  } catch (e) { console.error('\\nGRID-GRADE — ERROR:', e && e.message, e && e.stack); process.exit(1); }
})();
`;
try { eval(script + driver); } catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
