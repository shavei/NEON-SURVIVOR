/* ========== UI ENGINE — screen-space HUD widgets that live outside the world transform ==========
 * Minimap: absolute world->corner-canvas scatter of player / enemies / boss. Own canvas + ctx,
 * never touches the main game transform stack. Called once at the tail of draw(). */
let _mm=null,_mmctx=null;
const MM_SIZE=160,MM=MM_SIZE/WORLD.w;   // world(3200)->minimap(160) scale; assumes square world

function drawMinimap(){
  if(!_mmctx){const c=document.getElementById('minimap');
    if(!c||typeof c.getContext!=='function')return;_mm=c;_mmctx=c.getContext('2d');}
  const g=_mmctx;if(!g)return;g.clearRect(0,0,MM_SIZE,MM_SIZE);
  // enemy swarm — tiny faded dots (skip boss, drawn larger below)
  g.fillStyle='rgba(124,140,255,.75)';
  for(let i=0;i<enemies.length;i++){const e=enemies[i];if(e.boss)continue;
    g.fillRect(e.x*MM-1,e.y*MM-1,2,2);}
  // boss — pulsing red blip so it reads at a glance
  for(let i=0;i<enemies.length;i++){const e=enemies[i];if(!e.boss)continue;
    const r=4+Math.sin(frame*.1)*1.5;g.fillStyle='#ff3b6b';
    g.beginPath();g.arc(e.x*MM,e.y*MM,r,0,6.283);g.fill();}
  // player — bright cyan dot on top
  g.fillStyle='#54e6ff';g.beginPath();g.arc(player.x*MM,player.y*MM,3,0,6.283);g.fill();
}
