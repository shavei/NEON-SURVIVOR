/* NEON SURVIVOR — achievement-sync.js : persistent identity + cloud achievement hydration.
 * Classic global. Loads AFTER net.js (needs SB/getPlayer/savePlayer) and achievements.js (needs Ach),
 * BEFORE main.js (main wires the modal + boot to AchSync). Headless/offline-safe: every SB/DOM/storage
 * touch is guarded, so verify*.cjs load it clean and offline play never throws (SB===null → no-ops).
 *
 * Identity model: Supabase Auth (email+password) issues a durable user_id that survives a browser
 * clear via the refresh token. On login we adopt that id into neon_player (net.js) so every existing
 * caller (submitScore, Ach.onRunStart, /api/verify) keys to the SAME id on every device. The local
 * `neon_ach:<id>` mirror becomes a per-user cache that we overwrite from the cloud on login (pull).
 * The authoritative writer stays /api/verify.js — this module only reads back what the server granted. */

const AchSync = {
  /* the auth path is used only when we're a real browser AND a Supabase project is configured.
   * Otherwise we degrade to net.js' legacy local identity (offline / headless / unconfigured). */
  enabled() { try { return (typeof _isBrowser !== 'undefined' && _isBrowser) && (typeof SUPA_OK !== 'undefined' && SUPA_OK); } catch (e) { return false; } },
  ready()   { return typeof SB !== 'undefined' && !!SB; },

  /* called from main.bootMenu() when enabled(): resolve any existing session, else wait for the SDK.
   * net.js injects the supabase SDK asynchronously, so SB may still be null here — onSupabaseReady()
   * (main.js) calls resolveSession() once it connects. The timeout guards against a config+no-network
   * lockout: if the SDK never loads, fall back to local-only play instead of hanging on a dead modal. */
  boot() {
    if (this.ready()) { this.resolveSession(); return; }
    const self = this;
    try { setTimeout(function () { if (!self.ready()) self._fire('onAuthOffline'); }, 7000); } catch (e) {}
  },

  /* SB is up: if a session exists adopt it + hydrate (→ onAuthResolved), else ask to sign in (→ onAuthRequired) */
  resolveSession() {
    if (!this.ready()) return Promise.resolve(null);
    const self = this;
    try {
      return SB.auth.getSession().then(function (res) {
        const s = res && res.data && res.data.session;
        if (s && s.user) return self._adopt(s.user).then(function (r) { self._fire('onAuthResolved', r); return r; });
        self._fire('onAuthRequired'); return null;
      }, function () { self._fire('onAuthRequired'); return null; });
    } catch (e) { return Promise.resolve(null); }
  },

  /* create an account: sign up → seed the profile display name → adopt + hydrate. Resolves {ok,error}. */
  signUp(email, password, username) {
    if (!this.ready()) return Promise.resolve({ ok: false, error: 'Offline — can’t create an account right now.' });
    const self = this;
    try {
      return SB.auth.signUp({ email: email, password: password }).then(function (res) {
        if (res && res.error) return { ok: false, error: res.error.message || 'Sign-up failed.' };
        const user = res && res.data && res.data.user;
        if (!user) return { ok: false, error: 'Sign-up failed.' };
        if (!(res.data && res.data.session)) return { ok: false, error: 'Account created — confirm your email, then sign in.' };
        return self._adopt(user, username);
      }, function () { return { ok: false, error: 'Network error.' }; });
    } catch (e) { return Promise.resolve({ ok: false, error: 'Network error.' }); }
  },

  /* sign in to an existing account → adopt + hydrate. Resolves {ok,error}. */
  signIn(email, password) {
    if (!this.ready()) return Promise.resolve({ ok: false, error: 'Offline — can’t sign in right now.' });
    const self = this;
    try {
      return SB.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        if (res && res.error) return { ok: false, error: res.error.message || 'Sign-in failed.' };
        const user = res && res.data && res.data.user;
        if (!user) return { ok: false, error: 'Sign-in failed.' };
        return self._adopt(user);
      }, function () { return { ok: false, error: 'Network error.' }; });
    } catch (e) { return Promise.resolve({ ok: false, error: 'Network error.' }); }
  },

  signOut() { if (this.ready()) { try { return SB.auth.signOut(); } catch (e) {} } return Promise.resolve(); },

  /* update the leaderboard display name for the signed-in user (profile + local mirror) */
  updateName(name) {
    const id = ((typeof getPlayer === 'function' && getPlayer()) || {}).id;
    if (typeof savePlayer === 'function') savePlayer(name, id);
    if (this.ready() && id) this._setProfile(id, name);
  },

  /* ---- internals ---- */

  /* bind the auth user_id into neon_player (so every caller keys to it), then hydrate from the cloud */
  _adopt(user, username) {
    const self = this;
    const finish = function (name) {
      if (typeof savePlayer === 'function') savePlayer(name, user.id);   // canonical id = auth user_id
      self._setProfile(user.id, name);   // ensure a profiles row exists for this user (idempotent, fire-and-forget)
      return self.pull(user.id).then(function () { return { ok: true, id: user.id, name: name }; });
    };
    if (username) return finish(String(username).slice(0, 16));
    return this._profileName(user).then(finish);
  },

  /* prefer the stored profile name; fall back to the email local-part for first-time/legacy users */
  _profileName(user) {
    const fallback = (((user && user.email) || '').split('@')[0] || 'Player').slice(0, 16);
    if (!this.ready()) return Promise.resolve(fallback);
    try {
      return SB.from('profiles').select('username').eq('id', user.id).single()
        .then(function (res) { return (res && res.data && res.data.username) || fallback; }, function () { return fallback; });
    } catch (e) { return Promise.resolve(fallback); }
  },

  _setProfile(id, username) {
    if (!this.ready()) return Promise.resolve();
    try { return SB.from('profiles').upsert({ id: id, username: String(username || '').slice(0, 16) }).then(function () {}, function () {}); }
    catch (e) { return Promise.resolve(); }
  },

  /* INITIAL FETCH: read the server-granted unlocks for this id and reconcile into the local mirror so
   * the achievements panel reflects cloud truth on any device. Cloud is authoritative; any optimistic
   * local-only id not yet on the server is preserved (it'll be confirmed on the next /api/verify). */
  pull(id) {
    id = id || ((typeof getPlayer === 'function' && getPlayer()) || {}).id;
    if (!this.ready() || !id || typeof Ach === 'undefined') return Promise.resolve();
    try {
      const self = this;
      return SB.from('player_achievements').select('achievement_id').eq('player_id', id).then(function (res) {
        if (!res || res.error || !Array.isArray(res.data)) return;
        const cloud = res.data.map(function (r) { return r.achievement_id; });
        const s = Ach._load();
        const localOnly = (s.unlocked || []).filter(function (x) { return cloud.indexOf(x) < 0; });
        s.unlocked = cloud.concat(localOnly);
        Ach._save(s);
        if (typeof Ach.renderPanel === 'function') Ach.renderPanel();
        self.pullCosmetics(id);                                       // …and reconcile the gold-tier rewards
      }, function () {});
    } catch (e) { return Promise.resolve(); }
  },

  /* read the server-granted cosmetics for this id into the local mirror so the showcase reflects cloud
   * truth on any device. Cloud is authoritative; optimistic local-only ids are preserved (re-confirmed
   * on the next /api/verify). No-op offline/headless. */
  pullCosmetics(id) {
    id = id || ((typeof getPlayer === 'function' && getPlayer()) || {}).id;
    if (!this.ready() || !id || typeof Ach === 'undefined') return Promise.resolve();
    try {
      return SB.from('cosmetics_inventory').select('cosmetic_id').eq('player_id', id).then(function (res) {
        if (!res || res.error || !Array.isArray(res.data)) return;
        const cloud = res.data.map(function (r) { return r.cosmetic_id; });
        const s = Ach._load();
        const localOnly = (s.cosmetics || []).filter(function (x) { return cloud.indexOf(x) < 0; });
        s.cosmetics = cloud.concat(localOnly);
        Ach._save(s);
        if (typeof Ach.renderPanel === 'function') Ach.renderPanel();
      }, function () {});
    } catch (e) { return Promise.resolve(); }
  },

  /* late-bound call into a global UI hook (onAuth* below); swallow if absent/headless */
  _fire(name, arg) { try { if (typeof globalThis[name] === 'function') globalThis[name](arg); } catch (e) {} },
};

/* ===== auth-modal UI — lives here (not main.js) to keep main.js under the 28 KB truncation line =====
 * Reuses the single #username overlay. Modes: 'signin'/'signup' (email+password) · 'editname' (rename)
 * · 'local' (offline/unconfigured first-run name). main.js wires the buttons + bootMenu to these. */
let _authmode = 'signin';
function _setShown(el, on) { if (el) el.style.display = on ? '' : 'none'; }
function showAuth(mode) {
  _authmode = mode; const m = document.getElementById('username'); if (!m) return;
  const title = m.querySelector('.title'), tag = document.getElementById('authtag');
  const email = document.getElementById('authemail'), pass = document.getElementById('authpass'), uname = document.getElementById('uname');
  const ok = document.getElementById('unameok'), toggle = document.getElementById('authtoggle'), err = document.getElementById('unameerr');
  const otpbtn = document.getElementById('authotp'), code = document.getElementById('authcode');
  if (err) err.textContent = '';
  if (typeof _otpStage !== 'undefined') _otpStage = null;        // (auth-otp.js) leaving any mode cancels an in-flight OTP
  _setShown(code, false);                                        // code field hidden until "email me a code" sends one
  const local = (mode === 'editname' || mode === 'local');
  if (local) {
    _setShown(email, false); _setShown(pass, false); _setShown(uname, true); _setShown(toggle, false); _setShown(otpbtn, false);
    if (title) title.textContent = mode === 'editname' ? 'EDIT NAME' : 'PICK A USERNAME';
    if (tag) tag.textContent = 'How you show up on the global leaderboard. 3–16 characters.';
    if (ok) ok.textContent = mode === 'editname' ? '✔ SAVE' : '✔ CONFIRM';
    if (uname) { const p = (typeof getPlayer === 'function') && getPlayer(); uname.value = mode === 'editname' && p ? p.name : ''; }
  } else {
    const signup = mode === 'signup';
    _setShown(email, true); _setShown(pass, true); _setShown(uname, signup); _setShown(toggle, true); _setShown(otpbtn, true);
    if (title) title.textContent = signup ? 'CREATE ACCOUNT' : 'SIGN IN';
    if (tag) tag.textContent = signup ? 'Create an account to sync achievements across every device.' : 'Sign in to sync your achievements across every device.';
    if (ok) ok.textContent = signup ? '✔ CREATE ACCOUNT' : '✔ SIGN IN';
    if (toggle) toggle.textContent = signup ? 'Have an account? Sign in' : 'New here? Create an account';
    if (otpbtn) otpbtn.textContent = '📧 Email me a 6-digit code instead';
  }
  m.classList.remove('hidden'); document.getElementById('start').classList.add('hidden');
  const f = local ? uname : email; if (f) try { f.focus(); } catch (e) {}
}
function confirmUsername() {
  const err = document.getElementById('unameerr'), seterr = t => { if (err) err.textContent = t; };
  if (typeof _otpStage !== 'undefined' && _otpStage === 'sent') { confirmOtp(); return; }   // OTP code pending → verify it (auth-otp.js)
  if (_authmode === 'editname' || _authmode === 'local') {
    const n = sanitizeName(document.getElementById('uname').value);
    if (n.length < 3) { seterr('Please use at least 3 characters.'); return; }
    if (_authmode === 'editname' && AchSync.enabled() && AchSync.ready()) AchSync.updateName(n);
    else if (typeof savePlayer === 'function') savePlayer(n);
    document.getElementById('username').classList.add('hidden');
    document.getElementById('start').classList.remove('hidden');
    if (typeof LBSync !== 'undefined') LBSync.syncAll();   // identity set → warm all leaderboards in the background
    return;
  }
  const email = (document.getElementById('authemail').value || '').trim(), pass = document.getElementById('authpass').value || '';
  if (!/.+@.+\..+/.test(email)) { seterr('Enter a valid email address.'); return; }
  if (pass.length < 6) { seterr('Password must be at least 6 characters.'); return; }
  let name = '';
  if (_authmode === 'signup') { name = sanitizeName(document.getElementById('uname').value); if (name.length < 3) { seterr('Display name: at least 3 characters.'); return; } }
  seterr(_authmode === 'signup' ? 'Creating account…' : 'Signing in…');
  const ok = document.getElementById('unameok'); if (ok) ok.disabled = true;
  const done = r => {
    if (ok) ok.disabled = false;
    if (r && r.ok) { document.getElementById('username').classList.add('hidden'); document.getElementById('start').classList.remove('hidden'); if (typeof Ach !== 'undefined') Ach.renderPanel(); }
    else seterr((r && r.error) || 'Something went wrong.');
  };
  const p = _authmode === 'signup' ? AchSync.signUp(email, pass, name) : AchSync.signIn(email, pass);
  p.then(done, () => done({ ok: false, error: 'Network error.' }));
}
/* AchSync → UI hooks, fired via AchSync._fire (globalThis lookup) */
function onAuthResolved() { const m = document.getElementById('username'); if (m) m.classList.add('hidden'); document.getElementById('start').classList.remove('hidden'); if (typeof Ach !== 'undefined') Ach.renderPanel(); if (typeof LBSync !== 'undefined') LBSync.syncAll(); }
function onAuthRequired() { showAuth('signin'); }                                    // SDK up, no session → ask to sign in
function onAuthOffline() { if (typeof getPlayer === 'function' && !getPlayer()) showAuth('local'); else document.getElementById('start').classList.remove('hidden'); }
