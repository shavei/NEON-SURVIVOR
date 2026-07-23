/* ========== TOTAL GENRE CONVERSION — GenreOrchestrator (the audio 'Director') ==========
 * Classic global. Loads AFTER audio-orchestrator.js and reward-map.js, BEFORE reward-granting-engine.js
 * (whose equipMusic fires rethemeGrid). All lookups runtime + typeof-guarded → headless/partial-load
 * inert-safe. Owns EVERY per-genre mapping so the near-cap modules stay small:
 *   • GENRE_MAP — built from AUDIO_MANIFEST (audio-manifest.js): genre → JUKE keys for menu / wave /
 *     the 3 boss archetype themes + the Warden title the boss toast shows (world.js reads wardenTitle();
 *     lang-he.js carries the Hebrew). 6 genres: orchestral (free) · classical · pop · metal · acoustic · rap.
 *   • unlocked(g) — a genre stays LOCKED until a music reward carrying it is owned; ownership is granted
 *     authoritatively by api/verify.js into user_inventory and hydrated by RewardEngine.pullInventory.
 *   • rethemeGrid() — live retheme hook (fired by RewardEngine.equipMusic): re-fires the live audio state
 *     through the new genre, refreshes the Music Sync readout, broadcasts a 'rethemeGrid' CustomEvent.
 *   • syncUI() — the menu/pause 'Music Sync' genre readout (#genreSyncMenu / #genreSyncPause).
 *   • window.debugGenre(id) — Thematic Swap audit · window.debugAudioState(st) — Music Stress Test. */
const GENRE_MAP = (function () { const M = {}, G = (typeof AUDIO_MANIFEST !== 'undefined' && AUDIO_MANIFEST.genres) || {};
  for (const g in G) { const d = G[g], o = g === 'orchestral';
    M[g] = { ico: d.ico, label: d.label, unlock: d.unlock, wardenTitle: d.wardenTitle,
      menu: o ? 'menu' : g + 'menu', wave: o ? 'play' : g, boss: ['0', '1', '2'].map(i => (o ? 'boss' : g + 'boss') + i) }; }
  if (!M.orchestral) M.orchestral = { ico: '🎼', label: 'Orchestral', menu: 'menu', wave: 'play', boss: ['boss0', 'boss1', 'boss2'], wardenTitle: 'WARDEN PROTOCOL' };   // manifest absent (partial load)
  return M; })();

const GenreOrchestrator = {
  _ov: null, _last: 'orchestral',   // _ov = debugGenre session override (wins over the equipped track); _last dedupes retheme refires
  // active genre id: override → equipped Soundtrack track's genre field → orchestral default. equippedMusic
  // is ownership-validated (RewardEngine.owns), so a locked genre can never become current.
  current() { if (this._ov) return this._ov;
    if (typeof RewardEngine !== 'undefined' && RewardEngine.equippedMusic) { const eq = RewardEngine.equippedMusic();
      const m = eq && RewardEngine.musicDefs && RewardEngine.musicDefs().find(function (d) { return d.id === eq; });
      const g = m && m.genre && String(m.genre).toLowerCase(); if (g && GENRE_MAP[g]) return g; }
    return 'orchestral'; },
  def() { return GENRE_MAP[this.current()]; },
  // a genre is UNLOCKED once the player owns ANY music reward carrying it — cloud-truth via user_inventory
  unlocked(g) { if (g === 'orchestral') return true;
    if (typeof RewardEngine === 'undefined' || !RewardEngine.musicDefs) return false;
    return RewardEngine.musicDefs().some(function (d) { return d.genre && String(d.genre).toLowerCase() === g && RewardEngine.owns(d.id); }); },
  // Orchestra._resolve delegate: menu/play/bossN → this genre's JUKE key. null = no opinion (orchestral /
  // non-themed key like 'over') → the legacy Soundtrack-override path in _resolve runs unchanged.
  resolveKey(key) { const g = this.current(); if (g === 'orchestral') return null; const d = GENRE_MAP[g];
    if (key === 'menu') return d.menu; if (key === 'play') return d.wave;
    if (key && key.indexOf('boss') === 0) { const bt = +key.slice(4) || 0; return d.boss[bt % d.boss.length]; }
    return null; },
  // procedural bed the composer renders under a boss for this genre ('boss' = the orchestral default bed)
  bossBed() { const k = this.current() + 'boss'; return (typeof Orchestra !== 'undefined' && Orchestra.TRACKS[k]) ? k : 'boss'; },
  // procedural MENU bed for this genre (distinct chill flavour when the real g+'menu' file is absent); null =
  // orchestral / genre with no menubed → Orchestra._bed falls through to the wave bed / default ambient loop
  menuBed() { const k = this.current() + 'menu'; return (typeof Orchestra !== 'undefined' && Orchestra.TRACKS[k]) ? k : null; },
  wardenTitle() { return this.def().wardenTitle; },   // world.js boss-spawn toast reads this (tr() at the display site)
  // menu + pause 'Music Sync' readout — re-rendered on every retheme and language switch (Hebrew in lang-he.js)
  syncUI() { if (typeof document === 'undefined') return; const d = this.def();
    ['genreSyncMenu', 'genreSyncPause'].forEach(function (id) { const el = document.getElementById(id); if (!el) return;
      el.innerHTML = '<span class="gs-ico">' + d.ico + '</span> ' + tr('Music Sync') + ': <b>' + tr(d.label) + '</b>'; }); },
  // THE retheme hook: crossfade the LIVE audio state onto the new genre (menu theme mid-menu, wave/boss
  // theme mid-run) + a Full Sync toast, then broadcast to any visual engine listening for 'rethemeGrid'.
  rethemeGrid() { const g = this.current();
    if (g !== this._last) { this._last = g;
      if (typeof Music !== 'undefined' && typeof Orchestra !== 'undefined') { const st = Orchestra.state;
        if (st === 'MENU') Music.menu(); else if (st === 'AMBIENT' || st === 'BOSS') Music.start(); }   // PAUSED/OVER/BOOT: the new theme applies on the next state edge
      const d = this.def();
      if (typeof AchUI !== 'undefined' && AchUI._push) AchUI._push(`<span class="at-ico">${d.ico}</span><div class="at-text"><b>${tr('⚡ FULL SYNC')}</b><span>${tr(d.label)} ${tr('grid conversion')}</span></div>`, '#ffd95e'); }
    this.syncUI();
    if (typeof window !== 'undefined' && window.dispatchEvent) try { window.dispatchEvent(new CustomEvent('rethemeGrid', { detail: { genre: g } })); } catch (e) {} },
};

/* Thematic Swap debugger — debugGenre('pop') instantly retunes music + Warden labels (no ownership gate,
 * session-only, no cloud write). debugGenre() lists genres; debugGenre(null) reverts to the equipped/default. */
if (typeof window !== 'undefined') window.debugGenre = function (id) {
  const GO = GenreOrchestrator;
  if (arguments.length === 0) { console.log('[GENRE] ' + Object.keys(GENRE_MAP).join(' · ') + ' — current: ' + GO.current() + (GO._ov ? ' (debug override)' : '')); return Object.keys(GENRE_MAP); }
  if (id === null) { GO._ov = null; GO.rethemeGrid(); console.log('[GENRE] override cleared → ' + GO.current()); return GO.current(); }
  id = String(id).toLowerCase();
  if (!GENRE_MAP[id]) { console.log('[GENRE] unknown "' + id + '" — try: ' + Object.keys(GENRE_MAP).join(' / ')); return null; }
  GO._ov = id; GO.rethemeGrid();
  const d = GENRE_MAP[id], he = (typeof LANG_HE !== 'undefined' && LANG_HE[d.wardenTitle]) || d.wardenTitle;
  console.log('[GENRE] ' + id + ' → menu:' + d.menu + ' · wave:' + d.wave + ' · boss:' + d.boss.join(',') + ' · bossBed:' + GO.bossBed() + ' · unlocked:' + GO.unlocked(id) + ' — warden: "' + d.wardenTitle + '" / "' + he + '"');
  return d;
};

/* Music Stress Test — window.debugAudioState('menu'|'wave'|'boss_0..2'|'lowhp'|'lowhp_off'|'over'|none).
 * Forces the orchestrator through that state edge and logs three snapshots (t0 → mid-fade → settled):
 * genre · real track vs procedural bed · every juke GainNode value · live low-pass Hz. Two overlapping
 * non-zero gains mid-fade PROVE the equal-power crossfade (a hard cut would show 0/1); filterHz collapsing
 * to AUDIO_MANIFEST.lowHealth.freq under 'lowhp' PROVES the danger muffle rides the LIVE mix with no track
 * swap. Session-only, no cloud writes. No arg = one snapshot of the current graph. */
if (typeof window !== 'undefined') window.debugAudioState = function (st) {
  if (typeof Orchestra === 'undefined') return 'no Orchestra';
  const O = Orchestra, GO = GenreOrchestrator;
  const snap = function (tag) { const gains = {}; for (const k in O._jk) { const r = O._jk[k]; if (r.gain) gains[k] = Math.round(r.gain.gain.value * 1000) / 1000; }
    const s = { tag: tag, state: O.state, genre: GO.current(), unlocked: GO.unlocked(GO.current()), real: O._real || ('procedural:' + O._bed()), gains: gains,
      filterHz: O._g ? Math.round(O._g.filter.frequency.value) : null, lowhpFx: !!O._dangerOv };
    try { console.log('[AUDX]', JSON.stringify(s)); } catch (e) {} return s; };
  if (st == null) return snap('now');
  st = String(st).toLowerCase();
  if (st === 'lowhp') { O._dangerOv = true; O._tick(); }
  else if (st === 'lowhp_off') { O._dangerOv = false; O._tick(); }
  else if (st === 'menu') Music.menu();
  else if (st === 'wave') { O.bossMode = false; Music.start(); }
  else if (st.indexOf('boss') === 0) { O.bossMode = false; Music.enterBoss((+st.replace(/\D/g, '') || 0) % 3); }
  else if (st === 'over') Music.die();
  else return 'states: menu · wave · boss_0/1/2 · lowhp · lowhp_off · over';
  const s0 = snap('t0'), xf = O._xf(st.indexOf('boss') === 0 ? 'boss' : 'wave') * 1000;
  setTimeout(function () { snap('mid-fade'); }, xf / 2); setTimeout(function () { snap('settled'); }, xf + 600);
  return s0;
};

// first Music Sync render + re-render on language switch (deferred a tick so RewardEngine/I18N exist)
if (typeof window !== 'undefined') setTimeout(function () { GenreOrchestrator.syncUI();
  if (typeof I18N !== 'undefined' && I18N.onChange) I18N.onChange(function () { GenreOrchestrator.syncUI(); }); }, 0);
