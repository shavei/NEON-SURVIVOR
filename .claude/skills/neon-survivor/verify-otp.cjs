#!/usr/bin/env node
/* Headless verifier for BOTH halves of the hybrid email sign-in — the template ships a 6-digit code
 * AND a magic link, and a player can use either. Run after editing auth-otp.js / achievement-sync.js /
 * the #username modal:   node .claude/skills/neon-survivor/verify-otp.cjs
 *
 * Both paths are exercised WITHOUT a network, against a stub Supabase client:
 *   A) CODE — player types the code; we drive confirmOtp() as the modal does and assert verifyOtp got
 *      {type:'email', token}, _adopt bound the auth user_id into neon_player, and the modal closed.
 *   B) LINK — player clicks the email link; the SDK's detectSessionInUrl turns the returned URL into a
 *      session, so on boot getSession() yields it. We drive AchSync.resolveSession() and assert the SAME
 *      _adopt path binds the user_id and onAuthResolved closes the modal onto the menu.
 * Both must adopt the durable user_id so leaderboards + achievements key identically on every device.
 * Exits non-zero on any failure. Optional arg: path to the html file.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.argv[2] || path.resolve(__dirname, '../../../index.html');
const ROOT = path.dirname(FILE);
const html = fs.readFileSync(FILE, 'utf8');

// Concatenate external classic scripts in <script defer src> order — reproduces the page's shared global scope.
const inline = html.match(/<script>([\s\S]*?)<\/script>/);
let script;
if (inline) { script = inline[1]; }
else {
  const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]);
  if (!srcs.length) { console.error('NO SCRIPT FOUND in ' + FILE); process.exit(1); }
  script = srcs.map(s => fs.readFileSync(path.resolve(ROOT, s), 'utf8')).join('\n;\n');
}

// syntax check
try { new vm.Script(script, { filename: 'index.html#script' }); }
catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }

// ---- stub DOM/storage (richer than verify.cjs: tracks per-element value + classList for assertions) ----
const any = new Proxy(function () {}, { get(t, p) { if (p === Symbol.toPrimitive) return () => 0; if (p === 'toString' || p === 'valueOf') return () => ''; return any; }, apply() { return any; }, set() { return true; }, construct() { return any; } });
const mkEl = () => { const e = {
  value: '', _text: '', _cls: new Set(),
  style: { setProperty() {}, removeProperty() {} },
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
// NOTE: real timers (no setTimeout stub) so the verify Promise chain settles before we assert.

const driver = `
;(function(){
  // Stand in for the configured, connected backend with a stub client. verifyOtp (code path) and
  // getSession (link path, after detectSessionInUrl) each return a verified user; from() answers the
  // profile/achievement reads _adopt makes. _curSession lets path B flip getSession to "signed in".
  var codeUser = { id: 'auth-uid-CODE', email: 'pilot@neon.gg' };
  var linkUser = { id: 'auth-uid-LINK', email: 'ace@neon.gg' };
  var calls = { verifyOtp: null }, _curSession = null;
  var query = function(rows){ var t = {
    select:function(){return t}, eq:function(){return t}, order:function(){return t}, limit:function(){return t},
    single:function(){return Promise.resolve({data:null,error:null})},   // no profile row → name falls back to email local-part
    upsert:function(){return Promise.resolve({error:null})}, insert:function(){return Promise.resolve({error:null})},
    then:function(f,r){return Promise.resolve({data:rows||[],error:null}).then(f,r)} }; return t; };
  SB = { auth: {
      verifyOtp:function(args){ calls.verifyOtp = args; return Promise.resolve({data:{user:codeUser},error:null}); },
      getSession:function(){ return Promise.resolve({data:{session:_curSession}}); } },
    from:function(){ return query([]); } };
  // _fire() resolves UI hooks via globalThis; in a browser these classic-script fns live on window, so
  // expose them here to exercise onAuthResolved (the link path closes the modal through it).
  if (typeof onAuthResolved === 'function') globalThis.onAuthResolved = onAuthResolved;
  if (typeof onAuthRequired === 'function') globalThis.onAuthRequired = onAuthRequired;
  // Isolate the assertions to auth routing — neutralize downstream UI fan-out.
  if (typeof Ach !== 'undefined') Ach.renderPanel = function(){};

  var fails = [];
  var openModal = function(){ document.getElementById('username').classList.remove('hidden');
                              document.getElementById('start').classList.add('hidden'); };
  var adopted = function(u){ var p = getPlayer() || {};
    var uname = document.getElementById('username'), start = document.getElementById('start');
    return p.id === u.id && p.name === u.email.split('@')[0]
        && uname.classList.contains('hidden') && !start.classList.contains('hidden'); };

  // ---- Path A: typed 6-digit code → confirmOtp() ----
  openModal(); _otpStage = 'sent'; _otpEmail = codeUser.email;
  document.getElementById('authcode').value = '123456';
  confirmOtp();
  setTimeout(function(){
    var codeOK = !!(calls.verifyOtp && calls.verifyOtp.type === 'email' && calls.verifyOtp.token === '123456'
      && adopted(codeUser) && _otpStage === null);
    if (!codeOK) fails.push('CODE: verifyOtp=' + JSON.stringify(calls.verifyOtp) + ' player=' + JSON.stringify(getPlayer()));

    // ---- Path B: clicked magic link → SDK detected the session → resolveSession() on boot ----
    openModal(); _curSession = { user: linkUser };
    AchSync.resolveSession().then(function(r){
      var linkOK = !!(r && r.ok && r.id === linkUser.id && adopted(linkUser));
      if (!linkOK) fails.push('LINK: resolve=' + JSON.stringify(r) + ' player=' + JSON.stringify(getPlayer()));
      globalThis.__FAIL = fails.length ? 1 : 0;
      console.log(fails.length
        ? 'FAIL — ' + fails.join(' | ')
        : 'PASS — CODE: verifyOtp(type=email) → _adopt bound ' + codeUser.id + '; '
          + 'LINK: resolveSession → _adopt bound ' + linkUser.id + '; both closed modal onto menu');
      process.exit(globalThis.__FAIL);
    }, function(e){ console.error('LINK PATH ERROR:', e && e.message); process.exit(1); });
  }, 80);
})();
`;
try { eval(script + driver); } catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
