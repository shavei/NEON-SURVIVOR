/* NEON SURVIVOR — auth-uplink.js : the "GRID ACCESS" modal — one overlay, one stage machine, for the
 * whole identity flow. Classic global. Loads AFTER achievement-sync.js (drives AchSync's thin auth
 * wrappers + _adopt/pull) and BEFORE main.js (main only calls showAuth('local') + bootMenu).
 * Headless/offline-safe: every SB/DOM/storage touch is guarded, so verify*.cjs load it clean.
 *
 * Identity, the way the player experiences it:
 *   LOGIN (primary)  — email + password → signInWithPassword.
 *   LOGIN (alternate)— "log in with a code" → signInWithOtp(shouldCreateUser:false) → verifyOtp(type:'email').
 *                      No account for that email? We nudge the player to CREATE one (every account is
 *                      password-backed) rather than minting a passwordless one.
 *   SIGNUP           — set a password (signUp) AND confirm the email with the 6-digit code Supabase
 *                      mails (verifyOtp type:'signup'), all in-modal. Callsign captured up-front.
 * Every successful path funnels through AchSync._adopt(user[,callsign]) → savePlayer(name,user.id) → pull,
 * so the SAME durable user_id keys leaderboards + achievements on every device, however you signed in. */

/* stage: 'login' | 'signup' | 'signup-code' | 'otp-code' | 'local' | 'callsign'
 * (callsigns are UNIQUE & set-once — see supabase/schema.sql — so there is no rename/'editname' stage) */
let _stage = 'login';
let _authEmail = '';          // address a code went to (kept so verify/resend don't re-read a changed field)
let _pendingCallsign = '';    // callsign chosen on SIGNUP, applied when the signup code verifies

/* ----- tiny DOM + trace helpers ----- */
const _el = id => document.getElementById(id);
function _setShown(el, on) { if (el) el.style.display = on ? '' : 'none'; }
function _seterr(t) { const e = _el('unameerr'); if (e) e.textContent = t ? tr(t) : ''; }   // tr(): unknown strings pass through untranslated
function _authReady() { try { return typeof AchSync !== 'undefined' && AchSync.enabled() && AchSync.ready(); } catch (e) { return false; } }
/* Login Debug Trace: opt-in (localStorage.neon_auth_debug=1) log of each state transition, so the
 * Email Sent → Code Verified → Profile Linked flow can be confirmed end-to-end without guessing. */
function _trace(stage, detail) { try { if (typeof localStorage !== 'undefined' && localStorage.getItem('neon_auth_debug')) console.log('[UPLINK] ' + stage + (detail ? '  → ' + detail : '')); } catch (e) {} }

/* ----- ONLINE / OFFLINE identity badge (#netstatus on the menu, #gonet on the death screen) -----
 * Makes it unmistakable whether a run will reach the GLOBAL leaderboard: the cloud write needs both the
 * SDK connected (a run token can open + /api/verify is reachable) AND a live browser connection. `_signedIn`
 * is latched by the auth hooks below (true = durable cloud account). Headless/offline-safe: DOM-guarded. */
let _signedIn = false;
function _netEsc(s) { return String(s || '').replace(/[&<>]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; }); }
function _netOnline() { try { return (typeof SB !== 'undefined' && !!SB) && (typeof navigator === 'undefined' || navigator.onLine !== false); } catch (e) { return false; } }
function renderNetStatus() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const on = _netOnline(), nm = ((typeof getPlayer === 'function' && getPlayer()) || {}).name || '';
  const main = on ? (_signedIn && nm ? tr('ONLINE — logged in as') + ' ' + _netEsc(nm) : tr('ONLINE'))
                  : tr('OFFLINE — this device only');
  const sub = on ? tr('Your runs post to the global leaderboard.')
                 : tr('No connection — runs are saved here but won’t reach the leaderboard.');
  const html = '<span class="nsdot"></span><span><b>' + main + '</b><span class="nssub">' + sub + '</span></span>';
  ['netstatus', 'gonet'].forEach(function (id) {
    const el = _el(id); if (!el) return;
    el.className = 'netstatus' + (id === 'gonet' ? ' netstatus--go' : '') + ' ' + (on ? 'on' : 'off');
    el.innerHTML = html;
  });
}
/* auth hooks call this to latch the durable-account flag, then repaint the badge */
function _setSignedIn(v) { _signedIn = !!v; renderNetStatus(); }

/* callsign input border feedback: '' neutral · 'ok' green pulse (available) · 'taken' red pulse (claimed) */
function _unameState(s) { const u = _el('uname'); if (!u || !u.classList) return; u.classList.remove('ok', 'taken'); if (s) u.classList.add(s); }
/* cross-language censorship gate (js/callsign-filter.js). Fires the red/orange alarm pulse + 'SYSTEM ACCESS
 * DENIED' BEFORE any cloud write, so a flagged callsign never reaches Supabase. Filter absent → allow. */
function _restricted(n) { try { return typeof CallsignFilter !== 'undefined' && CallsignFilter.blocked(n); } catch (e) { return false; } }
/* hardened denial: red 'taken' border pulse + an inline RED/ORANGE alarm glow (no CSS-file touch), and the
 * unambiguous lockout message. The glow self-clears after ~900 ms so the field returns to neutral. */
let _rsTimer = 0;
function _flagRestricted() {
  _unameState('taken');
  const u = _el('uname');
  if (u && u.style) {
    u.style.boxShadow = '0 0 14px 2px #ff7a18, 0 0 6px 1px #ff2d2d inset';
    try { clearTimeout(_rsTimer); } catch (e) {}
    _rsTimer = setTimeout(function () { if (u && u.style) u.style.boxShadow = ''; }, 900);
  }
  _seterr('SYSTEM ACCESS DENIED: RESTRICTED CALLSIGN');
}
/* debounced live availability check (250 ms). Only the cloud callsign stages query; a stale response
 * (user kept typing) is dropped by token; an inconclusive/offline check leaves the border neutral. */
let _ckTimer = 0, _ckToken = 0;
function _checkCallsign() {
  if (_stage !== 'signup' && _stage !== 'callsign') return;
  try { clearTimeout(_ckTimer); } catch (e) {}
  const raw = (_el('uname') || {}).value || '';
  const n = (typeof sanitizeName === 'function') ? sanitizeName(raw) : raw.trim();
  if (n.length >= 3 && _restricted(n)) { _flagRestricted(); return; }              // censored → red pulse, no query
  if (n.length < 3 || !_authReady() || typeof AchSync === 'undefined') { _unameState(''); return; }
  const token = ++_ckToken;
  _ckTimer = setTimeout(function () {
    AchSync.callsignAvailable(n).then(function (r) {
      if (token !== _ckToken) return;                              // a newer keystroke superseded this check
      _unameState((r && r.ok) ? (r.available ? 'ok' : 'taken') : '');
    });
  }, 250);
}

/* ----- the stage renderer: one overlay, fields/labels swapped per stage ----- */
function _render(stage) {
  _stage = stage;
  const m = _el('username'); if (!m) return;
  const title = (m.querySelector && m.querySelector('.title')) || null;
  const email = _el('authemail'), pass = _el('authpass'), code = _el('authcode'), uname = _el('uname');
  _seterr('');
  // per-stage view config — [title, tag, okLabel, otpLabel|null, toggleLabel|null, {email,pass,code,uname}, focusId]
  const C = {
    'login':       ['GRID ACCESS', 'Link up to carry your callsign, achievements and best runs across every device.', '✔ JACK IN', '📧 Send me an access code', 'New operator? Register', { email: 1, pass: 1 }, 'authemail'],
    'signup':      ['NEW OPERATOR', 'Set a password, then confirm with the 6-digit code we uplink to your email.', '✔ REGISTER', null, 'Already on the grid? Sign in', { email: 1, pass: 1, uname: 1 }, 'authemail'],
    'signup-code': ['VERIFY UPLINK', tr('Enter the 6-digit code sent to') + ' ' + _authEmail + ' ' + tr('to bring your operator online.'), '✔ CONFIRM & ENTER', '↻ Resend code', '← Back', { code: 1 }, 'authcode'],
    'otp-code':    ['GRID ACCESS', tr('Enter the 6-digit access code uplinked to') + ' ' + _authEmail + '.', '✔ VERIFY CODE', '↻ Resend code', '← Use password', { code: 1 }, 'authcode'],
    // 'local' (offline first-run) and 'callsign' (signed-in claim) share ONE copy — same action, same words.
    'local':       ['CHOOSE CALLSIGN', 'Your handle on the global grid. 3–16 characters.', '✔ ENTER THE GRID', null, null, { uname: 1 }, 'uname'],
    'callsign':    ['CHOOSE CALLSIGN', 'Your handle on the global grid. 3–16 characters.', '✔ ENTER THE GRID', null, null, { uname: 1 }, 'uname'],
  }[stage] || C_DEFAULT();
  const vis = C[5];
  _setShown(email, !!vis.email); _setShown(pass, !!vis.pass); _setShown(code, !!vis.code); _setShown(uname, !!vis.uname);
  if (title) title.textContent = tr(C[0]);
  const tag = _el('authtag'); if (tag) tag.textContent = tr(C[1]);
  const ok = _el('unameok'); if (ok) { ok.textContent = tr(C[2]); ok.disabled = false; }
  const otp = _el('authotp'); _setShown(otp, !!C[3]); if (otp && C[3]) { otp.textContent = tr(C[3]); otp.disabled = false; }
  const toggle = _el('authtoggle'); _setShown(toggle, !!C[4]); if (toggle && C[4]) toggle.textContent = tr(C[4]);
  if (code && vis.code) code.value = '';                          // a fresh code stage always starts empty
  if (uname && vis.uname) { uname.value = ''; _unameState(''); }  // callsign is always typed fresh; clear any prior pulse
  m.classList.remove('hidden'); const s = _el('start'); if (s) s.classList.add('hidden');
  const f = _el(C[6]); if (f) try { f.focus(); } catch (e) {}
}
function C_DEFAULT() { return ['GRID ACCESS', '', '✔ OK', null, null, { email: 1, pass: 1 }, 'authemail']; }

/* public entry (main.js / onAuth* call this): reset transient state, then render the chosen mode */
function showAuth(mode) { _authEmail = ''; _pendingCallsign = ''; _render(mode); }

function _close() { const m = _el('username'); if (m) m.classList.add('hidden'); const s = _el('start'); if (s) s.classList.remove('hidden'); }

/* resolve the success of any cloud auth: close to the menu + refresh panels, or surface the error */
function _finishAuth(r) {
  const ok = _el('unameok'); if (ok) ok.disabled = false;
  if (r && r.ok) {
    _trace('profile-linked', 'name="' + (r.name || '') + '" id=' + (r.id || '').slice(0, 8));
    _setSignedIn(true);                                            // durable cloud account is live
    _close();
    if (typeof Ach !== 'undefined') Ach.renderPanel();
    if (typeof LBSync !== 'undefined') LBSync.syncAll();
  } else _seterr((r && r.error) || 'Uplink failed — try again.');
}

/* ----- the single OK handler — dispatches on _stage ----- */
function confirmUsername() {
  // callsign stages. 'local' = offline first-run (legacy uuid, no cloud, no uniqueness). 'callsign' =
  // a signed-in user claiming their (unique, set-once) callsign — a cloud write that can come back TAKEN.
  if (_stage === 'local' || _stage === 'callsign') {
    const n = (typeof sanitizeName === 'function') ? sanitizeName(_el('uname').value) : (_el('uname').value || '').trim();
    if (n.length < 3) { _seterr('Please use at least 3 characters.'); return; }
    if (_restricted(n)) { _flagRestricted(); return; }
    if (_stage === 'callsign' && _authReady()) {
      const id = ((typeof getPlayer === 'function' && getPlayer()) || {}).id;
      const ok = _el('unameok'); if (ok) ok.disabled = true; _seterr('Claiming callsign…');
      AchSync._setProfile(id, n).then(function (r) {
        if (ok) ok.disabled = false;
        if (r && r.taken) { _unameState('taken'); _seterr('CALLSIGN ALREADY CLAIMED'); return; }
        if (!r || !r.ok) { _seterr('Couldn’t save the callsign — try again.'); return; }
        if (typeof savePlayer === 'function') savePlayer(n, id);
        _setSignedIn(true);                                        // signed in + callsign now claimed
        _close(); if (typeof LBSync !== 'undefined') LBSync.syncAll();
        _trace('profile-linked', 'callsign="' + n + '"');
      }, function () { if (ok) ok.disabled = false; _seterr('Grid unreachable — try again.'); });
      return;
    }
    if (typeof savePlayer === 'function') savePlayer(n);
    _setSignedIn(false);                                           // local-only name (no cloud account)
    _close(); if (typeof LBSync !== 'undefined') LBSync.syncAll();
    _trace('profile-linked', 'callsign="' + n + '"');
    return;
  }
  // code stages: verify the 6 digits
  if (_stage === 'signup-code' || _stage === 'otp-code') {
    const c = (_el('authcode').value || '').replace(/\D/g, '');
    if (c.length !== 6) { _seterr('Enter the 6-digit code.'); return; }
    _seterr('Verifying…'); const ok = _el('unameok'); if (ok) ok.disabled = true;
    const type = _stage === 'signup-code' ? 'signup' : 'email';
    AchSync.verifyCode(_authEmail, c, type, _stage === 'signup-code' ? _pendingCallsign : '').then(function (r) {
      // session is live but the chosen callsign was claimed first → drop into the callsign stage to retry
      if (r && r.taken) { _render('callsign'); _unameState('taken'); _seterr('CALLSIGN ALREADY CLAIMED'); return; }
      if (r && r.ok) _trace('code-verified', 'uid=' + (r.id || '').slice(0, 8) + ' (' + type + ')');
      _finishAuth(r);
    }, function () { _finishAuth({ ok: false, error: 'Grid unreachable — try again.' }); });
    return;
  }
  // email+password stages: LOGIN or SIGNUP
  const email = (_el('authemail').value || '').trim(), pass = _el('authpass').value || '';
  if (!/.+@.+\..+/.test(email)) { _seterr('Enter a valid email address.'); return; }
  if (pass.length < 6) { _seterr('Password must be at least 6 characters.'); return; }
  if (!_authReady()) { _seterr('Offline — can’t reach the grid right now.'); return; }
  const ok = _el('unameok'); if (ok) ok.disabled = true;

  if (_stage === 'signup') {
    const name = (typeof sanitizeName === 'function') ? sanitizeName(_el('uname').value) : '';
    if (name.length < 3) { if (ok) ok.disabled = false; _seterr('Callsign: at least 3 characters.'); return; }
    if (_restricted(name)) { if (ok) ok.disabled = false; _flagRestricted(); return; }
    _authEmail = email; _pendingCallsign = name; _seterr('Creating account…');
    AchSync.pwSignUp(email, pass).then(function (r) {
      if (!r || !r.ok) { if (ok) ok.disabled = false; _seterr((r && r.error) || 'Sign-up failed.'); return; }
      _trace('signup-requested', email);
      if (r.hasSession) {                                        // email-confirm OFF → already signed in
        AchSync._adopt(r.user, _pendingCallsign).then(function (a) {
          if (a && a.taken) { _render('callsign'); _unameState('taken'); _seterr('CALLSIGN ALREADY CLAIMED'); return; }
          _finishAuth(a);
        }, function () { _finishAuth({ ok: false, error: 'Grid unreachable — try again.' }); });
      } else { _seterr(''); _render('signup-code'); }            // the usual path: collect the emailed code
    }, function () { if (ok) ok.disabled = false; _seterr('Grid unreachable — try again.'); });
    return;
  }
  // LOGIN (primary, password)
  _seterr('Signing in…');
  AchSync.signIn(email, pass).then(function (r) {
    if (r && r.ok) _trace('password-login', 'uid=' + (r.id || '').slice(0, 8));
    _finishAuth(r);
  }, function () { _finishAuth({ ok: false, error: 'Grid unreachable — try again.' }); });
}

/* ----- secondary buttons ----- */

/* alternate login: email a 6-digit code for an EXISTING account (no account → nudge to signup) */
function _startOtpLogin() {
  const email = (_el('authemail').value || '').trim();
  if (!/.+@.+\..+/.test(email)) { _seterr('Enter your email above first.'); return; }
  if (!_authReady()) { _seterr('Offline — can’t email a code right now.'); return; }
  _authEmail = email; _seterr('Sending code…');
  const otp = _el('authotp'); if (otp) otp.disabled = true;
  AchSync.otpRequest(email, false).then(function (r) {
    if (otp) otp.disabled = false;
    if (r && r.ok) { _trace('otp-requested', email); _render('otp-code'); }
    else {
      const msg = (r && r.error) || 'Couldn’t send the code.';
      _seterr(/not allowed|signup|not found|no user|invalid/i.test(msg) ? 'No account for that email — tap “New here? Create an account”.' : msg);
    }
  }, function () { if (otp) otp.disabled = false; _seterr('Grid unreachable — try again.'); });
}

/* resend the code currently in flight (signup confirmation or alternate-login code) */
function _resend() {
  const otp = _el('authotp'); if (otp) otp.disabled = true; _seterr('Resending…');
  const p = _stage === 'signup-code' ? AchSync.resend(_authEmail, 'signup') : AchSync.otpRequest(_authEmail, false);
  p.then(function (r) { if (otp) otp.disabled = false; _seterr(r && r.ok ? 'Code resent.' : ((r && r.error) || 'Couldn’t resend.')); },
    function () { if (otp) otp.disabled = false; _seterr('Grid unreachable — try again.'); });
}

/* the toggle link: meaning depends on the stage (create↔signin, or back out of a code stage) */
function _authToggle() {
  if (_stage === 'login') _render('signup');
  else if (_stage === 'signup') _render('login');
  else if (_stage === 'signup-code') _render('signup');
  else if (_stage === 'otp-code') showAuth('login');
}

/* ----- AchSync → UI hooks (fired via AchSync._fire / globalThis lookup) ----- */
function _hideBoot() { const b = _el('boot'); if (b) b.classList.add('hidden'); }
function onAuthResolved() { _hideBoot(); _setSignedIn(true); _close(); if (typeof Ach !== 'undefined') Ach.renderPanel(); if (typeof LBSync !== 'undefined') LBSync.syncAll(); _trace('instant-resume', 'session restored'); }
function onAuthRequired() { _hideBoot(); _setSignedIn(false); showAuth('login'); }   // SDK up, no session → ask to sign in
function onAuthOffline() { _hideBoot(); _setSignedIn(false); if (typeof getPlayer === 'function' && !getPlayer()) showAuth('local'); else { const s = _el('start'); if (s) s.classList.remove('hidden'); } }

/* ----- self-wiring (keeps main.js untouched / under the 28 KB line) ----- */
if (typeof _isBrowser !== 'undefined' && _isBrowser) {
  const ok = _el('unameok'); if (ok) ok.onclick = confirmUsername;
  const otp = _el('authotp'); if (otp) otp.onclick = function () { if (_stage === 'login') _startOtpLogin(); else _resend(); };
  const toggle = _el('authtoggle'); if (toggle) toggle.onclick = _authToggle;
  ['uname', 'authemail', 'authpass', 'authcode'].forEach(function (id) {
    const inp = _el(id); if (inp && inp.addEventListener) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') confirmUsername(); });
  });
  const un = _el('uname'); if (un && un.addEventListener) un.addEventListener('input', _checkCallsign);   // live callsign availability
  // a mid-session network drop must flip the badge to OFFLINE even without an auth event
  if (typeof addEventListener === 'function') { addEventListener('online', renderNetStatus); addEventListener('offline', renderNetStatus); }
  renderNetStatus();   // paint the initial (pre-connect) state so the badge is never blank
}
