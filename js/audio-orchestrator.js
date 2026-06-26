/* ========== DYNAMIC ORCHESTRAL MUSIC ENGINE + public Music facade ==========
   Replaces the synthwave SynthMusic. A procedural ORCHESTRAL composer (strings / winds / brass /
   timpani / choir) vertically remixed by live game intensity, driven by an EXPLICIT state machine:
     BOOT → AMBIENT ⇄ BOSS,  PAUSED (overlay on either),  DEATH (terminal → AMBIENT on reset).
   • Boss Sync: enterBoss queues a bar-quantized voicing crossfade + fires a brass/timpani intro sting.
   • Stings: level-up (ascending fanfare) and Tier-3 synergy (evolution chord + timpani) are one-shot
     overlays that do NOT change state.
   • Pause: sweeps a low-pass closed + ducks the bus so menus stay muffled/immersive (mobile pause btn).
   • Real-stem path: the STEMS manifest is the documented drop-in for sampled orchestral loops; absent
     assets, the procedural bed plays — the game is never silent.
   Inert-safe headless: no AudioContext ⇒ flags + trace only, never touches a node, never throws.
   F3 debug overlay (_perf.on) enables an [AUD] trace logging every state edge + live node count.
   This file OWNS the `Music` facade — game code (main.js / world.js via Fx.music) only touches Music.
   Edit by unique anchor; keep the terse one-liner style. */
const Orchestra = {
  // ---- tracks = data, not branches. sched() reads the active track's tempo / harmony / voicing flags ----
  // Aeolian (natural-minor) cinematic beds. prog = chord tones (MIDI); bass = chord root (MIDI). Chord
  // changes every 2 bars over an 8-bar cycle. Add a track (e.g. a final-boss theme) as a table entry.
  TRACKS: {
    ambient: { bpm: 80,  prog: [[57,60,64,67],[53,57,60,64],[55,58,62,65],[50,53,57,60]], bass: [33,29,31,26], drive: false, ostinato: false },
    boss:    { bpm: 132, prog: [[52,55,59,62],[51,55,58,62],[53,56,60,63],[50,53,57,60]], bass: [28,27,29,26], drive: true,  ostinato: true  },
  },
  // intensity i(0..1) + danger flag + boss flag → per-section target gain (dynamic orchestration). Tune here.
  MIX: {
    strings: (i, d, b) => 0.85 + 0.15 * i,                       // the always-on bowed bed
    winds:   (i, d, b) => clamp((i - 0.20) / 0.40, 0, 1),        // countermelody enters early
    brass:   (i, d, b) => b ? 0.70 + 0.30 * i : clamp((i - 0.55) / 0.35, 0, 1),  // nobility on heat / boss
    timpani: (i, d, b) => b ? 1 : clamp((i - 0.45) / 0.40, 0, 1),
    choir:   (i, d, b) => d ? 0.90 : clamp((i - 0.75) / 0.25, 0, 1) * 0.5,        // the danger / climax layer
  },
  LAYERS: ['strings', 'winds', 'brass', 'timpani', 'choir'],

  // ---- optional REAL sampled orchestral loops (drop-in, layered over the procedural bed) ----
  // Wire-up is intentionally deferred: this manifest documents the asset path for a follow-up commit.
  STEMS: { ambient: 'audio/orchestral/ambient.ogg', boss: 'audio/orchestral/boss.ogg' },

  // ---- state machine ----
  state: 'BOOT', active: 'ambient', playing: false, bossMode: false,
  _g: null, step: 0, nextTime: 0, _pending: null, _resume: 'AMBIENT', _i: 0, _live: 0, _trace: [],

  // ---------- STATE TRANSITION + DEBUG TRACE (one [AUD] line per edge; NEVER in the hot audio path) ----------
  _go(to, note) {
    const from = this.state; this.state = to;
    const line = '[AUD] ' + from + ' → ' + to + (note ? ' · ' + note : '');
    this._trace.push(line); if (this._trace.length > 40) this._trace.shift();
    if (typeof _perf !== 'undefined' && _perf.on && typeof console !== 'undefined' && console.log)
      console.log(line + ' · nodes~' + (this._live | 0));
  },
  audioTrace() { return this._trace.slice(); },                  // console helper: Music.audioTrace()
  _mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); },

  // ---------- INTENSITY (single-sourced; mirrors the old engines' computation) ----------
  _intensity() {
    const en = (typeof enemies !== 'undefined' && enemies) ? enemies.length : 0;
    let i = clamp(en / 25, 0, 1);
    if (this.active === 'boss') i = Math.max(i, 0.85);
    const lowhp = (typeof player !== 'undefined' && player && typeof state !== 'undefined' && state !== 'start')
      ? clamp(1 - player.hp / player.maxhp, 0, 1) : 0;
    return { i, danger: lowhp > 0.7 };
  },

  // ---------- AUDIO GRAPH: section gains → lowpass filter → bus → Sound.master ----------
  _build() {
    const ac = Sound.ac;
    const master = ac.createGain(); master.gain.value = 0; master.connect(Sound.master);
    const filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 1.2; filter.frequency.value = 1600; filter.connect(master);
    const layers = {};
    for (const L of this.LAYERS) { const g = ac.createGain(); g.gain.value = L === 'strings' ? 0.85 : 0; g.connect(filter); layers[L] = g; }
    master.gain.setTargetAtTime(0.9, ac.currentTime, 0.4);        // fade the bus in
    this._g = { master, filter, layers, sched: null, tick: null };
  },

  // one ADSR voice into a section bus; tracks _live so the debug trace can watch for node leaks
  _v(layer, freq, t, dur, type, vol, atk) {
    const ac = Sound.ac, g = this._g; if (!g) return;
    const o = ac.createOscillator(), ga = ac.createGain();
    o.type = type; o.frequency.value = freq;
    ga.gain.setValueAtTime(0, t); ga.gain.linearRampToValueAtTime(vol, t + atk); ga.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(ga); ga.connect(g.layers[layer]); o.start(t); o.stop(t + dur + 0.05);
    this._live++; setTimeout(() => { this._live--; }, (dur + 0.1) * 1000);
  },
  // timpani / low drum: pitched sine with a fast downward thump
  _timp(t, midi, vol) {
    const ac = Sound.ac, g = this._g; if (!g) return;
    const o = ac.createOscillator(), ga = ac.createGain(), f = this._mtof(midi);
    o.type = 'sine'; o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    ga.gain.setValueAtTime(vol, t); ga.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(ga); ga.connect(g.layers.timpani); o.start(t); o.stop(t + 0.55);
    this._live++; setTimeout(() => { this._live--; }, 650);
  },

  // ---------- THE COMPOSER: 8th-note grid, 8-bar cycle; reads this.active for tempo/harmony/voicing ----------
  sched() {
    const ac = Sound.ac, g = this._g; if (!g) return;
    while (this.nextTime < ac.currentTime + 0.18) {
      // Boss Sync: bar-quantized track swap (seamless — both beds share the bar grid). Sting on entering boss.
      if (this.step % 8 === 0 && this._pending && this._pending !== this.active) {
        const into = this._pending; this._pending = null; this.active = into;
        if (into === 'boss') this._sting('boss');
      }
      const T = this.TRACKS[this.active], stepDur = (60 / T.bpm) / 2;
      const s = this.step, idx = s % 8, bar = (s / 8) | 0, ci = (bar >> 1) % T.prog.length;
      const set = T.prog[ci], root = T.bass[ci], t = this.nextTime;
      // STRINGS — sustained bowed chord, re-attacked at each chord change (idx 0); + a cello root underneath
      if (idx === 0) {
        const dur = stepDur * 16;
        for (const m of set) { this._v('strings', this._mtof(m), t, dur, 'sawtooth', 0.045, 0.28); this._v('strings', this._mtof(m) * 1.006, t, dur, 'triangle', 0.035, 0.32); }
        this._v('strings', this._mtof(root), t, dur, 'sine', 0.09, 0.18);
      }
      // BOSS ostinato — driving low-string 8ths under everything
      if (T.ostinato) this._v('strings', this._mtof(root + 12), t, stepDur * 0.9, 'sawtooth', 0.04, 0.012);
      // WINDS — flowing countermelody (flute/oboe-ish triangle), thickens with intensity
      const wm = [0, 2, 1, 3, 2, 3, 1, 2][idx];
      if (idx % 2 === 0 || this._i > 0.4) this._v('winds', this._mtof(set[wm % set.length] + 12), t, stepDur * 1.5, 'triangle', 0.035, 0.04);
      // BRASS — noble stabs: every beat on the boss drive, downbeat-only when calm
      if (T.drive ? idx % 2 === 0 : idx === 0) {
        this._v('brass', this._mtof(set[0] + 12), t, stepDur * 2.2, 'sawtooth', 0.05, 0.06);
        this._v('brass', this._mtof(set[2] + 12), t, stepDur * 2.2, 'square', 0.028, 0.07);
      }
      // TIMPANI — heartbeat on strong beats; rolls on the off-beats during boss fights
      if (idx === 0 || idx === 4) this._timp(t, root - 12, 0.6);
      if (T.ostinato && (idx === 2 || idx === 6)) this._timp(t, root - 12, 0.4);
      // CHOIR — high sustained 'aah' swell at each chord change (danger/climax layer)
      if (idx === 0) this._v('choir', this._mtof(set[set.length - 1] + 12), t, stepDur * 16, 'sine', 0.05, 0.55);
      this.step = (this.step + 1) % 64;
      this.nextTime += stepDur;
    }
  },

  // automate section gains + filter cutoff from live intensity. Frozen while PAUSED (pause owns the filter).
  _tick() {
    const g = this._g; if (!g || this.state === 'PAUSED') return;
    const ac = Sound.ac, { i, danger } = this._intensity(); this._i = i; const boss = this.active === 'boss';
    for (const L of this.LAYERS) {
      const tgt = clamp((this.MIX[L] || (() => 1))(i, danger, boss), 0, 1);
      g.layers[L].gain.setTargetAtTime(tgt * 0.9, ac.currentTime, 0.5);
    }
    const cut = danger ? 700 : (boss ? 1500 : 1100) + i * 3000;
    g.filter.frequency.setTargetAtTime(cut, ac.currentTime, 0.35);
  },

  // ---------- STINGS — one-shot orchestral overlays; no state change ----------
  _sting(kind) {
    const ac = Sound.ac, g = this._g; if (!g || !ac) return;
    const t = ac.currentTime + 0.02;
    if (kind === 'boss')        { this._timp(t, 28, 0.9); this._timp(t + 0.13, 28, 0.7); [40, 47, 52].forEach(m => this._v('brass', this._mtof(m), t, 1.0, 'sawtooth', 0.06, 0.02)); }
    else if (kind === 'levelup'){ [64, 68, 71, 76].forEach((m, k) => this._v('brass', this._mtof(m), t + k * 0.045, 0.55, 'sawtooth', 0.045, 0.02)); this._timp(t, 52, 0.4); }   // ascending fanfare
    else if (kind === 'synergy'){ [52, 59, 64, 71].forEach(m => this._v('brass', this._mtof(m), t, 1.2, 'sawtooth', 0.05, 0.03)); this._v('choir', this._mtof(76), t, 1.5, 'sine', 0.05, 0.1); this._timp(t, 28, 0.8); this._timp(t + 0.22, 35, 0.6); }   // evolution chord
    if (typeof _perf !== 'undefined' && _perf.on && typeof console !== 'undefined' && console.log) console.log('[AUD] sting:' + kind + ' (overlay · no state change) · nodes~' + (this._live | 0));
  },

  // ---------- LIFECYCLE ----------
  start() {
    if (this._g && this._g.sched) { this.playing = true; return; }        // already running (idempotent)
    this.playing = true;
    if (!Sound || !Sound.ac) { this._go(this.bossMode ? 'BOSS' : 'AMBIENT', 'inert/no-audio'); return; }
    if (!this._g) this._build();
    this.active = this.bossMode ? 'boss' : 'ambient'; this._pending = null;
    this.step = 0; this.nextTime = Sound.ac.currentTime + 0.15;
    this._g.sched = setInterval(() => this.sched(), 30);
    this._g.tick = setInterval(() => this._tick(), 60);
    this._tick();
    this._go(this.bossMode ? 'BOSS' : 'AMBIENT', 'start');
  },

  _teardown(close) {
    const g = this._g; if (!g) return; this._g = null; const ac = Sound.ac;
    if (g.sched) clearInterval(g.sched); if (g.tick) clearInterval(g.tick);
    try {
      if (close) g.filter.frequency.setTargetAtTime(120, ac.currentTime, 0.25);   // close the hall (death)
      g.master.gain.setTargetAtTime(0.0001, ac.currentTime, close ? 0.3 : 0.12);
    } catch (e) {}
    setTimeout(() => { try { g.master.disconnect(); } catch (e) {} }, close ? 1000 : 200);
  },

  stop() { this.playing = false; this._teardown(false); this._go('BOOT', 'stop'); },   // leave to menu: full stop

  // pause: KEEP playing, muffled behind a low-pass (immersion in menus). Remembers the bed to resume into.
  pause() {
    this._resume = this.state === 'BOSS' ? 'BOSS' : 'AMBIENT';
    if (this._g && Sound.ac) { const ac = Sound.ac; this._g.filter.frequency.setTargetAtTime(360, ac.currentTime, 0.25); this._g.master.gain.setTargetAtTime(0.4, ac.currentTime, 0.2); }
    this._go('PAUSED', 'low-pass sweep');
  },
  resume() {
    if (!this.playing || !this._g) { this.start(); return; }               // safety: restart if we'd fully stopped
    if (Sound.ac) this._g.master.gain.setTargetAtTime(0.9, Sound.ac.currentTime, 0.2);   // filter reopens via _tick
    this._go(this._resume, 'resume'); this._tick();
  },

  die() {                                                                  // player death: final timpani toll + powerdown
    this.playing = false; this.bossMode = false; this.active = 'ambient'; this._pending = null;
    if (this._g && Sound.ac) this._timp(Sound.ac.currentTime + 0.02, 21, 0.9);
    this._teardown(true);
    this._go('DEATH', 'powerdown');
  },

  reset() {                                                                // new run: clear boss state to the ambient bed
    this.bossMode = false; this._pending = this._g ? 'ambient' : null; if (!this._g) this.active = 'ambient';
    this._go(this.playing && this.state !== 'BOOT' ? 'AMBIENT' : this.state, 'reset');
  },

  // ---------- BOSS TRANSITIONS (bar-quantized crossfade via _pending, or flag-only if not yet playing) ----------
  enterBoss() {
    if (this.bossMode) return; this.bossMode = true;
    if (this._g) this._pending = 'boss'; else this.active = 'boss';
    this._go('BOSS', 'enterBoss · xfade@bar');
  },
  exitBoss() {
    if (!this.bossMode) return; this.bossMode = false;
    if (this._g) this._pending = 'ambient'; else this.active = 'ambient';
    this._go('AMBIENT', 'exitBoss · xfade@bar');
  },
  stingLevelUp() { this._sting('levelup'); },                              // no state change (overlay)
  stingSynergy() { this._sting('synergy'); },
};

/* ========== PUBLIC FACADE — the only audio object game code touches ==========
   Preserves the start/stop/die/enterBoss/exitBoss/reset surface; adds pause/resume (swept low-pass)
   and stingLevelUp/stingSynergy. Fx.music(name) dispatches here by name. */
const Music = {
  start()       { Orchestra.start(); },
  stop()        { Orchestra.stop(); },
  pause()       { Orchestra.pause(); },
  resume()      { Orchestra.resume(); },
  die()         { Orchestra.die(); },
  reset()       { Orchestra.reset(); },
  enterBoss()   { Orchestra.enterBoss(); },
  exitBoss()    { Orchestra.exitBoss(); },
  stingLevelUp(){ Orchestra.stingLevelUp(); },
  stingSynergy(){ Orchestra.stingSynergy(); },
  audioTrace()  { return Orchestra.audioTrace(); },
  get bossMode() { return Orchestra.bossMode; },
  set bossMode(v) { Orchestra.bossMode = v; if (!v && !Orchestra._g) Orchestra.active = 'ambient'; },
};
