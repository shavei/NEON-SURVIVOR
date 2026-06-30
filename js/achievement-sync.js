/* NEON SURVIVOR — achievement-sync.js : persistent identity + cloud achievement hydration.
 * Classic global. Loads AFTER net.js (needs SB/getPlayer/savePlayer) and achievements.js (needs Ach),
 * BEFORE main.js (main wires the modal + boot to AchSync). Headless/offline-safe: every SB/DOM/storage
 * touch is guarded, so verify*.cjs load it clean and offline play never throws (SB===null → no-ops).
 *
 * Identity model: Supabase Auth (email+password, or alternate 6-digit OTP) issues a durable user_id
 * that survives a browser clear via the refresh token. On login we adopt that id into neon_player (net.js) so every existing
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

  /* ----- thin auth wrappers (orchestrated by auth-uplink.js' Grid Access modal) -----
   * Each resolves a plain {ok,error,...} object and NEVER rejects, so the UI can chain without try/catch.
   * Password is the primary login; OTP is the alternate login + the signup email-confirmation step. */

  /* SIGNUP step 1: create the account with a password. Resolves {ok, hasSession, user, error}.
   * hasSession=false (the usual case, email-confirm ON) → Supabase emailed a 6-digit code; the modal
   * collects it and calls verifyCode(...,'signup',callsign). hasSession=true (confirm OFF) → adopt now. */
  pwSignUp(email, password) {
    if (!this.ready()) return Promise.resolve({ ok: false, error: 'Offline — can’t create an account right now.' });
    try {
      return SB.auth.signUp({ email: email, password: password }).then(function (res) {
        if (res && res.error) return { ok: false, error: res.error.message || 'Sign-up failed.' };
        const user = res && res.data && res.data.user;
        if (!user) return { ok: false, error: 'Sign-up failed.' };
        return { ok: true, hasSession: !!(res.data && res.data.session), user: user };
      }, function () { return { ok: false, error: 'Network error.' }; });
    } catch (e) { return Promise.resolve({ ok: false, error: 'Network error.' }); }
  },

  /* LOGIN (primary): sign in to an existing account with the password → adopt + hydrate. {ok,error}. */
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

  /* email a 6-digit code. createUser=false on the alternate-login path (no account → nudge to signup);
   * the signup path uses pwSignUp's own confirmation email, not this. Resolves {ok,error}. */
  otpRequest(email, createUser) {
    if (!this.ready()) return Promise.resolve({ ok: false, error: 'Offline — can’t email a code right now.' });
    try {
      return SB.auth.signInWithOtp({ email: email, options: { shouldCreateUser: !!createUser } }).then(
        function (res) { return (res && res.error) ? { ok: false, error: res.error.message || 'Couldn’t send the code.' } : { ok: true }; },
        function () { return { ok: false, error: 'Network error.' }; });
    } catch (e) { return Promise.resolve({ ok: false, error: 'Network error.' }); }
  },

  /* re-send a code already in flight (type:'signup' for the confirmation email). Resolves {ok,error}. */
  resend(email, type) {
    if (!this.ready()) return Promise.resolve({ ok: false, error: 'Offline — can’t resend right now.' });
    try {
      return SB.auth.resend({ type: type || 'signup', email: email }).then(
        function (res) { return (res && res.error) ? { ok: false, error: res.error.message || 'Couldn’t resend.' } : { ok: true }; },
        function () { return { ok: false, error: 'Network error.' }; });
    } catch (e) { return Promise.resolve({ ok: false, error: 'Network error.' }); }
  },

  /* verify a typed 6-digit code → adopt the resulting session (same downstream path as password login).
   * type:'signup' confirms a freshly created account (pass the chosen callsign); type:'email' is the
   * alternate code-login for an existing account. Resolves {ok, id, name, error}. */
  verifyCode(email, token, type, username) {
    if (!this.ready()) return Promise.resolve({ ok: false, error: 'Offline — can’t verify right now.' });
    const self = this;
    try {
      return SB.auth.verifyOtp({ email: email, token: token, type: type || 'email' }).then(
        function (res) {
          if (res && res.error) return { ok: false, error: res.error.message || 'Invalid or expired code.' };
          const user = res && res.data && res.data.user;
          if (!user) return { ok: false, error: 'Invalid or expired code.' };
          return self._adopt(user, username);
        }, function () { return { ok: false, error: 'Network error.' }; });
    } catch (e) { return Promise.resolve({ ok: false, error: 'Network error.' }); }
  },

  signOut() { if (this.ready()) { try { return SB.auth.signOut(); } catch (e) {} } return Promise.resolve(); },

  /* live availability check (debounced caller in auth-uplink.js). RPC returns ONLY a boolean; resolves
   * {ok, available, error} and never rejects. Offline/headless → {ok:false} so the UI shows no class. */
  callsignAvailable(name) {
    if (!this.ready()) return Promise.resolve({ ok: false });
    try {
      return SB.rpc('callsign_available', { name: String(name || '') }).then(
        function (res) { return (res && res.error) ? { ok: false, error: res.error.message } : { ok: true, available: !!res.data }; },
        function () { return { ok: false }; });
    } catch (e) { return Promise.resolve({ ok: false }); }
  },

  /* ---- internals ---- */

  /* bind the auth user_id into neon_player (so every caller keys to it), then hydrate from the cloud.
   * `username` is present ONLY when a callsign is being claimed for the first time (signup) → we WRITE
   * the profile and a 23505 (taken) here aborts adoption with {ok:false,taken:true}. A returning login
   * passes no username → we READ the stored name and NEVER re-write it (the set-once policy would reject
   * an update anyway). */
  _adopt(user, username) {
    const self = this;
    const hydrate = function (name) {
      if (typeof savePlayer === 'function') savePlayer(name, user.id);   // canonical id = auth user_id
      return self.pull(user.id).then(function () { return { ok: true, id: user.id, name: name }; });
    };
    if (username) {
      const name = String(username).slice(0, 16);
      return this._setProfile(user.id, name).then(function (r) {
        if (r && r.taken) return { ok: false, taken: true, error: 'CALLSIGN ALREADY CLAIMED' };
        return hydrate(name);
      });
    }
    return this._profileName(user).then(hydrate);
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

  /* write the player's claimed callsign. Resolves {ok} on success, {taken:true} when the unique index
   * rejects a duplicate (Postgres 23505), {ok:false} on any other failure. Offline/headless → {ok:false}. */
  _setProfile(id, username) {
    if (!this.ready()) return Promise.resolve({ ok: false });
    try {
      return SB.from('profiles').upsert({ id: id, username: String(username || '').slice(0, 16) }).then(
        function (res) { return (res && res.error) ? { ok: false, taken: res.error.code === '23505', error: res.error.message } : { ok: true }; },
        function () { return { ok: false }; });
    } catch (e) { return Promise.resolve({ ok: false }); }
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
        // derive the non-gold rewards (trails/music/palettes) straight from REWARD_MAP so they hydrate on a
        // fresh device even when user_inventory is empty/absent — pullInventory only covers the table-backed rows.
        if (typeof Ach._grantRewards === 'function') { s.cosmetics = s.cosmetics || []; Ach._grantRewards(s, s.unlocked); }
        Ach._save(s);
        if (typeof Ach.renderPanel === 'function') Ach.renderPanel();
        self.pullCosmetics(id);                                       // …and reconcile the gold-tier rewards
        if (typeof RewardEngine !== 'undefined' && RewardEngine.pullInventory) RewardEngine.pullInventory(id);   // …and the full reward inventory (skins/trails/tracks)
      }, function () {});
    } catch (e) { return Promise.resolve(); }
  },

  /* read the server-granted cosmetics for this id into the local mirror so the showcase reflects cloud
   * truth on any device. Cloud is authoritative; optimistic local-only ids are preserved (re-confirmed
   * on the next /api/verify). No-op offline/headless. */
  _cosmeticsOff: false,   // set once the cosmetics_inventory table is found missing (older deployed schema) → stop re-requesting it (no repeat 404s)
  pullCosmetics(id) {
    id = id || ((typeof getPlayer === 'function' && getPlayer()) || {}).id;
    if (this._cosmeticsOff || !this.ready() || !id || typeof Ach === 'undefined') return Promise.resolve();
    const self = this;
    try {
      return SB.from('cosmetics_inventory').select('cosmetic_id').eq('player_id', id).then(function (res) {
        if (res && res.error) { const c = res.error.code, m = (res.error.message || ''); if (c === 'PGRST205' || c === '42P01' || /find the table|does not exist/i.test(m)) self._cosmeticsOff = true; }
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

  /* late-bound call into a global UI hook (onAuth* in auth-uplink.js); swallow if absent/headless */
  _fire(name, arg) { try { if (typeof globalThis[name] === 'function') globalThis[name](arg); } catch (e) {} },
};
/* The Grid Access modal UI (showAuth / confirmUsername / onAuth* hooks) lives in js/auth-uplink.js —
 * kept out of this file AND main.js so each stays under the 28 KB silent-truncation threshold. */
