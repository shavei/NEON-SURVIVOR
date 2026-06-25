/* NEON SURVIVOR — auth-otp.js : browserless OTP (6-digit email code) sign-in, ALONGSIDE the existing
 * email+password flow. Classic global. Loads AFTER achievement-sync.js (extends AchSync, reuses _adopt /
 * showAuth / confirmUsername) and BEFORE main.js. Headless/offline-safe: every SB/DOM touch is guarded.
 *
 * Why OTP: no browser redirect, no magic-link round-trip — the player types a code straight into the
 * in-game modal. We pivot only HOW the session is obtained (signInWithOtp → verifyOtp); everything
 * downstream (AchSync._adopt → savePlayer(name,user.id) → pull) is identical to the password path, so
 * the same durable user_id keys leaderboards + achievements on every device.
 *
 * Modal: reuses the #username overlay. The signin/signup screens show a "📧 Email me a code" button;
 * clicking it sends the code and reveals #authcode. _otpStage ('sent') routes confirmUsername() here. */

let _otpStage = null;        // null = password mode · 'sent' = a code is out, OK button verifies it
let _otpEmail = '';          // the address we sent to (kept so resend/verify don't re-read a changed field)

/* ----- AchSync auth methods (assigned here to keep the OTP surface in this file) ----- */

/* send a 6-digit code; shouldCreateUser lets first-timers sign up with the same call (no separate signup) */
AchSync.sendOtp = function (email) {
  if (!this.ready()) return Promise.resolve({ ok: false, error: 'Offline — can’t email a code right now.' });
  try {
    return SB.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } }).then(
      function (res) { return (res && res.error) ? { ok: false, error: res.error.message || 'Couldn’t send the code.' } : { ok: true }; },
      function () { return { ok: false, error: 'Network error.' }; });
  } catch (e) { return Promise.resolve({ ok: false, error: 'Network error.' }); }
};

/* verify the typed code → adopt the resulting session (same path as password sign-in). type:'email'
 * covers both new and returning users when the code came from signInWithOtp+shouldCreateUser. */
AchSync.verifyOtp = function (email, token) {
  if (!this.ready()) return Promise.resolve({ ok: false, error: 'Offline — can’t verify right now.' });
  const self = this;
  try {
    return SB.auth.verifyOtp({ email: email, token: token, type: 'email' }).then(
      function (res) {
        if (res && res.error) return { ok: false, error: res.error.message || 'Invalid or expired code.' };
        const user = res && res.data && res.data.user;
        if (!user) return { ok: false, error: 'Invalid or expired code.' };
        return self._adopt(user);
      }, function () { return { ok: false, error: 'Network error.' }; });
  } catch (e) { return Promise.resolve({ ok: false, error: 'Network error.' }); }
};

/* ----- modal handlers (reuse the #username overlay elements) ----- */

/* "Email me a code" / "Resend code": validate the email, send, then reveal the code field */
function startOtp() {
  const err = document.getElementById('unameerr'), seterr = t => { if (err) err.textContent = t; };
  const email = (document.getElementById('authemail').value || '').trim();
  if (!/.+@.+\..+/.test(email)) { seterr('Enter a valid email address.'); return; }
  if (typeof AchSync === 'undefined' || !AchSync.enabled() || !AchSync.ready()) { seterr('Offline — can’t email a code right now.'); return; }
  _otpEmail = email; seterr('Sending code…');
  const otpbtn = document.getElementById('authotp'); if (otpbtn) otpbtn.disabled = true;
  AchSync.sendOtp(email).then(function (r) {
    if (otpbtn) otpbtn.disabled = false;
    if (!r || !r.ok) { seterr((r && r.error) || 'Couldn’t send the code.'); return; }
    _otpStage = 'sent';
    _setShown(document.getElementById('authpass'), false);                 // password not needed on the OTP path
    const code = document.getElementById('authcode'); _setShown(code, true);
    if (code) { code.value = ''; try { code.focus(); } catch (e) {} }
    const tag = document.getElementById('authtag'); if (tag) tag.textContent = 'Enter the 6-digit access code sent via secure uplink to ' + _otpEmail + ' — or just tap the link in that email.';
    const ok = document.getElementById('unameok'); if (ok) ok.textContent = '✔ VERIFY CODE';
    if (otpbtn) otpbtn.textContent = '↻ Resend code';
    seterr('');
  }, function () { if (otpbtn) otpbtn.disabled = false; seterr('Network error.'); });
}

/* verify the typed code; on success close the modal exactly like the password path does */
function confirmOtp() {
  const err = document.getElementById('unameerr'), seterr = t => { if (err) err.textContent = t; };
  const code = (document.getElementById('authcode').value || '').replace(/\D/g, '');
  if (code.length !== 6) { seterr('Enter the 6-digit code.'); return; }
  seterr('Verifying…');
  const ok = document.getElementById('unameok'); if (ok) ok.disabled = true;
  AchSync.verifyOtp(_otpEmail, code).then(function (r) {
    if (ok) ok.disabled = false;
    if (r && r.ok) {
      _otpStage = null;
      document.getElementById('username').classList.add('hidden');
      document.getElementById('start').classList.remove('hidden');
      if (typeof Ach !== 'undefined') Ach.renderPanel();
      if (typeof LBSync !== 'undefined') LBSync.syncAll();
    } else seterr((r && r.error) || 'Invalid or expired code.');
  }, function () { if (ok) ok.disabled = false; seterr('Network error.'); });
}

/* ----- self-wiring (keeps main.js untouched / under the 28 KB line) ----- */
if (typeof _isBrowser !== 'undefined' && _isBrowser) {
  const _otp = document.getElementById('authotp'); if (_otp) _otp.onclick = startOtp;
  const _code = document.getElementById('authcode'); if (_code) _code.addEventListener('keydown', e => { if (e.key === 'Enter') confirmUsername(); });
}
