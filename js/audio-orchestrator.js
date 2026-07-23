/* ========== DYNAMIC MUSIC ENGINE + public Music facade ==========
   Real PD/CC0 RECORDINGS (state-driven jukebox; paths/voicings from AUDIO_MANIFEST) + a PROCEDURAL
   composer fallback — never silent. States: BOOT → MENU / AMBIENT ⇄ BOSS, PAUSED, OVER/DEATH.
   Streaming <audio> per state → MediaElementSource → trackGain → shared low-pass → master; transitions
   are SEAMLESS equal-power GainNode crossfades (_ramp, per-kind s from manifest.xfade); missing file ⇒
   procedural bed ('error' recovery). Low-HP DANGER sweeps the shared BiquadFilter to manifest.lowHealth
   freq/q on the LIVE mix (real-time effect, no track swap); the same filter carries the PAUSE muffle.
   Inert-safe headless: no AudioContext OR no Audio ctor ⇒ flags + trace only, never throws. F3 ⇒ [AUD]
   trace; Music.audioTrace() dumps it; window.debugAudioState() lives in genre-orchestrator.js.
   This file OWNS the `Music` facade — game code (main.js/world.js via Fx.music) only touches Music. */
const Orchestra = {
  // ---- jukebox + procedural beds, filled from AUDIO_MANIFEST just below the object literal. JUKE keys:
  // orchestral keeps menu/play/boss0-2/over; genre g gets g (wave) · g+'menu' · g+'boss0..2'; its beds land
  // in TRACKS under g / g+'boss'. Manifest absent ⇒ empty juke, the built-in beds carry everything.
  JUKE: {},
  TRACKS: {
    ambient: { bpm: 80,  prog: [[57,60,64,67],[53,57,60,64],[55,58,62,65],[50,53,57,60]], bass: [33,29,31,26], drive: false, ostinato: false },
    boss:    { bpm: 132, prog: [[52,55,59,62],[51,55,58,62],[53,56,60,63],[50,53,57,60]], bass: [28,27,29,26], drive: true,  ostinato: true  },
  },
  // i(0..1)+danger+boss → section gain (vertical remix). Tune here, not the loop.
  MIX: {
    strings: (i, d, b) => b ? 1 : 0.85 + 0.15 * i,
    winds:   (i, d, b) => clamp((i - 0.20) / 0.40, 0, 1),
    brass:   (i, d, b) => b ? 0.70 + 0.30 * i : clamp((i - 0.55) / 0.35, 0, 1),
    timpani: (i, d, b) => b ? 1 : clamp((i - 0.45) / 0.40, 0, 1),
    choir:   (i, d, b) => (b || d) ? 0.90 : clamp((i - 0.75) / 0.25, 0, 1) * 0.5,
  },
  LAYERS: ['strings', 'winds', 'brass', 'timpani', 'choir'],

  // ---- state ----
  state: 'BOOT', active: 'ambient', playing: false, bossMode: false, _bt: 0,
  _g: null, _jk: {}, _real: null, _realActive: false,
  step: 0, nextTime: 0, _pending: null, _resume: 'AMBIENT', _i: 0, _live: 0, _trace: [],

  // ---------- STATE TRANSITION + DEBUG TRACE (one [AUD] line per edge, off the hot path) ----------
  _go(to, note) {
    const from = this.state; this.state = to;
    const line = '[AUD] ' + from + ' → ' + to + (note ? ' · ' + note : '') + (this._realActive ? ' [real:' + this._real + ']' : ' [procedural]');
    this._trace.push(line); if (this._trace.length > 40) this._trace.shift();
    if (typeof _perf !== 'undefined' && _perf.on && typeof console !== 'undefined' && console.log) console.log(line + ' · nodes~' + (this._live | 0));
  },
  audioTrace() { return this._trace.slice(); },
  _mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); },
  // DANGER (low-HP) low-pass voicing from AUDIO_MANIFEST.lowHealth; _dangerOv = debugAudioState override
  _lh() { return (typeof AUDIO_MANIFEST !== 'undefined' && AUDIO_MANIFEST.lowHealth) || { freq: 700, q: 1.6, ramp: 0.35, hpFrac: 0.3 }; },
  _intensity() {
    const en = (typeof enemies !== 'undefined' && enemies) ? enemies.length : 0;
    let i = clamp(en / 25, 0, 1);
    if (this.active === 'boss') i = 1;   // boss overdrive: all sections full-throttle
    const lowhp = (typeof player !== 'undefined' && player && typeof state !== 'undefined' && state !== 'start') ? clamp(1 - player.hp / player.maxhp, 0, 1) : 0;
    return { i, danger: lowhp > 1 - this._lh().hpFrac || !!this._dangerOv };
  },

  // ---------- REAL-RECORDING JUKEBOX ----------
  _jukeOK() { return typeof Audio !== 'undefined' && Sound && Sound.ac && typeof Sound.ac.createMediaElementSource === 'function'; },
  _track(key) {                                  // lazy-create one streaming track
    if (!this._jukeOK() || !this._g) return null;
    if (this._jk[key]) return this._jk[key];
    const url = this.JUKE[key]; if (!url) return null;
    const a = new Audio(); a.src = url; a.loop = true; a.preload = 'auto';
    const rec = { a, gain: null, ready: false, bad: false };
    a.addEventListener('canplaythrough', () => { rec.ready = true; }, { once: true });
    a.addEventListener('error', () => { rec.bad = true; if (this._real === key) { this._real = null; this._realActive = false; }   // file missing ⇒ recover to procedural
      if (typeof _perf !== 'undefined' && _perf.on && typeof console !== 'undefined') console.log('[AUD] track missing: ' + url + ' → procedural fallback'); });
    try { const src = Sound.ac.createMediaElementSource(a); const g = Sound.ac.createGain(); g.gain.value = 0; src.connect(g); g.connect(this._g.filter); rec.gain = g; } catch (e) { rec.bad = true; }
    this._jk[key] = rec; return rec;
  },
  _warm(k) {                                     // warm the imminent track now, the trio later (off the tap-critical path)
    if (k) this._track(this._resolve(k));
    clearTimeout(this._warmT);
    this._warmT = setTimeout(() => { ['menu', 'play', 'over'].forEach(x => this._track(this._resolve(x))); }, 4000);
  },
  // equal-power crossfade seconds per transition kind — data lives in AUDIO_MANIFEST.xfade (boss snaps in faster than wave/menu)
  _xf(k) { const m = typeof AUDIO_MANIFEST !== 'undefined' && AUDIO_MANIFEST.xfade; return (m && m[k]) || 2.4; },
  _ramp(param, to, dur) {                        // glide one gain → `to` over `dur` s, no audible step
    const ac = Sound.ac; if (!ac) return;
    const now = ac.currentTime, from = param.value;
    if (Math.abs(from - to) < 0.001) return;
    try {
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now); else param.cancelScheduledValues(now);
      const N = 32, arr = new Float32Array(N);   // fade-in tracks sin, fade-out tracks cos ⇒ sin²+cos²=1, constant power through a swap
      for (let k = 0; k < N; k++) { const x = k / (N - 1);
        arr[k] = to > from ? from + (to - from) * Math.sin(x * Math.PI / 2) : to + (from - to) * Math.cos(x * Math.PI / 2); }
      arr[N - 1] = to; param.setValueCurveAtTime(arr, now, dur);
    } catch (e) { try { param.setTargetAtTime(to, now, dur / 3); } catch (_) {} }
  },
  _playReal(key, fk) {                           // crossfade to a real track (fk = xfade kind); false ⇒ unavailable (use procedural)
    if (!this._g || !this._jukeOK()) return false;
    key = this._resolve(key);                    // a player-equipped Soundtrack track overrides the gameplay theme
    const rec = this._track(key); if (!rec || rec.bad) return false;
    const XF = this._xf(fk);
    for (const k in this._jk) { const r = this._jk[k]; if (!r.gain) continue; const on = k === key;
      this._ramp(r.gain.gain, on ? 1 : 0, XF);   // equal-power overlap, no hard cut
      if (on) { try { const p = r.a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
      else setTimeout(() => { if (this._real !== k) try { r.a.pause(); } catch (e) {} }, (XF + 0.4) * 1000);   // pause only after the fade-out
    }
    this._real = key; this._realActive = true; return true;
  },
  _stopReal() { for (const k in this._jk) { const r = this._jk[k]; if (r.gain) try { r.gain.gain.value = 0; } catch (e) {} try { r.a.pause(); } catch (e) {} } this._real = null; this._realActive = false; },

  // GenreOrchestrator resolves menu/wave/boss keys through the equipped genre first (null = no opinion);
  // else an equipped Soundtrack reward re-points 'play' at its JUKE src; else the requested key unchanged.
  _resolve(key) {
    if (typeof GenreOrchestrator !== 'undefined' && GenreOrchestrator.resolveKey) { const k = GenreOrchestrator.resolveKey(key); if (k && this.JUKE[k]) return k; }
    if (key !== 'play' || typeof RewardEngine === 'undefined' || !RewardEngine.equippedMusic) return key;
    const eq = RewardEngine.equippedMusic();
    const m = eq && RewardEngine.musicDefs && RewardEngine.musicDefs().find(d => d.id === eq);
    return (m && m.src && this.JUKE[m.src]) ? m.src : key;
  },

  // which procedural bed the composer renders: genre/orchestral boss bed under a boss; else the equipped
  // genre's wave bed when its real file is absent; else the default ambient bed.
  _bed() {
    if (this.active === 'boss') {   // under a boss: the equipped genre's boss bed (GenreOrchestrator data), else the orchestral one
      if (typeof GenreOrchestrator !== 'undefined' && GenreOrchestrator.bossBed) { const k = GenreOrchestrator.bossBed(); if (this.TRACKS[k]) return k; }
      return 'boss'; }
    if (!this._realActive && typeof GenreOrchestrator !== 'undefined' && GenreOrchestrator.resolveKey) {   // genre wave bed (covers the debugGenre override too, which owns no track)
      const k = GenreOrchestrator.resolveKey('play'); if (k && this.TRACKS[k]) return k; }
    if (!this._realActive && typeof RewardEngine !== 'undefined' && RewardEngine.equippedMusic) {
      const eq = RewardEngine.equippedMusic();
      const m = eq && RewardEngine.musicDefs && RewardEngine.musicDefs().find(d => d.id === eq);
      if (m && m.src && this.TRACKS[m.src]) return m.src;
    }
    return this.active;
  },

  // one-shot ~8 s Soundtrack ▶ Preview — standalone <audio> outside the graph; headless no-op.
  previewTrack(key) {
    if (typeof Audio === 'undefined') return;
    const url = this.JUKE[key]; if (!url) return;
    try {
      this.stopPreview();
      const a = new Audio(); a.src = url; a.volume = 0.6; this._prev = a;
      const p = a.play(); if (p && p.catch) p.catch(() => {});
      this._duckBed(true);                                       // hush the menu bed so preview plays alone, not stacked on top
      this._prevT = setTimeout(() => this.stopPreview(), 9000);
    } catch (e) {}
  },
  stopPreview() { try { if (this._prevT) { clearTimeout(this._prevT); this._prevT = null; } if (this._prev) { this._prev.pause(); this._prev = null; } } catch (e) {} this._duckBed(false); },
  // duck/restore the in-graph mix (procedural bed + any real track, both feed _g.master) so a preview is never
  // heard over the menu music; restore target 0.9 == menu()/resume() level. No-op headless / before the graph exists.
  _duckBed(on) { if (this._g && Sound && Sound.ac) try { this._g.master.gain.setTargetAtTime(on ? 0.0001 : 0.9, Sound.ac.currentTime, 0.18); } catch (e) {} },

  // ---------- AUDIO GRAPH: section gains + sting bus + juke gains → lowpass → master → Sound.master ----------
  _build() {
    const ac = Sound.ac;
    const master = ac.createGain(); master.gain.value = 0; master.connect(Sound.master);
    const filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 1.2; filter.frequency.value = 8000; filter.connect(master);
    const layers = {};
    for (const L of this.LAYERS) { const g = ac.createGain(); g.gain.value = L === 'strings' ? 0.85 : 0; g.connect(filter); layers[L] = g; }
    const sting = ac.createGain(); sting.gain.value = 1; sting.connect(filter); layers.sting = sting;   // stings bypass intensity gating
    master.gain.setTargetAtTime(0.9, ac.currentTime, 0.4);
    this._g = { master, filter, layers, sched: null, tick: null };
  },
  _v(layer, freq, t, dur, type, vol, atk) {     // one ADSR voice (procedural bed / stings)
    const ac = Sound.ac, g = this._g; if (!g) return;
    const o = ac.createOscillator(), ga = ac.createGain();
    o.type = type; o.frequency.value = freq;
    ga.gain.setValueAtTime(0, t); ga.gain.linearRampToValueAtTime(vol, t + atk); ga.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(ga); ga.connect(g.layers[layer]); o.start(t); o.stop(t + dur + 0.05);
    this._live++; setTimeout(() => { this._live--; }, (dur + 0.1) * 1000);
  },
  _timp(layer, t, midi, vol) {                   // timpani / low drum
    const ac = Sound.ac, g = this._g; if (!g) return;
    const o = ac.createOscillator(), ga = ac.createGain(), f = this._mtof(midi);
    o.type = 'sine'; o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    ga.gain.setValueAtTime(vol, t); ga.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(ga); ga.connect(g.layers[layer]); o.start(t); o.stop(t + 0.55);
    this._live++; setTimeout(() => { this._live--; }, 650);
  },

  // ---------- PROCEDURAL COMPOSER: 8th-note grid, 8-bar cycle, reads this.active ----------
  sched() {
    const ac = Sound.ac, g = this._g; if (!g) return;
    while (this.nextTime < ac.currentTime + 0.18) {
      if (this.step % 8 === 0 && this._pending && this._pending !== this.active) { this.active = this._pending; this._pending = null; if (this.active === 'boss' && !this._realActive) this._sting('boss'); }
      const T = this.TRACKS[this._bed()], stepDur = (60 / T.bpm) / 2;
      const s = this.step, idx = s % 8, bar = (s / 8) | 0, ci = (bar >> 1) % T.prog.length;
      const set = T.prog[ci], root = T.bass[ci], t = this.nextTime;
      if (idx === 0) { const dur = stepDur * 16; for (const m of set) { this._v('strings', this._mtof(m), t, dur, 'sawtooth', 0.045, 0.28); this._v('strings', this._mtof(m) * 1.006, t, dur, 'triangle', 0.035, 0.32); } this._v('strings', this._mtof(root), t, dur, 'sine', 0.09, 0.18); }
      if (T.ostinato) this._v('strings', this._mtof(root + 12), t, stepDur * 0.9, 'sawtooth', 0.04, 0.012);
      const wm = [0, 2, 1, 3, 2, 3, 1, 2][idx];
      if (idx % 2 === 0 || this._i > 0.4) this._v('winds', this._mtof(set[wm % set.length] + 12), t, stepDur * 1.5, 'triangle', 0.035, 0.04);
      if (T.drive ? idx % 2 === 0 : idx === 0) { this._v('brass', this._mtof(set[0] + 12), t, stepDur * 2.2, 'sawtooth', 0.05, 0.06); this._v('brass', this._mtof(set[2] + 12), t, stepDur * 2.2, 'square', 0.028, 0.07); }
      if (idx === 0 || idx === 4) this._timp('timpani', t, root - 12, 0.6);
      if (T.ostinato && (idx === 2 || idx === 6)) this._timp('timpani', t, root - 12, 0.4);
      if (this.active === 'boss' && !this._realActive) { if (idx % 2 === 1) this._timp('timpani', t, root - 12, 0.35);   // boss overdrive: 8th-note war drums…
        this._v('brass', this._mtof(set[idx % set.length] + 24), t, stepDur * 0.7, 'square', 0.022, 0.008); }            // …+ shrill top-octave stab on every step
      if (idx === 0) this._v('choir', this._mtof(set[set.length - 1] + 12), t, stepDur * 16, 'sine', 0.05, 0.55);
      this.step = (this.step + 1) % 64; this.nextTime += stepDur;
    }
  },
  _tick() {                                      // automate section gains + filter; freezes while PAUSED
    const g = this._g; if (!g || this.state === 'PAUSED') return;
    const ac = Sound.ac, { i, danger } = this._intensity(); this._i = i; const boss = this.active === 'boss';
    const mute = this._realActive ? 0 : 1;       // silence the procedural bed under a live real track
    for (const L of this.LAYERS) { const tgt = clamp((this.MIX[L] || (() => 1))(i, danger, boss), 0, 1) * 0.9 * mute; g.layers[L].gain.setTargetAtTime(tgt, ac.currentTime, 0.5); }
    const LH = this._lh();                       // DANGER ⇒ manifest low-pass on the LIVE mix — no track swap
    const cut = danger ? LH.freq : (this._realActive ? 8000 : (boss ? 2600 : 1100) + i * 3000);   // real mix open unless danger; boss bed bright
    g.filter.frequency.setTargetAtTime(cut, ac.currentTime, LH.ramp);
    g.filter.Q.setTargetAtTime(danger ? LH.q : 1.2, ac.currentTime, LH.ramp);   // resonant peak reads as DANGER, not broken audio
  },
  _sting(kind) {                                 // one-shot orchestral overlay on the sting bus; no state change
    const ac = Sound.ac, g = this._g; if (!g || !ac) return;
    const t = ac.currentTime + 0.02;
    if (kind === 'boss')        { this._timp('sting', t, 28, 0.9); this._timp('sting', t + 0.13, 28, 0.7); [40, 47, 52].forEach(m => this._v('sting', this._mtof(m), t, 1.0, 'sawtooth', 0.06, 0.02)); }
    else if (kind === 'levelup'){ [64, 68, 71, 76].forEach((m, k) => this._v('sting', this._mtof(m), t + k * 0.045, 0.55, 'sawtooth', 0.045, 0.02)); this._timp('sting', t, 52, 0.4); }
    else if (kind === 'synergy'){ [52, 59, 64, 71].forEach(m => this._v('sting', this._mtof(m), t, 1.2, 'sawtooth', 0.05, 0.03)); this._v('sting', this._mtof(76), t, 1.5, 'sine', 0.05, 0.1); this._timp('sting', t, 28, 0.8); this._timp('sting', t + 0.22, 35, 0.6); }
    if (typeof _perf !== 'undefined' && _perf.on && typeof console !== 'undefined' && console.log) console.log('[AUD] sting:' + kind + ' (overlay) · nodes~' + (this._live | 0));
  },

  // ---------- LIFECYCLE ----------
  _ensure() {                                    // graph + schedulers up (idempotent)
    if (!this._g) this._build();
    if (!this._g.sched) { this.step = 0; this.nextTime = Sound.ac.currentTime + 0.15; this._g.sched = setInterval(() => this.sched(), 30); this._g.tick = setInterval(() => this._tick(), 60); }
  },
  menu() {                                       // chill menu theme
    this.playing = true; this.bossMode = false; this._pending = 'ambient'; this.active = 'ambient';
    if (!Sound || !Sound.ac) { this._go('MENU', 'inert/no-audio'); return; }
    this._ensure(); this._warm('menu');
    if (!this._playReal('menu', 'menu')) this._realActive = false;
    this._tick(); this._go('MENU', 'menu theme');
  },
  start() {                                      // gameplay (called on run start)
    this.playing = true;
    if (!Sound || !Sound.ac) { this._go(this.bossMode ? 'BOSS' : 'AMBIENT', 'inert/no-audio'); return; }
    this._ensure(); this._warm(this.bossMode ? 'boss' + (this._bt % 3) : 'play'); this.active = this.bossMode ? 'boss' : 'ambient'; this._pending = null;
    if (!this._playReal(this.bossMode ? 'boss' + (this._bt % 3) : 'play', this.bossMode ? 'boss' : 'wave')) this._realActive = false;
    this._tick(); this._go(this.bossMode ? 'BOSS' : 'AMBIENT', 'start');
  },
  _teardown(close) {
    const g = this._g; if (!g) return; this._g = null; this._jk = {}; this._real = null; this._realActive = false; const ac = Sound.ac;
    if (g.sched) clearInterval(g.sched); if (g.tick) clearInterval(g.tick);
    try { if (close) g.filter.frequency.setTargetAtTime(120, ac.currentTime, 0.25); g.master.gain.setTargetAtTime(0.0001, ac.currentTime, close ? 0.3 : 0.12); } catch (e) {}
    setTimeout(() => { try { g.master.disconnect(); } catch (e) {} }, close ? 1000 : 200);
  },
  stop() { this.playing = false; this._stopReal(); this._teardown(false); this._go('BOOT', 'stop'); },
  pause() {
    this._resume = this.state === 'BOSS' ? 'BOSS' : (this.state === 'MENU' ? 'MENU' : 'AMBIENT');
    if (this._g && Sound.ac) { const ac = Sound.ac; this._g.filter.frequency.setTargetAtTime(360, ac.currentTime, 0.25); this._g.master.gain.setTargetAtTime(0.4, ac.currentTime, 0.2); }
    this._go('PAUSED', 'low-pass sweep');         // real tracks keep streaming
  },
  resume() {
    if (!this.playing || !this._g) { this.start(); return; }
    if (Sound.ac) this._g.master.gain.setTargetAtTime(0.9, Sound.ac.currentTime, 0.2);
    this._go(this._resume, 'resume'); this._tick();
  },
  die() {                                        // somber real track if present, else procedural powerdown
    this.bossMode = false; this._pending = 'ambient';
    const over = this._jukeOK() ? this._track('over') : null;
    if (over && over.ready && !over.bad && this._playReal('over', 'over')) { this._go('OVER', 'gameover theme'); return; }
    this.playing = false; if (this._g && Sound.ac) this._timp('timpani', Sound.ac.currentTime + 0.02, 21, 0.9);
    this._teardown(true); this._go('DEATH', 'powerdown');
  },
  reset() {                                      // new run: back to the ambient bed
    this.bossMode = false; this._pending = 'ambient';
    if (this._real && this._real.indexOf('boss') >= 0) this._playReal('play', 'wave');   // >=0: genre boss keys are '<g>bossN'
    this._go(this.playing && this.state !== 'BOOT' ? 'AMBIENT' : this.state, 'reset');
  },
  enterBoss(bt) {                                // crossfade to this archetype's theme + sting
    if (this.bossMode) return; this.bossMode = true; this._bt = bt | 0;
    if (this._g) this._pending = 'boss'; else this.active = 'boss';
    if (!this._playReal('boss' + (this._bt % 3), 'boss')) this._realActive = false;   // boss asset absent ⇒ _tick un-mutes the procedural boss bed
    if (this._realActive) this._sting('boss');    // layer the sting over the real track
    this._go('BOSS', 'enterBoss b' + (this._bt % 3) + ' · xfade');
  },
  exitBoss() {
    if (!this.bossMode) return; this.bossMode = false;
    if (this._g) this._pending = 'ambient'; else this.active = 'ambient';
    if (!this._playReal('play', 'wave')) this._realActive = false;   // real track absent ⇒ procedural bed, not silence
    this._go('AMBIENT', 'exitBoss · xfade');
  },
  stingLevelUp() { this._sting('levelup'); },
  stingSynergy() { this._sting('synergy'); },
};

(function () { const G = typeof AUDIO_MANIFEST !== 'undefined' && AUDIO_MANIFEST.genres, J = Orchestra.JUKE, T = Orchestra.TRACKS;
  for (const g in G) { const d = G[g], o = g === 'orchestral';
    if (d.menu) J[o ? 'menu' : g + 'menu'] = d.menu; if (d.wave) J[o ? 'play' : g] = d.wave; if (d.over) J.over = d.over;
    if (d.boss) ['revenant', 'maelstrom', 'overseer'].forEach((a, i) => { if (d.boss[a]) J[(o ? 'boss' : g + 'boss') + i] = d.boss[a]; });
    if (d.bed) T[g] = d.bed; if (d.bossbed) T[g + 'boss'] = d.bossbed; } })();

/* ========== PUBLIC FACADE — the only audio object game code touches (Fx.music dispatches by name) ========== */
const Music = {
  menu()        { Orchestra.menu(); },
  start()       { Orchestra.start(); },
  stop()        { Orchestra.stop(); },
  pause()       { Orchestra.pause(); },
  resume()      { Orchestra.resume(); },
  die()         { Orchestra.die(); },
  reset()       { Orchestra.reset(); },
  enterBoss(bt) { Orchestra.enterBoss(bt); },
  exitBoss()    { Orchestra.exitBoss(); },
  stingLevelUp(){ Orchestra.stingLevelUp(); },
  stingSynergy(){ Orchestra.stingSynergy(); },
  preview(key)  { Orchestra.previewTrack(key); },   // Soundtrack tab ▶ Preview
  stopPreview() { Orchestra.stopPreview(); },
  audioTrace()  { return Orchestra.audioTrace(); },
  get bossMode() { return Orchestra.bossMode; },
  set bossMode(v) { Orchestra.bossMode = v; if (!v && !Orchestra._g) Orchestra.active = 'ambient'; },
};
