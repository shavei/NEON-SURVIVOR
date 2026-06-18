/* NEON SURVIVOR — engine.js
 * Core systems: foundational globals, sprite/sound/music engines, world state,
 * the per-frame simulation (update) and renderer (draw).
 * Loads BEFORE main.js (classic script — shared global scope, declaration-before-use). */

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
const EMETA={grunt:{r:12,col:'#7c8cff',sides:0,rot:0},fast:{r:9,col:'#54e6b5',sides:3,rot:.05},tank:{r:22,col:'#ff5fa2',sides:6,rot:.01},boss:{r:46,col:'#ff3b6b',sides:8,rot:.006}};
function enemySprite(type,white){const k='e'+type+(white?'w':'');if(_spr[k])return _spr[k];
  const m=EMETA[type],pad=12,S=(m.r+pad)*2,c=document.createElement('canvas');c.width=c.height=S;
  const g=c.getContext('2d');g.translate(S/2,S/2);g.shadowBlur=14;g.shadowColor=m.col;g.fillStyle=white?'#fff':m.col;
  if(m.sides===0){g.beginPath();g.arc(0,0,m.r,0,7);g.fill();}
  else{g.beginPath();for(let i=0;i<m.sides;i++){const a=i/m.sides*6.283,x=Math.cos(a)*m.r,y=Math.sin(a)*m.r;i?g.lineTo(x,y):g.moveTo(x,y);}g.closePath();g.fill();}
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

/* ========== HIGH-FIDELITY SYNTHWAVE MUSIC ENGINE ========== */
const Music = {
  playing: false, timer: null, gain: null, filter: null, nextTime: 0, step: 0,
  // Cyberpunk progression (i - VI - VII - v)
  prog: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]],
  bass: [33, 29, 31, 28],

  mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); },

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
    try { if (this.gain) this.gain.disconnect(); if (this.filter) this.filter.disconnect(); } catch (e) {}
    this.gain = null; this.filter = null;
  },

  // Optimized Voice Architecture with custom envelope parameters
  voice(freq, t, dur, type, vol, attack = 0.006, decay = 0.001) {
    const ac = Sound.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);

    o.connect(g);
    g.connect(this.filter); // Route everything through the active visual filter
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
    const intensity = clamp(en / 25, 0, 1);
    const lowhp = (player && state !== 'start') ? clamp(1 - player.hp / player.maxhp, 0, 1) : 0;
    const danger = lowhp > .7;

    // Locked 125 BPM Grid (Steady head-bobbing drive)
    const spb = 0.12;

    // Dynamically adjust master track level and master synth cutoff filter
    this.gain.gain.setTargetAtTime(0.32 + intensity * 0.18, ac.currentTime, 0.4);
    // As swarms increase, the synth filter opens up from muffled (500Hz) to razor-sharp (3200Hz)
    const targetCutoff = danger ? 400 + Math.sin(ac.currentTime * 6) * 100 : 550 + (intensity * 2650);
    this.filter.frequency.setTargetAtTime(targetCutoff, ac.currentTime, 0.3);

    while (this.nextTime < ac.currentTime + 0.12) {
      const s = this.step, t = this.nextTime;
      const chord = s >> 3;           // Changes every 8 steps
      const patternIdx = s % 8;       // Current step in the bar loop
      const set = this.prog[chord];

      // --- 1. DRUM KIT ---
      if (patternIdx === 0 || patternIdx === 4) this.kick(t, 0.34);
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

      this.step = (this.step + 1) % 32;
      this.nextTime += spb;
    }
  }
};

/* ========== STATE ENGINE ========== */
let state='start';
let player,enemies,bullets,orbs,particles,floats,missiles,bolts,items,ebullets;
let nextBoss=60,bossOn=false;
let t0,now,score,wave,spawnTimer,itemTimer,shake,frame,kills,pauseStart=0,pendingLevels=0;
let best=+(localStorage.getItem('neon_best')||0);
const WORLD={w:3200,h:3200};
const cam={x:0,y:0};

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
    missile:0,missileCool:0,shield:0,shieldAng:0,chain:0,chainCool:0};

  enemies=[];bullets=[];orbs=[];particles=[];floats=[];missiles=[];bolts=[];items=[];ebullets=[];
  for(const k in Up)delete Up[k];           // clear upgrade tracker so PLAY AGAIN starts fresh
  score=0;wave=1;spawnTimer=0;itemTimer=900;shake=0;frame=0;kills=0;pendingLevels=0;t0=performance.now();
  nextBoss=60;bossOn=false;

  cam.x=clamp(player.x-W/2,0,Math.max(0,WORLD.w-W));
  cam.y=clamp(player.y-H/2,0,Math.max(0,WORLD.h-H));

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
    fast:{r:9,hp:12,spd:2.25,col:'#54e6b5',dmg:6,xp:1,sc:7},
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
  const hp=(700+tier*420)*DIFF.hp*(1+Math.max(0,elapsed-180)*0.006);
  enemies.push({x,y,r:46,hp,maxhp:hp,spd:.55+tier*0.03,col:'#ff3b6b',
    dmg:32*DIFF.dmg,xp:35,sc:400+tier*100,hit:0,scd:0,cdmg:0,dead:false,
    type:'boss',boss:true,bossT:90,name:'WARDEN '+tier});
  bossOn=true;showToast('💀','BOSS — WARDEN '+tier,'#ff3b6b');
  Sound.boom();shake=Math.min(shake+10,16);
}
function bossAttack(e){
  const tier=Math.max(1,Math.round((now-t0)/1000/60)),n=10+Math.min(10,tier*2);
  const base=Math.atan2(player.y-e.y,player.x-e.x);
  for(let k=0;k<n;k++){const a=base+k/n*6.283;
    ebullets.push({x:e.x,y:e.y,vx:Math.cos(a)*3.3,vy:Math.sin(a)*3.3,r:7,dmg:e.dmg*0.55,life:220});}
  Sound.zap();
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
    bossOn=false;nextBoss=(now-t0)/1000+50;          // next boss 50s after this one falls
    burst(e.x,e.y,'#ff3b6b',60,9);burst(e.x,e.y,'#ffd95e',40,7);
    shake=Math.min(shake+18,24);Sound.boom();flashHit();
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
  if(id==='dmg')p.dmg*=1.36;else if(id==='rate')p.rate=Math.max(6,p.rate*.78);
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

/* ========== TICK LOOP UPDATE ========== */
function update(){
  frame++;const p=player;
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
  spawnTimer--;const interval=Math.max(22,72-elapsed*.42)*DIFF.spawn;
  if(spawnTimer<=0){const c=1+Math.floor(elapsed/70);for(let i=0;i<c;i++)spawnEnemy();spawnTimer=interval;}
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
    e.x+=ux*e.spd;e.y+=uy*e.spd;
    if(e.boss&&--e.bossT<=0){bossAttack(e);e.bossT=Math.max(45,90-Math.floor((now-t0)/1000/60)*8);}
    // per-enemy contact cooldown → a swarm hurts far more than one enemy (density = danger)
    if(p.inv<=0&&e.cdmg<=0){const combR=e.r+p.r;
      if(dp*dp<combR*combR){
        p.hp-=e.dmg;p.inv=7;e.cdmg=26;shake=Math.min(shake+8,14);flashHit();Sound.hurt();
        burst(p.x,p.y,'#ff5fa2',14,5);e.x-=ux*12;e.y-=uy*12;
        if(p.hp<=0){p.hp=0;return gameOver();}}}}

  // Boss projectiles
  for(let i=ebullets.length-1;i>=0;i--){const b=ebullets[i];b.x+=b.vx;b.y+=b.vy;b.life--;
    if(b.life<=0){ebullets.splice(i,1);continue;}
    if(p.inv<=0){const dx=b.x-p.x,dy=b.y-p.y,rr=b.r+p.r;
      if(dx*dx+dy*dy<rr*rr){p.hp-=b.dmg;p.inv=20;shake=Math.min(shake+6,14);flashHit();Sound.hurt();
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

/* ========== DRAW LOOP (Batched Canvas States) ========== */
function draw(){
  ctx.clearRect(0,0,W,H);let sx=0,sy=0;
  if(shake>.3){sx=rand(-shake,shake);sy=rand(-shake,shake);}
  ctx.save();
  ctx.translate(sx, sy); // Screen shake layer stays isolated

  // 1. --- DEEP-SPACE BACKDROP (one stretched image → solid, no tiling seams) ---
  if (NEBULA_CANVAS) ctx.drawImage(NEBULA_CANVAS, 0, 0, W, H);

  // Shift camera vector down for active physics layers (vessels, projectiles, effects)
  ctx.translate(-cam.x, -cam.y);

  // 1b. --- PARALLAX STARFIELD (world-space, culled to viewport) ---
  for(let i=0;i<STAR_FIELD.length;i++){const st=STAR_FIELD[i];
    if(st.x<cam.x||st.x>cam.x+W||st.y<cam.y||st.y>cam.y+H)continue;
    ctx.globalAlpha=st.alpha;ctx.fillStyle=st.col;ctx.fillRect(st.x,st.y,st.r,st.r);}
  ctx.globalAlpha=1;

  // 2. --- STRUCTURAL ARENA ALIGNMENT GRID LINES ---
  ctx.strokeStyle='rgba(124,140,255,.04)'; ctx.lineWidth=1; const g=64;
  const x0=Math.floor(cam.x/g)*g, y0=Math.floor(cam.y/g)*g;
  ctx.beginPath();
  for(let x=x0; x<cam.x+W+g; x+=g){ ctx.moveTo(x,cam.y); ctx.lineTo(x,cam.y+H); }
  for(let y=y0; y<cam.y+H+g; y+=g){ ctx.moveTo(cam.x,y); ctx.lineTo(cam.x+W,y); }
  ctx.stroke();
  ctx.globalAlpha = 1.0;

  // 3. --- SECTOR BORDER SAFETY MATRIX ---
  ctx.strokeStyle='rgba(124,140,255,.35)';ctx.lineWidth=3;ctx.shadowBlur=18;ctx.shadowColor='#7c8cff';
  ctx.strokeRect(0, 0, WORLD.w, WORLD.h); ctx.shadowBlur = 0;

  // 4. Render Orbs (Cached Sprite batching)
  const orbSpr=dotSprite('#54e6b5');
  const oLen=orbs.length;
  for(let i=0;i<oLen;i++){const o=orbs[i];const vr=o.r*2.6;ctx.drawImage(orbSpr,o.x-vr,o.y-vr,vr*2,vr*2);}

  // 5. Item Pickups / Cargo Drops
  const itemLen=items.length;
  ctx.textAlign='center';ctx.textBaseline='middle';
  for(let i=0;i<itemLen;i++){const it=items[i];if(it.life<160&&frame%12<6)continue;
    const yo=Math.sin(frame*.06+it.bob)*4;
    const beam=ctx.createLinearGradient(0,it.y-150,0,it.y+10);
    beam.addColorStop(0,'rgba(0,0,0,0)');beam.addColorStop(1,it.col+'66');
    ctx.fillStyle=beam;ctx.globalAlpha=.5;ctx.fillRect(it.x-12,it.y-150,24,160);ctx.globalAlpha=1;
    ctx.save();ctx.translate(it.x,it.y+yo);
    ctx.shadowBlur=20;ctx.shadowColor=it.col;ctx.strokeStyle=it.col;ctx.lineWidth=2;
    ctx.fillStyle='rgba(255,255,255,.08)';ctx.beginPath();ctx.arc(0,0,it.r,0,7);ctx.fill();ctx.stroke();
    ctx.save();ctx.rotate(frame*.03);ctx.setLineDash([4,6]);ctx.beginPath();ctx.arc(0,0,it.r+7,0,7);ctx.stroke();ctx.restore();
    ctx.setLineDash([]);ctx.shadowBlur=0;
    ctx.font='18px sans-serif';ctx.fillText(it.ico,0,1);
    ctx.font='700 11px Inter,sans-serif';const tw=ctx.measureText(it.label).width+14;
    ctx.fillStyle='rgba(8,9,16,.8)';ctx.strokeStyle=it.col;ctx.lineWidth=1;
    roundRect(-tw/2,it.r+8,tw,17,5);ctx.fill();ctx.stroke();
    ctx.fillStyle=it.col;ctx.fillText(it.label,0,it.r+17);ctx.restore();}
  ctx.textBaseline='alphabetic';

  // 6. Render Projectiles (Plasma Bolts)
  const bSpr=dotSprite('#ffd95e');
  const bLen=bullets.length;
  for(let i=0;i<bLen;i++){const b=bullets[i];const vr=b.r*2.4;ctx.drawImage(bSpr,b.x-vr,b.y-vr,vr*2,vr*2);}

  // 7. Seeker Torpedoes / Missiles
  const mLen=missiles.length;
  for(let i=0;i<mLen;i++){const m=missiles[i];const vr=11;ctx.drawImage(bSpr,m.x-vr,m.y-vr,vr*2,vr*2);
    ctx.save();ctx.translate(m.x,m.y);ctx.rotate(Math.atan2(m.vy,m.vx));ctx.fillStyle='#fff';
    ctx.beginPath();ctx.moveTo(6,0);ctx.lineTo(-4,3);ctx.lineTo(-4,-3);ctx.closePath();ctx.fill();ctx.restore();}

  // 8. EMP Chain Arcs / Lightning
  const boltLen=bolts.length;
  for(let i=0;i<boltLen;i++){const bo=bolts[i];ctx.strokeStyle='rgba(157,176,255,'+clamp(bo.life/9,0,1)+')';ctx.lineWidth=2.4;
    ctx.beginPath();const seg=6;for(let j=0;j<=seg;j++){const tt=j/seg;const x=bo.a.x+(bo.b.x-bo.a.x)*tt+rand(-7,7);
      const y=bo.a.y+(bo.b.y-bo.a.y)*tt+rand(-7,7);j?ctx.lineTo(x,y):ctx.moveTo(bo.a.x,bo.a.y);}ctx.stroke();}

  // 8b. Boss projectiles
  const ebSpr=dotSprite('#ff3b6b');
  for(let i=0;i<ebullets.length;i++){const b=ebullets[i];const vr=b.r*1.7;ctx.drawImage(ebSpr,b.x-vr,b.y-vr,vr*2,vr*2);}

  // 9. Hostile Alien Vessels Swarms
  const eLen=enemies.length;
  for(let i=0;i<eLen;i++){const e=enemies[i];const m=EMETA[e.type],spr=enemySprite(e.type,e.hit>0);
    if(m.rot){ctx.save();ctx.translate(e.x,e.y);ctx.rotate(frame*m.rot);ctx.drawImage(spr,-spr.width/2,-spr.height/2);ctx.restore();}
    else ctx.drawImage(spr,e.x-spr.width/2,e.y-spr.height/2);
    if(e.type==='tank'){ctx.strokeStyle='rgba(255,255,255,.25)';ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(e.x,e.y,e.r+5,-1.57,-1.57+6.28*(e.hp/e.maxhp));ctx.stroke();}}

  // 10. Exhaust Sparks & Explosive Debris Particles
  const pLen=particles.length;
  for(let i=0;i<pLen;i++){const q=particles[i];ctx.globalAlpha=clamp(q.life/30,0,1);ctx.fillStyle=q.col;ctx.beginPath();ctx.arc(q.x,q.y,q.r,0,7);ctx.fill();}
  ctx.globalAlpha=1;

  // 11. Space Interceptor Player Model Rendering
  const p=player,rage=p.rageT>0;ctx.save();ctx.translate(p.x,p.y);
  if(p.inv>0&&frame%6<3)ctx.globalAlpha=.45;
  const near=p.near;
  if(near){const aa=Math.atan2(near.y-p.y,near.x-p.x);let da=aa-p.angle;
    while(da>Math.PI)da-=6.283;while(da<-Math.PI)da+=6.283;p.angle+=da*.2;
    ctx.strokeStyle='rgba(255,217,94,.22)';ctx.lineWidth=1.5;ctx.setLineDash([4,6]);
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(near.x-p.x,near.y-p.y);ctx.stroke();ctx.setLineDash([]);}
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
    for(let k=0;k<orbs;k++){const a=p.shieldAng+k/orbs*6.283;const ox=p.x+Math.cos(a)*rad,oy=p.y+Math.sin(a)*rad;
      ctx.drawImage(ss,ox-vr,oy-vr,vr*2,vr*2);}}

  // 13. Combat Floating Damage Numbers
  ctx.textAlign='center';ctx.font='700 15px Inter,sans-serif';
  const fLen=floats.length;
  for(let i=0;i<fLen;i++){const f=floats[i];ctx.globalAlpha=clamp(f.life/40,0,1);ctx.fillStyle=f.col;ctx.fillText(f.txt,f.x,f.y);}
  ctx.globalAlpha=1;ctx.restore();

  // 14. Off-Screen Cargo/Item Target HUD Nav-Arrows
  const mg=46;
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='13px sans-serif';
  for(let i=0;i<itemLen;i++){const it=items[i];const ix=it.x-cam.x,iy=it.y-cam.y;
    if(ix>=mg&&ix<=W-mg&&iy>=mg&&iy<=H-mg)continue;
    const ex=clamp(ix,mg,W-mg),ey=clamp(iy,mg,H-mg);
    const ang=Math.atan2(iy-H/2,ix-W/2);
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
}
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
