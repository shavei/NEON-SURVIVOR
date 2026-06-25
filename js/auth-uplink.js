/* NEON SURVIVOR — auth-uplink.js : the "GRID ACCESS" modal — one overlay, one stage machine, for the
 * whole identity flow. Classic global. Loads AFTER achievement-sync.js (drives AchSync's thin auth
 * wrappers + _adopt/pull) and BEFORE main.js (main only calls showAuth('local')/('editname') + bootMenu).
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

/* stage: 'login' | 'signup' | 'signup-code' | 'otp-code' | 'editname' | 'local' | 'callsign' */
let _stage = 'login';
let _authEmail = '';          // address a code went to (kept so verify/resend don't re-read a changed field)
let _pendingCallsign = '';    // callsign chosen on SIGNUP, applied when the signup code verifies

/* ----- tiny DOM + trace helpers ----- */
const _el = id => document.getElementById(id);
function _setShown(el, on) { if (el) el.style.display = on ? '' : 'none'; }
function _seterr(t) { const e = _el('unameerr'); if (e) e.textContent = t || ''; }
function _authReady() { try { return typeof AchSync !== 'undefined' && AchSync.enabled() && AchSync.ready(); } catch (e) { return false; } }
/* Login Debug Trace: opt-in (localStorage.neon_auth_debug=1) log of each state transition, so the
 * Email Sent → Code Verified → Profile Linked flow can be confirmed end-to-end without guessing. */
function _trace(stage, detail) { try { if (typeof localStorage !== 'undefined' && localStorage.getItem('neon_auth_debug')) console.log('[UPLINK] ' + stage + (detail ? '  → ' + detail : '')); } catch (e) {} }

/* ----- the stage renderer: one overlay, fields/labels swapped per stage ----- */
function _render(stage) {
  _stage = stage;
  const m = _el('username'); if (!m) return;
  const title = (m.querySelector && m.querySelector('.title')) || null;
  const email = _el('authemail'), pass = _el('authpass'), code = _el('authcode'), uname = _el('uname');
  _seterr('');
  // per-stage view config — [title, tag, okLabel, otpLabel|null, toggleLabel|null, {email,pass,code,uname}, focusId]
  const C = {
    'login':       ['GRID ACCESS', 'Sign in to sync your achievements across every device.', '✔ SIGN IN', '📧 Log in with a code instead', 'New here? Create an account', { email: 1, pass: 1 }, 'authemail'],
    'signup':      ['CREATE ACCOUNT', 'Set a password, then confirm with the 6-digit code we email you.', '✔ CREATE ACCOUNT', null, 'Have an account? Sign in', { email: 1, pass: 1, uname: 1 }, 'authemail'],
    'signup-code': ['CONFIRM EMAIL', 'Enter the 6-digit code sent to ' + _authEmail + ' to finish creating your account.', '✔ CONFIRM & ENTER', '↻ Resend code', '← Back', { code: 1 }, 'authcode'],
    'otp-code':    ['GRID ACCESS', 'Enter the 6-digit access code sent via secure uplink to ' + _authEmail + '.', '✔ VERIFY CODE', '↻ Resend code', '← Use password', { code: 1 }, 'authcode'],
    'editname':    ['EDIT NAME', 'How you show up on the global leaderboard. 3–16 characters.', '✔ SAVE', null, null, { uname: 1 }, 'uname'],
    'local':       ['PICK A CALLSIGN', 'How you show up on the global leaderboard. 3–16 characters.', '✔ CONFIRM', null, null, { uname: 1 }, 'uname'],
    'callsign':    ['CHOOSE CALLSIGN', 'Pick a callsign for the leaderboard. 3–16 characters.', '✔ ENTER THE GRID', null, null, { uname: 1 }, 'uname'],
  }[stage] || C_DEFAULT();
  const vis = C[5];
  _setShown(email, !!vis.email); _setShown(pass, !!vis.pass); _setShown(code, !!vis.code); _setShown(uname, !!vis.uname);
  if (title) title.textContent = C[0];
  const tag = _el('authtag'); if (tag) tag.textContent = C[1];
  const ok = _el('unameok'); if (ok) { ok.textContent = C[2]; ok.disabled = false; }
  const otp = _el('authotp'); _setShown(otp, !!C[3]); if (otp && C[3]) { otp.textContent = C[3]; otp.disabled = false; }
  const toggle = _el('authtoggle'); _setShown(toggle, !!C[4]); if (toggle && C[4]) toggle.textContent = C[4];
  if (code && vis.code) code.value = '';                          // a fresh code stage always starts empty
  if (uname && vis.uname) { const p = (typeof getPlayer === 'function') && getPlayer(); uname.value = (stage === 'editname' && p) ? p.name : ''; }
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
    _close();
    if (typeof Ach !== 'undefined') Ach.renderPanel();
    if (typeof LBSync !== 'undefined') LBSync.syncAll();
  } else _seterr((r && r.error) || 'Something went wrong.');
}

/* ----- the single OK handler — dispatches on _stage ----- */
function confirmUsername() {
  // local name stages (offline first-run, rename, post-OTP callsign): no cloud round-trip
  if (_stage === 'editname' || _stage === 'local' || _stage === 'callsign') {
    const n = (typeof sanitizeName === 'function') ? sanitizeName(_el('uname').value) : (_el('uname').value || '').trim();
    if (n.length < 3) { _seterr('Please use at least 3 characters.'); return; }
    if ((_stage === 'editname' || _stage === 'callsign') && _authReady()) AchSync.updateName(n);
    else if (typeof savePlayer === 'function') savePlayer(n);
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
      if (r && r.ok) _trace('code-verified', 'uid=' + (r.id || '').slice(0, 8) + ' (' + type + ')');
      _finishAuth(r);
    }, function () { _finishAuth({ ok: false, error: 'Network error.' }); });
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
    _authEmail = email; _pendingCallsign = name; _seterr('Creating account…');
    AchSync.pwSignUp(email, pass).then(function (r) {
      if (!r || !r.ok) { if (ok) ok.disabled = false; _seterr((r && r.error) || 'Sign-up failed.'); return; }
      _trace('signup-requested', email);
      if (r.hasSession) {                                        // email-confirm OFF → already signed in
        AchSync._adopt(r.user, _pendingCallsign).then(_finishAuth, function () { _finishAuth({ ok: false, error: 'Network error.' }); });
      } else { _seterr(''); _render('signup-code'); }            // the usual path: collect the emailed code
    }, function () { if (ok) ok.disabled = false; _seterr('Network error.'); });
    return;
  }
  // LOGIN (primary, password)
  _seterr('Signing in…');
  AchSync.signIn(email, pass).then(function (r) {
    if (r && r.ok) _trace('password-login', 'uid=' + (r.id || '').slice(0, 8));
    _finishAuth(r);
  }, function () { _finishAuth({ ok: false, error: 'Network error.' }); });
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
  }, function () { if (otp) otp.disabled = false; _seterr('Network error.'); });
}

/* resend the code currently in flight (signup confirmation or alternate-login code) */
function _resend() {
  const otp = _el('authotp'); if (otp) otp.disabled = true; _seterr('Resending…');
  const p = _stage === 'signup-code' ? AchSync.resend(_authEmail, 'signup') : AchSync.otpRequest(_authEmail, false);
  p.then(function (r) { if (otp) otp.disabled = false; _seterr(r && r.ok ? 'Code resent.' : ((r && r.error) || 'Couldn’t resend.')); },
    function () { if (otp) otp.disabled = false; _seterr('Network error.'); });
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
function onAuthResolved() { _hideBoot(); _close(); if (typeof Ach !== 'undefined') Ach.renderPanel(); if (typeof LBSync !== 'undefined') LBSync.syncAll(); _trace('instant-resume', 'session restored'); }
function onAuthRequired() { _hideBoot(); showAuth('login'); }                       // SDK up, no session → ask to sign in
function onAuthOffline() { _hideBoot(); if (typeof getPlayer === 'function' && !getPlayer()) showAuth('local'); else { const s = _el('start'); if (s) s.classList.remove('hidden'); } }

/* ----- self-wiring (keeps main.js untouched / under the 28 KB line) ----- */
if (typeof _isBrowser !== 'undefined' && _isBrowser) {
  const ok = _el('unameok'); if (ok) ok.onclick = confirmUsername;
  const otp = _el('authotp'); if (otp) otp.onclick = function () { if (_stage === 'login') _startOtpLogin(); else _resend(); };
  const toggle = _el('authtoggle'); if (toggle) toggle.onclick = _authToggle;
  const edit = _el('editname'); if (edit) edit.onclick = function () { showAuth('editname'); };
  ['uname', 'authemail', 'authpass', 'authcode'].forEach(function (id) {
    const inp = _el(id); if (inp && inp.addEventListener) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') confirmUsername(); });
  });
}
