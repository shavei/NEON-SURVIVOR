/* ========== DYNAMIC ORCHESTRAL MUSIC ENGINE + public Music facade ==========
   Real public-domain orchestral RECORDINGS (a state-driven jukebox) with a PROCEDURAL orchestral
   composer as the offline / headless / pre-download fallback — so the game is never silent.
   Explicit state machine: BOOT → MENU / AMBIENT ⇄ BOSS, PAUSED (overlay), OVER / DEATH (terminal).
   • Jukebox: streaming <audio> per state → MediaElementSource → trackGain → the shared low-pass filter
     → master, so the PAUSE sweep + low-HP DANGER muffle shape the real mix too. Missing file ⇒ that
     state falls back to the procedural bed (per-track 'error' recovery). Tracks sourced by fetch-music.sh.
   • Boss Sync: enterBoss(bt) crossfades to the boss theme for that archetype (0/1/2) + a brass sting.
   • Stings: level-up fanfare & Tier-3 synergy chord on a dedicated bus (always audible over any track).
   • Procedural bed: strings/winds/brass/timpani/choir, vertically remixed by intensity — used wherever
     a real track is absent. Muted under a live real track.
   Inert-safe headless: no AudioContext OR no Audio ctor ⇒ flags + trace only, never throws.
   F3 overlay (_perf.on) ⇒ [AUD] trace of every state edge + live node count. Music.audioTrace() dumps it.
   This file OWNS the `Music` facade — game code (main.js/world.js via Fx.music) only touches Music. */
const Orchestra = {
  // ---- real-recording manifest: filenames fetch-music.sh writes into audio/orchestral/ (PD/CC0 only) ----
  JUKE: {
    menu:  'audio/orchestral/menu.ogg',            // Debussy — Clair de Lune (not yet supplied → procedural)
    play:  'audio/orchestral/gameplay.mp3',        // Mozart — Symphony No.40 i (urgent)
    boss0: 'audio/orchestral/boss-revenant.mp3',   // Mozart — Requiem: Dies Irae
    boss1: 'audio/orchestral/boss-maelstrom.mp3',  // Bach — Toccata & Fugue in D minor
    boss2: 'audio/orchestral/boss-overseer.ogg',   // Mussorgsky — Night on Bald Mountain
    over:  'audio/orchestral/gameover.ogg',         // Chopin — Marche funèbre (somber)
  },

  // ---- procedural fallback bed: tracks = data. Aeolian beds; prog = chord tones, bass = root (MIDI) ----
  TRACKS: {
    ambient: { bpm: 80,  prog: [[57,60,64,67],[53,57,60,64],[55,58,62,65],[50,53,57,60]], bass: [33,29,31,26], drive: false, ostinato: false },
    boss:    { bpm: 132, prog: [[52,55,59,62],[51,55,58,62],[53,56,60,63],[50,53,57,60]], bass: [28,27,29,26], drive: true,  ostinato: true  },
  },
  // intensity i(0..1) + danger + boss → section gain (procedural vertical remix). Tune here, not the loop.
  MIX: {
    strings: (i, d, b) => 0.85 + 0.15 * i,
    winds:   (i, d, b) => clamp((i - 0.20) / 0.40, 0, 1),
    brass:   (i, d, b) => b ? 0.70 + 0.30 * i : clamp((i - 0.55) / 0.35, 0, 1),
    timpani: (i, d, b) => b ? 1 : clamp((i - 0.45) / 0.40, 0, 1),
    choir:   (i, d, b) => d ? 0.90 : clamp((i - 0.75) / 0.25, 0, 1) * 0.5,
  },
  LAYERS: ['strings', 'winds', 'brass', 'timpani', 'choir'],

  // ---- state ----
  state: 'BOOT', active: 'ambient', playing: false, bossMode: false, _bt: 0,
  _g: null, _jk: {}, _real: null, _realActive: false,
  step: 0, nextTime: 0, _pending: null, _resume: 'AMBIENT', _i: 0, _live: 0, _trace: [],

  // ---------- STATE TRANSITION + DEBUG TRACE (one [AUD] line per edge; never in the hot audio path) ----------
  _go(to, note) {
    const from = this.state; this.state = to;
    const line = '[AUD] ' + from + ' → ' + to + (note ? ' · ' + note : '') + (this._realActive ? ' [real:' + this._real + ']' : ' [procedural]');
    this._trace.push(line); if (this._trace.length > 40) this._trace.shift();
    if (typeof _perf !== 'undefined' && _perf.on && typeof console !== 'undefined' && console.log) console.log(line + ' · nodes~' + (this._live | 0));
  },
  audioTrace() { return this._trace.slice(); },
  _mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); },
  _intensity() {
    const en = (typeof enemies !== 'undefined' && enemies) ? enemies.length : 0;
    let i = clamp(en / 25, 0, 1);
    if (this.active === 'boss') i = Math.max(i, 0.85);
    const lowhp = (typeof player !== 'undefined' && player && typeof state !== 'undefined' && state !== 'start') ? clamp(1 - player.hp / player.maxhp, 0, 1) : 0;
    return { i, danger: lowhp > 0.7 };
  },

  // ---------- REAL-RECORDING JUKEBOX (streaming <audio> through the shared filter) ----------
  _jukeOK() { return typeof Audio !== 'undefined' && Sound && Sound.ac && typeof Sound.ac.createMediaElementSource === 'function'; },
  _track(key) {                                  // lazy-create one streaming track; returns its record or null
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
  _warm() { ['menu', 'play', 'over'].forEach(k => this._track(k)); },   // preload the common tracks
  _playReal(key) {                               // crossfade to a real track; false ⇒ unavailable (use procedural)
    if (!this._g || !this._jukeOK()) return false;
    const rec = this._track(key); if (!rec || rec.bad) return false;
    const ac = Sound.ac;
    for (const k in this._jk) { const r = this._jk[k]; if (!r.gain) continue; const on = k === key;
      r.gain.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, 0.6);
      if (on) { try { const p = r.a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
      else setTimeout(() => { if (this._real !== k) try { r.a.pause(); } catch (e) {} }, 1300);
    }
    this._real = key; this._realActive = true; return true;
  },
  _stopReal() { for (const k in this._jk) { const r = this._jk[k]; if (r.gain) try { r.gain.gain.value = 0; } catch (e) {} try { r.a.pause(); } catch (e) {} } this._real = null; this._realActive = false; },

  // ---------- AUDIO GRAPH: section gains + sting bus + juke gains → lowpass filter → bus → Sound.master ----------
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

  // ---------- PROCEDURAL COMPOSER (fallback bed): 8th-note grid, 8-bar cycle, reads this.active ----------
  sched() {
    const ac = Sound.ac, g = this._g; if (!g) return;
    while (this.nextTime < ac.currentTime + 0.18) {
      if (this.step % 8 === 0 && this._pending && this._pending !== this.active) { this.active = this._pending; this._pending = null; if (this.active === 'boss' && !this._realActive) this._sting('boss'); }
      const T = this.TRACKS[this.active], stepDur = (60 / T.bpm) / 2;
      const s = this.step, idx = s % 8, bar = (s / 8) | 0, ci = (bar >> 1) % T.prog.length;
      const set = T.prog[ci], root = T.bass[ci], t = this.nextTime;
      if (idx === 0) { const dur = stepDur * 16; for (const m of set) { this._v('strings', this._mtof(m), t, dur, 'sawtooth', 0.045, 0.28); this._v('strings', this._mtof(m) * 1.006, t, dur, 'triangle', 0.035, 0.32); } this._v('strings', this._mtof(root), t, dur, 'sine', 0.09, 0.18); }
      if (T.ostinato) this._v('strings', this._mtof(root + 12), t, stepDur * 0.9, 'sawtooth', 0.04, 0.012);
      const wm = [0, 2, 1, 3, 2, 3, 1, 2][idx];
      if (idx % 2 === 0 || this._i > 0.4) this._v('winds', this._mtof(set[wm % set.length] + 12), t, stepDur * 1.5, 'triangle', 0.035, 0.04);
      if (T.drive ? idx % 2 === 0 : idx === 0) { this._v('brass', this._mtof(set[0] + 12), t, stepDur * 2.2, 'sawtooth', 0.05, 0.06); this._v('brass', this._mtof(set[2] + 12), t, stepDur * 2.2, 'square', 0.028, 0.07); }
      if (idx === 0 || idx === 4) this._timp('timpani', t, root - 12, 0.6);
      if (T.ostinato && (idx === 2 || idx === 6)) this._timp('timpani', t, root - 12, 0.4);
      if (idx === 0) this._v('choir', this._mtof(set[set.length - 1] + 12), t, stepDur * 16, 'sine', 0.05, 0.55);
      this.step = (this.step + 1) % 64; this.nextTime += stepDur;
    }
  },
  _tick() {                                      // automate section gains + filter; freezes while PAUSED
    const g = this._g; if (!g || this.state === 'PAUSED') return;
    const ac = Sound.ac, { i, danger } = this._intensity(); this._i = i; const boss = this.active === 'boss';
    const mute = this._realActive ? 0 : 1;       // silence the procedural bed under a live real track
    for (const L of this.LAYERS) { const tgt = clamp((this.MIX[L] || (() => 1))(i, danger, boss), 0, 1) * 0.9 * mute; g.layers[L].gain.setTargetAtTime(tgt, ac.currentTime, 0.5); }
    const cut = this._realActive ? (danger ? 900 : 8000) : (danger ? 700 : (boss ? 1500 : 1100) + i * 3000);   // real mix stays open except on danger
    g.filter.frequency.setTargetAtTime(cut, ac.currentTime, 0.35);
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
  menu() {                                       // chill menu theme (or calm procedural bed)
    this.playing = true; this.bossMode = false; this._pending = 'ambient'; this.active = 'ambient';
    if (!Sound || !Sound.ac) { this._go('MENU', 'inert/no-audio'); return; }
    this._ensure(); this._warm();
    if (!this._playReal('menu')) this._realActive = false;
    this._tick(); this._go('MENU', 'menu theme');
  },
  start() {                                      // gameplay (called on run start)
    this.playing = true;
    if (!Sound || !Sound.ac) { this._go(this.bossMode ? 'BOSS' : 'AMBIENT', 'inert/no-audio'); return; }
    this._ensure(); this._warm(); this.active = this.bossMode ? 'boss' : 'ambient'; this._pending = null;
    if (!this._playReal(this.bossMode ? 'boss' + (this._bt % 3) : 'play')) this._realActive = false;
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
    this._go('PAUSED', 'low-pass sweep');         // real tracks keep streaming, muffled
  },
  resume() {
    if (!this.playing || !this._g) { this.start(); return; }
    if (Sound.ac) this._g.master.gain.setTargetAtTime(0.9, Sound.ac.currentTime, 0.2);
    this._go(this._resume, 'resume'); this._tick();
  },
  die() {                                        // game over: somber real track if present, else procedural powerdown
    this.bossMode = false; this._pending = 'ambient';
    const over = this._jukeOK() ? this._track('over') : null;
    if (over && over.ready && !over.bad && this._playReal('over')) { this._go('OVER', 'gameover theme'); return; }
    this.playing = false; if (this._g && Sound.ac) this._timp('timpani', Sound.ac.currentTime + 0.02, 21, 0.9);
    this._teardown(true); this._go('DEATH', 'powerdown');
  },
  reset() {                                      // new run: clear boss state to the gameplay/ambient bed
    this.bossMode = false; this._pending = 'ambient';
    if (this._real && this._real.indexOf('boss') === 0) this._playReal('play');
    this._go(this.playing && this.state !== 'BOOT' ? 'AMBIENT' : this.state, 'reset');
  },
  enterBoss(bt) {                                // boss spawn: crossfade to this archetype's epic theme + sting
    if (this.bossMode) return; this.bossMode = true; this._bt = bt | 0;
    if (this._g) this._pending = 'boss'; else this.active = 'boss';
    this._playReal('boss' + (this._bt % 3));      // procedural boss bed if no asset (sched fires the sting)
    if (this._realActive) this._sting('boss');    // real track plays: layer the sting on the sting bus
    this._go('BOSS', 'enterBoss b' + (this._bt % 3) + ' · xfade');
  },
  exitBoss() {
    if (!this.bossMode) return; this.bossMode = false;
    if (this._g) this._pending = 'ambient'; else this.active = 'ambient';
    this._playReal('play');
    this._go('AMBIENT', 'exitBoss · xfade');
  },
  stingLevelUp() { this._sting('levelup'); },
  stingSynergy() { this._sting('synergy'); },
};

/* ========== PUBLIC FACADE — the only audio object game code touches ==========
   start/stop/die/enterBoss/exitBoss/reset preserved; adds menu (chill theme), pause/resume (swept
   low-pass), stingLevelUp/stingSynergy. Fx.music(name, ...args) dispatches here by name. */
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
  audioTrace()  { return Orchestra.audioTrace(); },
  get bossMode() { return Orchestra.bossMode; },
  set bossMode(v) { Orchestra.bossMode = v; if (!v && !Orchestra._g) Orchestra.active = 'ambient'; },
};
