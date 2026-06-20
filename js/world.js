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
    if(typeof Ach!=='undefined')Ach.onBossKill();              // achievements: count Wardens felled this run
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
