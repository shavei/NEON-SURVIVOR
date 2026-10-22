/* ========== THE ARMORY — permanent meta-progression ==========
 * Classic script (NOT a module). Headless/offline-safe: every document/localStorage touch is guarded,
 * so verify.cjs loads it clean. It is ABSENT from the verify-equiv / verify-determinism / verify-simcore
 * script lists, so `typeof Shop` is undefined there → reset()'s applyTo() hook and gainXP's p.xpMul read
 * are no-ops → the golden run stays byte-identical. In a real browser it loads before main.js (defer),
 * so Shop exists by the time a run can start.
 *
 * Model: ONE soft currency ("Credits", ◈) earned at death as a performance-weighted cut of the run, banked
 * PER IDENTITY in localStorage `neon_meta:<id>` (same :<id> suffixing as the cosmetic equips). Spent on 8
 * stat upgrades, each with multiple levels on a geometric cost curve and a MODEST cap, so a fully-maxed
 * account is strong (~+74% DPS / ~+60% survivability ceiling) but never trivialises the game. Respec is
 * free + unlimited (full refund) so the screen invites experimentation, not buyer's remorse.
 *
 * Upgrades raise p.base.* (the single source of base truth) + mirror the live p.* at reset, BEFORE any
 * in-run level-up runs — so every in-run UPGRADES pick, which recomputes p.X = p.base.X <op> scalar^level,
 * compounds on top automatically with zero changes to upgrade-logic.js.
 */
(function () {
  'use strict';

  var pctC = function (r, l) { return Math.round((Math.pow(r, l) - 1) * 100); };   // compounding "+N%" readout
  var money = function (x) { return ('' + (x | 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var GLYPH = '◈';

  /* Tamper-evidence: a keyed non-crypto checksum (cyrb53) over the wallet. The stored blob carries this
   * digest; on load we recompute and reject anything that does not match, so hand-edited localStorage
   * ("credits:999999") is ignored rather than honoured. This is NOT cryptographic — the algorithm + salt
   * are in this file, so a determined attacker with devtools can still recompute it. It stops the casual
   * edit, which is the realistic threat for a single-player, local-only save. The wallet is never sent to
   * the server, and all cloud grants (achievements / cosmetics / leaderboard) are validated server-side in
   * api/verify.js, so none of this can be used to forge cloud state. */
  var SALT = 'neon.armory.k1';
  var CAP = 100000000;                                   // hard credit ceiling — blocks absurd/overflow values
  function cyrb53(s) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < s.length; i++) { ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  /* The roster. `apply(p,l)` mutates p.base.* then mirrors the live p.* (Up{} is empty at reset-time, so
   * the live field == base). `tot(l)` is the honest total-at-level readout. Caps keep each axis modest. */
  var META = [
    { id: 'dmg',    ico: '🗡️', c: '#ff5fa2', name: 'Weapon Charge', stat: 'bullet damage', max: 8, base: 100,
      tot: function (l) { return '+' + pctC(1.05, l) + '%'; },
      apply: function (p, l) { p.base.dmg *= Math.pow(1.05, l); p.dmg = p.base.dmg; } },
    { id: 'rate',   ico: '⚡', c: '#ffd95e', name: 'Trigger Servo', stat: 'fire rate', max: 6, base: 120,
      tot: function (l) { return '+' + pctC(1.04, l) + '%'; },
      apply: function (p, l) { p.base.rate *= Math.pow(1 / 1.04, l); p.rate = p.base.rate; } },
    { id: 'hp',     ico: '❤️', c: '#ff5fa2', name: 'Hull Plating', stat: 'max HP', max: 6, base: 80,
      tot: function (l) { return '+' + pctC(1.08, l) + '%'; },
      apply: function (p, l) { p.base.maxhp *= Math.pow(1.08, l); p.maxhp = p.base.maxhp; p.hp = p.maxhp; } },
    { id: 'spd',    ico: '🥾', c: '#d97757', name: 'Thruster Tune', stat: 'move speed', max: 5, base: 90,
      tot: function (l) { return '+' + pctC(1.03, l) + '%'; },
      apply: function (p, l) { p.base.speed *= Math.pow(1.03, l); p.speed = p.base.speed; } },
    { id: 'xp',     ico: '✦', c: '#7c8cff', name: 'Neural Uplink', stat: 'XP gain', max: 6, base: 80,
      tot: function (l) { return '+' + pctC(1.06, l) + '%'; },
      apply: function (p, l) { p.xpMul = Math.pow(1.06, l); } },
    { id: 'magnet', ico: '🧲', c: '#54e6b5', name: 'Tractor Array', stat: 'pickup range', max: 5, base: 60,
      tot: function (l) { return '+' + pctC(1.10, l) + '%'; },
      apply: function (p, l) { p.base.magnet *= Math.pow(1.10, l); p.magnet = p.base.magnet; p.magnetSq = p.magnet * p.magnet; } },
    { id: 'regen',  ico: '♻️', c: '#54e6b5', name: 'Nanorepair', stat: 'HP / sec', max: 5, base: 110,
      tot: function (l) { return '+' + (0.4 * l).toFixed(1); },
      apply: function (p, l) { p.base.regenRate += 0.4 * l; p.regenRate = p.base.regenRate; } },
    { id: 'credit', ico: '💰', c: '#ffd95e', name: 'Overclock', stat: 'credit gain', max: 5, base: 140,
      tot: function (l) { return '+' + (5 * l) + '%'; },
      apply: function () {} }                                   // payout-side (see earn()); no in-run stat
  ];
  var DIFFMULT = { easy: 1.0, normal: 1.25, hard: 1.6 };

  var Shop = {
    CATALOG: META,

    /* ---- durable state: per-identity wallet + owned levels ---- */
    _key: function () {
      try { var p = (typeof getPlayer === 'function') && getPlayer(); return 'neon_meta:' + ((p && p.id) || 'local'); }
      catch (e) { return 'neon_meta:local'; }
    },
    // sanitize to a trusted shape: credits a finite int in [0,CAP]; every level a finite int in [0,max].
    // Coercion kills NaN/Infinity/strings/negatives/overflow before they can reach the game or the hash.
    _norm: function (d) {
      d = d || {}; var lv = (d && d.lv) || {};
      var cr = d.credits; cr = (typeof cr === 'number' && isFinite(cr)) ? Math.floor(cr) : 0;
      var out = { credits: Math.max(0, Math.min(CAP, cr)), lv: {} };
      META.forEach(function (u) { var v = lv[u.id]; v = (typeof v === 'number' && isFinite(v)) ? Math.floor(v) : 0; out.lv[u.id] = Math.max(0, Math.min(u.max, v)); });
      return out;
    },
    // canonical string over ONLY the owned (level>0) entries + credits — stable across roster ADDITIONS, so
    // shipping a new upgrade never invalidates an existing player's signed wallet (they just re-sign on next buy).
    _canon: function (d) {
      var owned = []; META.forEach(function (u) { var l = d.lv[u.id] || 0; if (l > 0) owned.push(u.id + ':' + l); });
      owned.sort(); return 'c' + d.credits + '|' + owned.join(',');
    },
    _sig: function (d, key) { return cyrb53(this._canon(d) + '|' + SALT + '|' + key); },
    // read + verify a specific key. Strict: a signed blob whose digest fails, or any unsigned value, is
    // untrusted → returns a zeroed wallet (the tamper is simply not honoured). Legacy plain-JSON wallets are
    // migrated once by _migrate() before this ever runs in the browser, so they are not seen here.
    _readKey: function (key) {
      try {
        if (typeof localStorage === 'undefined') return this._norm(null);
        var raw = localStorage.getItem(key); if (!raw) return this._norm(null);
        var o = JSON.parse(raw);
        if (o && o.d && typeof o.k === 'string') { var d = this._norm(o.d); return (this._sig(d, key) === o.k) ? d : this._norm(null); }
        return this._norm(null);
      } catch (e) { return this._norm(null); }
    },
    _saveKey: function (key, d) {
      try { if (typeof localStorage === 'undefined') return; var n = this._norm(d); localStorage.setItem(key, JSON.stringify({ d: n, k: this._sig(n, key) })); } catch (e) {}
    },
    load: function () { return this._readKey(this._key()); },
    _save: function (d) { this._saveKey(this._key(), d); },
    // one-time, at init: re-sign any pre-hardening plain-JSON wallet in place so it isn't rejected as
    // untrusted. Idempotent — a blob already carrying a digest is left alone.
    _migrate: function () {
      try {
        if (typeof localStorage === 'undefined') return; var self = this;
        [this._key(), 'neon_meta:local'].forEach(function (key) {
          var raw = localStorage.getItem(key); if (!raw) return; var o;
          try { o = JSON.parse(raw); } catch (e) { return; }
          if (o && o.d && typeof o.k === 'string') return;                 // already signed
          if (o && (('credits' in o) || ('lv' in o))) self._saveKey(key, o); // legacy plain → sign in place
        });
      } catch (e) {}
    },
    // called by onboarding.adoptGuest the moment a guest signs up: fold the guest wallet (neon_meta:local)
    // into the now-bound account key so a strong pre-account grind is never lost on sign-up. Consumed once.
    adoptGuest: function () {
      try {
        if (typeof localStorage === 'undefined') return;
        if (!localStorage.getItem('neon_meta:local')) return;
        var g = this._readKey('neon_meta:local'), self = this;        // verified read (tampered guest blob folds in as zero)
        if (this._server()) {                                          // server mode: one-time server-side seed (capped), then drop the guest blob
          this._api('adopt', { guest: { credits: g.credits, levels: g.lv } }, function (j) {
            try { localStorage.removeItem('neon_meta:local'); } catch (e) {}
            if (j && j.ok && j.wallet) { self._applyWallet(j.wallet); self.render(); } else self.pull();
          });
          return;
        }
        if (this._key() === 'neon_meta:local') return;                 // still a guest — nothing to fold into
        var d = this.load();
        d.credits += g.credits;
        META.forEach(function (u) { d.lv[u.id] = Math.max(d.lv[u.id] || 0, g.lv[u.id] || 0); });
        this._save(d);
        localStorage.removeItem('neon_meta:local');                    // consumed — never merge it twice
      } catch (e) {}
    },
    level: function (id) { return this.load().lv[id] || 0; },
    credits: function () { return this.load().credits; },

    /* ================= SERVER-AUTHORITATIVE MODE (signed-in players) =================
     * When the player is signed in to the cloud, the SERVER owns the wallet (public.player_meta):
     * credits are earned ONLY from server-validated runs (/api/verify) and spent ONLY through the
     * server-checked /api/meta endpoint, so a browser can't forge credits or buy without funds. The
     * local signed store then acts as a synced CACHE (what applyTo/render read). Guests / offline /
     * unconfigured stay fully local (the hardened wallet above) — every server path below no-ops then. */
    _acct: function () { try { return typeof localStorage !== 'undefined' && localStorage.getItem('neon_acct') === '1'; } catch (e) { return false; } },
    _server: function () {
      return typeof SUPA_OK !== 'undefined' && SUPA_OK && typeof fetch === 'function' && this._acct() &&
        !!(typeof getPlayer === 'function' && getPlayer() && getPlayer().id);
    },
    _bearer: function (cb) {
      try {
        if (typeof SB !== 'undefined' && SB && SB.auth && SB.auth.getSession) {
          SB.auth.getSession().then(function (r) { cb((r && r.data && r.data.session && r.data.session.access_token) || null); }, function () { cb(null); });
          return;
        }
      } catch (e) {}
      cb(null);
    },
    // POST an action to /api/meta with the session bearer; cb(json|null). No session / not server mode → cb(null).
    _api: function (action, extra, cb) {
      cb = cb || function () {};
      if (!this._server()) { cb(null); return; }
      this._bearer(function (tok) {
        if (!tok) { cb(null); return; }
        var base = (typeof SUPA_FUNCTIONS_URL === 'string' && SUPA_FUNCTIONS_URL) || '';
        var body = { action: action }; if (extra) { for (var k in extra) body[k] = extra[k]; }
        try {
          fetch(base + '/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) })
            .then(function (r) { return r.json(); }).then(function (j) { cb(j); }, function () { cb(null); });
        } catch (e) { cb(null); }
      });
    },
    // write a server wallet ({credits, levels}) into the local signed cache so applyTo/render reflect it
    _applyWallet: function (wallet) { if (wallet) this._save(this._norm({ credits: wallet.credits, lv: wallet.levels || {} })); },
    // refresh the cache from the server (best-effort); called at init, when the shop opens, and post-run.
    // One-time reconcile: if the server wallet is empty but a pre-server-era LOCAL wallet has value (a player
    // who earned Credits before this feature, or a just-signed-up guest), seed the server from it once
    // (capped, server-gated to no-existing-row) so the switch to server-authoritative never wipes progress.
    pull: function () {
      var self = this;
      this._api('get', null, function (j) {
        if (!(j && j.ok && j.wallet)) return;
        var sv = j.wallet, local = self.load();
        var svEmpty = ((sv.credits | 0) === 0) && (!sv.levels || !Object.keys(sv.levels).length);
        var localHas = (local.credits > 0) || META.some(function (u) { return (local.lv[u.id] || 0) > 0; });
        if (svEmpty && localHas) {
          self._api('adopt', { guest: { credits: local.credits, levels: local.lv } }, function (a) {
            self._applyWallet(a && a.ok && a.wallet ? a.wallet : sv); self.render();
          });
        } else { self._applyWallet(sv); self.render(); }
      });
    },
    // called by achievements._submit with /api/verify's response: the server just banked this run's credits
    serverSync: function (wallet, earned) {
      if (!wallet) return;
      this._applyWallet(wallet);
      if (earned && earned > 0) this._paintEarned(earned, wallet.credits | 0, false);
      this.render();
    },

    /* ---- economy ---- */
    // cost to buy the step from `owned` → `owned+1` (so L1 = base, geometric ×1.55 thereafter, rounded to 10)
    cost: function (u, owned) { return Math.round(u.base * Math.pow(1.55, owned) / 10) * 10; },
    nextCost: function (u) { var l = this.level(u.id); return l >= u.max ? null : this.cost(u, l); },
    // credits a run pays: survival floor + performance, scaled by difficulty + the Overclock upgrade.
    // greedLvl is passed explicitly by the SERVER (api/verify) so the same formula runs client + server;
    // the browser omits it and reads its own Overclock level.
    earn: function (run, greedLvl) {
      run = run || {};
      var base = Math.floor((run.secs || 0) / 3) + Math.floor((run.kills || 0) / 2) + Math.floor((run.score || 0) / 200);
      var dm = DIFFMULT[run.difficulty] || 1;
      var g = (greedLvl != null) ? (greedLvl | 0) : ((this.load().lv.credit) || 0);
      return Math.max(0, Math.round(base * dm * (1 + 0.05 * g)));
    },

    /* ---- the one hook reset() calls: raise base stats from the saved loadout ---- */
    applyTo: function (p) {
      try {
        if (!p || !p.base) return;
        var d = this.load();
        META.forEach(function (u) { var l = d.lv[u.id] || 0; if (l > 0) u.apply(p, l); });
      } catch (e) {}
    },

    /* ---- transactions ---- */
    buy: function (id) {
      var u = META.find(function (x) { return x.id === id; }); if (!u) return false;
      var self = this;
      if (this._server()) {                                            // server-authoritative purchase
        this._api('buy', { upgrade: id }, function (j) {
          if (j && j.ok && j.wallet) { self._applyWallet(j.wallet); self._toast('<b>' + tr(u.name) + '</b> → ' + tr('Lv') + ' ' + ((j.wallet.levels && j.wallet.levels[id]) || 0), u.c); self.render(); }
          else if (j && j.wallet) { self._applyWallet(j.wallet); self.render(); self._toast(tr(j.reason === 'insufficient' ? 'Not enough Credits' : 'Already maxed'), '#ff5fa2'); }
          else { self._toast(tr('Could not reach the grid, try again'), '#ff5fa2'); }
        });
        return true;                                                   // async; the UI refreshes on the callback
      }
      // local mode (guest / offline) — client-authoritative, hardened
      var d = this.load(), lv = d.lv[id] || 0; if (lv >= u.max) return false;
      var c = this.cost(u, lv); if (d.credits < c) return false;
      d.credits -= c; d.lv[id] = lv + 1; this._save(d);
      this._toast('<b>' + tr(u.name) + '</b> → ' + tr('Lv') + ' ' + (lv + 1), u.c);
      this.render();
      return true;
    },
    respec: function () {
      var self = this;
      if (this._server()) {                                            // server-authoritative respec (full refund)
        this._api('respec', null, function (j) {
          if (j && j.ok && j.wallet) { self._applyWallet(j.wallet); self._toast(tr('Upgrades reset'), '#ffd95e'); self.render(); }
          else self._toast(tr('Could not reach the grid, try again'), '#ff5fa2');
        });
        return;
      }
      var d = this.load(), refund = 0;
      META.forEach(function (u) { var l = d.lv[u.id] || 0; for (var i = 0; i < l; i++) refund += self.cost(u, i); d.lv[u.id] = 0; });
      d.credits += refund; this._save(d);
      this._toast(tr('Upgrades reset') + ' · +' + money(refund) + ' ' + GLYPH, '#ffd95e');
      this.render();
    },
    _paintEarned: function (amt, balance, pending) {
      try {
        if (typeof document === 'undefined') return;
        var el = document.getElementById('gocredits'); if (!el) return;
        el.innerHTML = '<span class="go-cr-amt">+' + money(amt) + ' ' + GLYPH + '</span> ' + tr('credits earned') +
          ' · ' + tr('balance') + ' <b>' + money(balance) + ' ' + GLYPH + '</b>' +
          (pending ? ' <span class="go-cr-pending">' + tr('(banking…)') + '</span>' : '');
      } catch (e) {}
    },
    // banked at death (called from gameOver) → returns amount earned so the death screen can show it.
    // Server mode: the server banks it (via /api/verify); we show an optimistic predicted amount now and
    // serverSync() corrects it with the confirmed balance a moment later. Local mode: the client banks it.
    onGameOver: function (run) {
      if (this._server()) {
        var amt = this.earn(run, this.load().lv.credit || 0);
        this._paintEarned(amt, (this.load().credits | 0) + amt, true);
        this.render();
        return amt;
      }
      var a = this.earn(run), d = this.load(); d.credits += a; this._save(d);
      this._paintEarned(a, d.credits, false);
      this.render();
      return a;
    },

    _toast: function (html, col) {
      if (typeof AchUI !== 'undefined' && AchUI._push) AchUI._push('<span class="at-ico">🛒</span><div class="at-text">' + html + '</div>', col || '#ffd95e');
    },

    /* ---- UI ---- */
    open: function () {
      if (typeof document === 'undefined') return;
      this.render();                                                   // paint from cache instantly
      var o = document.getElementById('armory'); if (o) o.classList.remove('hidden');
      if (this._server()) this.pull();                                 // then refresh the balance from the server
    },
    close: function () {
      if (typeof document === 'undefined') return;
      var o = document.getElementById('armory'); if (o) o.classList.add('hidden');
    },
    // cheapest next step the player can ALMOST afford → the goal-gradient "one good run away" hint
    _goal: function (d) {
      var best = null, self = this;
      META.forEach(function (u) {
        var l = d.lv[u.id] || 0; if (l >= u.max) return;
        var c = self.cost(u, l); if (c <= d.credits) return;                 // already affordable → not the goal
        if (!best || c < best.c) best = { u: u, c: c };
      });
      return best;
    },
    render: function () {
      if (typeof document === 'undefined') return;
      var host = document.getElementById('armorylist'); if (!host) return;
      var d = this.load(), self = this, maxed = 0;
      META.forEach(function (u) { if ((d.lv[u.id] || 0) >= u.max) maxed++; });
      var goal = this._goal(d), goalHTML = '';
      if (goal) {
        var pr = Math.min(100, Math.round(d.credits / goal.c * 100));
        goalHTML = '<div class="armo-goal">' + tr('Closest') + ': <b>' + tr(goal.u.name) + '</b> · ' +
          money(d.credits) + ' / ' + money(goal.c) + ' ' + GLYPH +
          '<span class="armo-prog"><i style="width:' + pr + '%"></i></span></div>';
      }
      var bar = '<div class="armo-bar"><div class="armo-wallet">' + GLYPH + ' <b>' + money(d.credits) + '</b> ' + tr('Credits') + '</div>' +
        '<div class="armo-done">' + tr('Maxed') + ' ' + maxed + '/' + META.length + '</div></div>';
      var cards = META.map(function (u) { return self._card(u, d); }).join('');
      host.innerHTML = bar + goalHTML + '<div class="track-grid armo-grid">' + cards + '</div>' +
        '<button class="menubtn armo-respec" id="armoRespec">↺ ' + tr('Reset all (full refund)') + '</button>';
      if (typeof host.querySelectorAll === 'function') {
        host.querySelectorAll('[data-buy]').forEach(function (b) { b.onclick = function () { self.buy(b.dataset.buy); }; });
        var rs = document.getElementById('armoRespec'); if (rs) rs.onclick = function () { self.respec(); };
      }
    },
    _card: function (u, d) {
      var l = d.lv[u.id] || 0, isMax = l >= u.max, c = isMax ? null : this.cost(u, l), afford = !isMax && d.credits >= c;
      var cls = ['track-card', 'armo-card', isMax ? 'maxed' : (afford ? 'afford' : 'short')].join(' ');
      var dots = '';
      for (var i = 0; i < u.max; i++) dots += '<i class="' + (i < l ? 'on' : '') + '"></i>';
      var foot = isMax
        ? '<span class="track-badge">✓ ' + tr('MAXED') + '</span>'
        : (afford
          ? '<button class="track-btn buy" data-buy="' + u.id + '">' + tr('Buy') + ' · ' + money(c) + ' ' + GLYPH + '</button>'
          : '<span class="armo-cost">' + money(c) + ' ' + GLYPH + '</span>');
      return '<div class="' + cls + '" style="--skin-accent:' + u.c + '">' +
        '<div class="skin-card-head"><span class="skin-ico">' + u.ico + '</span><span class="skin-tag">' + tr('Lv') + ' ' + l + '/' + u.max + '</span></div>' +
        '<div class="skin-card-body"><b>' + tr(u.name) + '</b><span>' + u.tot(Math.max(1, l)) + ' ' + tr(u.stat) + (l > 0 ? ' · ' + tr('owned') : '') + '</span></div>' +
        '<div class="armo-dots">' + dots + '</div>' + foot + '</div>';
    },

    _init: function () {
      if (typeof document === 'undefined') return;
      var self = this;
      var wire = function (id) { var b = document.getElementById(id); if (b) b.onclick = function () { self.open(); }; };
      wire('armorybtn'); wire('goarmory');
      var cl = document.getElementById('armoClose'); if (cl) cl.onclick = function () { self.close(); };
      if (typeof I18N !== 'undefined' && I18N.onChange) I18N.onChange(function () { self.render(); });
      this._migrate();                                   // sign any pre-hardening plain-JSON wallet once, before first read
      this.render();
      if (this._server()) this.pull();                   // signed-in: hydrate the cache from the authoritative server wallet
    }
  };

  if (typeof window !== 'undefined') {
    window.Shop = Shop;
    window.debugMeta = function () { try { console.log(JSON.stringify(Shop.load())); } catch (e) {} return Shop.load(); };
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { Shop._init(); });
      else Shop._init();
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = Shop;
})();
