/* NEON SURVIVOR — achievements-ui.js : high-fidelity Achievement Gallery + non-pausing unlock toasts.
 * Classic global. Loads AFTER achievements.js (reads Ach/COSMETICS), BEFORE main.js. Headless/offline-safe:
 * every DOM touch is guarded, so verify.cjs loads it clean and offline play never throws.
 *
 * Owns three things the data layer (achievements.js) deliberately does NOT:
 *   1) renderGallery()  — the tiered card grid: tier-coloured cards, progress bars, neon pulse on near-complete.
 *   2) unlockToast()/cosmeticToast() — queued #achtoast that slides in WITHOUT pausing the run (pure CSS).
 *   3) mock()/mockReset() — DEV console tool: set any achievement to N% to exercise UI + reward triggers.
 * Ach.renderPanel() delegates here when present; this file never writes the DB (RLS forbids it anyway). */

const AchUI = {
  filter: 'all',                              // active gallery category tab
  _snap: null,                                // mirror snapshot captured before the first mock() (for mockReset)

  /* ----- category model: prefer the def's explicit `cat`; fall back to its first cond's metric ----- */
  CATS: [['all','All'], ['combat','Combat'], ['survival','Survival'], ['boss','Boss'],
         ['skill','Skill'], ['speed','Speed'], ['challenge','Challenge'], ['secret','Secret']],
  catOf(d) {
    if (d.cat) return d.cat;
    if (d.hidden) return 'secret';
    const m = d.conds && d.conds[0] && d.conds[0][0];
    if (m === 'bosses') return 'boss';
    if (m === 'kills') return 'combat';
    return 'survival';                        // score / wave / level / runs
  },

  /* ----- the gallery (rendered into #achlist, replacing the legacy flat list) ----- */
  renderGallery() {
    if (typeof document === 'undefined' || typeof Ach === 'undefined') return;
    const host = document.getElementById('achlist'); if (!host) return;
    const s = Ach._load(), owned = s.unlocked || [], cos = s.cosmetics || [];

    const tabs = this.CATS.map(([k, label]) =>
      `<button class="ach-tab${this.filter === k ? ' on' : ''}" data-cat="${k}">${label}</button>`).join('');

    // show: unlocked achievements, ones already in progress (progress > 0), and ALL secrets as masked
    // '???' placeholders (so hidden goals are discoverable without spoiling them). Difficulty-gated defs
    // have no per-difficulty progress, so they read 0% until unlocked.
    const inCat = d => this.filter === 'all' || this.catOf(d) === this.filter;
    const prog = d => (d.difficulty && owned.indexOf(d.id) < 0) ? 0 : Ach.progressFrac(d);
    const visible = Ach.CATALOG.filter(d => inCat(d) && (owned.indexOf(d.id) >= 0 || prog(d) > 0 || d.hidden));
    const cards = visible.length ? visible.map(d => {
      const got = owned.indexOf(d.id) >= 0;
      const masked = d.hidden && !got;                                  // hidden + locked → reveal nothing
      const frac = prog(d), pct = Math.round(frac * 100);
      const near = !got && !masked && frac >= 0.8;                      // near-complete → neon pulse
      const tier = d.tier || 'bronze';
      const c = Ach.driverCond ? Ach.driverCond(d) : (d.conds[0] || ['', 0]);
      const op = c.length === 2 ? '>=' : c[1];
      const label = masked ? 'HIDDEN' : got ? 'UNLOCKED'
                  : op === '>=' ? Ach.progressValue(d) + ' / ' + (c.length === 2 ? c[1] : c[2]) : 'LOCKED';
      const cls = ['ach-card', 'tier-' + tier, got ? 'got' : 'locked', near ? 'is-near' : '', masked ? 'secret' : ''].join(' ').replace(/ +/g, ' ').trim();
      const ico = masked ? '🔒' : d.ico, title = masked ? '???' : d.title, desc = masked ? 'Hidden — unlock to reveal.' : d.desc;
      return `<div class="${cls}" data-tier="${tier}">` +
               `<div class="ach-head"><span class="ach-ico">${ico}</span>` +
                 `<span class="ach-tier">${tier}</span><span class="ach-mark">${got ? '✓' : (near ? '↯' : '🔒')}</span></div>` +
               `<div class="ach-body"><b>${title}</b><span>${desc}</span></div>` +
               `<div class="ach-prog"><div class="ach-prog-fill" style="width:${got ? 100 : pct}%"></div></div>` +
               `<div class="ach-prog-label">${label}</div>` +
             `</div>`;
    }).join('') : `<div class="ach-empty">${owned.length ? 'Nothing here yet in this category.' : 'No achievements unlocked yet — go play a run!'}</div>`;

    const showcase = this._showcaseHTML(cos);
    host.innerHTML = `<div class="ach-tabs">${tabs}</div>${showcase}<div class="ach-grid">${cards}</div>`;
    if (typeof host.querySelectorAll === 'function')                               // guard: headless stub has no querySelectorAll
      host.querySelectorAll('.ach-tab').forEach(b => b.onclick = () => { this.filter = b.dataset.cat; this.renderGallery(); });
  },

  _showcaseHTML() { return ''; },

  /* ----- non-pausing toasts (own #achtoast, FIFO so multi-unlocks stagger; pure CSS = no rAF stall) ----- */
  _q: [], _busy: false,
  _push(html, accent, gold) {
    this._q.push({ html, accent, gold }); this._drain();
  },
  _drain() {
    if (this._busy || !this._q.length || typeof document === 'undefined') return;
    const el = document.getElementById('achtoast'); if (!el) { this._q.length = 0; return; }
    this._busy = true;
    const { html, accent, gold } = this._q.shift();
    el.style.setProperty('--ac', accent || '#ffd95e');
    el.innerHTML = html; el.classList.add('show', 'glitch'); if (gold) el.classList.add('shimmer');   // gold caps sweep
    clearTimeout(this._t1); clearTimeout(this._t2);
    this._t1 = setTimeout(() => el.classList.remove('glitch'), 240);                 // brief glitch flash only
    this._t2 = setTimeout(() => { el.classList.remove('show', 'shimmer'); this._busy = false; setTimeout(() => this._drain(), 360); }, 3200);
  },
  unlockToast(id) {
    if (typeof Ach === 'undefined') return;
    const d = Ach.CATALOG.find(x => x.id === id); if (!d) return;
    const tier = (d.tier || 'bronze').toUpperCase(), accent = { BRONZE:'#d9875a', SILVER:'#cfd6e6', GOLD:'#ffd95e' }[tier] || '#ffd95e';
    this._push(`<span class="at-ico">${d.ico}</span><div class="at-text"><b>ACHIEVEMENT UNLOCKED</b>` +
               `<span>${d.title} · ${tier}</span></div>`, accent, tier === 'GOLD');
  },
  cosmeticToast(cid) {
    if (typeof COSMETICS === 'undefined') return;
    const c = COSMETICS.find(x => x.id === cid); if (!c) return;
    this._push(`<span class="at-ico">${c.ico}</span><div class="at-text"><b>🎨 COSMETIC UNLOCKED</b>` +
               `<span>${c.kind === 'skin' ? 'Skin' : 'Trail'}: ${c.title}</span></div>`, '#54e6ff');
  },

  /* ----- DEV verification tool (console) -----
   * AchUI.mock('one_man_army', 0.99)  → set that badge to 99% (card pulses, bar fills) without unlocking.
   * AchUI.mock('annihilator', 1)      → unlock it + fire the unlock & cosmetic toasts (gold cap).
   * AchUI.mockReset()                 → restore the real mirror captured before the first mock.
   * Mirror-only; the server is never touched, so prod data is safe. */
  mock(id, frac) {
    if (typeof Ach === 'undefined') return 'no Ach';
    const d = Ach.CATALOG.find(x => x.id === id); if (!d) return 'unknown id: ' + id;
    if (frac == null) frac = 0.99;
    if (!this._snap) { try { this._snap = JSON.stringify(Ach._load()); } catch (e) {} }   // capture once
    const s = Ach._load(); if (!s.life.best) s.life.best = {};
    const c = Ach.driverCond(d), op = c.length === 2 ? '>=' : c[1], v = c.length === 2 ? c[1] : c[2], m = c[0];
    if (op === '>=') s.life.best[m] = Math.max(s.life.best[m] || 0, Math.round(v * frac));   // '<='/'==' goals are binary (no partial bar)
    Ach._save(s);
    if (frac >= 1) Ach.mockGrant(id); else this.renderGallery();
    return id + ' → ' + (frac >= 1 ? 'UNLOCKED' : Math.round(frac * 100) + '%');
  },
  mockReset() {
    if (typeof Ach === 'undefined' || this._snap == null) return 'nothing to reset';
    try { localStorage.setItem(Ach._key(), this._snap); } catch (e) {}
    this._snap = null; this.renderGallery();
    return 'mirror restored';
  },
};

/* ----- AchDebug : console verification tool for the whole achievement pipeline (UI + mirror + sync) -----
 * Everything is MIRROR-ONLY (prod data safe) EXCEPT syncTest(), the single command that hits the network.
 *   AchDebug.list()                     → every achievement: tier, category, progress %, state
 *   AchDebug.set('ghost_grid', 0.8)     → drive a badge's bar to 80% (near-complete pulse)
 *   AchDebug.unlock('untouchable')      → force-unlock + fire unlock/cosmetic toasts (gold shimmer)
 *   AchDebug.flag('dmgTaken', 0)        → set a LIVE run-flag mid-game to exercise intent tracking
 *   AchDebug.simRun({noHitWave:20})     → push a synthetic stats bag through evaluate→toasts→mirror
 *   AchDebug.syncTest({wave:10})        → opt-in /api/verify round-trip; reply logged to Ach._last
 *   AchDebug.reset()                    → restore the mirror snapshot captured before the first mock */
const AchDebug = {
  help() { return ['list()','set(id,frac)','unlock(id)','flag(name,value)','simRun(stats)','syncTest(stats)','reset()']; },
  list() {
    if (typeof Ach === 'undefined') return 'no Ach';
    return Ach.CATALOG.map(d => ({ id:d.id, tier:d.tier, cat:AchUI.catOf(d),
      pct:Math.round(Ach.progressFrac(d) * 100) + '%',
      state:Ach.isUnlocked(d.id) ? '✓ unlocked' : (d.hidden ? '??? hidden' : 'locked') }));
  },
  set(id, frac) { return AchUI.mock(id, frac == null ? 0.99 : frac); },
  unlock(id) { return AchUI.mock(id, 1); },
  flag(name, value) {
    if (typeof Ach === 'undefined' || !Ach.run) return 'no active run — start a game first';
    if (!(name in Ach.run)) return 'unknown run flag: ' + name + ' — try: ' + Object.keys(Ach.run).join(', ');
    Ach.run[name] = value; return name + ' = ' + value;
  },
  /* synthetic stats bag → the same fold/toast/mirror path reportRun uses (caller controls every metric,
   * intent ones included). Captures a snapshot first so AchDebug.reset() can undo it. */
  simRun(stats) {
    if (typeof Ach === 'undefined') return 'no Ach';
    if (AchUI._snap == null) { try { AchUI._snap = JSON.stringify(Ach._load()); } catch (e) {} }
    const base = { kills:0, score:0, wave:1, level:1, secs:0, bosses:0, runs:1, difficulty:'normal',
      noHitWave:0, starterWave:0, soloWave:0, asceticWave:0, glassWave:0, flawlessBoss:0,
      peakWeapons:0, bossKillSecs:9999, cameback:0, unlockedPct:0 };
    const full = Object.assign(base, stats || {});
    const s = Ach._load(), earned = Ach.evaluate(full), fresh = earned.filter(id => s.unlocked.indexOf(id) < 0);
    if (fresh.length) { s.unlocked = s.unlocked.concat(fresh); Ach._grantCosmetics(s, fresh); Ach._notify(fresh); Ach._save(s); }
    if (typeof Ach.renderPanel === 'function') Ach.renderPanel();
    return { earned, fresh };
  },
  syncTest(stats) {
    if (typeof Ach === 'undefined') return 'no Ach';
    if (!Ach._token) return 'no run_token — sign in and start an ONLINE run first (offline play is mirror-only)';
    const e = Object.assign({ score:0, secs:0, wave:1, kills:0, level:1, difficulty:'normal' }, stats || {});
    Ach._submit(e, Ach._runStats(e));
    if (typeof setTimeout === 'function') setTimeout(() => { try { console.log('[AchDebug] /api/verify →', Ach._last); } catch (x) {} }, 1500);
    return 'submitted — server reply logged in ~1.5s (also at Ach._last)';
  },
  reset() { return AchUI.mockReset(); },
};
if (typeof window !== 'undefined') window.AchDebug = AchDebug;
