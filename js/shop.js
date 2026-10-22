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
    _norm: function (d) {
      d = d || {}; var lv = d.lv || {}, out = { credits: Math.max(0, d.credits | 0), lv: {} };
      META.forEach(function (u) { out.lv[u.id] = Math.max(0, Math.min(u.max, lv[u.id] | 0)); });
      return out;
    },
    load: function () {
      try { var raw = (typeof localStorage !== 'undefined') && localStorage.getItem(this._key()); return this._norm(raw ? JSON.parse(raw) : null); }
      catch (e) { return this._norm(null); }
    },
    _save: function (d) { try { if (typeof localStorage !== 'undefined') localStorage.setItem(this._key(), JSON.stringify(d)); } catch (e) {} },
    // called by onboarding.adoptGuest the moment a guest signs up: fold the guest wallet (neon_meta:local)
    // into the now-bound account key so a strong pre-account grind is never lost on sign-up. Consumed once.
    adoptGuest: function () {
      try {
        if (typeof localStorage === 'undefined') return;
        var raw = localStorage.getItem('neon_meta:local'); if (!raw) return;
        if (this._key() === 'neon_meta:local') return;                 // still a guest — nothing to fold into
        var g = this._norm(JSON.parse(raw)), d = this.load();
        d.credits += g.credits;
        META.forEach(function (u) { d.lv[u.id] = Math.max(d.lv[u.id] || 0, g.lv[u.id] || 0); });
        d = this._norm(d); this._save(d);
        localStorage.removeItem('neon_meta:local');                    // consumed — never merge it twice
      } catch (e) {}
    },
    level: function (id) { return this.load().lv[id] || 0; },
    credits: function () { return this.load().credits; },

    /* ---- economy ---- */
    // cost to buy the step from `owned` → `owned+1` (so L1 = base, geometric ×1.55 thereafter, rounded to 10)
    cost: function (u, owned) { return Math.round(u.base * Math.pow(1.55, owned) / 10) * 10; },
    nextCost: function (u) { var l = this.level(u.id); return l >= u.max ? null : this.cost(u, l); },
    // credits a run pays: survival floor + performance, scaled by difficulty + the Overclock upgrade
    earn: function (run) {
      run = run || {};
      var base = Math.floor((run.secs || 0) / 3) + Math.floor((run.kills || 0) / 2) + Math.floor((run.score || 0) / 200);
      var dm = DIFFMULT[run.difficulty] || 1, greed = 1 + 0.05 * (this.load().lv.credit || 0);
      return Math.max(0, Math.round(base * dm * greed));
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
      var d = this.load(), lv = d.lv[id] || 0; if (lv >= u.max) return false;
      var c = this.cost(u, lv); if (d.credits < c) return false;
      d.credits -= c; d.lv[id] = lv + 1; this._save(d);
      this._toast('<b>' + tr(u.name) + '</b> → ' + tr('Lv') + ' ' + (lv + 1), u.c);
      this.render();
      return true;
    },
    respec: function () {
      var d = this.load(), refund = 0, self = this;
      META.forEach(function (u) { var l = d.lv[u.id] || 0; for (var i = 0; i < l; i++) refund += self.cost(u, i); d.lv[u.id] = 0; });
      d.credits += refund; this._save(d);
      this._toast(tr('Upgrades reset') + ' · +' + money(refund) + ' ' + GLYPH, '#ffd95e');
      this.render();
    },
    // banked at death (called from gameOver) → returns amount earned so the death screen can show it
    onGameOver: function (run) {
      var amt = this.earn(run), d = this.load(); d.credits += amt; this._save(d);
      try {
        if (typeof document !== 'undefined') {
          var el = document.getElementById('gocredits');
          if (el) el.innerHTML = '<span class="go-cr-amt">+' + money(amt) + ' ' + GLYPH + '</span> ' +
            tr('credits earned') + ' · ' + tr('balance') + ' <b>' + money(d.credits) + ' ' + GLYPH + '</b>';
        }
      } catch (e) {}
      this.render();
      return amt;
    },

    _toast: function (html, col) {
      if (typeof AchUI !== 'undefined' && AchUI._push) AchUI._push('<span class="at-ico">🛒</span><div class="at-text">' + html + '</div>', col || '#ffd95e');
    },

    /* ---- UI ---- */
    open: function () {
      if (typeof document === 'undefined') return;
      this.render();
      var o = document.getElementById('armory'); if (o) o.classList.remove('hidden');
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
      this.render();
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
