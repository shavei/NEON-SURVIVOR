/* NEON SURVIVOR — core.js
 * Foundational globals, sprite cache, difficulty table, sound + music engines.
 * Classic script (shared global scope). Load order: core → world → sim → render → main. */

const cv=document.getElementById('game'),ctx=cv.getContext('2d');
let W,H,DPR;
let needsDraw=false;   // request a single static redraw (pause / level-up / resize)

const rand=(a,b)=>a+Math.random()*(b-a);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

/* ========== ALLOCATED MEMORY CACHES (Prevents Garbage Collection Stutters) ========== */
const EXCLUDE_SET = new Set();
const CHAIN_SET = new Set();

/* ========== SPRITE CACHE ========== */
const _spr={};
function hexA(h,a){if(h[0]!=='#')return h;let s=h.slice(1);if(s.length===3)s=s.replace(/./g,c=>c+c);
  const n=parseInt(s,16);return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';}
function dotSprite(color){const k='d'+color;if(_spr[k])return _spr[k];
  const S=32,c=document.createElement('canvas');c.width=c.height=S;const g=c.getContext('2d');
  const r=S/2,grd=g.createRadialGradient(r,r,0,r,r,r);
  grd.addColorStop(0,'#ffffff');grd.addColorStop(.28,color);grd.addColorStop(1,hexA(color,0));
  g.fillStyle=grd;g.beginPath();g.arc(r,r,r,0,7);g.fill();return _spr[k]=c;}
const EMETA={grunt:{r:12,col:'#7c8cff',sides:0,rot:0},fast:{r:9,col:'#ff9d2e',sides:3,rot:.05,ring:'#fff1c2'},tank:{r:22,col:'#ff5fa2',sides:6,rot:.01},boss:{r:46,col:'#ff3b6b',sides:8,rot:.006}};
function enemySprite(type,white){const k='e'+type+(white?'w':'');if(_spr[k])return _spr[k];
  const m=EMETA[type],pad=12,S=(m.r+pad)*2,c=document.createElement('canvas');c.width=c.height=S;
  const g=c.getContext('2d');g.translate(S/2,S/2);g.shadowBlur=14;g.shadowColor=m.col;g.fillStyle=white?'#fff':m.col;
  if(m.sides===0){g.beginPath();g.arc(0,0,m.r,0,7);g.fill();}
  else{g.beginPath();for(let i=0;i<m.sides;i++){const a=i/m.sides*6.283,x=Math.cos(a)*m.r,y=Math.sin(a)*m.r;i?g.lineTo(x,y):g.moveTo(x,y);}g.closePath();g.fill();
    if(m.ring&&!white){g.shadowBlur=0;g.lineWidth=2;g.strokeStyle=m.ring;g.stroke();}}   // contrasting outline so threats read apart from teal XP orbs
  return _spr[k]=c;}
// player hull baked once per rage-state (gradient + shadow are expensive; the hull is static)
function shipSprite(rage,r){const k='s'+(rage?1:0)+'_'+r;if(_spr[k])return _spr[k];
  const pad=22,S=(r+pad)*2;shipSprite._s=S;
  const c=document.createElement('canvas');c.width=c.height=S;const g=c.getContext('2d');
  g.translate(S/2,S/2);g.shadowBlur=18;g.shadowColor=rage?'#ffd95e':'#d97757';
  const grd=g.createLinearGradient(-r,0,r+4,0);
  grd.addColorStop(0,rage?'#6b3410':'#37223f');grd.addColorStop(1,rage?'#ffd95e':'#ff8a5e');
  g.fillStyle=grd;g.beginPath();
  g.moveTo(r+5,0);g.lineTo(-r+3,r-1);g.lineTo(-r+8,0);g.lineTo(-r+3,-(r-1));g.closePath();g.fill();
  g.strokeStyle=rage?'#fff7d6':'#ffd9c2';g.lineWidth=1.5;g.stroke();
  return _spr[k]=c;}

/* ========== DIFFICULTY ========== */
const DIFFS={
  easy:  {key:'easy', label:'Easy',   spawn:1.4,  hp:.78, dmg:.65, col:'#54e6b5'},
  normal:{key:'normal',label:'Normal', spawn:1.0,  hp:1.0,  dmg:1.0,  col:'#ffd95e'},
  hard:  {key:'hard', label:'Hard',   spawn:.68, hp:1.8,  dmg:2.0,  col:'#ff5fa2'},
};
let DIFF=DIFFS.normal;
// Boss tunables — one place to balance the WARDEN (HP/dmg/speed, attack cadence+telegraph, hitbox/i-frames).
const BOSS={hpBase:500,hpTier:300,hpRamp:0.004,contactDmg:22,projDmg:0.45,speedBase:.45,speedTier:.02,
  cdBase:120,cdFloor:75,teleT:45,hitRMul:.85,invProj:30,invContact:12,
  // attack cycle (atk 0=burst, 1=dash, 2=slam): dash lunge + AOE shockwave ring tunables
  dashSpd:6.4,dashT:24,slamN:24,slamR:200,slamSpd:2.4,
  // spawn throttle while a Warden is alive: longer interval + smaller batches (focus the fight)
  spawnMul:2.2,spawnCountMul:0.5};

/* ========== SOUND ENGINE (Web Audio) ========== */
const Sound={
  ac:null,master:null,muted:false,
  init(){if(this.ac)return;const A=window.AudioContext||window.webkitAudioContext;if(!A)return;
    this.ac=new A();this.master=this.ac.createGain();this.master.gain.value=this.muted?0:.85;this.master.connect(this.ac.destination);},
  resume(){if(this.ac&&this.ac.state==='suspended')this.ac.resume();},
  toggle(){this.muted=!this.muted;if(this.master)this.master.gain.value=this.muted?0:.85;
    document.getElementById('sound').textContent=this.muted?'🔇 muted':'🔊 sound';},
  tone(f1,f2,dur,type,vol){if(!this.ac||this.muted)return;const ac=this.ac,o=ac.createOscillator(),g=ac.createGain();
    o.type=type||'square';o.frequency.setValueAtTime(f1,ac.currentTime);
    if(f2)o.frequency.exponentialRampToValueAtTime(Math.max(1,f2),ac.currentTime+dur);
    g.gain.setValueAtTime(vol,ac.currentTime);g.gain.exponentialRampToValueAtTime(.0008,ac.currentTime+dur);
    o.connect(g);g.connect(this.master);o.start();o.stop(ac.currentTime+dur+.02);},
  noise(dur,vol,cutoff){if(!this.ac||this.muted)return;const ac=this.ac,n=Math.floor(ac.sampleRate*dur);
    const buf=ac.createBuffer(1,n,ac.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*(1-i/n);
    const s=ac.createBufferSource();s.buffer=buf;const f=ac.createBiquadFilter();f.type='lowpass';f.frequency.value=cutoff||1400;
    const g=ac.createGain();g.gain.setValueAtTime(vol,ac.currentTime);g.gain.exponentialRampToValueAtTime(.0008,ac.currentTime+dur);
    s.connect(f);f.connect(g);g.connect(this.master);s.start();},
  shoot(){this.tone(540,300,.07,'triangle',.04);},
  death(){this.tone(220,70,.18,'square',.09);this.noise(.12,.06,900);},
  boom(){this.noise(.3,.18,700);this.tone(120,40,.3,'sawtooth',.08);},
  pickup(){this.tone(620,940,.08,'sine',.05);},
  hurt(){this.tone(150,60,.22,'sawtooth',.13);},
  zap(){this.tone(1100,1500,.05,'square',.06);this.noise(.06,.04,3000);},
  ping(){this.tone(1300,1700,.05,'sine',.04);},
  level(){[0,1,2].forEach((k,i)=>setTimeout(()=>this.tone([523,659,880][i],0,.16,'triangle',.07),i*70));},
};
let lastShootSnd=0,lastPingSnd=0;

/* ========== SYNTHWAVE MUSIC ENGINE (procedural fallback) ==========
   Renamed Music -> SynthMusic. js/audio-engine.js now owns the public `Music` facade and
   delegates here whenever real instrument stems aren't loaded (asset-less, file://, or decode
   failure). Game code calls Music.*; this object is the fallback the facade falls back TO. */
const SynthMusic = {
  playing: false, timer: null, gain: null, filter: null, drive: null, nextTime: 0, step: 0,
  bossMode: false, _np: null, _nb: null,
  // Cyberpunk progression (i - VI - VII - v)
  prog: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]],
  bass: [33, 29, 31, 28],
  // Darker, lower-register menace progression swapped in during boss fights
  bossProg: [[52, 55, 59, 62], [51, 54, 58, 61], [53, 56, 60, 63], [50, 53, 57, 60]],
  bossBass: [28, 27, 29, 26],

  // Track = data, not branches. sched() reads the active track's tempo/mix/layer flags so adding a
  // new track (e.g. a final-boss variant) is a table entry, not another if(boss) in the hot loop.
  // normal = synthwave drive; boss = faster heavy/trance: four-on-the-floor, distorted power chords, driving lead.
  TRACKS: {
    normal: { spb: 0.12, baseGain: 0.32, gainScale: 0.18, cutBase: 550,  cutScale: 2650, q: 2.5, fourFloor: false, heavy: false },
    boss:   { spb: 0.10, baseGain: 0.42, gainScale: 0.18, cutBase: 1400, cutScale: 3200, q: 6.0, fourFloor: true,  heavy: true  },
  },

  mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); },
  // tanh soft-clip curve → overdriven "guitar" saws on the boss distortion bus
  makeDriveCurve(amount) { const n = 256, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * amount); } return c; },

  start() {
    if (!Sound.ac || this.playing) return;
    this.playing = true;
    const ac = Sound.ac;

    // Master Music Gain
    this.gain = ac.createGain();
    this.gain.gain.value = 0;

    // Lowpass Filter for Dynamic Intensity Sweeps
    this.filter = ac.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2.5; // Slight resonance for synth growl

    // Distortion bus for heavy boss power chords/lead: WaveShaper -> Filter (so it still sweeps with intensity)
    this.drive = ac.createWaveShaper();
    this.drive.curve = this.makeDriveCurve(4);
    this.drive.oversample = '2x';
    this.drive.connect(this.filter);

    // Connect Chain: Synths -> Filter -> Gain -> Game Master Output
    this.filter.connect(this.gain);
    this.gain.connect(Sound.master);

    this.nextTime = ac.currentTime + .1;
    this.step = 0;
    this.timer = setInterval(() => this.sched(), 25);
  },

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.playing = false;
    try { if (this.gain) this.gain.disconnect(); if (this.filter) this.filter.disconnect(); if (this.drive) this.drive.disconnect(); } catch (e) {}
    this.gain = null; this.filter = null; this.drive = null;
  },

  // Boss fight start: swap to the menace progression + a brass-ish "fight start" sting.
  // bossMode survives stop()/start() (pause/resume), so it's only cleared by exitBoss().
  enterBoss() {
    if (this.bossMode) return;
    this.bossMode = true;
    this._np = this.prog; this._nb = this.bass;
    this.prog = this.bossProg; this.bass = this.bossBass;
    const ac = Sound.ac;
    if (ac && this.gain && !Sound.muted) {
      const t = ac.currentTime;
      this.voice(this.mtof(40), t, 1.2, 'sawtooth', 0.12, 0.01);
      this.voice(this.mtof(47), t, 1.2, 'sawtooth', 0.09, 0.01);
      this.voice(this.mtof(52), t, 1.1, 'square', 0.06, 0.02);
      // 1-bar riser into the drop — sweeping saw that lands on the fight
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(this.mtof(28), t);
      o.frequency.exponentialRampToValueAtTime(this.mtof(52), t + 0.8);
      g.gain.setValueAtTime(0.0008, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + 0.8);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.0);
      o.connect(g); g.connect(this.drive || this.filter);
      o.start(t); o.stop(t + 1.05);
    }
  },

  // Boss defeated: restore the normal progression (filter/level crossfade back via setTargetAtTime) + a victory stab.
  exitBoss() {
    if (!this.bossMode) return;
    this.bossMode = false;
    if (this._np) { this.prog = this._np; this.bass = this._nb; }
    const ac = Sound.ac;
    if (ac && this.gain && !Sound.muted) {
      const t = ac.currentTime;
      // triumphant resolve: ascending stab + a full root/fifth/octave chord ring-out
      [57, 64, 69].forEach((m, i) => this.voice(this.mtof(m), t + i * 0.05, 0.5, 'triangle', 0.08, 0.01));
      [57, 64, 69].forEach(m => this.voice(this.mtof(m), t + 0.18, 0.9, 'sawtooth', 0.04, 0.02));
      this.voice(this.mtof(81), t + 0.18, 1.1, 'sine', 0.03, 0.04);   // shimmer bell on top
    }
  },

  // Player death: turntable power-down — pitch-bend the mix down, close the filter, then stop.
  // Replaces the old abrupt Music.stop() in gameOver() so death feels deliberate.
  die() {
    const ac = Sound.ac;
    if (!ac || !this.gain || Sound.muted) { this.stop(); return; }
    const t = ac.currentTime;
    // stop the scheduler immediately so its setTargetAtTime ramps don't fight the power-down
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.playing = false;
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, t);
    this.filter.frequency.exponentialRampToValueAtTime(120, t + 0.7);
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.8);
    const o = ac.createOscillator(), g = ac.createGain();   // descending death groan
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(this.mtof(45), t);
    o.frequency.exponentialRampToValueAtTime(this.mtof(21), t + 0.7);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.8);
    o.connect(g); g.connect(Sound.master); o.start(t); o.stop(t + 0.85);
    // tear down nodes after the bend finishes — but skip if a new run already called start() (playing===true)
    setTimeout(() => { if (!this.playing) this.stop(); }, 850);
  },

  // Optimized Voice Architecture with custom envelope parameters
  voice(freq, t, dur, type, vol, attack = 0.006, decay = 0.001, dest) {
    const ac = Sound.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);

    o.connect(g);
    g.connect(dest || this.filter); // default: active visual filter; boss layers pass the distortion bus
    o.start(t);
    o.stop(t + dur + decay + 0.05);
  },

  // Synthesis of Synthwave Drums using basic White Noise
  snare(t, vol) {
    const ac = Sound.ac;
    const bufferSize = ac.sampleRate * 0.12, buffer = ac.createBuffer(1, bufferSize, ac.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ac.createBufferSource(); noise.buffer = buffer;
    const filter = ac.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 1100;
    const gain = ac.createGain();

    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    noise.connect(filter); filter.connect(gain); gain.connect(this.gain);
    noise.start(t); noise.stop(t + 0.14);
  },

  kick(t, vol) {
    const ac = Sound.ac, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09); // Punchy pitch drop

    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    o.connect(g); g.connect(this.gain); // Bypass main lowpass filter so bass stays clean
    o.start(t); o.stop(t + 0.11);
  },

  // deep sine sub-bass (weight under the saw bass)
  sub(t, freq, dur, vol) {
    const ac = Sound.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this.gain);
    o.start(t); o.stop(t + dur + 0.05);
  },

  // open hi-hat (longer filtered noise)
  openhat(t, vol) {
    const ac = Sound.ac, n = Math.floor(ac.sampleRate * 0.18), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource(); src.buffer = b;
    const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(f); f.connect(g); g.connect(this.gain);
    src.start(t); src.stop(t + 0.2);
  },

  // pitched tom (for fills)
  tom(t, freq, vol) {
    const ac = Sound.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.18);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(this.gain);
    o.start(t); o.stop(t + 0.22);
  },

  sched() {
    const ac = Sound.ac;
    const en = (typeof enemies !== 'undefined' && enemies) ? enemies.length : 0;
    const boss = this.bossMode;
    const T = boss ? this.TRACKS.boss : this.TRACKS.normal;   // active track drives tempo/mix/layers
    let intensity = clamp(en / 25, 0, 1);
    if (boss) intensity = Math.max(intensity, 0.85);   // boss fights run hot regardless of swarm size
    const lowhp = (player && state !== 'start') ? clamp(1 - player.hp / player.maxhp, 0, 1) : 0;
    const danger = lowhp > .7;

    // Tempo grid: normal ~125 BPM head-bob, boss ~150 BPM hype drive
    const spb = T.spb;

    // Dynamically adjust master track level and master synth cutoff filter
    this.gain.gain.setTargetAtTime(T.baseGain + intensity * T.gainScale, ac.currentTime, 0.4);
    // As swarms increase, the synth filter opens up from muffled to razor-sharp; boss track starts brighter + more aggressive
    const targetCutoff = danger ? 400 + Math.sin(ac.currentTime * 6) * 100 : T.cutBase + intensity * T.cutScale;
    this.filter.frequency.setTargetAtTime(targetCutoff, ac.currentTime, 0.3);
    this.filter.Q.setTargetAtTime(T.q, ac.currentTime, 0.3);   // boss track growls harder (higher resonance)

    while (this.nextTime < ac.currentTime + 0.12) {
      const s = this.step, t = this.nextTime;
      const chord = s >> 3;           // Changes every 8 steps
      const patternIdx = s % 8;       // Current step in the bar loop
      const set = this.prog[chord];

      // --- 1. DRUM KIT ---
      if (patternIdx === 0 || patternIdx === 4) this.kick(t, 0.34);
      if (T.fourFloor) {                                       // four-on-the-floor + 8th-note double-kick (trance/metal drive)
        if (patternIdx === 2 || patternIdx === 6) this.kick(t, 0.30);
        this.kick(t + spb * 0.5, 0.15);
      }
      if (patternIdx === 4) this.snare(t, 0.18);
      if (patternIdx % 2 === 1) this.voice(8000, t, 0.02, 'triangle', 0.014, 0.001);   // closed hat
      if (patternIdx === 2 || patternIdx === 6) this.openhat(t, 0.05);                  // open hat
      if (chord === 3 && patternIdx >= 5) this.tom(t, this.mtof(52 - (patternIdx - 5) * 3), 0.13); // tom fill

      // --- 2. SUB + FAT DETUNED BASS ---
      this.sub(t, this.mtof(this.bass[chord] - 12), (patternIdx % 2 === 0) ? 0.22 : 0.12, 0.13);
      const baseBass = this.mtof(this.bass[chord]);
      if (patternIdx % 2 === 0 || intensity > 0.4) {
        const bassFreq = (patternIdx === 3 || patternIdx === 7) ? baseBass * 1.5 : baseBass;
        this.voice(bassFreq, t, 0.09, 'sawtooth', 0.10, 0.005);
        this.voice(bassFreq * 1.007, t, 0.09, 'sawtooth', 0.05, 0.005); // detune fatten
      }

      // --- 3. WARM PAD (sustained chord bed, swells in on each chord change) ---
      if (patternIdx === 0) {
        const padDur = spb * 8;
        for (let n = 0; n < set.length; n++) this.voice(this.mtof(set[n]), t, padDur, 'triangle', 0.017, 0.09);
      }

      // --- 4. ARPEGGIATOR (+ slap-delay echo) ---
      const noteMap = [0, 2, 1, 3, 0, 2, 3, 1];
      const targetNote = set[noteMap[patternIdx]] + 12;
      if (patternIdx % 2 === 0 || intensity > 0.5) {
        const synthVol = 0.04 + intensity * 0.02;
        this.voice(this.mtof(targetNote), t, 0.14, 'triangle', synthVol, 0.008);
        this.voice(this.mtof(targetNote), t + spb * 0.75, 0.10, 'triangle', synthVol * 0.4, 0.01);
      }

      // --- 5. FAT DETUNED SAW LEAD ---
      const leadMap = [0, -1, 2, -1, 3, -1, 4, 2];
      const ld = leadMap[patternIdx];
      if (ld >= 0 && (intensity > 0.25 || chord % 2 === 0)) {
        const lf = this.mtof(set[ld % 4] + 24);
        this.voice(lf, t, spb * 1.6, 'sawtooth', 0.026 + intensity * 0.02, 0.012);
        this.voice(lf * 1.006, t, spb * 1.6, 'sawtooth', 0.016, 0.012);
      }

      // --- 6. SHIMMER BELLS ---
      if (patternIdx === 2 || patternIdx === 6) this.voice(this.mtof(set[0] + 36), t, 0.32, 'sine', 0.012, 0.006);

      // --- 7. CHORD STABS (when the swarm is thick) ---
      if (patternIdx === 0 && intensity > 0.25) {
        for (let n = 0; n < set.length; n++) this.voice(this.mtof(set[n] + 12), t, 0.13, 'square', 0.013, 0.004);
      }

      // --- 8. CLIMAX + DANGER LAYERS ---
      if (intensity > 0.6 && s % 4 === 2) this.voice(this.mtof(set[s % 4] + 24), t, 0.06, 'square', 0.018 * intensity, 0.004);
      if (danger && s % 8 === 0) this.voice(this.mtof(this.bass[chord] - 12), t, 0.45, 'sawtooth', 0.09, 0.02);

      // --- 9. BOSS HEAVY LAYERS — drone + distorted power chords + driving lead (routed through the drive bus) ---
      if (T.heavy) {
        if (patternIdx === 0) this.sub(t, this.mtof(this.bass[chord] - 12), spb * 8, 0.11);          // low ominous drone bed
        if (patternIdx === 0 || patternIdx === 4) {                                                  // overdriven root+fifth+octave power chord
          const root = this.mtof(set[0] + 12), fifth = this.mtof(set[0] + 19);
          this.voice(root,    t, spb * 3, 'sawtooth', 0.05,  0.004, 0.001, this.drive);
          this.voice(fifth,   t, spb * 3, 'sawtooth', 0.04,  0.004, 0.001, this.drive);
          this.voice(root * 0.5, t, spb * 3, 'sawtooth', 0.045, 0.004, 0.001, this.drive);           // octave-down chug
        }
        if (patternIdx % 2 === 0) { const lf = this.mtof(set[0] + 24);                               // driving detuned lead
          this.voice(lf,         t, spb * 1.4, 'sawtooth', 0.03, 0.01, 0.001, this.drive);
          this.voice(lf * 1.008, t, spb * 1.4, 'sawtooth', 0.02, 0.01, 0.001, this.drive); }
      }

      this.step = (this.step + 1) % 32;
      this.nextTime += spb;
    }
  }
};

;
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

;
/* NEON SURVIVOR — world.js
 * World state, nebula/starfield, spawning, combat, pickups, weapons, leveling.
 * Classic script (shared global scope). Load order: core → world → sim → render → main. */

/* ========== STATE ENGINE ========== */
let state='start';
let player,enemies,bullets,orbs,particles,floats,missiles,bolts,items,ebullets;
let nextBoss=60,bossOn=false,_test=false;   // _test: Test Mode (one-hit bosses, manual spawn — key B)
let t0,now,score,wave,spawnTimer,itemTimer,shake,frame,kills,pauseStart=0,pendingLevels=0;
let best=+(localStorage.getItem('neon_best')||0);
/* ----- FIXED-TIMESTEP SIM CLOCK -----
 * The sim advances in discrete 1/60 s ticks regardless of display refresh, so the game plays
 * identically on 60 / 144 / 240 Hz monitors (was frame-locked → ran 2.4× fast on 144 Hz).
 * loop() accumulates real elapsed time and runs update() 0..MAXSUBSTEP times; draw() renders once,
 * lerping every moving body by `alpha` (the fractional tick) for smooth motion on high-refresh panels. */
const STEP=1000/60;          // one logical tick = 16.667 ms
const MAXSUBSTEP=5;          // cap catch-up ticks/frame → no spiral-of-death after a tab stall
let acc=0,lastTs=0,alpha=0,slowmo=0;   // slowmo: ms of dramatic slow-motion (boss death)
const lerp=(a,b,t)=>a+(b-a)*t;
const WORLD={w:3200,h:3200};
const cam={x:0,y:0,px:0,py:0};

/* ========== HIGH-FIDELITY COSMIC NEBULA GENERATOR ========== */
let NEBULA_CANVAS = null;

function generateNebula() {
  const S = 1024; // Resolution of our repeating deep-space texture tile
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');

  // Fill space background depth gradient
  const bgGrad = ctx.createRadialGradient(S/2, S/2, 10, S/2, S/2, S/2 * 1.4);
  bgGrad.addColorStop(0, '#070910');
  bgGrad.addColorStop(0.6, '#05060d');
  bgGrad.addColorStop(1, '#020204');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, S, S);

  // subtle nebula gas clouds — faint colored glows, not heavy blobs
  function drawCloud(x, y, radius, rgb, a) {
    const cg = ctx.createRadialGradient(x, y, 0, x, y, radius);
    cg.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
    cg.addColorStop(0.35, 'rgba(' + rgb + ',' + (a * 0.3) + ')');
    cg.addColorStop(0.7, 'rgba(' + rgb + ',' + (a * 0.05) + ')');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.globalCompositeOperation = 'screen';
    ctx.beginPath(); ctx.arc(x, y, radius, 0, 7); ctx.fill();
  }
  for (let i = 0; i < 7; i++) {
    drawCloud(rand(0, S), rand(0, S), rand(130, 240), '255,95,162', 0.045);
    drawCloud(rand(0, S), rand(0, S), rand(120, 210), '84,230,181', 0.04);
    drawCloud(rand(0, S), rand(0, S), rand(150, 280), '124,140,255', 0.05);
  }

  // ambient star cluster
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 520; i++) {
    const x = rand(0, S), y = rand(0, S), r = rand(0.4, 1.3);
    ctx.fillStyle = ['#fff', '#7c8cff', '#ffd95e'][Math.floor(rand(0, 3))];
    ctx.globalAlpha = rand(0.08, 0.55);
    ctx.fillRect(x, y, r, r);
  }

  // a few soft lens flares
  for (let i = 0; i < 5; i++) {
    const x = rand(0, S), y = rand(0, S);
    ctx.shadowBlur = rand(8, 18);
    ctx.shadowColor = '#fff';
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = rand(0.35, 0.6);
    ctx.beginPath(); ctx.arc(x, y, rand(1.2, 2.4), 0, 7); ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1.0;

  NEBULA_CANVAS = c; // Cache the generated background texture texture map
}

/* ========== COSMIC SPACE BACKGROUND GENERATOR ========== */
const STAR_FIELD = [];
function initStars() {
  STAR_FIELD.length = 0;
  // Generate 250 structural stars across the 3200x3200 cosmic map area
  for (let i = 0; i < 250; i++) {
    STAR_FIELD.push({
      x: rand(0, 3200),
      y: rand(0, 3200),
      r: rand(0.6, 2.2), // Size dictates depth perception
      alpha: rand(0.2, 0.85),
      col: ['#ffffff', '#7c8cff', '#ffd95e', '#ff5fa2'][Math.floor(rand(0, 4))]
    });
  }
}

/* HIGHLY OPTIMIZED: Uses squared distance checks to skip costly Math.hypot (Square Roots) */
function nearestTo(pt,exclude){
  let n=null,ndSq=1e12;
  const len=enemies.length;
  for(let i=0;i<len;i++){
    const e=enemies[i];
    if(exclude&&exclude.has(e))continue;
    const dx=pt.x-e.x,dy=pt.y-e.y;
    const dSq=dx*dx+dy*dy;
    if(dSq<ndSq){ndSq=dSq;n=e;}
  }
  return n;
}

function reset(){
  initStars(); // <--- Builds the space starfield

  player={x:WORLD.w/2,y:WORLD.h/2,vx:0,vy:0,r:14,angle:0,hp:100,maxhp:100,speed:4.1,accel:.16,
    rate:34,cool:0,dmg:10,multi:1,pierce:0,bulletSpd:7.5,magnet:90,magnetSq:8100,
    xp:0,level:1,next:8,regen:0,regenAcc:0,inv:0,lifesteal:0,lsCd:0,near:null,rageT:0,
    missile:0,missileCool:0,shield:0,shieldAng:0,chain:0,chainCool:0,px:WORLD.w/2,py:WORLD.h/2};
  acc=0;lastTs=0;alpha=0;slowmo=0;   // reset the sim clock for a clean run

  enemies=[];bullets=[];orbs=[];particles=[];floats=[];missiles=[];bolts=[];items=[];ebullets=[];
  for(const k in Up)delete Up[k];           // clear upgrade tracker so PLAY AGAIN starts fresh
  score=0;wave=1;spawnTimer=0;itemTimer=900;shake=0;frame=0;kills=0;pendingLevels=0;t0=performance.now();
  nextBoss=60;bossOn=false;
  Music.reset();   // clear boss track (real + synth) if last run died mid-fight

  cam.x=clamp(player.x-W/2,0,Math.max(0,WORLD.w-W));
  cam.y=clamp(player.y-H/2,0,Math.max(0,WORLD.h-H));
  cam.px=cam.x;cam.py=cam.y;

  renderLoadout();
}

/* ========== SPAWNING ========== */
function spawnEnemy(){
  const elapsed=(now-t0)/1000;wave=1+Math.floor(elapsed/24);
  const ang=rand(0,6.283),d=Math.max(W,H)*.62+rand(0,160);
  const x=clamp(player.x+Math.cos(ang)*d,24,WORLD.w-24),y=clamp(player.y+Math.sin(ang)*d,24,WORLD.h-24);
  const roll=Math.random();let type='grunt';
  if(elapsed>42&&roll<.12)type='tank';else if(elapsed>24&&roll<.30)type='fast';
  const base={
    grunt:{r:12,hp:20,spd:1.15,col:'#7c8cff',dmg:8,xp:1,sc:5},
    fast:{r:9,hp:12,spd:2.25,col:'#ff9d2e',dmg:6,xp:1,sc:7},
    tank:{r:22,hp:90,spd:.7,col:'#ff5fa2',dmg:18,xp:4,sc:20},
  }[type];
  const late=Math.max(0,elapsed-180);            // super-linear pressure past 3 min
  const hpScale=(1+elapsed/75+late*late*0.00012)*DIFF.hp;
  const dmg=base.dmg*(1+elapsed/130+late*late*0.00006)*DIFF.dmg;
  enemies.push({x,y,r:base.r,hp:base.hp*hpScale,maxhp:base.hp*hpScale,
    spd:base.spd*(1+elapsed/300),col:base.col,dmg,xp:base.xp,sc:base.sc,hit:0,scd:0,cdmg:0,dead:false,type});
}
function spawnBoss(){
  const elapsed=(now-t0)/1000,tier=Math.max(1,Math.round(elapsed/60));
  const ang=rand(0,6.283),d=Math.max(W,H)*.62;
  const x=clamp(player.x+Math.cos(ang)*d,60,WORLD.w-60),y=clamp(player.y+Math.sin(ang)*d,60,WORLD.h-60);
  let hp=(BOSS.hpBase+tier*BOSS.hpTier)*DIFF.hp*(1+Math.max(0,elapsed-180)*BOSS.hpRamp);
  if(_test)hp=1;                                    // Test Mode: one-hit boss to study patterns fast
  enemies.push({x,y,r:46,hp,maxhp:hp,spd:BOSS.speedBase+tier*BOSS.speedTier,col:'#ff3b6b',
    dmg:BOSS.contactDmg*DIFF.dmg,xp:35,sc:400+tier*100,hit:0,scd:0,cdmg:0,dead:false,
    type:'boss',boss:true,bossT:BOSS.cdBase,tele:0,atk:0,dashT:0,dvx:0,dvy:0,name:'WARDEN '+tier});
  bossOn=true;showToast('💀','BOSS — WARDEN '+tier,'#ff3b6b');
  Sound.boom();shake=Math.min(shake+10,16);Music.enterBoss();
}
// cooldown till the next telegraph, tightening with tier
function bossCD(){return Math.max(BOSS.cdFloor,BOSS.cdBase-Math.floor((now-t0)/1000/60)*8);}
// fired when the telegraph (e.tele) expires — dispatch by e.atk. burst/slam are instant (reset cadence here);
// dash spans ticks → its cadence reset + atk-advance happen when the dash ends (sim.js movement loop).
function bossAttack(e){
  const tier=Math.max(1,Math.round((now-t0)/1000/60));
  if(e.atk===0){                                   // 0) CIRCULAR BURST — aimed radial ring
    const n=10+Math.min(10,tier*2),base=Math.atan2(player.y-e.y,player.x-e.x);
    for(let k=0;k<n;k++){const a=base+k/n*6.283;
      ebullets.push({x:e.x,y:e.y,vx:Math.cos(a)*3.3,vy:Math.sin(a)*3.3,r:7,dmg:e.dmg*BOSS.projDmg,life:220});}
    Sound.zap();e.bossT=bossCD();e.atk=1;
  }else if(e.atk===1){                             // 1) TARGETED DASH — lunge along a locked vector
    const a=Math.atan2(player.y-e.y,player.x-e.x);
    e.dvx=Math.cos(a)*BOSS.dashSpd;e.dvy=Math.sin(a)*BOSS.dashSpd;e.dashT=BOSS.dashT;
    Sound.boom();shake=Math.min(shake+7,16);       // cadence/atk advance on dash-end
  }else{                                            // 2) AOE GROUND SLAM — outward shockwave ring to outrun
    const n=BOSS.slamN;for(let k=0;k<n;k++){const a=k/n*6.283;
      ebullets.push({x:e.x,y:e.y,vx:Math.cos(a)*BOSS.slamSpd,vy:Math.sin(a)*BOSS.slamSpd,r:9,dmg:e.dmg*BOSS.projDmg,life:200});}
    Sound.boom();shake=Math.min(shake+13,20);e.bossT=bossCD();e.atk=0;
  }
}

/* ========== COMBAT ========== */
function fire(){
  const near=player.near;if(!near)return;
  const baseAng=Math.atan2(near.y-player.y,near.x-player.x);
  const n=player.multi,spread=.16,dmg=player.rageT>0?player.dmg*1.6:player.dmg;
  for(let i=0;i<n;i++){const a=baseAng+(i-(n-1)/2)*spread;
    bullets.push({x:player.x,y:player.y,vx:Math.cos(a)*player.bulletSpd,vy:Math.sin(a)*player.bulletSpd,r:4,dmg,pierce:player.pierce,life:70});}
  shake=Math.min(shake+1.2,7);
  if(now-lastShootSnd>60){Sound.shoot();lastShootSnd=now;}
}
function burst(x,y,col,n,sp){n=Math.min(n,340-particles.length);if(n<=0)return;
  for(let i=0;i<n;i++){const a=rand(0,7),s=rand(.5,sp);
  particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:rand(1,3.4),life:rand(20,40),col});}}
function floatText(x,y,txt,col){floats.push({x,y,txt,col,life:50,vy:-.7});}

function damageEnemy(e,dmg,col){e.hp-=dmg;e.hit=6;if(e.hp<=0)killEnemy(e,col);}
function killEnemy(e,col){
  const i=enemies.indexOf(e);if(i<0)return;e.dead=true;enemies.splice(i,1);
  score+=e.sc;kills++;
  if(e.boss){
    bossOn=false;nextBoss=(now-t0)/1000+50;Music.exitBoss();   // next boss 50s after this one falls; music back to normal track
    burst(e.x,e.y,'#ff3b6b',60,9);burst(e.x,e.y,'#ffd95e',40,7);
    shake=Math.min(shake+18,24);Sound.boom();flashHit();slowmo=Math.max(slowmo,340);   // dramatic slow-mo on the kill
    floatText(e.x,e.y-30,'BOSS DOWN  +'+e.sc,'#ffd95e');
    for(let k=0;k<e.xp;k++)orbs.push({x:e.x+rand(-40,40),y:e.y+rand(-40,40),r:4,xp:1,col:'#54e6b5'});
    const it=ITEMS[Math.floor(rand(0,ITEMS.length))];     // guaranteed reward drop
    items.push({x:e.x,y:e.y,type:it.id,ico:it.ico,col:it.col,label:it.label,r:16,life:900,bob:rand(0,7)});
    showToast(it.ico,it.label+' (boss drop)',it.col);
    return;
  }
  burst(e.x,e.y,e.col,e.type==='tank'?22:10,e.type==='tank'?5:4);
  floatText(e.x,e.y,'+'+e.sc,e.col);shake=Math.min(shake+(e.type==='tank'?6:1.5),10);Sound.death();
  if(player.lifesteal>0&&player.lsCd<=0&&player.hp<player.maxhp){
    player.hp=Math.min(player.maxhp,player.hp+player.lifesteal);player.lsCd=6;}   // capped to ~10 HP/s
  for(let k=0;k<e.xp;k++)orbs.push({x:e.x+rand(-8,8),y:e.y+rand(-8,8),r:4,xp:1,col:'#54e6b5'});
}

/* ========== PICKUPS ========== */
const ITEMS=[
  {id:'heal',ico:'❤️',col:'#ff5fa2',label:'+25 HP'},
  {id:'bomb',ico:'💣',col:'#ffd95e',label:'NUKE'},
  {id:'magnet',ico:'🧲',col:'#54e6b5',label:'XP RUSH'},
  {id:'rage',ico:'🔥',col:'#d97757',label:'OVERDRIVE'},
];
function spawnItem(){const t=ITEMS[Math.floor(rand(0,ITEMS.length))];
  const ang=rand(0,6.283),d=rand(Math.min(W,H)*.35,Math.min(W,H)*.35+520);
  const x=clamp(player.x+Math.cos(ang)*d,90,WORLD.w-90),y=clamp(player.y+Math.sin(ang)*d,90,WORLD.h-90);
  items.push({x,y,type:t.id,ico:t.ico,col:t.col,label:t.label,r:16,life:900,bob:rand(0,7)});
  showToast(t.ico,t.label,t.col);}
function showToast(ico,label,col){const el=document.getElementById('toast');
  el.style.setProperty('--tc',col);el.style.color=col;
  el.innerHTML=`<span class="tico">${ico}</span><span>${label}<br><small>appeared on the map</small></span>`;
  el.classList.add('show');clearTimeout(showToast._t);showToast._t=setTimeout(()=>el.classList.remove('show'),2600);}
function pickItem(it){const p=player;burst(it.x,it.y,it.col,16,4);
  if(it.type==='heal'){p.hp=Math.min(p.maxhp,p.hp+25);floatText(p.x,p.y-22,'+25 HP','#ff5fa2');Sound.tone(440,900,.25,'sine',.09);}
  else if(it.type==='bomb'){for(let i=enemies.length-1;i>=0;i--)damageEnemy(enemies[i],150,'#ffd95e');
    shake=Math.min(shake+18,22);Sound.boom();burst(p.x,p.y,'#ffd95e',46,9);flashHit();floatText(p.x,p.y-22,'NUKE!','#ffd95e');}
  else if(it.type==='magnet'){for(let i=orbs.length-1;i>=0;i--)gainXP(orbs[i].xp);orbs.length=0;
    Sound.pickup();floatText(p.x,p.y-22,'XP RUSH','#54e6b5');}
  else if(it.type==='rage'){p.rageT=540;Sound.tone(180,680,.35,'sawtooth',.11);floatText(p.x,p.y-22,'OVERDRIVE','#d97757');}
}

/* ========== WEAPON ARCHETYPES ========== */
function fireMissiles(){
  const count=Math.min(player.missile,5);
  EXCLUDE_SET.clear(); // Reused memory cache
  for(let i=0;i<count;i++){
    let tgt=nearestTo(player,EXCLUDE_SET);
    if(tgt)EXCLUDE_SET.add(tgt);
    const a=rand(0,7);
    missiles.push({x:player.x,y:player.y,vx:Math.cos(a)*3,vy:Math.sin(a)*3,
      spd:5.2,turn:.18,r:5,dmg:22+player.missile*7,target:tgt,life:140});}
  Sound.tone(380,520,.12,'triangle',.05);
}
function explodeMissile(m){
  const rad=72,radSq=rad*rad;burst(m.x,m.y,'#ffd95e',20,5);shake=Math.min(shake+5,12);Sound.boom();
  floatText(m.x,m.y,'💥','#ffd95e');
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];const dx=m.x-e.x,dy=m.y-e.y;
    if((dx*dx+dy*dy)<radSq)damageEnemy(e,m.dmg,'#ffd95e');}
}

function castChain(){
  let cur=nearestTo(player);if(!cur)return;
  const jumps=2+player.chain,dmg=16+player.chain*6,reach=190,reachSq=reach*reach;
  CHAIN_SET.clear(); // Reused memory cache
  let fromX=player.x,fromY=player.y;
  for(let j=0;j<jumps;j++){if(!cur)break;CHAIN_SET.add(cur);
    bolts.push({a:{x:fromX,y:fromY},b:{x:cur.x,y:cur.y},life:9});
    damageEnemy(cur,dmg,'#7c8cff');burst(cur.x,cur.y,'#9db0ff',6,3);
    fromX=cur.x;fromY=cur.y;
    let nx=null,ndSq=reachSq;
    for(const e of enemies){
      if(CHAIN_SET.has(e)) continue;
      const dx=fromX-e.x,dy=fromY-e.y;const dSq=dx*dx+dy*dy;
      if(dSq<ndSq){ndSq=dSq;nx=e;}
    }
    cur=nx;}
  Sound.zap();shake=Math.min(shake+2,8);
}

/* ========== LEVEL MANAGEMENT ========== */
const UPGRADES=[
  {id:'dmg',ico:'🗡️',c:'#ff5fa2',name:'Sharper Rounds',desc:'+35% bullet damage'},
  {id:'rate',ico:'⚡',c:'#ffd95e',name:'Rapid Fire',desc:'+22% fire rate'},
  {id:'multi',ico:'🔱',c:'#7c8cff',name:'Split Shot',desc:'+1 projectile per volley'},
  {id:'pierce',ico:'➶',c:'#54e6b5',name:'Piercing',desc:'bullets pass through +1 enemy'},
  {id:'spd',ico:'🥾',c:'#d97757',name:'Swift Boots',desc:'+12% move speed'},
  {id:'maxhp',ico:'❤️',c:'#ff5fa2',name:'Vitality',desc:'+30 max HP & heal 30'},
  {id:'magnet',ico:'🧲',c:'#54e6b5',name:'Magnet Core',desc:'+60% XP pickup range'},
  {id:'regen',ico:'✚',c:'#ffd95e',name:'Regeneration',desc:'+1 HP / sec'},
  {id:'lifesteal',ico:'🩸',c:'#ff5fa2',name:'Lifesteal',desc:'heal +1 HP on every kill'},
  {id:'velocity',ico:'➹',c:'#7c8cff',name:'Hyper Velocity',desc:'+30% bullet speed & +8% damage'},
  {id:'missile',ico:'🚀',c:'#ffd95e',name:'Homing Missiles',desc:'launch a missile that seeks & explodes (AoE)',weapon:'missile'},
  {id:'shield',ico:'🛡️',c:'#54e6b5',name:'Orbiting Shield',desc:'a guardian orb circles you, shredding contact',weapon:'shield'},
  {id:'chain',ico:'🌩️',c:'#7c8cff',name:'Chain Lightning',desc:'periodic bolt that arcs between enemies',weapon:'chain'},
];
const Up={};
function applyUpgrade(id){const p=player;
  if(id==='dmg')p.dmg*=1.35;else if(id==='rate')p.rate=Math.max(6,p.rate*.78);
  else if(id==='multi')p.multi++;else if(id==='pierce')p.pierce++;
  else if(id==='spd')p.speed*=1.12;
  else if(id==='maxhp'){p.maxhp+=30;p.hp=Math.min(p.maxhp,p.hp+30);}
  else if(id==='magnet'){p.magnet*=1.6;p.magnetSq=p.magnet*p.magnet;}
  else if(id==='regen')p.regen+=1;
  else if(id==='velocity'){p.bulletSpd*=1.3;p.dmg*=1.08;}else if(id==='lifesteal')p.lifesteal+=1;
  else if(id==='missile')p.missile++;else if(id==='shield')p.shield++;else if(id==='chain')p.chain++;
  Up[id]=(Up[id]||0)+1;renderLoadout();
}
function renderLoadout(){
  const box=document.getElementById('loadout');box.innerHTML='';
  const w=[['missile','🚀','Missiles',player.missile],['shield','🛡️','Shield',player.shield],['chain','🌩️','Lightning',player.chain]];
  for(const[id,ic,nm,lv]of w)if(lv>0){const d=document.createElement('div');d.className='wpip';
    d.innerHTML=`<i>${ic}</i> ${nm} <b>Lv${lv}</b>`;box.appendChild(d);}
}
function openLevelUp(){
  state='levelup';needsDraw=true;
  const avail=UPGRADES.filter(u=>!(u.id==='rate'&&player.rate<=6));   // retire maxed Rapid Fire
  const pool=avail.sort(()=>Math.random()-.5).slice(0,3);
  const wrap=document.getElementById('cards');wrap.innerHTML='';
  pool.forEach(u=>{const el=document.createElement('div');el.className='upg';el.style.setProperty('--c',u.c);
    const owned=Up[u.id]||0;
    const corner=u.weapon&&!owned?`<div class="new">NEW</div>`:owned?`<div class="lvl">Lv ${owned+1}</div>`:'';
    el.innerHTML=`${corner}<div class="uico">${u.ico}</div><h3>${u.name}</h3><p>${u.desc}</p>`;
    el.onclick=()=>{applyUpgrade(u.id);document.getElementById('levelup').classList.remove('show');
      state='play';t0+=performance.now()-pauseStart;};
    wrap.appendChild(el);});
  document.getElementById('levelup').classList.add('show');pauseStart=performance.now();
}
function gainXP(n){const p=player;p.xp+=n;
  while(p.xp>=p.next){p.xp-=p.next;p.level++;p.next=Math.floor(p.next*1.32+3);pendingLevels++;}}

;
/* NEON SURVIVOR — sim.js
 * update() — the per-tick simulation (fixed 1/60 s step; movement, weapons, collisions).
 * Classic script (shared global scope). Load order: core → world → sim → render → main. */

/* ========== TICK LOOP UPDATE ========== */
function update(){
  frame++;const p=player;
  // interpolation snapshot — remember this tick's start positions so draw() can lerp toward the new ones
  p.px=p.x;p.py=p.y;cam.px=cam.x;cam.py=cam.y;
  for(let i=0;i<enemies.length;i++){const e=enemies[i];e.px=e.x;e.py=e.y;}
  for(let i=0;i<bullets.length;i++){const b=bullets[i];b.px=b.x;b.py=b.y;}
  for(let i=0;i<missiles.length;i++){const m=missiles[i];m.px=m.x;m.py=m.y;}
  for(let i=0;i<ebullets.length;i++){const b=ebullets[i];b.px=b.x;b.py=b.y;}
  for(let i=0;i<orbs.length;i++){const o=orbs[i];o.px=o.x;o.py=o.y;}
  let mx=0,my=0;
  if(keys['w']||keys['arrowup'])my-=1;if(keys['s']||keys['arrowdown'])my+=1;
  if(keys['a']||keys['arrowleft'])mx-=1;if(keys['d']||keys['arrowright'])mx+=1;
  if(touch){const dx=touch.x-touch.cx,dy=touch.y-touch.cy,m=Math.hypot(dx,dy);if(m>8){mx=dx/m;my=dy/m;}}
  const ml=Math.hypot(mx,my);
  const tvx=ml?mx/ml*p.speed:0,tvy=ml?my/ml*p.speed:0;
  const ease=ml?p.accel:p.accel*1.4;
  p.vx+=(tvx-p.vx)*ease;p.vy+=(tvy-p.vy)*ease;
  p.x=clamp(p.x+p.vx,p.r,WORLD.w-p.r);p.y=clamp(p.y+p.vy,p.r,WORLD.h-p.r);
  if((p.x<=p.r&&p.vx<0)||(p.x>=WORLD.w-p.r&&p.vx>0))p.vx*=-.3;
  if((p.y<=p.r&&p.vy<0)||(p.y>=WORLD.h-p.r&&p.vy>0))p.vy*=-.3;

  // Smooth Padding Box Camera Constraints (Optimized Space Navigation)
  const mx2=W*0.30,my2=H*0.30,sxp=p.x-cam.x,syp=p.y-cam.y;
  if(sxp<mx2)cam.x=p.x-mx2;else if(sxp>W-mx2)cam.x=p.x-(W-mx2);
  if(syp<my2)cam.y=p.y-my2;else if(syp>H-my2)cam.y=p.y-(H-my2);
  cam.x=clamp(cam.x,0,Math.max(0,WORLD.w-W));
  cam.y=clamp(cam.y,0,Math.max(0,WORLD.h-H));

  if(p.inv>0)p.inv--;
  if(p.lsCd>0)p.lsCd--;
  p.near=nearestTo(p);                       // cache nearest enemy once per frame (used by fire + draw)
  if(p.regen>0&&p.hp<p.maxhp){p.regenAcc+=p.regen/60;if(p.regenAcc>=1){p.hp=Math.min(p.maxhp,p.hp+1);p.regenAcc-=1;}}

  if(p.rageT>0)p.rageT--;
  p.cool--;if(p.cool<=0){fire();p.cool=p.rageT>0?p.rate*.5:p.rate;}
  if(p.missile>0){p.missileCool--;if(p.missileCool<=0){fireMissiles();p.missileCool=Math.max(40,150-p.missile*14);}}
  if(p.chain>0){p.chainCool--;if(p.chainCool<=0){castChain();p.chainCool=Math.max(34,120-p.chain*12);}}

  // Shield Collision Matrix Optimization
  if(p.shield>0){p.shieldAng+=.07;const orbs=Math.min(p.shield+1,6),rad=48+p.shield*5,sdmg=10+p.shield*4;
    for(let k=0;k<orbs;k++){const a=p.shieldAng+k/orbs*6.283;const ox=p.x+Math.cos(a)*rad,oy=p.y+Math.sin(a)*rad;
      for(let i=0;i<enemies.length;i++){const e=enemies[i];if(e.scd>0)continue;   // live length: damageEnemy may splice
        const dx=e.x-ox,dy=e.y-oy,distHit=e.r+9;
        if((dx*dx+dy*dy)<(distHit*distHit)){
          damageEnemy(e,sdmg,'#54e6b5');e.scd=16;burst(ox,oy,'#54e6b5',5,3);
          if(now-lastPingSnd>50){Sound.ping();lastPingSnd=now;}}}}}

  const elapsed=(now-t0)/1000;
  spawnTimer--;const interval=Math.max(22,72-elapsed*.42)*DIFF.spawn*(bossOn?BOSS.spawnMul:1);
  if(spawnTimer<=0){const c=Math.max(1,Math.round((1+Math.floor(elapsed/70))*(bossOn?BOSS.spawnCountMul:1)));
    for(let i=0;i<c;i++)spawnEnemy();spawnTimer=interval;}
  if(!bossOn&&elapsed>=nextBoss)spawnBoss();        // boss waves (first at 60s, then 50s after each kill)

  // Cargo Pickups Matrix Optimization
  itemTimer--;if(itemTimer<=0){spawnItem();itemTimer=Math.floor(rand(1500,2100));}
  for(let i=items.length-1;i>=0;i--){const it=items[i];it.life--;
    if(it.life<=0){items.splice(i,1);continue;}
    const dx=it.x-p.x,dy=it.y-p.y,pRadius=p.r+20;
    if((dx*dx+dy*dy)<(pRadius*pRadius)){pickItem(it);items.splice(i,1);}}

  // Plasma Railgun Bolts Matrix Optimization
  for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];b.x+=b.vx;b.y+=b.vy;b.life--;
    if(b.life<=0||b.x<-20||b.x>WORLD.w+20||b.y<-20||b.y>WORLD.h+20){bullets.splice(i,1);continue;}
    // live length: damageEnemy() may splice an enemy mid-scan (pierce), so don't cache the bound
    for(let j=0;j<enemies.length;j++){const e=enemies[j];
      const dx=b.x-e.x,dy=b.y-e.y,combR=e.r+b.r;
      if((dx*dx+dy*dy)<(combR*combR)){damageEnemy(e,b.dmg,e.col);burst(b.x,b.y,e.col,4,3);
        if(b.pierce>0)b.pierce--;else bullets.splice(i,1);break;}}}

  // Torpedoes / Seeker Missiles Matrix Optimization
  for(let i=missiles.length-1;i>=0;i--){const m=missiles[i];
    if(!m.target||m.target.dead)m.target=nearestTo(m);
    if(m.target){const a=Math.atan2(m.target.y-m.y,m.target.x-m.x);const ca=Math.atan2(m.vy,m.vx);
      let da=a-ca;while(da>Math.PI)da-=6.283;while(da<-Math.PI)da+=6.283;
      const na=ca+clamp(da,-m.turn,m.turn);m.vx=Math.cos(na)*m.spd;m.vy=Math.sin(na)*m.spd;}
    m.x+=m.vx;m.y+=m.vy;m.life--;
    if(frame%2===0)particles.push({x:m.x,y:m.y,vx:0,vy:0,r:2,life:14,col:'#ffd95e'});
    let hit=m.life<=0;
    if(!hit){
      const eLen=enemies.length;
      for(let j=0;j<eLen;j++){const e=enemies[j];
        const dx=m.x-e.x,dy=m.y-e.y,combR=e.r+m.r;
        if((dx*dx+dy*dy)<(combR*combR)){hit=true;break;}}
    }
    if(hit){explodeMissile(m);missiles.splice(i,1);}}

  // Hostile Vessel Hulls Matrix Optimization
  for(let i=enemies.length-1;i>=0;i--){const e=enemies[i];if(e.hit>0)e.hit--;if(e.scd>0)e.scd--;if(e.cdmg>0)e.cdmg--;
    // chase via a normalized vector — avoids atan2+cos+sin (3 transcendentals) per enemy per frame
    const dxp=p.x-e.x,dyp=p.y-e.y,dp=Math.sqrt(dxp*dxp+dyp*dyp)||1,ux=dxp/dp,uy=dyp/dp;
    if(e.boss&&e.dashT>0){e.x+=e.dvx;e.y+=e.dvy;                 // mid-dash: charge along locked vector, skip chase + cadence
      if(--e.dashT<=0){e.bossT=bossCD();e.atk=2;}}               // dash done → next up: AOE slam
    else{e.x+=ux*e.spd;e.y+=uy*e.spd;
      if(e.type==='fast'&&(e.trail=(e.trail|0)+1)%3===0&&particles.length<320)   // amber wake → fast threats read apart from inert teal orbs
        particles.push({x:e.px,y:e.py,vx:-ux*.3,vy:-uy*.3,r:rand(1.4,2.6),life:rand(10,18),col:'#ff9d2e'});
      if(e.boss){if(e.tele>0){if(--e.tele<=0)bossAttack(e);}      // telegraph expired → dispatch attack[e.atk]
        else if(--e.bossT<=0){e.tele=BOSS.teleT;Sound.ping();}}}  // cadence elapsed → start wind-up telegraph
    // per-enemy contact cooldown → a swarm hurts far more than one enemy (density = danger)
    if(p.inv<=0&&e.cdmg<=0){const combR=(e.boss?e.r*BOSS.hitRMul:e.r)+p.r;
      if(dp*dp<combR*combR){
        p.hp-=e.dmg;p.inv=e.boss?BOSS.invContact:7;e.cdmg=26;shake=Math.min(shake+8,14);flashHit();Sound.hurt();
        burst(p.x,p.y,'#ff5fa2',14,5);e.x-=ux*12;e.y-=uy*12;
        if(p.hp<=0){p.hp=0;return gameOver();}}}}

  // Boss projectiles
  for(let i=ebullets.length-1;i>=0;i--){const b=ebullets[i];b.x+=b.vx;b.y+=b.vy;b.life--;
    if(b.life<=0){ebullets.splice(i,1);continue;}
    if(p.inv<=0){const dx=b.x-p.x,dy=b.y-p.y,rr=b.r+p.r;
      if(dx*dx+dy*dy<rr*rr){p.hp-=b.dmg;p.inv=BOSS.invProj;shake=Math.min(shake+6,14);flashHit();Sound.hurt();
        burst(p.x,p.y,'#ff3b6b',10,5);ebullets.splice(i,1);
        if(p.hp<=0){p.hp=0;return gameOver();}}}}

  // Energy Core / XP Orbs Tractor Pull Matrix Optimization
  for(let i=orbs.length-1;i>=0;i--){const o=orbs[i];
    const dx=o.x-p.x,dy=o.y-p.y;const dSq=dx*dx+dy*dy;
    if(dSq<p.magnetSq){
      const d=Math.sqrt(dSq)||1,pull=clamp((p.magnet-d)/p.magnet*6,.6,6);
      o.x-=dx/d*pull;o.y-=dy/d*pull;}   // pull toward player without atan2/cos/sin
    const collectR=p.r+6;
    if(dSq<(collectR*collectR)){orbs.splice(i,1);gainXP(o.xp);burst(o.x,o.y,'#54e6b5',5,2.5);Sound.pickup();}}

  for(let i=particles.length-1;i>=0;i--){const q=particles[i];q.x+=q.vx;q.y+=q.vy;q.vx*=.92;q.vy*=.92;q.life--;if(q.life<=0)particles.splice(i,1);}
  for(let i=floats.length-1;i>=0;i--){const f=floats[i];f.y+=f.vy;f.life--;if(f.life<=0)floats.splice(i,1);}
  for(let i=bolts.length-1;i>=0;i--){if(--bolts[i].life<=0)bolts.splice(i,1);}
  if(shake>0)shake*=.85;
  if(pendingLevels>0&&state==='play'){pendingLevels--;Sound.level();openLevelUp();}
  updateHUD(elapsed);
}

;
/* NEON SURVIVOR — render.js
 * draw() — interpolated renderer (lerps bodies by alpha), plus roundRect helper.
 * Classic script (shared global scope). Load order: core → world → sim → render → main. */

/* ========== DRAW LOOP (Batched Canvas States) ========== */
function draw(){
  // interpolated camera — render between the last two sim ticks (alpha=fractional tick) for smooth scroll
  const A=alpha,icx=lerp(cam.px,cam.x,A),icy=lerp(cam.py,cam.y,A);
  // per-body interpolated coords (?? guards bodies spawned this tick, which have no prev yet)
  const ix=e=>lerp(e.px===undefined?e.x:e.px,e.x,A),iy=e=>lerp(e.py===undefined?e.y:e.py,e.y,A);
  ctx.clearRect(0,0,W,H);let sx=0,sy=0;
  if(shake>.3){sx=rand(-shake,shake);sy=rand(-shake,shake);}
  ctx.save();
  ctx.translate(sx, sy); // Screen shake layer stays isolated

  // 1. --- DEEP-SPACE BACKDROP (one stretched image → solid, no tiling seams) ---
  if (NEBULA_CANVAS) ctx.drawImage(NEBULA_CANVAS, 0, 0, W, H);

  // Shift camera vector down for active physics layers (vessels, projectiles, effects)
  ctx.translate(-icx, -icy);

  // 1b. --- PARALLAX STARFIELD (world-space, culled to viewport) ---
  for(let i=0;i<STAR_FIELD.length;i++){const st=STAR_FIELD[i];
    if(st.x<icx||st.x>icx+W||st.y<icy||st.y>icy+H)continue;
    ctx.globalAlpha=st.alpha;ctx.fillStyle=st.col;ctx.fillRect(st.x,st.y,st.r,st.r);}
  ctx.globalAlpha=1;

  // 2. --- STRUCTURAL ARENA ALIGNMENT GRID LINES ---
  ctx.strokeStyle='rgba(124,140,255,.04)'; ctx.lineWidth=1; const g=64;
  const x0=Math.floor(icx/g)*g, y0=Math.floor(icy/g)*g;
  ctx.beginPath();
  for(let x=x0; x<icx+W+g; x+=g){ ctx.moveTo(x,icy); ctx.lineTo(x,icy+H); }
  for(let y=y0; y<icy+H+g; y+=g){ ctx.moveTo(icx,y); ctx.lineTo(icx+W,y); }
  ctx.stroke();
  ctx.globalAlpha = 1.0;

  // 3. --- SECTOR BORDER SAFETY MATRIX ---
  ctx.strokeStyle='rgba(124,140,255,.35)';ctx.lineWidth=3;ctx.shadowBlur=18;ctx.shadowColor='#7c8cff';
  ctx.strokeRect(0, 0, WORLD.w, WORLD.h); ctx.shadowBlur = 0;

  // 4. Render Orbs (Cached Sprite batching)
  const orbSpr=dotSprite('#54e6b5');
  const oLen=orbs.length;
  for(let i=0;i<oLen;i++){const o=orbs[i];const vr=o.r*2.6,ox=ix(o),oy=iy(o);ctx.drawImage(orbSpr,ox-vr,oy-vr,vr*2,vr*2);}

  // 5. Item Pickups / Cargo Drops
  const itemLen=items.length;
  ctx.textAlign='center';ctx.textBaseline='middle';
  for(let i=0;i<itemLen;i++){const it=items[i];if(it.life<160&&frame%12<6)continue;
    const yo=Math.sin(frame*.06+it.bob)*4;
    let beam=it.beam;   // tractor-beam gradient is static (item never moves) → build once, reuse
    if(!beam){beam=it.beam=ctx.createLinearGradient(0,it.y-150,0,it.y+10);
      beam.addColorStop(0,'rgba(0,0,0,0)');beam.addColorStop(1,it.col+'66');}
    ctx.fillStyle=beam;ctx.globalAlpha=.5;ctx.fillRect(it.x-12,it.y-150,24,160);ctx.globalAlpha=1;
    ctx.save();ctx.translate(it.x,it.y+yo);
    ctx.shadowBlur=20;ctx.shadowColor=it.col;ctx.strokeStyle=it.col;ctx.lineWidth=2;
    ctx.fillStyle='rgba(255,255,255,.08)';ctx.beginPath();ctx.arc(0,0,it.r,0,7);ctx.fill();ctx.stroke();
    ctx.save();ctx.rotate(frame*.03);ctx.setLineDash([4,6]);ctx.beginPath();ctx.arc(0,0,it.r+7,0,7);ctx.stroke();ctx.restore();
    ctx.setLineDash([]);ctx.shadowBlur=0;
    ctx.font='18px sans-serif';ctx.fillText(it.ico,0,1);
    ctx.font='700 11px Inter,sans-serif';const tw=it.tw||(it.tw=ctx.measureText(it.label).width+14);   // label/font fixed → measure once
    ctx.fillStyle='rgba(8,9,16,.8)';ctx.strokeStyle=it.col;ctx.lineWidth=1;
    roundRect(-tw/2,it.r+8,tw,17,5);ctx.fill();ctx.stroke();
    ctx.fillStyle=it.col;ctx.fillText(it.label,0,it.r+17);ctx.restore();}
  ctx.textBaseline='alphabetic';

  // 6. Render Projectiles (Plasma Bolts)
  const bSpr=dotSprite('#ffd95e');
  const bLen=bullets.length;
  for(let i=0;i<bLen;i++){const b=bullets[i];const vr=b.r*2.4,bx=ix(b),by=iy(b);ctx.drawImage(bSpr,bx-vr,by-vr,vr*2,vr*2);}

  // 7. Seeker Torpedoes / Missiles
  const mLen=missiles.length;
  for(let i=0;i<mLen;i++){const m=missiles[i];const vr=11,mx=ix(m),my=iy(m);ctx.drawImage(bSpr,mx-vr,my-vr,vr*2,vr*2);
    ctx.save();ctx.translate(mx,my);ctx.rotate(Math.atan2(m.vy,m.vx));ctx.fillStyle='#fff';
    ctx.beginPath();ctx.moveTo(6,0);ctx.lineTo(-4,3);ctx.lineTo(-4,-3);ctx.closePath();ctx.fill();ctx.restore();}

  // 8. EMP Chain Arcs / Lightning
  const boltLen=bolts.length;
  for(let i=0;i<boltLen;i++){const bo=bolts[i];ctx.strokeStyle='rgba(157,176,255,'+clamp(bo.life/9,0,1)+')';ctx.lineWidth=2.4;
    ctx.beginPath();const seg=6;for(let j=0;j<=seg;j++){const tt=j/seg;const x=bo.a.x+(bo.b.x-bo.a.x)*tt+rand(-7,7);
      const y=bo.a.y+(bo.b.y-bo.a.y)*tt+rand(-7,7);j?ctx.lineTo(x,y):ctx.moveTo(bo.a.x,bo.a.y);}ctx.stroke();}

  // 8b. Boss projectiles
  const ebSpr=dotSprite('#ff3b6b');
  for(let i=0;i<ebullets.length;i++){const b=ebullets[i];const vr=b.r*1.7,bx=ix(b),by=iy(b);ctx.drawImage(ebSpr,bx-vr,by-vr,vr*2,vr*2);}

  // 9. Hostile Alien Vessels Swarms
  const eLen=enemies.length;
  for(let i=0;i<eLen;i++){const e=enemies[i];const m=EMETA[e.type],spr=enemySprite(e.type,e.hit>0),ex=ix(e),ey=iy(e);
    if(m.rot){ctx.save();ctx.translate(ex,ey);ctx.rotate(frame*m.rot);ctx.drawImage(spr,-spr.width/2,-spr.height/2);ctx.restore();}
    else ctx.drawImage(spr,ex-spr.width/2,ey-spr.height/2);
    if(e.type==='tank'){ctx.strokeStyle='rgba(255,255,255,.25)';ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(ex,ey,e.r+5,-1.57,-1.57+6.28*(e.hp/e.maxhp));ctx.stroke();}
    if(e.boss&&e.tele>0){const tl=1-e.tele/BOSS.teleT;                  // attack wind-up telegraph, color/shape per attack
      if(e.atk===1){const aa=Math.atan2(player.y-ey,player.x-ex),L=120+tl*170;   // dash: directional lunge line (amber)
        ctx.strokeStyle='rgba(255,157,46,'+(.25+.55*tl)+')';ctx.lineWidth=3+5*tl;
        ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex+Math.cos(aa)*L,ey+Math.sin(aa)*L);ctx.stroke();}
      else if(e.atk===2){const R=e.r+12+tl*(BOSS.slamR-e.r-12);        // slam: growing ground ring (cyan)
        ctx.strokeStyle='rgba(96,224,255,'+(.25+.5*tl)+')';ctx.lineWidth=3+5*tl;
        ctx.beginPath();ctx.arc(ex,ey,R,0,7);ctx.stroke();}
      else{ctx.strokeStyle='rgba(255,59,107,'+(.3+.5*tl)+')';ctx.lineWidth=3+4*tl;   // burst: pulsing red ring
        ctx.beginPath();ctx.arc(ex,ey,e.r+10+tl*22,0,7);ctx.stroke();}}
    if(e.boss&&e.dashT>0){ctx.strokeStyle='rgba(255,157,46,.5)';ctx.lineWidth=4;     // dash motion streak
      ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-e.dvx*6,ey-e.dvy*6);ctx.stroke();}}

  // 10. Exhaust Sparks & Explosive Debris Particles
  const pLen=particles.length;
  for(let i=0;i<pLen;i++){const q=particles[i];ctx.globalAlpha=clamp(q.life/30,0,1);ctx.fillStyle=q.col;ctx.beginPath();ctx.arc(q.x,q.y,q.r,0,7);ctx.fill();}
  ctx.globalAlpha=1;

  // 11. Space Interceptor Player Model Rendering
  const p=player,rage=p.rageT>0,ipx=ix(p),ipy=iy(p);ctx.save();ctx.translate(ipx,ipy);
  if(p.inv>0&&frame%6<3)ctx.globalAlpha=.45;
  const near=p.near;
  if(near){const aa=Math.atan2(near.y-p.y,near.x-p.x);let da=aa-p.angle;
    while(da>Math.PI)da-=6.283;while(da<-Math.PI)da+=6.283;p.angle+=da*.2;
    ctx.strokeStyle='rgba(255,217,94,.22)';ctx.lineWidth=1.5;ctx.setLineDash([4,6]);
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(ix(near)-ipx,iy(near)-ipy);ctx.stroke();ctx.setLineDash([]);}
  ctx.strokeStyle='rgba(84,230,181,.07)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,p.magnet,0,7);ctx.stroke();
  const sp=Math.hypot(p.vx,p.vy);
  if(sp>.4){const ta=Math.atan2(p.vy,p.vx)+Math.PI;ctx.save();ctx.rotate(ta);
    const fl=9+sp*3+Math.sin(frame*.7)*3;ctx.shadowBlur=16;ctx.shadowColor='#ffb04f';
    const fg=ctx.createLinearGradient(p.r-2,0,p.r-2+fl+6,0);fg.addColorStop(0,'rgba(255,225,120,.95)');fg.addColorStop(1,'rgba(255,90,60,0)');
    ctx.fillStyle=fg;ctx.beginPath();ctx.moveTo(p.r-3,5);ctx.lineTo(p.r-3+fl+6,0);ctx.lineTo(p.r-3,-5);ctx.closePath();ctx.fill();ctx.restore();ctx.shadowBlur=0;}
  ctx.save();ctx.rotate(frame*.02);ctx.strokeStyle=rage?'rgba(255,217,94,.6)':'rgba(124,140,255,.5)';
  ctx.lineWidth=2;ctx.setLineDash([7,9]);ctx.beginPath();ctx.arc(0,0,p.r+7,0,7);ctx.stroke();ctx.setLineDash([]);ctx.restore();
  ctx.save();ctx.rotate(p.angle);const _ship=shipSprite(rage,p.r);ctx.drawImage(_ship,-_ship.width/2,-_ship.height/2);ctx.restore();
  const pr=3+Math.sin(frame*.15)*1.2;ctx.shadowBlur=14;ctx.shadowColor=rage?'#ffd95e':'#7c8cff';
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,0,pr+2,0,7);ctx.fill();
  ctx.restore();ctx.shadowBlur=0;ctx.globalAlpha=1;

  // 12. Deflector Energy Shield Matrices
  if(p.shield>0){const orbs=Math.min(p.shield+1,6),rad=48+p.shield*5,ss=dotSprite('#54e6b5'),vr=11;
    for(let k=0;k<orbs;k++){const a=p.shieldAng+k/orbs*6.283;const ox=ipx+Math.cos(a)*rad,oy=ipy+Math.sin(a)*rad;
      ctx.drawImage(ss,ox-vr,oy-vr,vr*2,vr*2);}}

  // 13. Combat Floating Damage Numbers
  ctx.textAlign='center';ctx.font='700 15px Inter,sans-serif';
  const fLen=floats.length;
  for(let i=0;i<fLen;i++){const f=floats[i];ctx.globalAlpha=clamp(f.life/40,0,1);ctx.fillStyle=f.col;
    const pop=1+.6*clamp((f.life-44)/6,0,1);   // brief ease-out scale-up on spawn (life 50→44) for punch
    if(pop>1.01){ctx.save();ctx.translate(f.x,f.y);ctx.scale(pop,pop);ctx.fillText(f.txt,0,0);ctx.restore();}
    else ctx.fillText(f.txt,f.x,f.y);}
  ctx.globalAlpha=1;ctx.restore();

  // 14. Off-Screen Cargo/Item Target HUD Nav-Arrows
  const mg=46;
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='13px sans-serif';
  for(let i=0;i<itemLen;i++){const it=items[i];const sxp=it.x-icx,syp=it.y-icy;
    if(sxp>=mg&&sxp<=W-mg&&syp>=mg&&syp<=H-mg)continue;
    const ex=clamp(sxp,mg,W-mg),ey=clamp(syp,mg,H-mg);
    const ang=Math.atan2(syp-H/2,sxp-W/2);
    ctx.save();ctx.translate(ex,ey);
    ctx.shadowBlur=12;ctx.shadowColor=it.col;
    ctx.fillStyle='rgba(8,9,16,.85)';ctx.strokeStyle=it.col;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(0,0,15,0,7);ctx.fill();ctx.stroke();
    ctx.rotate(ang);ctx.fillStyle=it.col;ctx.beginPath();
    ctx.moveTo(20,0);ctx.lineTo(12,5);ctx.lineTo(12,-5);ctx.closePath();ctx.fill();ctx.rotate(-ang);
    ctx.shadowBlur=0;ctx.fillText(it.ico,0,1);
    ctx.restore();}
  ctx.textBaseline='alphabetic';

  // Boss health bar (screen space, top)
  let _boss=null;for(let i=0;i<enemies.length;i++){if(enemies[i].boss){_boss=enemies[i];break;}}
  if(_boss){
    const bwid=Math.min(560,W*0.7),bx=(W-bwid)/2,by=58,bh=15;
    ctx.fillStyle='rgba(8,9,16,.82)';ctx.strokeStyle='#ff3b6b';ctx.lineWidth=2;
    roundRect(bx,by,bwid,bh,7);ctx.fill();ctx.stroke();
    const bf=clamp(_boss.hp/_boss.maxhp,0,1);
    ctx.fillStyle='#ff3b6b';ctx.shadowBlur=12;ctx.shadowColor='#ff3b6b';
    roundRect(bx+2,by+2,(bwid-4)*bf,bh-4,5);ctx.fill();ctx.shadowBlur=0;
    ctx.fillStyle='#fff';ctx.font='700 11px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('☠ '+_boss.name+'  ·  '+Math.ceil(_boss.hp)+' / '+Math.ceil(_boss.maxhp),W/2,by+bh+9);
    ctx.textBaseline='alphabetic';
  }
  if(_test){ctx.fillStyle='#54e6b5';ctx.font='700 12px Inter,sans-serif';ctx.textAlign='left';
    ctx.fillText('🧪 TEST MODE (one-hit bosses · B to toggle)',12,H-14);ctx.textAlign='left';}
  drawMinimap();   // corner minimap (own canvas; pure screen space)
}
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

;
/* ========== UI ENGINE — screen-space HUD widgets that live outside the world transform ==========
 * Minimap: absolute world->corner-canvas scatter of orbs / enemies / items / boss / player.
 * Own canvas + ctx, never touches the main game transform stack. Called once at the tail of draw().
 * Markers use shape+colour redundancy so XP orbs (pulsing gold) never read as fast enemies (flat red),
 * loot (purple diamonds) stays distinct, and the boss (blinking gold-ringed blip) signals high priority. */
let _mm=null,_mmctx=null;
const MM_SIZE=160,MMx=MM_SIZE/WORLD.w,MMy=MM_SIZE/WORLD.h;   // world->minimap scale, per-axis (no square-world assumption)
const _mmCl=(v,r)=>v<r?r:(v>MM_SIZE-r?MM_SIZE-r:v);          // keep a marker of radius r fully inside the frame

function drawMinimap(){
  if(frame&1)return;                                          // 30Hz gate: minimap precision needs no 60fps redraw; off-frames keep last image
  if(!_mmctx){const c=document.getElementById('minimap');
    if(!c||typeof c.getContext!=='function')return;_mm=c;_mmctx=c.getContext('2d');}
  const g=_mmctx;if(!g)return;g.clearRect(0,0,MM_SIZE,MM_SIZE);
  // 1) XP orbs — pulsing gold, drawn first (lowest priority); capped+strided so late-game clouds stay cheap
  const on=orbs.length,ostep=on>120?Math.ceil(on/120):1;
  g.fillStyle='rgba(255,217,94,'+(.5+.5*Math.sin(frame*.15)).toFixed(2)+')';
  for(let i=0;i<on;i+=ostep){const o=orbs[i];g.fillRect(_mmCl(o.x*MMx,1)-1,_mmCl(o.y*MMy,1)-1,2,2);}
  // 2) enemies — flat red (threat=red; never tint by type so fast/tank don't read as orbs); skip boss
  g.fillStyle='#ff5f6e';
  for(let i=0;i<enemies.length;i++){const e=enemies[i];if(e.boss)continue;
    g.fillRect(_mmCl(e.x*MMx,1)-1,_mmCl(e.y*MMy,1)-1,2,2);}
  // 3) items/loot — purple rotated diamond (shape sets loot apart from any dot)
  g.fillStyle='#b56bff';
  for(let i=0;i<items.length;i++){const it=items[i];
    g.save();g.translate(_mmCl(it.x*MMx,4),_mmCl(it.y*MMy,4));g.rotate(.785);g.fillRect(-2.5,-2.5,5,5);g.restore();}
  // 4) boss — large blinking blip with a gold ring, high-priority signal
  for(let i=0;i<enemies.length;i++){const e=enemies[i];if(!e.boss)continue;
    const r=5+Math.sin(frame*.1)*2,x=_mmCl(e.x*MMx,r+2),y=_mmCl(e.y*MMy,r+2);
    g.fillStyle=(frame%30<15)?'#ff3b6b':'#ff8aa6';g.beginPath();g.arc(x,y,r,0,6.283);g.fill();
    g.lineWidth=1;g.strokeStyle='#ffd95e';g.beginPath();g.arc(x,y,r+2,0,6.283);g.stroke();}
  // 5) player — bright cyan dot on top
  g.fillStyle='#54e6ff';g.beginPath();g.arc(_mmCl(player.x*MMx,3),_mmCl(player.y*MMy,3),3,0,6.283);g.fill();
}

;
/* NEON SURVIVOR — main.js
 * Initialization & wiring: viewport sizing, input listeners, HUD, the game loop
 * driver, screen-flow control, menus/leaderboard, button bindings, and startup bootstrap.
 * Loads LAST (after core/world/sim/render) — references their globals (player, Sound, draw, update, …). */

/* ===== DEVICE MODE: capability + dimension detection toggles the touch UI / responsive layout ===== */
const _mqCoarse=typeof matchMedia==='function'?matchMedia('(pointer:coarse)'):{matches:false,addEventListener(){}};  // physical pointer is touch/stylus, not a mouse
const _hasTouch=('ontouchstart' in window)||(typeof navigator!=='undefined'&&navigator.maxTouchPoints>0);            // touch events actually supported
const joyEl=document.getElementById('joy'),joyNub=document.getElementById('joynub');
let IS_MOBILE=false,touch=null;
function applyDeviceMode(){                                              // coarse+touch OR small viewport → mobile
  IS_MOBILE=(_mqCoarse.matches&&_hasTouch)||Math.min(W||innerWidth,H||innerHeight)<=820;
  document.body.classList.toggle('mobile',IS_MOBILE);                   // single CSS hook for all responsive rules
  if(!IS_MOBILE){touch=null;if(joyEl)joyEl.hidden=true;}}               // desktop / mouse hand-off: drop the stick
_mqCoarse.addEventListener('change',applyDeviceMode);                    // live re-toggle on pointer-type change

function resize(){W=innerWidth;H=innerHeight;applyDeviceMode();
  DPR=Math.min(IS_MOBILE?1.5:2,devicePixelRatio||1);                    // cap fill-rate on mobile GPUs (1.5 vs retina 2)
  cv.width=W*DPR;cv.height=H*DPR;cv.style.width=W+'px';cv.style.height=H+'px';ctx.setTransform(DPR,0,0,DPR,0,0);needsDraw=true;}
resize();addEventListener('resize',resize);

/* ========== INPUTS ========== */
const keys={};
addEventListener('keydown',e=>{if(e.target&&e.target.tagName==='INPUT')return;   // let text fields (username) type normally
  const k=e.key.toLowerCase();keys[k]=true;
  if(k==='p'&&(state==='play'||state==='pause'))togglePause();
  if(k==='m')Sound.toggle();
  if(k==='f3'){e.preventDefault();togglePerf();}   // dev FPS benchmark overlay
  if(k==='b'&&state==='play'){_test=!_test;if(_test&&!bossOn)spawnBoss();}   // Test Mode: one-hit bosses (toggle off→on to respawn)
  if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();});
addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
/* floating virtual joystick — only on mobile; anchors at first touch, sim.js reads touch.{x,y,cx,cy} unchanged */
const JOYR=46;   // visual nub clamp radius (sim deadzone stays at 8px)
cv.addEventListener('touchstart',e=>{if(!IS_MOBILE)return;const t=e.touches[0];
  touch={cx:t.clientX,cy:t.clientY,x:t.clientX,y:t.clientY};
  if(joyEl){joyEl.style.left=t.clientX+'px';joyEl.style.top=t.clientY+'px';joyEl.hidden=false;joyNub.style.transform='translate(-50%,-50%)';}},{passive:true});
cv.addEventListener('touchmove',e=>{if(!touch)return;const t=e.touches[0];touch.x=t.clientX;touch.y=t.clientY;
  if(joyNub){let dx=t.clientX-touch.cx,dy=t.clientY-touch.cy,m=Math.hypot(dx,dy);if(m>JOYR){dx=dx/m*JOYR;dy=dy/m*JOYR;}
    joyNub.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;}},{passive:true});
cv.addEventListener('touchend',()=>{touch=null;if(joyEl)joyEl.hidden=true;});
document.getElementById('sound').onclick=()=>Sound.toggle();
const mpauseBtn=document.getElementById('mpause');   // touch pause (P is unreachable on a phone)
if(mpauseBtn)mpauseBtn.onclick=()=>{if(state==='play'||state==='pause')togglePause();};

/* ========== INTERFACE FLOW ========== */
const HUD={score:document.getElementById('score'),wave:document.getElementById('wave'),time:document.getElementById('time'),
  hpfill:document.getElementById('hpfill'),hplabel:document.getElementById('hplabel'),
  xpfill:document.getElementById('xpfill'),lvlnum:document.getElementById('lvlnum'),lowhp:document.getElementById('lowhp')};
const _hud={score:-1,wave:-1,time:'',hp:-1,maxhp:-1,xp:-1,next:-1,lvl:-1,low:-1};
function updateHUD(elapsed){const p=player;
  // cached element refs + change-guards: skip the DOM write when the value is unchanged (most frames)
  if(score!==_hud.score){HUD.score.textContent=score;_hud.score=score;}
  if(wave!==_hud.wave){HUD.wave.textContent=wave;_hud.wave=wave;}
  const tstr=Math.floor(elapsed/60)+':'+String(Math.floor(elapsed%60)).padStart(2,'0');
  if(tstr!==_hud.time){HUD.time.textContent=tstr;_hud.time=tstr;}
  // guard on the RAW operands (hp + maxhp), not the derived %, so a maxhp-only change (Vitality at full HP) still repaints the label
  const hpc=Math.ceil(p.hp);
  if(hpc!==_hud.hp||p.maxhp!==_hud.maxhp){HUD.hpfill.style.width=clamp(p.hp/p.maxhp*100,0,100)+'%';
    HUD.hplabel.textContent=hpc+' / '+p.maxhp;_hud.hp=hpc;_hud.maxhp=p.maxhp;}
  if(p.xp!==_hud.xp||p.next!==_hud.next){HUD.xpfill.style.width=(p.xp/p.next*100)+'%';_hud.xp=p.xp;_hud.next=p.next;}
  if(p.level!==_hud.lvl){HUD.lvlnum.textContent=p.level;_hud.lvl=p.level;}
  const frac=p.hp/p.maxhp;
  // low-HP vignette: only touch the DOM when the severity bucket changes; the pulse itself is a CSS animation
  if(frac<.35){const sev=Math.round((0.35-frac)/0.35*10)/10;
    if(_hud.low!==sev){HUD.lowhp.style.setProperty('--sev',sev);HUD.lowhp.classList.add('danger');_hud.low=sev;}}
  else if(_hud.low!==-1){HUD.lowhp.classList.remove('danger');HUD.lowhp.style.opacity='';_hud.low=-1;}
}
function flashHit(){const f=document.getElementById('flash');f.style.transition='none';f.style.opacity='.5';
  requestAnimationFrame(()=>{f.style.transition='opacity .4s';f.style.opacity='0';});}
/* ===== DEV DEBUG OVERLAY (toggle F3) — perf + live boss state + player stats =====
 * Off by default (zero cost), reads globals only (never mutates sim state, so verify-equiv stays identical).
 * Line 1 perf: fps, avg/worst frame-time, sim ticks-per-frame (proves the accumulator catches up: ~1 at
 *   60 Hz, <1 at 144 Hz), live body count. Lines 2-3 (play only): boss FSM + the upgrade-mutated stats. */
const _perf={on:false,el:null,n:0,sum:0,worst:0,ticks:0,last:0};
const _ATK=['BURST','DASH','SLAM'];           // mirrors e.atk dispatch in world.js (0/1/2)
function togglePerf(){
  _perf.on=!_perf.on;
  if(!_perf.el){const d=document.createElement('div');d.id='perfhud';document.body.appendChild(d);_perf.el=d;}
  _perf.el.style.display=_perf.on?'block':'none';
  _perf.last=0;_perf.n=0;_perf.sum=0;_perf.worst=0;}
// boss line: scan for the live boss, report its FSM sub-state (dash > telegraph > cadence), HP, and music layer
function _bossLine(){
  for(let i=0;i<enemies.length;i++){const e=enemies[i];if(e.boss){
    const sub=e.dashT>0?'dash '+e.dashT                          // mid-lunge: ticks left
      :e.tele>0?'tele '+(e.tele/60).toFixed(2)+'s'               // winding up the telegraph
      :'cd '+Math.max(0,e.bossT/60).toFixed(2)+'s';              // counting down to next attack
    return `BOSS active · atk=${_ATK[e.atk]} · ${sub} · hp ${Math.ceil(e.hp)}/${Math.round(e.maxhp)} · music=${Music.bossMode?'BOSS':'NORMAL'}`;}}
  const nx=Math.max(0,nextBoss-(now-t0)/1000);
  return `BOSS none · next in ${nx.toFixed(1)}s · music=${Music.bossMode?'BOSS':'NORMAL'}`;}
// stat line: exactly the player fields the 14 upgrades mutate — watch an upgrade land in real time
function _statLine(){const p=player;
  return `DMG ${p.dmg.toFixed(1)} · RATE ${p.rate.toFixed(0)}f (${(60/p.rate).toFixed(1)}/s) · MULTI ${p.multi} · PIERCE ${p.pierce} · SPD ${p.speed.toFixed(2)} · `
    +`HP ${Math.ceil(p.hp)}/${p.maxhp} · MAG ${Math.round(p.magnet)} · REGEN ${p.regen} · LS ${p.lifesteal} · MSL ${p.missile} · SHLD ${p.shield} · CHN ${p.chain} · Lv${p.level}`;}
function perfFrame(ts){
  if(!_perf.on)return;
  if(_perf.last){const d=ts-_perf.last;_perf.sum+=d;if(d>_perf.worst)_perf.worst=d;_perf.n++;}
  _perf.last=ts;
  if(_perf.sum>=200){                        // repaint ~5×/s to avoid its own DOM thrash
    const avg=_perf.sum/_perf.n,ec=enemies.length+bullets.length+orbs.length+particles.length+missiles.length+ebullets.length;
    let txt=`${(1000/avg).toFixed(0)} fps · ${avg.toFixed(1)}ms avg · ${_perf.worst.toFixed(1)}ms max · ${_perf.ticks} tick/f · ${ec} bodies`;
    if(state==='play'&&player)txt+='\n'+_bossLine()+'\n'+_statLine();   // boss/stat lines need a live run (player exists, t0 set)
    _perf.el.textContent=txt;                // single write — one reflow, not per-field
    _perf.n=0;_perf.sum=0;_perf.worst=0;}}

let _wasPlaying=null;   // state-change guard: toggle the cursor class only on transition, not every frame
function loop(ts){now=ts;
  const playing=state==='play';
  if(playing!==_wasPlaying){document.body.classList.toggle('playing',playing);_wasPlaying=playing;}   // hide cursor only while playing
  if(playing){
    if(!lastTs)lastTs=ts;
    let dt=ts-lastTs;lastTs=ts;
    if(dt>250)dt=250;                                  // tab-stall guard — never simulate a huge jump
    if(slowmo>0){slowmo-=dt;dt*=.35;}                  // boss-death slow-motion (real-time, frame-rate independent)
    acc+=dt;
    let n=0;
    while(acc>=STEP&&n<MAXSUBSTEP&&state==='play'){update();acc-=STEP;n++;}   // update() may flip state (gameOver/levelup) → stop simulating at once
    if(n===MAXSUBSTEP)acc=0;                           // drop unrecoverable backlog
    _perf.ticks=n;
    alpha=acc/STEP;                                    // fractional tick → render interpolation factor
    draw();
  }else{
    lastTs=0;acc=0;                                    // park the clock; resume seamlessly next play frame
    if((state==='levelup'||state==='pause')&&needsDraw){alpha=1;draw();needsDraw=false;}   // static scene: draw once at the settled position
  }
  perfFrame(ts);
  requestAnimationFrame(loop);}
function startGame(){Sound.init();Sound.resume();Music.start();reset();state='play';
  document.getElementById('start').classList.add('hidden');document.getElementById('over').classList.add('hidden');
  document.getElementById('sound').classList.add('show');}
function gameOver(){state='over';Music.die();
  const lh=document.getElementById('lowhp');lh.classList.remove('danger');lh.style.opacity=0;_hud.low=-1;
  if(score>best){best=score;localStorage.setItem('neon_best',best);}
  const elapsed=(now-t0)/1000,m=Math.floor(elapsed/60),s=Math.floor(elapsed%60);
  const run={score,secs:Math.floor(elapsed),wave,difficulty:DIFF.key};
  if(typeof reportRun==='function')reportRun(run);                          // concurrent submit+fetch + dynamic feedback
  else if(typeof submitScore==='function')submitScore(run);                 // fallback: bare submit if engine absent
  document.getElementById('finalscore').textContent=score;
  document.getElementById('finalmeta').textContent=`survived ${m}:${String(s).padStart(2,'0')} · wave ${wave} · Lv ${player.level} · ${DIFF.label}`;
  document.getElementById('hibest').textContent=score>=best?'★ NEW BEST!':'best: '+best;
  document.getElementById('over').classList.remove('hidden');}
function togglePause(){
  if(state==='play'){state='pause';needsDraw=true;Music.stop();pauseStart=performance.now();showPause();}
  else if(state==='pause'){state='play';Music.start();t0+=performance.now()-pauseStart;
    document.getElementById('pause').classList.add('hidden');}}
function showPause(){
  const p=player,elapsed=(now-t0)/1000,m=Math.floor(elapsed/60),s=Math.floor(elapsed%60);
  const dps=elapsed>0?(score/elapsed).toFixed(1):'0';
  const stats=[['⏱ '+m+':'+String(s).padStart(2,'0'),'survived'],[score,'score'],[kills,'kills'],
    [wave,'wave'],['Lv '+p.level,'level'],[Math.ceil(p.hp)+'/'+p.maxhp,'health'],
    [enemies.length,'on screen'],[dps,'score / s'],[(p.lifesteal||p.regen?'on':'—'),'sustain']];
  document.getElementById('pausestats').innerHTML=stats.map(([v,l])=>`<div class="pstat"><b>${v}</b><span>${l}</span></div>`).join('');
  const owned=UPGRADES.filter(u=>Up[u.id]);
  document.getElementById('pausebuild').innerHTML=owned.length
    ?owned.map(u=>`<div class="pchip"><i>${u.ico}</i>${u.name} <b>Lv${Up[u.id]}</b></div>`).join('')
    :`<div class="none">no upgrades yet — collect XP orbs to level up</div>`;
  const cs=[
    ['🗡️ Damage',p.dmg.toFixed(1)],['⚡ Fire rate',(60/p.rate).toFixed(1)+'/s'],
    ['🔱 Projectiles',p.multi],['➶ Pierce',p.pierce],
    ['➹ Bullet spd',p.bulletSpd.toFixed(1)],['🥾 Move spd',p.speed.toFixed(2)],
    ['❤️ Max HP',p.maxhp],['🧲 Magnet',Math.round(p.magnet)],
    ['✚ Regen',p.regen+'/s'],['🩸 Lifesteal',p.lifesteal+'/kill']];
  if(p.missile)cs.push(['🚀 Missiles','Lv '+p.missile]);
  if(p.shield)cs.push(['🛡️ Shield','Lv '+p.shield]);
  if(p.chain)cs.push(['🌩️ Lightning','Lv '+p.chain]);
  document.getElementById('pausecombat').innerHTML=cs.map(([k,v])=>`<div class="pchip">${k} <b>${v}</b></div>`).join('');
  document.getElementById('quitconfirm').classList.remove('show');   // always start collapsed
  document.getElementById('pause').classList.remove('hidden');
}

const DHINT={easy:'Relaxed — slower spawns and weaker enemies. Good for learning the ropes.',normal:'Balanced pace and pressure. Recommended for your first real run.',hard:'Brutal — dense swarms, tanky enemies and heavy hits. For veterans.'};
document.querySelectorAll('.diff').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.diff').forEach(z=>z.classList.remove('on'));b.classList.add('on');
  DIFF=DIFFS[b.dataset.d];document.getElementById('diffhint').textContent=DHINT[b.dataset.d];});
/* ===== main-menu content: pickups, weapons, persistent high scores ===== */
const PICKUP_INFO=[
  {ico:'❤️',name:'Heal',desc:'Instantly restores 25 HP. Grab it when you\'re hurt.'},
  {ico:'💣',name:'Nuke',desc:'Detonates the whole screen — clears a swarm in a pinch.'},
  {ico:'🧲',name:'XP Rush',desc:'Pulls in every XP orb on the map for an instant level-up.'},
  {ico:'🔥',name:'Overdrive',desc:'9 seconds of double fire-rate and +60% damage. Go aggressive.'},
];
const WEAPON_INFO=[
  {ico:'🚀',name:'Homing Missiles',desc:'Auto-launches a seeking missile that explodes for area damage.'},
  {ico:'🛡️',name:'Orbiting Shield',desc:'Orbs spin around you, destroying anything they touch — strong defense.'},
  {ico:'🌩️',name:'Chain Lightning',desc:'A bolt that leaps between nearby enemies, hitting several at once.'},
];
function legendHTML(list){return list.map(o=>
  `<div class="legrow"><span class="lico">${o.ico}</span><div class="ltext"><b>${o.name}</b><span>${o.desc}</span></div></div>`).join('');}
function renderLegends(){
  document.getElementById('pickupsLegend').innerHTML=legendHTML(PICKUP_INFO);
  document.getElementById('weaponsLegend').innerHTML=legendHTML(WEAPON_INFO);}
function fmtTime(sec){const m=Math.floor(sec/60),s=sec%60;return m+':'+String(s).padStart(2,'0');}
/* ===== global leaderboard (Supabase via net.js) — tabbed by difficulty, top 10 each ===== */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let _gdiff='normal',_gcache={};       // _gcache: diff → rows|null (per-menu-open cache)
function renderGlobalRows(rows){
  const el=document.getElementById('global');if(!el)return;
  if(rows===null){el.innerHTML='<div class="empty">Global board offline.<br>Scores still save on this device.</div>';return;}
  if(!rows.length){el.innerHTML='<div class="empty">No runs yet.<br>Be the first!</div>';return;}
  el.innerHTML=rows.map((r,i)=>
    `<div class="lbrow"><span class="rank">${i+1}</span><span class="sc">${r.score}</span><span class="meta">${esc(r.username||'—')} · ${fmtTime(r.secs)}</span></div>`).join('');}
function renderGlobal(diff){_gdiff=diff;
  if(_gcache[diff]!==undefined){renderGlobalRows(_gcache[diff]);return;}
  const el=document.getElementById('global');if(el)el.innerHTML='<div class="empty">Loading…</div>';
  if(typeof fetchTop!=='function'){renderGlobalRows(null);return;}
  // only cache successful results — never cache null, so an early (pre-SDK) or failed fetch retries next time
  fetchTop(diff).then(rows=>{if(rows!==null)_gcache[diff]=rows;if(_gdiff===diff)renderGlobalRows(rows);});}
function onSupabaseReady(){_gcache={};renderGlobal(_gdiff);}   // net.js calls this once the SDK connects → refresh the visible tab
document.querySelectorAll('#gtabs .gtab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#gtabs .gtab').forEach(z=>z.classList.remove('on'));b.classList.add('on');
  renderGlobal(b.dataset.d);});
function syncGlobalTab(diff){document.querySelectorAll('#gtabs .gtab').forEach(z=>z.classList.toggle('on',z.dataset.d===diff));}

/* ===== first-run username onboarding (gates the menu; identity persists via net.js) ===== */
function sanitizeName(s){return String(s||"").replace(/[\u0000-\u001f]/g,"").replace(/\s+/g," ").trim().slice(0,16);}
function showUsername(edit){const m=document.getElementById('username');if(!m)return;
  const inp=document.getElementById('uname'),err=document.getElementById('unameerr');
  if(err)err.textContent='';
  if(inp){const p=(typeof getPlayer==='function')&&getPlayer();inp.value=edit&&p?p.name:'';}
  m.classList.remove('hidden');if(inp)try{inp.focus();}catch(e){}}
function confirmUsername(){
  const inp=document.getElementById('uname'),err=document.getElementById('unameerr');
  const n=sanitizeName(inp&&inp.value);
  if(n.length<3){if(err)err.textContent='Please use at least 3 characters.';return;}
  if(typeof savePlayer==='function')savePlayer(n);
  document.getElementById('username').classList.add('hidden');
  document.getElementById('start').classList.remove('hidden');}
function bootMenu(){   // first run → name modal before the menu; returning players go straight in
  if(typeof getPlayer==='function'&&!getPlayer()){
    document.getElementById('start').classList.add('hidden');showUsername(false);}}

function showMenu(){
  document.getElementById('over').classList.add('hidden');
  document.getElementById('pause').classList.add('hidden');
  document.getElementById('sound').classList.remove('show');
  document.getElementById('start').classList.remove('hidden');
  _gdiff=(typeof DIFF!=='undefined'&&DIFF.key)||'normal';   // open on the difficulty you just played
  syncGlobalTab(_gdiff);_gcache={};renderGlobal(_gdiff);}   // clear cache → fresh fetch each menu open
function quitToMenu(){            // abandon the current run — all progress lost
  state='start';Music.stop();
  const lh=document.getElementById('lowhp');lh.classList.remove('danger');lh.style.opacity=0;_hud.low=-1;
  document.getElementById('quitconfirm').classList.remove('show');
  showMenu();}

document.getElementById('startbtn').onclick=startGame;
document.getElementById('againbtn').onclick=startGame;
document.getElementById('resumebtn').onclick=()=>{if(state==='pause')togglePause();};
document.getElementById('quitbtn').onclick=()=>document.getElementById('quitconfirm').classList.add('show');
document.getElementById('quitno').onclick=()=>document.getElementById('quitconfirm').classList.remove('show');
document.getElementById('quityes').onclick=quitToMenu;
document.getElementById('tomenu').onclick=showMenu;
const _unameok=document.getElementById('unameok');if(_unameok)_unameok.onclick=confirmUsername;
const _unameInput=document.getElementById('uname');if(_unameInput)_unameInput.addEventListener('keydown',e=>{if(e.key==='Enter')confirmUsername();});
const _editname=document.getElementById('editname');if(_editname)_editname.onclick=()=>showUsername(true);
renderLegends();
renderGlobal(_gdiff);   // prime the global board (resolves to offline/empty when unconfigured)
bootMenu();             // first-run players get the username modal before the menu
generateNebula();   // build the deep-space background tile once at startup
requestAnimationFrame(loop);
