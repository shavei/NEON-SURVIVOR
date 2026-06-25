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

  /* ----- category model: derive a gallery bucket from a def's metric (no schema change) ----- */
  CATS: [['all','All'], ['combat','Combat'], ['survival','Survival'], ['boss','Boss'], ['secret','Secret']],
  catOf(d) {
    if (d.hidden) return 'secret';
    if (d.metric === 'bosses') return 'boss';
    if (d.metric === 'kills') return 'combat';
    return 'survival';                        // score / wave / level / runs
  },

  /* ----- the gallery (rendered into #achlist, replacing the legacy flat list) ----- */
  renderGallery() {
    if (typeof document === 'undefined' || typeof Ach === 'undefined') return;
    const host = document.getElementById('achlist'); if (!host) return;
    const s = Ach._load(), owned = s.unlocked || [], cos = s.cosmetics || [];

    const tabs = this.CATS.map(([k, label]) =>
      `<button class="ach-tab${this.filter === k ? ' on' : ''}" data-cat="${k}">${label}</button>`).join('');

    const cards = Ach.CATALOG.filter(d => this.filter === 'all' || this.catOf(d) === this.filter).map(d => {
      const got = owned.indexOf(d.id) >= 0;
      const frac = Ach.progressFrac(d), pct = Math.round(frac * 100);
      const near = !got && frac >= 0.8;                                  // near-complete → neon pulse
      const secret = d.hidden && !got && frac <= 0;                      // undiscovered secret → masked
      const tier = d.tier || 'bronze';
      const val = Ach.progressValue(d), label = got ? 'UNLOCKED' : (secret ? '???' : val + ' / ' + d.threshold);
      const cls = ['ach-card', 'tier-' + tier, got ? 'got' : 'locked', near ? 'is-near' : '', secret ? 'secret' : ''].join(' ').trim();
      return `<div class="${cls}" data-tier="${tier}">` +
               `<div class="ach-head"><span class="ach-ico">${secret ? '❓' : d.ico}</span>` +
                 `<span class="ach-tier">${tier}</span><span class="ach-mark">${got ? '✓' : (near ? '↯' : '🔒')}</span></div>` +
               `<div class="ach-body"><b>${secret ? 'Hidden' : d.title}</b><span>${secret ? 'Discover this in play.' : d.desc}</span></div>` +
               `<div class="ach-prog"><div class="ach-prog-fill" style="width:${got ? 100 : pct}%"></div></div>` +
               `<div class="ach-prog-label">${label}</div>` +
             `</div>`;
    }).join('');

    const showcase = this._showcaseHTML(cos);
    host.innerHTML = `<div class="ach-tabs">${tabs}</div>${showcase}<div class="ach-grid">${cards}</div>`;
    if (typeof host.querySelectorAll === 'function')                               // guard: headless stub has no querySelectorAll
      host.querySelectorAll('.ach-tab').forEach(b => b.onclick = () => { this.filter = b.dataset.cat; this.renderGallery(); });
  },

  /* unlocked-cosmetics strip (gold-tier rewards) — empty until the first gold cap falls */
  _showcaseHTML(cos) {
    if (typeof COSMETICS === 'undefined' || !COSMETICS.length) return '';
    const chips = COSMETICS.map(c => {
      const owned = cos.indexOf(c.id) >= 0;
      return `<div class="cos-chip${owned ? ' got' : ''}" title="${owned ? c.title + ' — unlocked' : 'Locked: ' + c.title}">` +
             `<span class="cos-ico">${owned ? c.ico : '🔒'}</span><span>${owned ? c.title : '???'}</span></div>`;
    }).join('');
    return `<div class="ach-showcase"><div class="cos-title">🎨 COSMETICS — gold-tier rewards</div><div class="cos-row">${chips}</div></div>`;
  },

  /* ----- non-pausing toasts (own #achtoast, FIFO so multi-unlocks stagger; pure CSS = no rAF stall) ----- */
  _q: [], _busy: false,
  _push(html, accent) {
    this._q.push({ html, accent }); this._drain();
  },
  _drain() {
    if (this._busy || !this._q.length || typeof document === 'undefined') return;
    const el = document.getElementById('achtoast'); if (!el) { this._q.length = 0; return; }
    this._busy = true;
    const { html, accent } = this._q.shift();
    el.style.setProperty('--ac', accent || '#ffd95e');
    el.innerHTML = html; el.classList.add('show', 'glitch');
    clearTimeout(this._t1); clearTimeout(this._t2);
    this._t1 = setTimeout(() => el.classList.remove('glitch'), 240);                 // brief glitch flash only
    this._t2 = setTimeout(() => { el.classList.remove('show'); this._busy = false; setTimeout(() => this._drain(), 360); }, 3200);
  },
  unlockToast(id) {
    if (typeof Ach === 'undefined') return;
    const d = Ach.CATALOG.find(x => x.id === id); if (!d) return;
    const tier = (d.tier || 'bronze').toUpperCase(), accent = { BRONZE:'#d9875a', SILVER:'#cfd6e6', GOLD:'#ffd95e' }[tier] || '#ffd95e';
    this._push(`<span class="at-ico">${d.ico}</span><div class="at-text"><b>ACHIEVEMENT UNLOCKED</b>` +
               `<span>${d.title} · ${tier}</span></div>`, accent);
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
    const s = Ach._load(), target = Math.round(d.threshold * frac);
    const field = { kills:'bestKills', score:'bestScore', wave:'bestWave', level:'bestLevel', bosses:'bosses', runs:'runs' }[d.metric];
    s.life[field] = Math.max(s.life[field] || 0, target);
    Ach._save(s);
    if (frac >= 1) Ach.mockGrant(id); else this.renderGallery();
    return id + ' → ' + target + '/' + d.threshold + ' (' + Math.round(frac * 100) + '%)' + (frac >= 1 ? ' UNLOCKED' : '');
  },
  mockReset() {
    if (typeof Ach === 'undefined' || this._snap == null) return 'nothing to reset';
    try { localStorage.setItem(Ach._key(), this._snap); } catch (e) {}
    this._snap = null; this.renderGallery();
    return 'mirror restored';
  },
};
