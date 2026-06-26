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
  if(p.regenRate>0&&p.hp<p.maxhp){p.regenAcc+=p.regenRate/60;if(p.regenAcc>=1){p.hp=Math.min(p.maxhp,p.hp+1);p.regenAcc-=1;}}

  if(p.rageT>0)p.rageT--;
  if(p.rushT>0)p.rushT--;
  p.cool--;if(p.cool<=0){fire();p.cool=p.rageT>0?p.rate*.5:p.rate;}
  if(p.missile>0){p.missileCool--;if(p.missileCool<=0){fireMissiles();p.missileCool=Math.max(40,150-p.missile*14);}}
  if(p.chain>0){p.chainCool--;if(p.chainCool<=0){castChain();p.chainCool=Math.max(34,120-p.chain*12);}}

  // Shield Collision Matrix Optimization
  if(p.shield>0){p.shieldAng+=.07;const orbs=Math.min(p.shield+1,6),rad=48+p.shield*5,sdmg=10+p.shield*4;
    for(let k=0;k<orbs;k++){const a=p.shieldAng+k/orbs*6.283;const ox=p.x+Math.cos(a)*rad,oy=p.y+Math.sin(a)*rad;
      for(let i=0;i<enemies.length;i++){const e=enemies[i];if(e.scd>0)continue;   // live length: damageEnemy may splice
        const dx=e.x-ox,dy=e.y-oy,distHit=e.r+9;
        if((dx*dx+dy*dy)<(distHit*distHit)){
          hitEnemy(e,sdmg,'#54e6b5');e.scd=16;burst(ox,oy,'#54e6b5',5,3);
          if(now-lastPingSnd>50){Fx.sfx('ping');lastPingSnd=now;}}}}}

  const elapsed=(now-t0)/1000;
  // Enemy spawning — fixed difficulty curve: interval tightens over time, batch size grows with elapsed minutes.
  spawnTimer--;const interval=Math.max(22,72-elapsed*.42)*DIFF.spawn*(bossOn?BOSS.spawnMul:1);
  if(spawnTimer<=0){const c=Math.max(1,Math.round((1+Math.floor(elapsed/70))*(bossOn?BOSS.spawnCountMul:1)));
    for(let i=0;i<c;i++)spawnEnemy();spawnTimer=interval;}
  if(!bossOn&&elapsed>=nextBoss)spawnBoss();   // boss waves (first at 60s)

  // Cargo Pickups Matrix Optimization
  itemTimer--;if(itemTimer<=0){spawnItem();itemTimer=Math.floor(srand(1500,2100));}
  for(let i=items.length-1;i>=0;i--){const it=items[i];
    it.life--;
    if(it.life<=0){items.splice(i,1);continue;}
    const dx=it.x-p.x,dy=it.y-p.y,pRadius=p.r+20;
    if((dx*dx+dy*dy)<(pRadius*pRadius)){pickItem(it);items.splice(i,1);}}

  // Plasma Railgun Bolts Matrix Optimization
  for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];b.x+=b.vx;b.y+=b.vy;b.life--;
    if(b.life<=0||b.x<-20||b.x>WORLD.w+20||b.y<-20||b.y>WORLD.h+20){bullets.splice(i,1);continue;}
    // live length: damageEnemy() may splice an enemy mid-scan (pierce), so don't cache the bound
    for(let j=0;j<enemies.length;j++){const e=enemies[j];
      const dx=b.x-e.x,dy=b.y-e.y,combR=e.r+b.r;
      if((dx*dx+dy*dy)<(combR*combR)){hitEnemy(e,b.dmg,e.col);burst(b.x,b.y,e.col,4,3);
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
      if(--e.dashT<=0)bossNext(e);}                              // dash done → advance sequence
    else if(e.boss&&e.spin>0){                                   // MAELSTROM spiral: rooted, spraying a rotating two-arm storm
      for(let s=0;s<2;s++){const a=e.spinA+s*3.1416;
        ebullets.push({x:e.x,y:e.y,vx:Math.cos(a)*BOSS.spiralSpd,vy:Math.sin(a)*BOSS.spiralSpd,r:7,dmg:e.dmg*BOSS.projDmg,life:200});}
      e.spinA+=BOSS.spiralRot;if(--e.spin<=0)bossNext(e);}        // storm done → advance sequence
    else{e.x+=ux*e.spd;e.y+=uy*e.spd;
      if(e.type==='fast'&&(e.trail=(e.trail|0)+1)%3===0&&particles.length<320)   // amber wake → fast threats read apart from inert teal orbs
        particles.push({x:e.px,y:e.py,vx:-ux*.3,vy:-uy*.3,r:rand(1.4,2.6),life:rand(10,18),col:'#ff9d2e'});
      if(e.boss){if(e.tele>0){if(--e.tele<=0)bossAttack(e);}      // telegraph expired → dispatch attack[e.atk]
        else if(--e.bossT<=0){e.tele=BOSS.teleT;Fx.sfx('ping');}}}   // cadence elapsed → start wind-up telegraph
    // per-enemy contact cooldown → a swarm hurts far more than one enemy (density = danger)
    if(p.inv<=0&&e.cdmg<=0){const combR=(e.boss?e.r*BOSS.hitRMul:e.r)+p.r;
      if(dp*dp<combR*combR){
        p.hp-=e.dmg;p.inv=e.boss?BOSS.invContact:7;e.cdmg=26;shake=Math.min(shake+8,14);Fx.flash();Fx.sfx('hurt');
        if(typeof Ach!=='undefined')Ach.onDamage(wave,Math.max(0,p.hp)/p.maxhp*100);   // intent: no-hit / comeback tracking
        burst(p.x,p.y,'#ff5fa2',14,5);e.x-=ux*12;e.y-=uy*12;
        if(p.hp<=0){p.hp=0;return gameOver();}}}}

  // Boss projectiles
  for(let i=ebullets.length-1;i>=0;i--){const b=ebullets[i];b.x+=b.vx;b.y+=b.vy;b.life--;
    if(b.life<=0){ebullets.splice(i,1);continue;}
    if(p.inv<=0){const dx=b.x-p.x,dy=b.y-p.y,rr=b.r+p.r;
      if(dx*dx+dy*dy<rr*rr){p.hp-=b.dmg;p.inv=BOSS.invProj;shake=Math.min(shake+6,14);Fx.flash();Fx.sfx('hurt');
        if(typeof Ach!=='undefined')Ach.onDamage(wave,Math.max(0,p.hp)/p.maxhp*100);   // intent: no-hit / comeback tracking
        burst(p.x,p.y,'#ff3b6b',10,5);ebullets.splice(i,1);
        if(p.hp<=0){p.hp=0;return gameOver();}}}}

  // Energy Core / XP Orbs Tractor Pull Matrix Optimization — magnet each orb toward the player; collect → XP.
  for(let i=orbs.length-1;i>=0;i--){const o=orbs[i];
    const dx=o.x-p.x,dy=o.y-p.y;const dSq=dx*dx+dy*dy;
    if(o.homing||dSq<p.magnetSq){   // homing orbs (XP Rush pulse) ignore magnet range; range stat itself is never mutated
      const d=Math.sqrt(dSq)||1,pull=o.homing?Math.max(d*.25,6):clamp((p.magnet-d)/p.magnet*6,.6,6);
      o.x-=dx/d*pull;o.y-=dy/d*pull;}   // pull toward player without atan2/cos/sin
    const collectR=p.r+6;
    if(dSq<(collectR*collectR)){orbs.splice(i,1);gainXP(o.xp);
      burst(o.x,o.y,'#54e6b5',5,2.5);Fx.sfx('pickup');}}

  for(let i=particles.length-1;i>=0;i--){const q=particles[i];q.x+=q.vx;q.y+=q.vy;q.vx*=.92;q.vy*=.92;q.life--;if(q.life<=0)particles.splice(i,1);}
  for(let i=floats.length-1;i>=0;i--){const f=floats[i];f.y+=f.vy;f.life--;if(f.life<=0)floats.splice(i,1);}
  for(let i=bolts.length-1;i>=0;i--){if(--bolts[i].life<=0)bolts.splice(i,1);}
  if(shake>0)shake*=.85;
  if(pendingLevels>0&&state==='play'){pendingLevels--;Fx.sfx('level');Fx.levelUp();}
  Fx.hud(elapsed);
}
