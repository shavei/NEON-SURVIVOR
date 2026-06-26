/* ========== REAL INSTRUMENT AUDIO ENGINE (stem layering) ==========
   Loads OGG instrument stem loops asynchronously, plays them phase-locked & gapless, and mixes
   layers by live game intensity (vertical remixing). Falls back to the procedural SynthMusic
   (core.js) until/unless real stems decode, so the game is audible from frame 1 and never hangs.

   PUBLIC SURFACE = the `Music` facade at the bottom: start/stop/die/enterBoss/exitBoss/reset +
   bossMode. Game code (main.js, world.js) only ever touches `Music`. To add/replace audio, edit
   THIS file — nothing else.

   Headless/asset-less safe: load() is guarded (no fetch at load time; runtime fetch failures are
   caught and we stay on SynthMusic). Gapless looping is inherent: we decodeAudioData into an
   AudioBuffer and loop the buffer (no encoder-padding gaps like <audio> has).

   See AUDIO_SPEC.md for the stem sourcing brief (filenames, tempo, loop length, mix levels). */
const RealMusic = {
  // ---- Manifest: stem files per track. Data, not branches — add a track as a table entry. ----
  // dir+stem+'.ogg' is the fetch path. `intro` is an optional non-looping boss drop one-shot.
  MANIFEST: {
    normal: { dir: 'audio/normal/', bpm: 125, bars: 8, stems: ['drums', 'rhythm', 'bass', 'lead', 'fx'] },
    boss:   { dir: 'audio/boss/',   bpm: 150, bars: 8, stems: ['drums', 'rhythm', 'bass', 'lead', 'fx'], intro: true },
  },

  // ---- Intensity -> per-stem gain target (i = 0..1 swarm intensity, d = low-HP danger flag). ----
  // Mirrors the synth's layering: drums/rhythm are the always-on bed; bass scales; lead enters
  // mid-intensity; fx only on danger. Tune here, not in the hot loop.
  MIX: {
    drums:  (i, d) => 1.0,
    rhythm: (i, d) => 0.85 + 0.15 * i,
    bass:   (i, d) => 0.30 + 0.70 * i,
    lead:   (i, d) => clamp((i - 0.45) / 0.40, 0, 1),
    fx:     (i, d) => d ? 0.85 : 0.0,
  },

  // ---- State ----
  buffers: {},                              // {track: {stem: AudioBuffer, __intro?: AudioBuffer}}
  loaded:  { normal: false, boss: false },  // stems decoded & ready
  loading: { normal: null,  boss: null },   // in-flight load promises (dedupe)
  playing: false,
  bossMode: false,
  active: 'normal',                         // which track should be sounding
  _g: null,                                 // active real-audio graph (null = not on real audio)

  // ---------- ASYNC LOADING (never blocks; failure => stay on synth) ----------
  load(track) {
    if (this.loaded[track]) return Promise.resolve(true);
    if (this.loading[track]) return this.loading[track];
    if (typeof fetch !== 'function' || !Sound.ac || !Sound.ac.decodeAudioData) return Promise.resolve(false);
    const m = this.MANIFEST[track], ac = Sound.ac;
    const grab = (url) => fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); })
                                    .then(buf => ac.decodeAudioData(buf));
    this.loading[track] = (async () => {
      try {
        const bufs = {};
        await Promise.all(m.stems.map(async s => { bufs[s] = await grab(m.dir + s + '.ogg'); }));
        if (m.intro) { try { bufs.__intro = await grab(m.dir + 'intro.ogg'); } catch (e) {} } // optional
        this.buffers[track] = bufs;
        this.loaded[track] = true;
        if (this.playing && this.active === track) this._route();   // upgrade synth->real live
        return true;
      } catch (e) { this.loading[track] = null; return false; }      // missing/undecodable => fallback
    })();
    return this.loading[track];
  },

  // ---------- INTENSITY (single-sourced; same computation as SynthMusic.sched) ----------
  _intensity() {
    const en = (typeof enemies !== 'undefined' && enemies) ? enemies.length : 0;
    let i = clamp(en / 25, 0, 1);
    if (this.active === 'boss') i = Math.max(i, 0.85);              // boss fights run hot
    const lowhp = (typeof player !== 'undefined' && player && state !== 'start')
      ? clamp(1 - player.hp / player.maxhp, 0, 1) : 0;
    return { i, danger: lowhp > 0.7 };
  },

  // ---------- ROUTING: pick real audio for the active track, else synth fallback ----------
  start() {
    if (this.playing) return;
    this.playing = true;
    if (!Sound.ac) return;
    this.load('normal'); this.load('boss');                        // kick async preload (safe noop headless)
    this._route();
  },

  _route() {
    if (!this.playing) return;
    if (this.loaded[this.active] && Sound.ac) {                    // real stems ready -> play them
      if (SynthMusic.playing) SynthMusic.stop();
      this._startReal();
    } else {                                                       // not ready -> procedural synth
      this._stopReal();
      this._routeSynth();
    }
  },

  _routeSynth() {
    if (!SynthMusic.playing) SynthMusic.start();
    if (this.active === 'boss' && !SynthMusic.bossMode) SynthMusic.enterBoss();
    else if (this.active === 'normal' && SynthMusic.bossMode) SynthMusic.exitBoss();
  },

  // ---------- REAL-AUDIO GRAPH: stems -> stemGain -> trackBus -> filter -> master -> Sound.master ----------
  _initGraph() {
    const ac = Sound.ac;
    const master = ac.createGain(); master.gain.value = 0; master.connect(Sound.master);
    const filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 2.5; filter.connect(master);
    master.gain.setTargetAtTime(1, ac.currentTime, 0.25);          // fade the bus in
    this._g = { master, filter, tracks: {}, cur: null, ticker: null };
  },

  // Build & start one track's looping stems, phase-locked at a shared start time. loop=true on a
  // decoded buffer is gapless; loopStart/loopEnd default to the whole buffer (authored to exact bars).
  _buildTrack(track) {
    if (!this._g || this._g.tracks[track] || !this.buffers[track]) return;
    const ac = Sound.ac, m = this.MANIFEST[track], bufs = this.buffers[track];
    const bus = ac.createGain(); bus.gain.value = 0; bus.connect(this._g.filter);
    const t0 = ac.currentTime + 0.06, stems = {};
    // Exact musical loop length from the bar grid. Pin loopEnd to this (not buffer.duration) so
    // codec decode-padding — Vorbis decodes a few ms long — is cropped out → truly gapless.
    const loopEnd = m.bars * 4 * 60 / m.bpm;
    for (const s of m.stems) {
      const src = ac.createBufferSource(); src.buffer = bufs[s]; src.loop = true;
      if (src.buffer.duration >= loopEnd - 0.05) { src.loopStart = 0; src.loopEnd = loopEnd; }
      const g = ac.createGain(); g.gain.value = 0;                  // ticker ramps to MIX target
      src.connect(g); g.connect(bus); src.start(t0);
      stems[s] = { src, g };
    }
    this._g.tracks[track] = { bus, stems, t0 };
  },

  _crossTo(track) {                                                // crossfade trackBuses (both keep playing)
    const ac = Sound.ac;
    for (const k in this._g.tracks)
      this._g.tracks[k].bus.gain.setTargetAtTime(k === track ? 1 : 0, ac.currentTime, 0.5);
    this._g.cur = track;
  },

  _startReal() {
    if (!this._g) this._initGraph();
    for (const tk in this.loaded) if (this.loaded[tk]) this._buildTrack(tk);  // build all ready tracks
    this._buildTrack(this.active);
    this._crossTo(this.active);
    if (this.active === 'boss') this._bossIntro();
    if (!this._g.ticker) this._g.ticker = setInterval(() => this._tick(), 60);
    this._tick();
  },

  _tick() {                                                        // automate stem gains + filter by intensity
    if (!this._g || !this._g.cur) return;
    const ac = Sound.ac, { i, danger } = this._intensity();
    const tr = this._g.tracks[this._g.cur];
    for (const s in tr.stems) {
      const target = clamp((this.MIX[s] || (() => 1))(i, danger), 0, 1);
      tr.stems[s].g.gain.setTargetAtTime(target, ac.currentTime, 0.4);
    }
    const cut = danger ? 500 : (this.active === 'boss' ? 1400 : 600) + i * 2600;
    this._g.filter.frequency.setTargetAtTime(cut, ac.currentTime, 0.3);
  },

  _bossIntro() {                                                   // optional one-shot drop over the loop
    const b = this.buffers.boss && this.buffers.boss.__intro;
    if (!b || !this._g) return;
    const ac = Sound.ac, src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = b; g.gain.value = 1; src.connect(g); g.connect(this._g.filter); src.start(ac.currentTime + 0.04);
  },

  _stopReal() {
    if (!this._g) return;
    const ac = Sound.ac, g = this._g; this._g = null;
    if (g.ticker) clearInterval(g.ticker);
    try { g.master.gain.setTargetAtTime(0.0001, ac.currentTime, 0.08); } catch (e) {}
    setTimeout(() => { try {
      for (const k in g.tracks) for (const s in g.tracks[k].stems) g.tracks[k].stems[s].src.stop();
      g.master.disconnect();
    } catch (e) {} }, 160);
  },

  // ---------- BOSS TRANSITIONS (bar-quantized crossfade, or synth fallback) ----------
  enterBoss() {
    if (this.bossMode) return;
    this.bossMode = true; this.active = 'boss';
    this._route();                                                 // -> boss stems crossfade, or synth.enterBoss
  },

  exitBoss() {
    if (!this.bossMode) return;
    this.bossMode = false; this.active = 'normal';
    this._route();
  },

  // ---------- LIFECYCLE ----------
  stop() {                                                         // pause: keeps bossMode (resume continues fight)
    this.playing = false;
    this._stopReal();
    if (SynthMusic.playing) SynthMusic.stop();
  },

  die() {                                                          // player death: power-down whichever is playing
    this.playing = false; this.bossMode = false; this.active = 'normal';
    if (this._g) {
      const ac = Sound.ac, g = this._g; this._g = null;
      if (g.ticker) clearInterval(g.ticker);
      try {
        g.filter.frequency.setTargetAtTime(120, ac.currentTime, 0.2);   // close filter (turntable powerdown)
        g.master.gain.setTargetAtTime(0.0001, ac.currentTime, 0.25);
      } catch (e) {}
      setTimeout(() => { try {
        for (const k in g.tracks) for (const s in g.tracks[k].stems) g.tracks[k].stems[s].src.stop();
        g.master.disconnect();
      } catch (e) {} }, 900);
    }
    if (SynthMusic.playing) SynthMusic.die();                      // synth has its own death groan
  },

  reset() {                                                        // new run: clear boss state on real + synth
    this.bossMode = false; this.active = 'normal';
    SynthMusic.bossMode = false;
    if (SynthMusic._np) { SynthMusic.prog = SynthMusic._np; SynthMusic.bass = SynthMusic._nb; }
  },
};

/* ========== SAMPLE-KIT ENGINE (recorded one-shots, code-sequenced) ==========
   The DEFAULT real-audio engine. Loads a handful of short recorded one-shots (drums + a pitched
   guitar/bass/lead) and a step sequencer triggers + pitch-shifts them into a full song that reacts
   to game intensity. Inherently gapless (discrete retriggered hits — no loop seam). Tiny assets.

   Delegation chain: SampleKit -> RealMusic (stem loops) -> SynthMusic. If samples aren't loaded it
   hands off to RealMusic exactly like RealMusic hands off to SynthMusic — so every layer below stays
   untouched & previously verified. Pitch: playbackRate = 2^((note - sampleRoot)/12); roots are
   mid-range so shifts stay small. Layering reuses RealMusic.MIX (drums/rhythm bed, bass scales,
   lead mid-intensity, fx on danger) via per-layer gain buses + the same intensity computation. */
const SampleKit = {
  MANIFEST: {
    dir: 'audio/samples/',
    files: ['kick', 'snare', 'hat', 'openhat', 'chug', 'chord', 'bass', 'lead'],
    roots: { chug: 53, chord: 53, bass: 29, lead: 64 },   // sample pitch (MIDI) for playbackRate math
  },
  // Per-track tempo + progression (A-minor family; chord changes every 2 bars over an 8-bar cycle).
  TRACKS: {
    normal: { bpm: 125, fourFloor: false, prog: [57, 53, 55, 52], bass: [33, 29, 31, 28] },
    boss:   { bpm: 150, fourFloor: true,  prog: [52, 51, 53, 50], bass: [28, 27, 29, 26] },
  },
  LAYERS: ['drums', 'rhythm', 'bass', 'lead', 'fx'],

  buffers: {}, loaded: false, loading: null,
  playing: false, bossMode: false, active: 'normal',
  _g: null, step: 0, nextTime: 0,

  ready() { return this.loaded; },
  _intensity() { return RealMusic._intensity.call(this); },   // identical computation, keyed on this.active

  load() {
    if (this.loaded) return Promise.resolve(true);
    if (this.loading) return this.loading;
    if (typeof fetch !== 'function' || !Sound.ac || !Sound.ac.decodeAudioData) return Promise.resolve(false);
    const m = this.MANIFEST, ac = Sound.ac;
    this.loading = (async () => {
      try {
        const bufs = {};
        await Promise.all(m.files.map(async f => {
          const r = await fetch(m.dir + f + '.ogg'); if (!r.ok) throw new Error(f);
          bufs[f] = await ac.decodeAudioData(await r.arrayBuffer());
        }));
        this.buffers = bufs; this.loaded = true;
        if (this.playing) this._route();                    // upgrade fallback -> samples live
        return true;
      } catch (e) { this.loading = null; return false; }     // missing samples -> delegate to RealMusic
    })();
    return this.loading;
  },

  // ---- routing: samples if loaded, else delegate down to RealMusic (stems -> synth) ----
  start() {
    if (this.playing) return;
    this.playing = true;
    if (!Sound.ac) return;
    this.load();
    this._route();
  },
  _route() {
    if (!this.playing) return;
    if (this.loaded && Sound.ac) { if (RealMusic.playing) RealMusic.stop(); this._engage(); }
    else { this._disengage(); this._routeDown(); }
  },
  _routeDown() {                                             // drive RealMusic to match active track
    if (!RealMusic.playing) RealMusic.start();
    if (this.active === 'boss' && !RealMusic.bossMode) RealMusic.enterBoss();
    else if (this.active === 'normal' && RealMusic.bossMode) RealMusic.exitBoss();
  },

  // ---- real-audio graph: per-layer gain -> filter -> master -> Sound.master ----
  _initGraph() {
    const ac = Sound.ac;
    const master = ac.createGain(); master.gain.value = 0; master.connect(Sound.master);
    const filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 2.5; filter.connect(master);
    const layers = {};
    for (const L of this.LAYERS) { const g = ac.createGain(); g.gain.value = L === 'drums' ? 1 : 0; g.connect(filter); layers[L] = g; }
    master.gain.setTargetAtTime(0.9, ac.currentTime, 0.25);
    this._g = { master, filter, layers, ticker: null, seq: null };
  },
  _engage() {
    if (!this._g) this._initGraph();
    if (!this._g.seq) { this.step = 0; this.nextTime = Sound.ac.currentTime + 0.1; this._g.seq = setInterval(() => this.sched(), 25); }
    if (!this._g.ticker) this._g.ticker = setInterval(() => this._tick(), 60);
    this._tick();
  },
  _disengage(closeFilter) {
    if (!this._g) return;
    const ac = Sound.ac, g = this._g; this._g = null;
    if (g.seq) clearInterval(g.seq); if (g.ticker) clearInterval(g.ticker);
    try {
      if (closeFilter) g.filter.frequency.setTargetAtTime(120, ac.currentTime, 0.2);
      g.master.gain.setTargetAtTime(0.0001, ac.currentTime, closeFilter ? 0.25 : 0.1);
    } catch (e) {}
    setTimeout(() => { try { g.master.disconnect(); } catch (e) {} }, closeFilter ? 900 : 160);
  },

  // ---- trigger one pitched/uppitched sample into its layer bus ----
  play(file, t, note, vel, layer) {
    const ac = Sound.ac, b = this.buffers[file]; if (!b || !this._g) return;
    const src = ac.createBufferSource(); src.buffer = b;
    if (note != null) src.playbackRate.value = Math.pow(2, (note - (this.MANIFEST.roots[file] || 60)) / 12);
    const g = ac.createGain(); g.gain.value = vel;
    src.connect(g); g.connect(this._g.layers[layer]); src.start(t);
  },

  // ---- the composer: 8th-note grid, 8-bar loop, reads this.active for tempo/progression ----
  sched() {
    const ac = Sound.ac, T = this.TRACKS[this.active], stepDur = (60 / T.bpm) / 2;
    while (this.nextTime < ac.currentTime + 0.12) {
      const s = this.step, t = this.nextTime, idx = s % 8, bar = (s / 8) | 0;
      const ci = ((bar / 2) | 0) % T.prog.length, root = T.prog[ci], bn = T.bass[ci];
      // DRUMS
      if (T.fourFloor ? idx % 2 === 0 : (idx === 0 || idx === 4)) this.play('kick', t, null, 0.9, 'drums');
      if (idx === 2 || idx === 6) this.play('snare', t, null, 0.8, 'drums');
      this.play('hat', t, null, 0.30, 'drums');
      if (idx % 2 === 1) this.play('openhat', t, null, 0.22, 'drums');
      // RHYTHM — palm-mute chug every 8th, pitched to the chord root
      this.play('chug', t, root, 0.8, 'rhythm');
      // BASS — driving 8th notes
      this.play('bass', t, bn, 0.9, 'bass');
      // LEAD — sparse motif (rides in at higher intensity via the layer bus)
      const m = [0, null, 3, null, 7, null, 10, 7][idx];
      if (m != null) this.play('lead', t, root + 12 + m, 0.7, 'lead');
      // FX — sustained chord swell at each bar (danger layer)
      if (idx === 0) this.play('chord', t, root, 0.6, 'fx');
      this.step = (this.step + 1) % 64;     // 8 bars × 8 steps
      this.nextTime += stepDur;
    }
  },
  _tick() {
    if (!this._g) return;
    const ac = Sound.ac, { i, danger } = this._intensity();
    for (const L of this.LAYERS) {
      const target = clamp((RealMusic.MIX[L] || (() => 1))(i, danger), 0, 1);
      this._g.layers[L].gain.setTargetAtTime(target, ac.currentTime, 0.4);
    }
    const cut = danger ? 600 : (this.active === 'boss' ? 1500 : 700) + i * 2500;
    this._g.filter.frequency.setTargetAtTime(cut, ac.currentTime, 0.3);
  },
  _sting() {                                // boss entrance stab over the loop
    if (!this._g) return;
    const t = Sound.ac.currentTime + 0.03, root = this.TRACKS.boss.prog[0];
    this.play('chord', t, root, 1.0, 'rhythm'); this.play('chord', t, root - 12, 0.8, 'bass');
  },

  // ---- lifecycle (mirrors RealMusic; fallback target is RealMusic, not SynthMusic) ----
  enterBoss() {
    if (this.bossMode) return;
    this.bossMode = true; this.active = 'boss';
    this._route();
    if (this._g && this._g.seq) this._sting();
  },
  exitBoss() {
    if (!this.bossMode) return;
    this.bossMode = false; this.active = 'normal';
    this._route();
  },
  stop() {                                  // pause: keeps bossMode
    this.playing = false;
    this._disengage(false);
    if (RealMusic.playing) RealMusic.stop();
  },
  die() {
    this.playing = false; this.bossMode = false; this.active = 'normal';
    if (this._g) this._disengage(true);
    if (RealMusic.playing) RealMusic.die();
  },
  reset() {
    this.bossMode = false; this.active = 'normal';
    RealMusic.reset();
  },
};

/* ========== PUBLIC FACADE — the only audio object game code touches ==========
   Keeps main.js/world.js call sites unchanged. Default engine: SampleKit (recorded one-shots).
   Fallback chain handled internally: SampleKit -> RealMusic (stems) -> SynthMusic. */
const Music = {
  start()     { SampleKit.start(); },
  stop()      { SampleKit.stop(); },
  die()       { SampleKit.die(); },
  enterBoss() { SampleKit.enterBoss(); },
  exitBoss()  { SampleKit.exitBoss(); },
  reset()     { SampleKit.reset(); },
  get bossMode() { return SampleKit.bossMode; },
  set bossMode(v) { SampleKit.bossMode = v; if (!v) SampleKit.active = 'normal'; },
};
