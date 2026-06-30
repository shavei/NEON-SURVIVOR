/* NEON SURVIVOR — world.js
 * World state, nebula/starfield, spawning, combat, pickups, weapons, leveling.
 * Classic script (shared global scope). Load order: core → world → sim → render → main. */

/* ========== STATE ENGINE ========== */
let state='start';
let player,enemies,bullets,orbs,particles,floats,missiles,bolts,items,ebullets;
let nextBoss=60,bossOn=false,_test=false;   // _test: Test Mode (one-hit bosses, manual spawn — key B)
let breatherT=0;   // post-boss "breather": ticks remaining of throttled (0.2×) spawning after a boss falls
let t0,now,score,wave,spawnTimer,itemTimer,shake,frame,kills,pauseStart=0,pendingLevels=0;
let best=+(localStorage.getItem('neon_best')||0);
let _eid=0;   // monotonically rising enemy id (stable handle for each spawned body)
let _oid=0,_iid=0;   // monotonic XP-orb / item ids
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

  // active map palette — swappable via Theme (Showcase → Grids). Built-in default mirrors the original
  // "cosmic nebula" byte-for-byte so a Theme-less load (e.g. the headless equiv harness) is unchanged.
  const _np = (typeof Theme !== 'undefined' && Theme.nebula) ? Theme.nebula()
            : { bgrad:['#070910','#05060d','#020204'], clouds:['255,95,162','84,230,181','124,140,255'], stars:['#fff','#7c8cff','#ffd95e'] };

  // Fill space background depth gradient
  const bgGrad = ctx.createRadialGradient(S/2, S/2, 10, S/2, S/2, S/2 * 1.4);
  bgGrad.addColorStop(0, _np.bgrad[0]);
  bgGrad.addColorStop(0.6, _np.bgrad[1]);
  bgGrad.addColorStop(1, _np.bgrad[2]);
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
    drawCloud(rand(0, S), rand(0, S), rand(130, 240), _np.clouds[0], 0.045);
    drawCloud(rand(0, S), rand(0, S), rand(120, 210), _np.clouds[1], 0.04);
    drawCloud(rand(0, S), rand(0, S), rand(150, 280), _np.clouds[2], 0.05);
  }

  // ambient star cluster
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 520; i++) {
    const x = rand(0, S), y = rand(0, S), r = rand(0.4, 1.3);
    ctx.fillStyle = _np.stars[Math.floor(rand(0, _np.stars.length))];
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
  // active palette's world-space star colours; built-in default keeps a Theme-less load byte-identical
  const _sp = (typeof Theme !== 'undefined' && Theme.stars) ? Theme.stars() : ['#ffffff', '#7c8cff', '#ffd95e', '#ff5fa2'];
  // Generate 250 structural stars across the 3200x3200 cosmic map area
  for (let i = 0; i < 250; i++) {
    STAR_FIELD.push({
      x: rand(0, 3200),
      y: rand(0, 3200),
      r: rand(0.6, 2.2), // Size dictates depth perception
      alpha: rand(0.2, 0.85),
      col: _sp[Math.floor(rand(0, _sp.length))]
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

/* The player is a full sim body of this exact shape. makeAvatar() keeps solo byte-identical (same
 * fields/values the old reset literal produced). */
function makeAvatar(x,y){
  const p={
    x,y,vx:0,vy:0,r:14,angle:0,hp:100,maxhp:100,speed:4.1,accel:.16,
    rate:34,cool:0,dmg:10,multi:1,pierce:0,bulletSpd:7.5,magnet:90,magnetSq:8100,
    xp:0,level:1,next:8,regenRate:0,regenAcc:0,inv:0,lifesteal:0,lsCd:0,near:null,rageT:0,rushT:0,
    missile:0,missileCool:0,shield:0,shieldAng:0,chain:0,chainCool:0,px:x,py:y};
  // base snapshot — single source of base truth for UpgradeRegistry.applyLogic() absolute recalc
  p.base={dmg:p.dmg,rate:p.rate,speed:p.speed,multi:p.multi,pierce:p.pierce,bulletSpd:p.bulletSpd,
    magnet:p.magnet,maxhp:p.maxhp,regenRate:p.regenRate,lifesteal:p.lifesteal,missile:0,shield:0,chain:0};
  return p;
}
/* spawn reference point — enemies/items appear at a ring around the player */
function spawnAnchor(){return player;}

function reset(){
  initStars(); // <--- Builds the space starfield

  player=makeAvatar(WORLD.w/2,WORLD.h/2);
  acc=0;lastTs=0;alpha=0;slowmo=0;   // reset the sim clock for a clean run

  enemies=[];bullets=[];orbs=[];particles=[];floats=[];missiles=[];bolts=[];items=[];ebullets=[];
  for(const k in Up)delete Up[k];           // clear upgrade tracker so PLAY AGAIN starts fresh
  score=0;wave=1;spawnTimer=0;itemTimer=900;shake=0;frame=0;kills=0;pendingLevels=0;t0=performance.now();
  nextBoss=60;bossOn=false;breatherT=0;
  player.evo={};                                   // clear evolved-weapon flags so PLAY AGAIN starts fresh
  if(typeof Nav!=='undefined')Nav.reset();         // drop any pending map from a run that ended mid-beat
  Fx.music('reset');   // clear boss track (real + synth) if last run died mid-fight

  const VW=W/VIEW,VH=H/VIEW;   // visible world span under zoom (== W,H on desktop where VIEW=1)
  cam.x=clamp(player.x-VW/2,0,Math.max(0,WORLD.w-VW));
  cam.y=clamp(player.y-VH*(VIEW<1?0.36:0.5),0,Math.max(0,WORLD.h-VH));   // match sim.js vertical bias so frame 1 doesn't snap
  cam.px=cam.x;cam.py=cam.y;

  Fx.loadout();
}

/* ========== SPAWNING ========== */
// fType/fx/fy: optional overrides (boss SUMMON warps specific drones in at a point); omitted → normal wave spawn.
function spawnEnemy(fType,fx,fy){
  const elapsed=(now-t0)/1000;wave=1+Math.floor(elapsed/24);
  const A=spawnAnchor();   // solo → player (byte-identical); shared-world → centroid of all avatars
  const ang=srand(0,6.283),d=Math.max(W,H)/VIEW*.62+srand(0,160);   // /VIEW keeps spawns off-screen when zoomed out (== *.62 on desktop)
  const x=fx!=null?fx:clamp(A.x+Math.cos(ang)*d,24,WORLD.w-24),y=fy!=null?fy:clamp(A.y+Math.sin(ang)*d,24,WORLD.h-24);
  const roll=srng();let type=fType||'grunt';
  if(!fType){if(elapsed>42&&roll<.12)type='tank';else if(elapsed>24&&roll<.30)type='fast';}
  const base={
    grunt:{r:12,hp:20,spd:1.15,col:'#7c8cff',dmg:8,xp:1,sc:5},
    fast:{r:9,hp:12,spd:2.25,col:'#ff9d2e',dmg:6,xp:1,sc:7},
    tank:{r:22,hp:90,spd:.7,col:'#ff5fa2',dmg:18,xp:4,sc:20},
  }[type];
  const late=Math.max(0,elapsed-180);            // super-linear pressure past 3 min
  const hpScale=(1+elapsed/75+late*late*0.00012)*DIFF.hp;
  const dmg=base.dmg*(1+elapsed/130+late*late*0.00006)*DIFF.dmg;
  enemies.push({id:++_eid,x,y,r:base.r,hp:base.hp*hpScale,maxhp:base.hp*hpScale,
    spd:base.spd*(1+elapsed/300),col:base.col,dmg,xp:base.xp,sc:base.sc,hit:0,scd:0,cdmg:0,dead:false,type});
}
function spawnBoss(){
  const elapsed=(now-t0)/1000,tier=Math.max(1,Math.round(elapsed/60));
  const bt=(tier-1)%BOSSES.length,B=BOSSES[bt];        // archetype rotates each wave: REVENANT → MAELSTROM → OVERSEER → …
  const A=spawnAnchor();
  const ang=srand(0,6.283),d=Math.max(W,H)/VIEW*.62;   // /VIEW keeps boss spawn off-screen when zoomed out
  const x=clamp(A.x+Math.cos(ang)*d,60,WORLD.w-60),y=clamp(A.y+Math.sin(ang)*d,60,WORLD.h-60);
  let hp=(BOSS.hpBase+tier*BOSS.hpTier)*DIFF.hp*B.hpMul*(1+Math.max(0,elapsed-180)*BOSS.hpRamp);
  if(_test)hp=1;                                    // Test Mode: one-hit boss to study patterns fast
  enemies.push({id:++_eid,x,y,r:46,hp,maxhp:hp,spd:(BOSS.speedBase+tier*BOSS.speedTier)*B.spdMul,col:B.col,
    dmg:BOSS.contactDmg*DIFF.dmg,xp:35,sc:400+tier*100,hit:0,scd:0,cdmg:0,dead:false,
    type:'boss',boss:true,bt,seq:B.seq,si:0,bossT:BOSS.cdBase,tele:0,atk:B.seq[0],dashT:0,dvx:0,dvy:0,spin:0,spinA:0,name:B.name+' '+tier});
  bossOn=true;if(typeof Ach!=='undefined')Ach.onBossSpawn(elapsed);   // intent: snapshot damage + clock for flawless/fast-kill
  Fx.toast('💀','BOSS — '+B.name+' '+tier,B.col);
  Fx.sfx('boom');shake=Math.min(shake+10,16);Fx.music('enterBoss',bt);   // bt selects this archetype's epic theme
}
// cooldown till the next telegraph, tightening with tier
function bossCD(){return Math.max(BOSS.cdFloor,BOSS.cdBase-Math.floor((now-t0)/1000/60)*8);}
// advance to the next move in this boss's looping sequence + reset the cadence. Instant attacks call this
// inline; multi-tick ones (dash/spiral) call it when their state expires in the sim.js movement loop.
function bossNext(e){e.si=(e.si+1)%e.seq.length;e.atk=e.seq[e.si];e.bossT=bossCD();}
// fired when the telegraph (e.tele) expires — dispatch by e.atk (id table in config-sim.js BOSS).
function bossAttack(e){
  const tier=Math.max(1,Math.round((now-t0)/1000/60));
  if(e.atk===0){                                   // 0) BURST — aimed radial ring
    const n=10+Math.min(10,tier*2),base=Math.atan2(player.y-e.y,player.x-e.x);
    for(let k=0;k<n;k++){const a=base+k/n*6.283;
      spawnEbullet(e.x,e.y,Math.cos(a)*3.3,Math.sin(a)*3.3,7,e.dmg*BOSS.projDmg,220);}
    Fx.sfx('zap');bossNext(e);
  }else if(e.atk===1){                             // 1) DASH — lunge along a locked vector (ends in sim loop)
    const a=Math.atan2(player.y-e.y,player.x-e.x);
    e.dvx=Math.cos(a)*BOSS.dashSpd;e.dvy=Math.sin(a)*BOSS.dashSpd;e.dashT=BOSS.dashT;
    Fx.sfx('boom');shake=Math.min(shake+7,16);
  }else if(e.atk===2){                             // 2) SLAM — outward shockwave ring to outrun
    const n=BOSS.slamN;for(let k=0;k<n;k++){const a=k/n*6.283;
      spawnEbullet(e.x,e.y,Math.cos(a)*BOSS.slamSpd,Math.sin(a)*BOSS.slamSpd,9,e.dmg*BOSS.projDmg,200);}
    Fx.sfx('boom');shake=Math.min(shake+13,20);bossNext(e);
  }else if(e.atk===3){                             // 3) SPIRAL — root + spray a rotating two-arm storm (ends in sim loop)
    e.spin=BOSS.spiralTicks;e.spinA=Math.atan2(player.y-e.y,player.x-e.x);Fx.sfx('zap');
  }else if(e.atk===4){                             // 4) SPREAD — aimed shotgun cone of fast bolts
    const base=Math.atan2(player.y-e.y,player.x-e.x),n=BOSS.spreadN;
    for(let k=0;k<n;k++){const a=base+(k/(n-1)-.5)*BOSS.spreadArc;
      spawnEbullet(e.x,e.y,Math.cos(a)*BOSS.spreadSpd,Math.sin(a)*BOSS.spreadSpd,7,e.dmg*BOSS.projDmg,200);}
    Fx.sfx('zap');shake=Math.min(shake+5,14);bossNext(e);
  }else if(e.atk===5){                             // 5) SUMMON — a ring of drones warps in around the boss
    const n=BOSS.summonN;for(let k=0;k<n;k++){const a=k/n*6.283;
      spawnEnemy(k%2?'fast':'grunt',e.x+Math.cos(a)*72,e.y+Math.sin(a)*72);}
    Fx.sfx('boom');shake=Math.min(shake+8,16);bossNext(e);
  }else{                                            // 6) BLINK — vanish + reappear at a fresh angle off the player
    burst(e.x,e.y,e.col,18,5);const a=srand(0,6.283);
    e.x=clamp(player.x+Math.cos(a)*BOSS.blinkDist,60,WORLD.w-60);e.y=clamp(player.y+Math.sin(a)*BOSS.blinkDist,60,WORLD.h-60);
    e.px=e.x;e.py=e.y;burst(e.x,e.y,e.col,18,5);Fx.sfx('zap');bossNext(e);   // sync px/py → no lerp smear across the warp
  }
}

/* ========== PROJECTILE OBJECT POOLS ==========
 * Fast-cycling bodies (bullets, boss ebullets, missiles, particles) used to allocate a fresh object literal
 * every spawn and leave the spliced-out one for the GC — at high body counts that churn shows up as GC
 * stutter. Each spawn now reuses a freed object from a free-list and overwrites EVERY field; each despawn
 * returns the object to its list (capped so a one-off swarm can't balloon memory). Snapshot-neutral: the
 * live arrays still hold the same field values in the same order, so verify-equiv stays byte-identical. */
const _POOL={bullets:[],ebullets:[],missiles:[],particles:[]};
const _POOLCAP=2000;
function poolAcquire(k){const f=_POOL[k];return f.length?f.pop():{};}
function poolRelease(k,o){const f=_POOL[k];if(f.length<_POOLCAP)f.push(o);}
// spawn helpers — single place that sets every field a body type uses, then pushes the pooled object
function spawnBullet(x,y,vx,vy,r,dmg,pierce,life){const b=poolAcquire('bullets');
  b.x=b.px=x;b.y=b.py=y;b.sx=x;b.sy=y;b.vx=vx;b.vy=vy;b.r=r;b.dmg=dmg;b.pierce=pierce;b.life=life;
  b.hitIds=b.hitIds||[];b.hitIds.length=0;bullets.push(b);return b;}   // hitIds: enemy ids this bullet already tagged → pierce never re-hits the same enemy (clear on reuse)   // seed px/py so a recycled bullet doesn't streak from its last death pos on frame 1; sx/sy = muzzle origin so the trail can't reach back into the ship
function spawnEbullet(x,y,vx,vy,r,dmg,life){const b=poolAcquire('ebullets');
  b.x=b.px=x;b.y=b.py=y;b.vx=vx;b.vy=vy;b.r=r;b.dmg=dmg;b.life=life;ebullets.push(b);return b;}
function spawnMissile(x,y,vx,vy,spd,turn,r,dmg,target,life){const m=poolAcquire('missiles');
  m.x=m.px=x;m.y=m.py=y;m.vx=vx;m.vy=vy;m.spd=spd;m.turn=turn;m.r=r;m.dmg=dmg;m.target=target;m.life=life;missiles.push(m);return m;}
function spawnParticle(x,y,vx,vy,r,life,col){const q=poolAcquire('particles');
  q.x=x;q.y=y;q.vx=vx;q.vy=vy;q.r=r;q.life=life;q.col=col;particles.push(q);return q;}

/* ========== COMBAT ========== */
function fire(p){p=p||player;   // p defaults to the local avatar → solo calls are byte-identical
  const near=p.near;if(!near)return;
  const baseAng=Math.atan2(near.y-p.y,near.x-p.x);
  const n=p.multi,spread=.16,dmg=p.rageT>0?p.dmg*1.6:p.dmg;
  const rail=p.evo&&p.evo.bullet==='railgun';   // RAILGUN: infinite-pierce, fatter, faster lance
  for(let i=0;i<n;i++){const a=baseAng+(i-(n-1)/2)*spread;
    spawnBullet(p.x,p.y,Math.cos(a)*p.bulletSpd*(rail?1.5:1),Math.sin(a)*p.bulletSpd*(rail?1.5:1),
      rail?6:4,rail?dmg*1.2:dmg,rail?999:p.pierce,rail?90:70);}
  shake=Math.min(shake+1.2,7);
  if(now-lastShootSnd>60){Fx.sfx('shoot');lastShootSnd=now;}
}
function burst(x,y,col,n,sp){n=Math.min(n,340-particles.length);if(n<=0)return;
  for(let i=0;i<n;i++){const a=rand(0,7),s=rand(.5,sp);
  spawnParticle(x,y,Math.cos(a)*s,Math.sin(a)*s,rand(1,3.4),rand(20,40),col);}}
function floatText(x,y,txt,col){floats.push({x,y,txt,col,life:50,vy:-.7});}

function damageEnemy(e,dmg,col){e.hp-=dmg;e.hit=6;if(e.hp<=0)killEnemy(e,col);}
function hitEnemy(e,dmg,col){damageEnemy(e,dmg,col);}
function killEnemy(e,col){
  const i=enemies.indexOf(e);if(i<0)return;e.dead=true;enemies.splice(i,1);
  score+=e.sc;kills++;
  if(e.boss){
    bossOn=false;nextBoss=(now-t0)/1000+50;Fx.music('exitBoss');   // next boss 50s after this one falls; music back to normal track
    breatherT=900;   // 15 s (900 ticks) breather: spawns drop to 0.2× so the arena clears for a beat
    if(typeof Reward!=='undefined')Reward.pulse('#54e6b5');floatText(e.x,e.y-54,'CLEARED','#54e6b5');   // neon CLEARED announcement (banner driven by breatherT in updateHUD)
    if(typeof Ach!=='undefined')Ach.onBossKill((now-t0)/1000);   // achievements: count Wardens + flawless/fast-kill intent
    burst(e.x,e.y,'#ff3b6b',60,9);burst(e.x,e.y,'#ffd95e',40,7);
    shake=Math.min(shake+18,24);Fx.sfx('boom');Fx.flash();slowmo=Math.max(slowmo,340);   // dramatic slow-mo on the kill
    floatText(e.x,e.y-30,'BOSS DOWN  +'+e.sc,'#ffd95e');
    for(let k=0;k<e.xp;k++)orbs.push({id:++_oid,x:e.x+srand(-40,40),y:e.y+srand(-40,40),r:4,xp:1,col:'#54e6b5'});
    const it=ITEMS[Math.floor(srand(0,ITEMS.length))];     // guaranteed reward drop
    items.push({id:++_iid,x:e.x,y:e.y,type:it.id,ico:it.ico,col:it.col,label:it.label,r:16,life:900,bob:rand(0,7)});
    Fx.toast(it.ico,it.label+' (boss drop)',it.col);
    if(typeof Nav!=='undefined')Nav.onBossDown(e.elite);   // boss fell → raise the branching map after the slow-mo beat
    return;
  }
  burst(e.x,e.y,e.col,e.type==='tank'?22:10,e.type==='tank'?5:4);
  floatText(e.x,e.y,'+'+e.sc,e.col);shake=Math.min(shake+(e.type==='tank'?6:1.5),10);Fx.sfx('death');
  const reaper=player.evo&&player.evo.lifesteal==='reaper';   // CRIMSON STORM: lifesteal procs on EVERY kill (no cooldown)
  if(player.lifesteal>0&&(reaper||player.lsCd<=0)&&player.hp<player.maxhp){
    player.hp=Math.min(player.maxhp,player.hp+player.lifesteal);if(!reaper)player.lsCd=6;}   // capped to ~10 HP/s (uncapped when evolved)
  for(let k=0;k<e.xp;k++)orbs.push({id:++_oid,x:e.x+srand(-8,8),y:e.y+srand(-8,8),r:4,xp:1,col:'#54e6b5'});
}

/* ========== PICKUPS ========== */
const ITEMS=[
  {id:'heal',ico:'❤️',col:'#ff5fa2',label:'+25 HP'},
  {id:'bomb',ico:'💣',col:'#ffd95e',label:'NUKE'},
  {id:'magnet',ico:'🧲',col:'#54e6b5',label:'XP RUSH'},
  {id:'rage',ico:'🔥',col:'#d97757',label:'OVERDRIVE'},
];
function spawnItem(){const t=ITEMS[Math.floor(srand(0,ITEMS.length))];
  const ang=srand(0,6.283),d=srand(Math.min(W,H)/VIEW*.35,Math.min(W,H)/VIEW*.35+520);   // /VIEW scales loot ring with zoom (== *.35 on desktop)
  const x=clamp(player.x+Math.cos(ang)*d,90,WORLD.w-90),y=clamp(player.y+Math.sin(ang)*d,90,WORLD.h-90);
  items.push({id:++_iid,x,y,type:t.id,ico:t.ico,col:t.col,label:t.label,r:16,life:900,bob:rand(0,7)});
  Fx.toast(t.ico,t.label,t.col);}
function showToast(ico,label,col){const el=document.getElementById('toast');
  el.style.setProperty('--tc',col);el.style.color=col;
  el.innerHTML=`<span class="tico">${ico}</span><span>${label}<br><small>appeared on the map</small></span>`;
  el.classList.add('show');clearTimeout(showToast._t);showToast._t=setTimeout(()=>el.classList.remove('show'),2600);}
function pickItem(it){const p=player;burst(it.x,it.y,it.col,16,4);
  if(typeof Ach!=='undefined')Ach.onPickup(wave);   // intent: ascetic (zero-pickup) tracking
  if(it.type==='heal'){p.hp=Math.min(p.maxhp,p.hp+25);floatText(p.x,p.y-22,'+25 HP','#ff5fa2');Fx.sfx('tone',440,900,.25,'sine',.09);}
  else if(it.type==='bomb'){for(let i=enemies.length-1;i>=0;i--)hitEnemy(enemies[i],150,'#ffd95e');
    shake=Math.min(shake+18,22);Fx.sfx('boom');burst(p.x,p.y,'#ffd95e',46,9);Fx.flash();floatText(p.x,p.y-22,'NUKE!','#ffd95e');}
  else if(it.type==='magnet'){p.rushT=600;   // 10s of 2x XP + tractor every orb (current and future) for the whole window; magnet stat untouched (handled in sim tractor via rushT)
    Fx.sfx('pickup');floatText(p.x,p.y-22,'XP RUSH x2','#54e6b5');}
  else if(it.type==='rage'){p.rageT=540;Fx.sfx('tone',180,680,.35,'sawtooth',.11);floatText(p.x,p.y-22,'OVERDRIVE','#d97757');}
}

/* ========== WEAPON ARCHETYPES ========== */
function fireMissiles(p){p=p||player;
  const count=Math.min(p.missile,5);
  EXCLUDE_SET.clear(); // Reused memory cache
  for(let i=0;i<count;i++){
    let tgt=nearestTo(p,EXCLUDE_SET);
    if(tgt)EXCLUDE_SET.add(tgt);
    const a=srand(0,7);
    spawnMissile(p.x,p.y,Math.cos(a)*3,Math.sin(a)*3,5.2,.18,5,22+p.missile*7,tgt,140);}
  Fx.sfx('tone',380,520,.12,'triangle',.05);
}
function explodeMissile(m){
  const cluster=player.evo&&player.evo.missile==='cluster';   // CLUSTER WARHEADS: wider blast + shrapnel ring
  const rad=cluster?100:72,radSq=rad*rad;burst(m.x,m.y,'#ffd95e',cluster?30:20,cluster?7:5);shake=Math.min(shake+(cluster?7:5),12);Fx.sfx('boom');
  floatText(m.x,m.y,'💥','#ffd95e');
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];const dx=m.x-e.x,dy=m.y-e.y;
    if((dx*dx+dy*dy)<radSq)hitEnemy(e,m.dmg,'#ffd95e');}
  if(cluster)for(let k=0;k<8;k++){const a=k/8*6.283;   // shrapnel bullets carry half the warhead's damage
    spawnBullet(m.x,m.y,Math.cos(a)*6,Math.sin(a)*6,4,m.dmg*.5,1,40);}
}

function castChain(p){p=p||player;
  let cur=nearestTo(p);if(!cur)return;
  const tesla=p.evo&&p.evo.chain==='tesla';   // TESLA WEB: far more jumps + longer arc reach
  const jumps=(2+p.chain)+(tesla?5:0),dmg=16+p.chain*6,reach=tesla?280:190,reachSq=reach*reach;
  CHAIN_SET.clear(); // Reused memory cache
  let fromX=p.x,fromY=p.y;
  for(let j=0;j<jumps;j++){if(!cur)break;CHAIN_SET.add(cur);
    bolts.push({a:{x:fromX,y:fromY},b:{x:cur.x,y:cur.y},life:9});
    hitEnemy(cur,dmg,'#7c8cff');burst(cur.x,cur.y,'#9db0ff',6,3);
    fromX=cur.x;fromY=cur.y;
    let nx=null,ndSq=reachSq;
    for(const e of enemies){
      if(CHAIN_SET.has(e)) continue;
      const dx=fromX-e.x,dy=fromY-e.y;const dSq=dx*dx+dy*dy;
      if(dSq<ndSq){ndSq=dSq;nx=e;}
    }
    cur=nx;}
  Fx.sfx('zap');shake=Math.min(shake+2,8);
}

/* ========== LEVEL MANAGEMENT ========== */
/* UPGRADES registry (id/name/ico/c/weapon + getLabel/applyLogic) lives in js/upgrade-logic.js,
 * loaded before this file. Up{} tracks per-upgrade stack counts (cleared each run by reset()). */
const Up={};
function applyUpgrade(id){const p=player;
  Up[id]=(Up[id]||0)+1;                                 // bump first so the level passed below is current
  UPGRADES.find(u=>u.id===id).applyLogic(p,Up[id]);     // absolute recalc of this upgrade's stat at its level
  Fx.loadout();
  if(typeof Synergy!=='undefined')Synergy.check();   // a pick may complete a weapon evolution (transformToEvolved)
  if(typeof Ach!=='undefined'){const isW=id==='missile'||id==='shield'||id==='chain';   // intent: starter-only / synergy / glass-cannon
    Ach.onUpgrade(id,isW,wave,(p.missile>0)+(p.shield>0)+(p.chain>0));}
}
function renderLoadout(){
  const box=document.getElementById('loadout');box.innerHTML='';
  const evo=player.evo||{};
  const w=[['missile','🚀','Missiles',player.missile],['shield','🛡️','Shield',player.shield],['chain','🌩️','Lightning',player.chain]];
  for(const[id,ic,nm,lv]of w)if(lv>0){const d=document.createElement('div');d.className='wpip';
    const ev=evo[id]?` <b style="color:#ffd95e">⚡EVO</b>`:'';   // evolved weapons read distinct in the loadout
    d.innerHTML=`<i>${ic}</i> ${nm} <b>Lv${lv}</b>${ev}`;box.appendChild(d);}
}
function openLevelUp(){
  state='levelup';needsDraw=true;
  const avail=UPGRADES.filter(u=>!(u.id==='rate'&&player.rate<=6));   // retire maxed Rapid Fire
  const pool=avail.sort(()=>srng()-.5).slice(0,3);   // seedable → all peers are offered the SAME 3 upgrades
  const wrap=document.getElementById('cards');wrap.innerHTML='';
  pool.forEach(u=>{const el=document.createElement('div');el.className='upg';el.style.setProperty('--c',u.c);
    const owned=Up[u.id]||0;
    const evo=(typeof Synergy!=='undefined')?Synergy.previews(u.id):null;   // does this pick complete an evolution?
    const corner=evo?`<div class="evo">⚡ EVOLVES</div>`:u.weapon&&!owned?`<div class="new">NEW</div>`:owned?`<div class="lvl">Lv ${owned+1}</div>`:'';
    const tip=evo?`<p style="color:#ffd95e;margin-top:6px;font-size:.82rem">⚡ Evolves → <b>${evo.name}</b><br><span style="color:#9aa3b2;font-size:.74rem">${evo.desc}</span></p>`:'';
    const label=u.getLabel(owned+1);   // level-aware description for the level this pick would reach
    el.innerHTML=`${corner}<div class="uico">${u.ico}</div><h3>${u.name}</h3><p>${label}</p>${tip}`;
    el.onclick=()=>{applyUpgrade(u.id);document.getElementById('levelup').classList.remove('show');
      state='play';t0+=performance.now()-pauseStart;};
    wrap.appendChild(el);});
  document.getElementById('levelup').classList.add('show');pauseStart=performance.now();
}
function gainXP(n){const p=player;if(p.rushT>0)n*=2;p.xp+=n;const lv0=p.level;
  while(p.xp>=p.next){p.xp-=p.next;p.level++;p.next=Math.floor(p.next*1.32+3);pendingLevels++;}
  if(lv0===1&&p.level>1&&typeof Ach!=='undefined')Ach.onLevelUp(wave);}   // intent: objector (stay level 1) tracking
