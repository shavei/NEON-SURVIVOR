#!/usr/bin/env node
/* NEON SURVIVOR — verify-otp.cjs : headless verifier for the CODE-based halves of the GRID ACCESS flow.
 * Run after editing js/auth-uplink.js / js/achievement-sync.js / the #username modal:
 *   node .claude/skills/neon-survivor/verify-otp.cjs
 *
 * The current identity module (js/auth-uplink.js) is a one-overlay stage machine — confirmUsername()
 * dispatches on `_stage` (login | signup | signup-code | otp-code | local | callsign). This harness drives
 * the two CODE entry points + the instant-resume path WITHOUT a network, against a stub Supabase client:
 *   A) SIGNUP CODE — a new account confirms its emailed 6-digit code AND claims a callsign in the same step.
 *      We set _stage='signup-code' (as the modal does after pwSignUp) and assert verifyOtp got {type:'signup'},
 *      _setProfile wrote the callsign, _adopt bound the auth user_id, and the modal closed onto the menu.
 *   B) OTP LOGIN — the alternate "log in with a code" for an EXISTING account. _stage='otp-code'; we assert
 *      verifyOtp got {type:'email'}, _adopt bound the user_id, and the name fell back to the email local-part.
 *   C) INSTANT RESUME — a durable refresh-token session: AchSync.resolveSession() adopts it on boot and
 *      onAuthResolved() closes the modal. (Same _adopt path; proves cross-device id continuity.)
 * Every path must adopt the durable user_id so leaderboards + achievements key identically on every device.
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

// ---- stub DOM/storage (tracks per-element value + classList so we can assert UI state) ----
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
g.fetch = () => Promise.reject(new Error('offline'));   // no network in the OTP verifier
// NOTE: real timers (no setTimeout stub) so the verify Promise chain settles before we assert.

const driver = `
;(function(){
  // Stub the configured, connected backend. verifyOtp returns a user keyed by the code's type (signup vs
  // email), so paths A & B get distinct durable ids. getSession drives the instant-resume path (C). from()
  // answers the profile/achievement reads _adopt makes; upsert records the callsign write _setProfile does.
  var signupUser = { id: 'auth-uid-SIGNUP', email: 'rookie@neon.gg' };
  var loginUser  = { id: 'auth-uid-LOGIN',  email: 'ace@neon.gg' };
  var calls = { verifyOtp: null, upsert: null }, _curSession = null;
  var query = function(rows){ var t = {
    select:function(){return t}, eq:function(){return t}, order:function(){return t}, limit:function(){return t},
    single:function(){return Promise.resolve({data:null,error:null})},   // no profile row → name falls back to email local-part
    upsert:function(row){ calls.upsert = row; return Promise.resolve({error:null}); },
    insert:function(){return Promise.resolve({error:null})},
    then:function(f,r){return Promise.resolve({data:rows||[],error:null}).then(f,r)} }; return t; };
  SB = { auth: {
      signInWithPassword:function(){ return Promise.resolve({data:{user:loginUser},error:null}); },
      signInWithOtp:function(){ return Promise.resolve({data:{},error:null}); },
      verifyOtp:function(args){ calls.verifyOtp = args; var u = args.type === 'signup' ? signupUser : loginUser; return Promise.resolve({data:{user:u},error:null}); },
      resend:function(){ return Promise.resolve({error:null}); },
      getSession:function(){ return Promise.resolve({data:{session:_curSession}}); },
      signOut:function(){ return Promise.resolve(); } },
    rpc:function(){ return Promise.resolve({data:true,error:null}); },
    from:function(){ return query([]); } };

  // expose the classic-script UI hooks on globalThis so AchSync._fire can reach them (browser → window)
  if (typeof onAuthResolved === 'function') globalThis.onAuthResolved = onAuthResolved;
  if (typeof onAuthRequired === 'function') globalThis.onAuthRequired = onAuthRequired;
  // Isolate the assertions to auth routing — neutralize downstream UI fan-out.
  if (typeof Ach !== 'undefined') Ach.renderPanel = function(){};
  if (typeof LBSync !== 'undefined') LBSync.syncAll = function(){};

  var fails = [];
  var $ = function(id){ return document.getElementById(id); };
  var openModal = function(){ $('username').classList.remove('hidden'); $('start').classList.add('hidden'); };
  var closed = function(){ return $('username').classList.contains('hidden') && !$('start').classList.contains('hidden'); };
  var adopted = function(u, name){ var p = getPlayer() || {}; return p.id === u.id && (name == null || p.name === name); };

  // ---- Path A: SIGNUP code + callsign → confirmUsername() on _stage='signup-code' ----
  openModal(); _authEmail = signupUser.email; _pendingCallsign = 'Rookie'; _render('signup-code');
  $('authcode').value = '123456';
  confirmUsername();
  setTimeout(function(){
    var aOK = !!(calls.verifyOtp && calls.verifyOtp.type === 'signup' && calls.verifyOtp.token === '123456'
      && calls.upsert && calls.upsert.username === 'Rookie'
      && adopted(signupUser, 'Rookie') && closed());
    if (!aOK) fails.push('SIGNUP-CODE: verifyOtp=' + JSON.stringify(calls.verifyOtp) + ' upsert=' + JSON.stringify(calls.upsert) + ' player=' + JSON.stringify(getPlayer()) + ' closed=' + closed());

    // ---- Path B: OTP alternate login → confirmUsername() on _stage='otp-code' ----
    calls.verifyOtp = null;
    openModal(); _authEmail = loginUser.email; _render('otp-code');
    $('authcode').value = '654321';
    confirmUsername();
    setTimeout(function(){
      var bOK = !!(calls.verifyOtp && calls.verifyOtp.type === 'email' && calls.verifyOtp.token === '654321'
        && adopted(loginUser, loginUser.email.split('@')[0]) && closed());
      if (!bOK) fails.push('OTP-CODE: verifyOtp=' + JSON.stringify(calls.verifyOtp) + ' player=' + JSON.stringify(getPlayer()) + ' closed=' + closed());

      // ---- Path C: instant resume → resolveSession() adopts an existing session ----
      openModal(); _curSession = { user: loginUser };
      AchSync.resolveSession().then(function(r){
        var cOK = !!(r && r.ok && r.id === loginUser.id && adopted(loginUser) && closed());
        if (!cOK) fails.push('RESUME: resolve=' + JSON.stringify(r) + ' player=' + JSON.stringify(getPlayer()) + ' closed=' + closed());
        globalThis.__FAIL = fails.length ? 1 : 0;
        console.log(fails.length
          ? 'FAIL — ' + fails.join(' | ')
          : 'PASS — SIGNUP-CODE: verifyOtp(type=signup)+callsign → _adopt bound ' + signupUser.id + '; '
            + 'OTP-CODE: verifyOtp(type=email) → _adopt bound ' + loginUser.id + '; '
            + 'RESUME: resolveSession → _adopt bound ' + loginUser.id + '; all closed the modal onto the menu');
        process.exit(globalThis.__FAIL);
      }, function(e){ console.error('RESUME PATH ERROR:', e && e.message); process.exit(1); });
    }, 60);
  }, 60);
})();
`;
try { eval(script + driver); } catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
