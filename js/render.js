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
  if (NEBULA_CANVAS) ctx.drawImage(NEBULA_CANVAS, 0, 0, W, H);   // screen-space, drawn BEFORE zoom so it always fills

  // ZOOM: scale the world layer (mobile zoom-out). Backdrop above stays full-screen; HUD after restore stays 1:1.
  ctx.scale(VIEW, VIEW);
  const VW=W/VIEW, VH=H/VIEW;   // visible world span under zoom (== W,H when VIEW=1)
  // Shift camera vector down for active physics layers (vessels, projectiles, effects)
  ctx.translate(-icx, -icy);

  // 1b. --- PARALLAX STARFIELD (world-space, culled to viewport) ---
  for(let i=0;i<STAR_FIELD.length;i++){const st=STAR_FIELD[i];
    if(st.x<icx||st.x>icx+VW||st.y<icy||st.y>icy+VH)continue;
    ctx.globalAlpha=st.alpha;ctx.fillStyle=st.col;ctx.fillRect(st.x,st.y,st.r,st.r);}
  ctx.globalAlpha=1;

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

  // 6. Render Projectiles (Plasma Bolts) — with the optional equipped achievement-reward trail streak
  const bSpr=dotSprite('#ffd95e');
  const bLen=bullets.length;
  const trailCol=(typeof RewardEngine!=='undefined'&&RewardEngine.equippedTrailColor)?RewardEngine.equippedTrailColor():null;
  if(trailCol){ctx.lineCap='round';ctx.shadowColor=trailCol;ctx.shadowBlur=12;
    for(let i=0;i<bLen;i++){const b=bullets[i];const sp=Math.hypot(b.vx,b.vy)||1;
      const bx=ix(b),by=iy(b),tl=Math.min(b.r*7+sp*1.6,Math.hypot(bx-b.sx,by-b.sy));   // clamp streak to distance flown so the tail never reaches back into the ship at the muzzle
      if(tl<1)continue;                                                                  // freshly-fired bolt sits on the player → no streak yet (this blob was flashing the ship)
      const tx=bx-b.vx/sp*tl,ty=by-b.vy/sp*tl;
      const grd=ctx.createLinearGradient(tx,ty,bx,by);grd.addColorStop(0,'transparent');grd.addColorStop(1,trailCol);   // fade from tail → bullet
      ctx.strokeStyle=grd;ctx.lineWidth=b.r*1.7;ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(bx,by);ctx.stroke();}
    ctx.shadowBlur=0;ctx.lineCap='butt';}
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
  for(let i=0;i<eLen;i++){const e=enemies[i];const m=EMETA[e.type],spr=e.boss?bossSprite(e.bt,e.hit>0):enemySprite(e.type,e.hit>0),ex=ix(e),ey=iy(e);
    const es=e.elite?1.3:1;                                              // elites render 30% larger than their base type
    if(m.rot){ctx.save();ctx.translate(ex,ey);ctx.rotate(frame*m.rot);if(es!==1)ctx.scale(es,es);ctx.drawImage(spr,-spr.width/2,-spr.height/2);ctx.restore();}
    else if(es!==1){ctx.save();ctx.translate(ex,ey);ctx.scale(es,es);ctx.drawImage(spr,-spr.width/2,-spr.height/2);ctx.restore();}
    else ctx.drawImage(spr,ex-spr.width/2,ey-spr.height/2);
    if(e.elite&&!e.boss){                                               // ELITE badge: pulsing crimson aura + gold HP ring + gold crown
      const pr=e.r+7+Math.sin(frame*.16)*2.5;
      ctx.strokeStyle='rgba(255,59,107,.9)';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(ex,ey,pr,0,7);ctx.stroke();
      ctx.strokeStyle='rgba(255,217,94,.9)';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(ex,ey,e.r+12,-1.57,-1.57+6.28*(e.hp/e.maxhp));ctx.stroke();
      const cy=ey-e.r-16,cw=9;ctx.fillStyle='#ffd95e';ctx.beginPath();
      ctx.moveTo(ex-cw,cy+6);ctx.lineTo(ex-cw,cy);ctx.lineTo(ex-cw/2,cy+4);ctx.lineTo(ex,cy-3);ctx.lineTo(ex+cw/2,cy+4);ctx.lineTo(ex+cw,cy);ctx.lineTo(ex+cw,cy+6);
      ctx.closePath();ctx.fill();}
    if(e.type==='tank'&&!e.elite){ctx.strokeStyle='rgba(255,255,255,.25)';ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(ex,ey,e.r+5,-1.57,-1.57+6.28*(e.hp/e.maxhp));ctx.stroke();}
    if(e.boss&&e.tele>0){const tl=1-e.tele/BOSS.teleT,a=e.atk;          // attack wind-up telegraph, colour/shape per attack id
      if(a===1){const aa=Math.atan2(player.y-ey,player.x-ex),L=120+tl*170;   // dash: directional lunge line (amber)
        ctx.strokeStyle='rgba(255,157,46,'+(.25+.55*tl)+')';ctx.lineWidth=3+5*tl;
        ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex+Math.cos(aa)*L,ey+Math.sin(aa)*L);ctx.stroke();}
      else if(a===2){const R=e.r+12+tl*(BOSS.slamR-e.r-12);            // slam: growing ground ring (cyan)
        ctx.strokeStyle='rgba(96,224,255,'+(.25+.5*tl)+')';ctx.lineWidth=3+5*tl;
        ctx.beginPath();ctx.arc(ex,ey,R,0,7);ctx.stroke();}
      else if(a===3){ctx.strokeStyle='rgba(56,224,255,'+(.3+.5*tl)+')';ctx.lineWidth=3;   // spiral: two winding-up arms (cyan)
        for(let s=0;s<2;s++){const a0=frame*.2+s*3.1416;ctx.beginPath();ctx.arc(ex,ey,e.r+14+tl*26,a0,a0+1.4);ctx.stroke();}}
      else if(a===4){const aa=Math.atan2(player.y-ey,player.x-ex);     // spread: aimed cone wedge (cyan)
        ctx.strokeStyle='rgba(56,224,255,'+(.25+.5*tl)+')';ctx.lineWidth=2+3*tl;
        for(let s=-1;s<2;s+=2){const ca=aa+s*BOSS.spreadArc*.5;ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex+Math.cos(ca)*150,ey+Math.sin(ca)*150);ctx.stroke();}}
      else if(a===5){ctx.strokeStyle='rgba(177,75,255,'+(.3+.5*tl)+')';ctx.lineWidth=2.5;   // summon: drone warp-in markers (violet)
        for(let k=0;k<BOSS.summonN;k++){const ka=k/BOSS.summonN*6.283;ctx.beginPath();ctx.arc(ex+Math.cos(ka)*72,ey+Math.sin(ka)*72,5+tl*5,0,7);ctx.stroke();}}
      else if(a===6){ctx.strokeStyle='rgba(177,75,255,'+(.3+.5*tl)+')';ctx.lineWidth=3;      // blink: collapsing ring (violet)
        ctx.beginPath();ctx.arc(ex,ey,e.r+30-tl*26,0,7);ctx.stroke();}
      else{ctx.strokeStyle='rgba(255,59,107,'+(.3+.5*tl)+')';ctx.lineWidth=3+4*tl;          // burst: pulsing red ring
        ctx.beginPath();ctx.arc(ex,ey,e.r+10+tl*22,0,7);ctx.stroke();}}
    if(e.boss&&e.dashT>0){ctx.strokeStyle='rgba(255,157,46,.5)';ctx.lineWidth=4;     // dash motion streak
      ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-e.dvx*6,ey-e.dvy*6);ctx.stroke();}
    if(e.boss&&e.spin>0){ctx.strokeStyle='rgba(56,224,255,.6)';ctx.lineWidth=3;      // spiral emitter arms
      for(let s=0;s<2;s++){const a=e.spinA+s*3.1416;ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex+Math.cos(a)*34,ey+Math.sin(a)*34);ctx.stroke();}}}

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
  const sp=Math.hypot(p.vx,p.vy);
  if(sp>.4){const ta=Math.atan2(p.vy,p.vx)+Math.PI;ctx.save();ctx.rotate(ta);
    const fl=9+sp*3+Math.sin(frame*.7)*3;ctx.shadowBlur=16;ctx.shadowColor='#ffb04f';
    const fg=ctx.createLinearGradient(p.r-2,0,p.r-2+fl+6,0);fg.addColorStop(0,'rgba(255,225,120,.95)');fg.addColorStop(1,'rgba(255,90,60,0)');
    ctx.fillStyle=fg;ctx.beginPath();ctx.moveTo(p.r-3,5);ctx.lineTo(p.r-3+fl+6,0);ctx.lineTo(p.r-3,-5);ctx.closePath();ctx.fill();ctx.restore();ctx.shadowBlur=0;}
  ctx.save();ctx.rotate(p.angle);const _ship=shipSprite(rage,p.r,typeof Skins!=='undefined'?Skins.equipped():null);ctx.drawImage(_ship,-_ship.width/2,-_ship.height/2);ctx.restore();
  const pr=3+Math.sin(frame*.15)*1.2;ctx.shadowBlur=14;ctx.shadowColor=rage?'#ffd95e':'#7c8cff';
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,0,pr+2,0,7);ctx.fill();ctx.shadowBlur=0;
  // 11b. Player health ring — palette-locked neon arc hugging the ship (teal→gold→crimson), glows brighter as HP drops + pulses when critical; eyes live on the ship so HP reads instantly
  {const frac=clamp(p.hp/p.maxhp,0,1),lo=frac<.5,t=lo?frac/.5:(frac-.5)/.5,
    c0=lo?[255,59,107]:[255,217,94],c1=lo?[255,217,94]:[84,230,181],   // crimson→gold below half, gold→teal above
    hc='rgb('+(c0[0]+(c1[0]-c0[0])*t|0)+','+(c0[1]+(c1[1]-c0[1])*t|0)+','+(c0[2]+(c1[2]-c0[2])*t|0)+')',
    pulse=frac<.3?.62+.38*Math.abs(Math.sin(frame*.12)):1,hr=p.r+8;
    ctx.globalAlpha=1;ctx.strokeStyle='rgba(124,140,255,.16)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,hr,0,7);ctx.stroke();   // faint blurple track
    ctx.globalAlpha=(.5+.5*(1-frac))*pulse;ctx.strokeStyle=hc;ctx.lineWidth=3;ctx.lineCap='round';ctx.shadowBlur=11;ctx.shadowColor=hc;
    ctx.beginPath();ctx.arc(0,0,hr,-1.5708,-1.5708+6.2832*frac);ctx.stroke();ctx.shadowBlur=0;ctx.lineCap='butt';ctx.globalAlpha=1;}
  ctx.restore();ctx.shadowBlur=0;ctx.globalAlpha=1;

  // 12. Deflector Energy Shield Matrices
  if(p.shield>0){const orbs=Math.min(p.shield+1,6),rad=48+p.shield*5,ss=dotSprite('#4ea8ff'),vr=12;   // cyan/blue — never confused with teal XP orbs
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
  for(let i=0;i<itemLen;i++){const it=items[i];const sxp=(it.x-icx)*VIEW,syp=(it.y-icy)*VIEW;   // world→screen px (zoom-aware)
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
    const bwid=Math.min(560,W*0.7),bx=(W-bwid)/2,by=58,bh=15,bcol=_boss.col||'#ff3b6b';
    ctx.fillStyle='rgba(8,9,16,.82)';ctx.strokeStyle=bcol;ctx.lineWidth=2;
    roundRect(bx,by,bwid,bh,7);ctx.fill();ctx.stroke();
    const bf=clamp(_boss.hp/_boss.maxhp,0,1);
    ctx.fillStyle=bcol;ctx.shadowBlur=12;ctx.shadowColor=bcol;
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
