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

/* ========== GENRE BEAT ENGINE — attached onto Orchestra (kept here so audio-orchestrator.js stays under the
 * 28 KB truncation cap). A bed tagged style:'trap'|'edm'|'trance'|'pop'|'metal'|'classical'|'acoustic' in
 * AUDIO_MANIFEST renders through _beat instead of the orchestral voices, so each genre actually sounds like
 * itself (electronic drum-machine beds + band/chamber/unplugged beds). All methods run as
 * Orchestra methods (this === Orchestra): _v/_mtof/_g/_live/Sound all resolve on it. Headless: Sound.ac is
 * absent so nothing schedules; sched() never fires without an audio graph, so verify-equiv stays byte-identical. */
if (typeof Orchestra !== 'undefined') Object.assign(Orchestra, {
  _noiseBuf() { if (this._nb) return this._nb; const ac = Sound.ac; const n = (ac.sampleRate * 0.4) | 0; const b = ac.createBuffer(1, n || 1, ac.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return (this._nb = b); },   // Math.random = audio texture only, never the sim RNG
  _drum(layer, t, kind, vol) {                   // synth drum kit — kind ∈ kick | snare | hat | ohat
    const ac = Sound.ac, g = this._g; if (!g || !ac) return;
    if (kind === 'kick') { const o = ac.createOscillator(), ga = ac.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.08);
      ga.gain.setValueAtTime(vol, t); ga.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      o.connect(ga); ga.connect(g.layers[layer]); o.start(t); o.stop(t + 0.3); this._live++; setTimeout(() => { this._live--; }, 340); return; }
    const src = ac.createBufferSource(), ga = ac.createGain(), f = ac.createBiquadFilter(); src.buffer = this._noiseBuf();
    if (kind === 'snare') { f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8; ga.gain.setValueAtTime(vol, t); ga.gain.exponentialRampToValueAtTime(0.001, t + 0.17); }
    else { f.type = 'highpass'; f.frequency.value = 8000; ga.gain.setValueAtTime(vol, t); ga.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'ohat' ? 0.14 : 0.045)); }
    src.connect(f); f.connect(ga); ga.connect(g.layers[layer]); src.start(t); src.stop(t + 0.3); this._live++; setTimeout(() => { this._live--; }, 350);
  },
  _saw(layer, midi, t, dur, vol, atk) {          // 3-osc detuned supersaw (EDM/trance stabs + arps)
    const f = this._mtof(midi); this._v(layer, f * 0.994, t, dur, 'sawtooth', vol, atk); this._v(layer, f, t, dur, 'sawtooth', vol, atk); this._v(layer, f * 1.006, t, dur, 'sawtooth', vol, atk);
  },
  // 8th-note grid: idx 0..7 = one bar, sd = 8th-note seconds, hh = 16th. boss=true busies the pattern.
  _beat(style, set, root, s, idx, t, sd, boss) {
    const g = this._g; if (!g) return; const hh = sd / 2, mtof = m => this._mtof(m), nt = set.length, on = (...a) => a.indexOf(idx) >= 0;
    if (style === 'trap') {
      if (on(0, 3, 6)) this._drum('timpani', t, 'kick', 0.95);                        // syncopated kick
      if (idx === 4) this._drum('winds', t, 'snare', 0.7);                            // half-time clap on beat 3
      this._drum('winds', t, 'hat', 0.22);                                            // steady 8th hats…
      if (on(2, 5)) this._drum('winds', t + hh, 'hat', 0.18);                         // …16th doubles…
      if (idx === 7) { this._drum('winds', t + hh, 'hat', 0.2); this._drum('winds', t + sd * 0.75, 'hat', 0.16); }   // …roll into the downbeat
      if (on(0, 6)) this._v('strings', mtof(root - 12), t, sd * 2.4, 'sine', 0.5, 0.006);   // gliding 808 sub
      if (idx === 0) set.forEach(m => this._v('brass', mtof(m), t, sd * 1.6, 'sawtooth', 0.05, 0.02));   // dark minor stab
      if (boss && on(1, 4, 7)) this._drum('timpani', t, 'kick', 0.55);
      return;
    }
    if (style === 'edm') {
      if (idx % 2 === 0) this._drum('timpani', t, 'kick', 1.0);                       // four-on-the-floor
      if (idx === 4) this._drum('winds', t, 'snare', 0.6);                            // backbeat clap
      if (idx % 2 === 1) this._drum('winds', t, 'ohat', 0.28);                        // offbeat open hat
      this._v('strings', mtof(root), t, sd * 0.55, 'sawtooth', 0.4, 0.004);           // growling wobble bass…
      this._v('strings', mtof(root + (idx % 2 ? 12 : 0)), t + hh, sd * 0.45, 'sawtooth', 0.3, 0.004);   // …retrig'd octave bounce = fake wub
      if (idx % 2 === 1) this._saw('brass', set[(idx >> 1) % nt] + 12, t, sd * 0.9, 0.04, 0.01);         // complextro supersaw stab
      if (boss && idx === 0) this._drum('winds', t, 'snare', 0.5);
      return;
    }
    if (style === 'pop') {                         // bright I–V–vi–IV anthem: four-on-floor-lite + bell stabs
      if (on(0, 4)) this._drum('timpani', t, 'kick', 0.9);                            // punchy downbeat kick
      if (on(2, 6)) this._drum('winds', t, 'snare', 0.6);                             // backbeat clap
      this._drum('winds', t, 'hat', 0.16); if (idx % 2 === 1) this._drum('winds', t, 'ohat', 0.14);   // 8th hats + offbeat open
      this._v('strings', mtof(root), t, sd * 0.9, 'triangle', 0.42, 0.006); this._v('strings', mtof(root + (idx % 2 ? 12 : 7)), t + hh, sd * 0.5, 'triangle', 0.22, 0.006);   // bouncy octave/5th bass
      if (idx % 2 === 0) set.forEach(m => this._v('brass', mtof(m + 12), t, sd * 0.7, 'sine', 0.05, 0.004));   // bright bell/synth stab
      if (idx === 0) this._v('choir', mtof(set[nt - 1] + 12), t, sd * 16, 'triangle', 0.04, 0.4);   // shimmer pad
      if (boss && on(2, 6)) this._drum('timpani', t, 'kick', 0.4);
      return;
    }
    if (style === 'metal') {                       // driving power-chord chug: galloping kick + tremolo lead
      if (idx % 2 === 0) this._drum('timpani', t, 'kick', 0.95);                      // galloping kick chug
      if (on(2, 6)) this._drum('winds', t, 'snare', 0.72);                            // driving backbeat
      this._drum('winds', t, 'hat', 0.2);
      this._saw('brass', root + 12, t, sd * 0.9, 0.06, 0.002); this._saw('brass', root + 19, t, sd * 0.9, 0.05, 0.002);   // palm-muted power chord (root+5th)
      if (idx % 2 === 1) this._saw('brass', set[s % nt] + 24, t, hh * 1.05, 0.03, 0.002);   // tremolo-picked lead 16ths
      if (idx === 0) this._v('strings', mtof(root - 12), t, sd * 4, 'sawtooth', 0.09, 0.004);   // low sub drone
      if (boss) { if (idx % 2 === 1) this._drum('timpani', t, 'kick', 0.6); this._drum('winds', t + hh, 'hat', 0.14); }   // double-kick blast
      return;
    }
    if (style === 'classical') {                   // no drum kit — Alberti broken-chord arpeggio + sustained pad
      this._v('strings', mtof(set[[0, 2, 1, 2, 0, 2, 1, 2][idx] % nt] + 12), t, sd * 1.1, 'triangle', 0.06, 0.01);   // Alberti bass figure
      if (boss) this._v('strings', mtof(set[(s * 2) % nt] + 24), t + hh, hh * 1.1, 'triangle', 0.045, 0.008);   // agitato 16th run under boss
      if (idx === 0) { set.forEach(m => this._v('choir', mtof(m), t, sd * 16, 'sine', 0.05, 0.5)); this._timp('timpani', t, root - 12, boss ? 0.55 : 0.32); }   // sustained pad + soft downbeat drum
      if (idx === 4) this._v('strings', mtof(root), t, sd * 4, 'sine', 0.07, 0.02);   // mid-bar bass suspension
      if (boss && on(2, 6)) this._timp('timpani', t, root - 12, 0.4);
      return;
    }
    if (style === 'acoustic') {                    // unplugged — brushed kit, walking bass, fingerpicked arpeggio
      if (on(0, 4)) this._drum('timpani', t, 'kick', 0.5); this._drum('winds', t, 'hat', 0.1);   // soft upright kick + brushed 8ths
      if (boss && on(2, 6)) this._drum('winds', t, 'snare', 0.4);                     // brushed backbeat under boss
      if (idx % 2 === 0) this._v('strings', mtof(root + (idx % 4 ? 2 : 0)), t, sd * 1.1, 'triangle', 0.16, 0.008);   // walking upright bass
      this._v('brass', mtof(set[(s + idx) % nt] + 12), t, sd * 0.8, 'triangle', 0.05, 0.004);   // fingerpicked pluck
      if (idx % 2 === 1) this._v('brass', mtof(set[(s + 1) % nt] + 19), t + hh, hh * 1.1, 'triangle', 0.035, 0.004);   // travis-pick upper string
      if (idx === 0) this._v('choir', mtof(set[0] + 12), t, sd * 12, 'sine', 0.03, 0.6);   // warm body resonance
      return;
    }
    if (idx % 2 === 0) this._drum('timpani', t, 'kick', 0.95);                        // trance: driving 4-on-floor
    if (idx % 2 === 1) { this._drum('winds', t, 'ohat', 0.3); this._v('strings', mtof(root), t, sd * 0.5, 'square', 0.28, 0.004); }   // offbeat hat + rolling psy bass
    this._saw('brass', set[(s * 2) % nt] + 12, t, hh * 1.1, 0.035, 0.006);            // climbing 16th supersaw arp
    this._saw('brass', set[(s * 2 + 1) % nt] + 12, t + hh, hh * 1.1, 0.035, 0.006);
    if (idx === 0) set.forEach(m => this._v('choir', mtof(m), t, sd * 16, 'sawtooth', 0.03, 0.6));        // euphoric sustained pad
    if (boss && idx % 2 === 0) this._drum('winds', t, 'hat', 0.2);
  },
});

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
