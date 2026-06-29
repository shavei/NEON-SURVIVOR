/* NEON SURVIVOR — core.js
 * Foundational globals, sprite cache, difficulty table, sound + music engines.
 * Classic script (shared global scope). Load order: core → world → sim → render → main. */

const cv=document.getElementById('game'),ctx=cv.getContext('2d');
let W,H,DPR,VIEW=1;   // VIEW: world→screen zoom (1=desktop 1:1, <1 zooms out on mobile). visible world span = W/VIEW × H/VIEW.
let needsDraw=false;   // request a single static redraw (pause / level-up / resize)

const rand=(a,b)=>a+Math.random()*(b-a);   // COSMETIC randomness (backdrop, particles) — never gates sim state
// Seeded GAMEPLAY randomness (seedRng/srng/srand) + DIFFS/DIFF/BOSS/COOP now live in config-sim.js,
// loaded before this file, so the headless server can take the deterministic config without audio/DOM.

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
// per-type boss sprite — each archetype gets its own colour + polygon (BOSSES[bt]) so the three read apart
// at a glance. Baked once per (type,hit-flash); a dark core ring + white rim sells the heavy "boss" mass.
function bossSprite(bt,white){const b=BOSSES[bt],k='boss'+bt+(white?'w':'');if(_spr[k])return _spr[k];
  const r=46,pad=16,S=(r+pad)*2,c=document.createElement('canvas');c.width=c.height=S;
  const g=c.getContext('2d');g.translate(S/2,S/2);g.shadowBlur=20;g.shadowColor=b.col;g.fillStyle=white?'#fff':b.col;
  g.beginPath();for(let i=0;i<b.sides;i++){const a=i/b.sides*6.283-1.57,x=Math.cos(a)*r,y=Math.sin(a)*r;i?g.lineTo(x,y):g.moveTo(x,y);}g.closePath();g.fill();
  g.shadowBlur=0;g.lineWidth=3;g.strokeStyle='rgba(255,255,255,.5)';g.stroke();
  g.fillStyle='rgba(8,9,16,.55)';g.beginPath();g.arc(0,0,r*.46,0,7);g.fill();           // hollow core → menacing eye
  g.strokeStyle=white?'#fff':b.col;g.lineWidth=2.5;g.stroke();
  return _spr[k]=c;}
// equipped-skin hull palettes (non-rage). Default = the stock orange hull; unknown ids fall back to it,
// so cosmetics added later never break the avatar. rage is a temporary power state → always overrides to gold.
const _SKIN_DEF={c0:'#37223f',c1:'#ff8a5e',shadow:'#d97757',stroke:'#ffd9c2'};
const SKIN_PALETTE={
  crimson_husk:{c0:'#3a0f16',c1:'#ff3b4e',shadow:'#ff3b6b',stroke:'#ffd2d8'},
  void_warden :{c0:'#1d0f3a',c1:'#9a5cff',shadow:'#9a5cff',stroke:'#e6d2ff'},
  legionnaire :{c0:'#3a1c06',c1:'#ff9d3b',shadow:'#ff8a3b',stroke:'#ffe4c2'},
  regent      :{c0:'#3a2f06',c1:'#ffd24a',shadow:'#ffd95e',stroke:'#fff0c2'},
  cinder_frame:{c0:'#2a1010',c1:'#ff6a4a',shadow:'#ff7a5e',stroke:'#ffd2c2'},
  prism_shard :{c0:'#0f2a3a',c1:'#4ad6ff',shadow:'#54e6ff',stroke:'#c2f0ff'},
  predator    :{c0:'#0f3a1c',c1:'#4aff9d',shadow:'#54e6b5',stroke:'#c2ffd9'},
  monoline    :{c0:'#22242c',c1:'#cfd6e6',shadow:'#cfd6e6',stroke:'#ffffff'},
  leet_chrome :{c0:'#1a1c22',c1:'#8ad0ff',shadow:'#9ad0ff',stroke:'#e6f2ff'},
  wardens_bane:{c0:'#0a1840',c1:'#3b82ff',shadow:'#5b9dff',stroke:'#cfe0ff'},   // sapphire — boss-bane
  radiant_aura:{c0:'#3a3212',c1:'#fff2c0',shadow:'#ffe48a',stroke:'#fffdf0'},   // white-gold halo — pacifist
  prism_core  :{c0:'#06322a',c1:'#19e6b0',shadow:'#2cffcf',stroke:'#d2fff2'},   // jade prism — completionist
};
// player hull baked once per (rage,r,skin) — gradient + shadow are expensive; the hull is static
function shipSprite(rage,r,skin){const pal=(!rage&&skin&&SKIN_PALETTE[skin])||_SKIN_DEF;
  const k='s'+(rage?1:0)+'_'+r+'_'+(rage||!SKIN_PALETTE[skin]?'def':skin);if(_spr[k])return _spr[k];
  const pad=22,S=(r+pad)*2;shipSprite._s=S;
  const c=document.createElement('canvas');c.width=c.height=S;const g=c.getContext('2d');
  g.translate(S/2,S/2);g.shadowBlur=18;g.shadowColor=rage?'#ffd95e':pal.shadow;
  const grd=g.createLinearGradient(-r,0,r+4,0);
  grd.addColorStop(0,rage?'#6b3410':pal.c0);grd.addColorStop(1,rage?'#ffd95e':pal.c1);
  g.fillStyle=grd;g.beginPath();
  g.moveTo(r+5,0);g.lineTo(-r+3,r-1);g.lineTo(-r+8,0);g.lineTo(-r+3,-(r-1));g.closePath();g.fill();
  g.strokeStyle=rage?'#fff7d6':pal.stroke;g.lineWidth=1.5;g.stroke();
  return _spr[k]=c;}

/* DIFFICULTY (DIFFS/DIFF), BOSS tunables and COOP scaling now live in config-sim.js (loaded first). */

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

/* ========== PRESENTATION PORT (Fx) ==========
 * The single seam between the SIMULATION (world.js/sim.js) and the CLIENT-only presentation layer
 * (audio + DOM). The sim never names Sound/Music/showToast/flashHit/updateHUD/renderLoadout directly —
 * it calls Fx.*, which forwards to whatever the host wired up. In the browser these resolve to the
 * real engines; under the headless/authoritative-server build (no audio-engine/render/main loaded)
 * every forward typeof-guards to a no-op, so the same world.js/sim.js run server-side untouched.
 * Phase 4: the Node server may also replace Fx wholesale. A/V is cosmetic-only — excluded from the
 * determinism/equiv hashes — so routing through this port changes zero gameplay state. */
const Fx={
  sfx(n,...a){ if(typeof Sound!=='undefined'&&Sound[n])Sound[n](...a); },           // one-shot SFX by name
  music(n,...a){ if(typeof Music!=='undefined'&&Music[n])Music[n](...a); },         // music facade event by name
  toast(...a){ if(typeof showToast==='function')showToast(...a); },                 // map toast (DOM)
  flash(){ if(typeof flashHit==='function')flashHit(); },                           // red hit flash (DOM)
  hud(...a){ if(typeof updateHUD==='function')updateHUD(...a); },                   // HUD repaint (DOM)
  loadout(){ if(typeof renderLoadout==='function')renderLoadout(); },               // weapon pips (DOM)
  levelUp(){ if(typeof openLevelUp==='function')openLevelUp(); },                   // level-up card modal (DOM + offer)
};

