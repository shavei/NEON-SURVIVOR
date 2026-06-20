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
  if(k==='f4'){e.preventDefault();if(typeof NetDebug!=='undefined')NetDebug.toggle();}   // dev network overlay
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
  if(typeof NetDebug!=='undefined')NetDebug.tick();
  requestAnimationFrame(loop);}
function startGame(){Sound.init();Sound.resume();Music.start();reset();state='play';
  if(typeof Ach!=='undefined')Ach.onRunStart();                            // reset run counters + open a server run token
  document.getElementById('start').classList.add('hidden');document.getElementById('over').classList.add('hidden');
  document.getElementById('sound').classList.add('show');}
function gameOver(){state='over';Music.die();
  const lh=document.getElementById('lowhp');lh.classList.remove('danger');lh.style.opacity=0;_hud.low=-1;
  if(score>best){best=score;localStorage.setItem('neon_best',best);}
  const elapsed=(now-t0)/1000,m=Math.floor(elapsed/60),s=Math.floor(elapsed%60);
  const run={score,secs:Math.floor(elapsed),wave,kills,level:player.level,difficulty:DIFF.key};
  if(typeof reportRun==='function')reportRun(run);                          // concurrent submit+fetch + dynamic feedback
  else if(typeof submitScore==='function')submitScore(run);                 // fallback: bare submit if engine absent
  if(typeof Ach!=='undefined'){Ach.reportRun(run);Ach.renderPanel();}        // fold run into achievements (optimistic + server-validated)
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
if(typeof Ach!=='undefined')Ach.renderPanel();   // paint the achievements grid from the local mirror

/* ===== peaceful multiplayer lobby — Supabase Presence hub (network.js) ===== */
let _lobbyOn=false,_lobbyRaf=0,_lobbyLast=0;
const _lobbyEl=document.getElementById('lobby'),_lobbyCv=document.getElementById('lobbycanvas');
const _lobbyCtx=_lobbyCv&&_lobbyCv.getContext?_lobbyCv.getContext('2d'):null;
let _lme={x:260,y:150,tx:260,ty:150};   // local avatar drifts to where you click/touch the hub
function openLobby(){const e=_lobbyEl;if(!e)return;e.classList.remove('hidden');
  document.getElementById('start').classList.add('hidden');}
function closeLobby(){if(typeof Lobby!=='undefined')Lobby.leave();_lobbyOn=false;
  if(_lobbyRaf)cancelAnimationFrame(_lobbyRaf);_lobbyRaf=0;
  if(_lobbyEl)_lobbyEl.classList.add('hidden');showMenu();}
function joinLobby(){
  const inp=document.getElementById('roomcode'),err=document.getElementById('lobbyerr');
  const room=String((inp&&inp.value)||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12)||'GLOBAL';
  if(typeof Lobby==='undefined'||!Lobby.join(room,{name:(getPlayer()||{}).name||'Player'})){
    if(err)err.textContent='Lobby offline — set Supabase config to play together.';return;}
  if(err)err.textContent='';_lobbyOn=true;_lobbyLast=performance.now();_lobbyRender();}
function _lobbyRender(ts){
  if(!_lobbyOn)return;ts=ts||performance.now();const dt=Math.min(.05,(ts-_lobbyLast)/1000);_lobbyLast=ts;
  _lme.x+=(_lme.tx-_lme.x)*(1-Math.exp(-12*dt));_lme.y+=(_lme.ty-_lme.y)*(1-Math.exp(-12*dt));
  if(typeof Lobby!=='undefined'){Lobby.setLocalState(_lme.x,_lme.y,ts);Lobby.step(dt,Date.now());}
  if(_lobbyCtx){const g=_lobbyCtx,W=_lobbyCv.width,H=_lobbyCv.height;g.clearRect(0,0,W,H);
    g.fillStyle='rgba(84,230,255,.08)';g.fillRect(0,0,W,H);
    if(typeof Lobby!=='undefined')for(const id in Lobby.peers){const p=Lobby.peers[id];
      g.fillStyle=p.color||'#ff5fa2';g.beginPath();g.arc(p.x,p.y,9,0,6.283);g.fill();
      g.fillStyle='#cfe';g.font='11px monospace';g.fillText((p.name||'').slice(0,10),p.x+12,p.y+4);}
    g.fillStyle='#54e6ff';g.beginPath();g.arc(_lme.x,_lme.y,10,0,6.283);g.fill();}
  const r=document.getElementById('lobbyroster');
  if(r&&typeof Lobby!=='undefined')r.textContent='In room '+(Lobby.room||'—')+': '+(Lobby.count()+1)+' player(s)';
  _lobbyRaf=requestAnimationFrame(_lobbyRender);}
if(_lobbyCv)_lobbyCv.addEventListener('pointerdown',e=>{const b=_lobbyCv.getBoundingClientRect();
  _lme.tx=(e.clientX-b.left)*(_lobbyCv.width/b.width);_lme.ty=(e.clientY-b.top)*(_lobbyCv.height/b.height);});
const _lobbyBtn=document.getElementById('lobbybtn');if(_lobbyBtn)_lobbyBtn.onclick=openLobby;
const _lobbyJoin=document.getElementById('lobbyjoin');if(_lobbyJoin)_lobbyJoin.onclick=joinLobby;
const _lobbyLeave=document.getElementById('lobbyleave');if(_lobbyLeave)_lobbyLeave.onclick=closeLobby;

renderGlobal(_gdiff);   // prime the global board (resolves to offline/empty when unconfigured)
bootMenu();             // first-run players get the username modal before the menu
generateNebula();   // build the deep-space background tile once at startup
requestAnimationFrame(loop);
