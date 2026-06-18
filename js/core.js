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
  dashSpd:6.4,dashT:24,slamN:24,slamR:200,slamSpd:2.4};

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
