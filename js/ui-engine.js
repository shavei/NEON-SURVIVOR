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
