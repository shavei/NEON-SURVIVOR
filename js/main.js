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
  VIEW=(_mqCoarse.matches&&_hasTouch)?0.78:1;                            // zoom out ~28%/axis on real TOUCH devices (finger-play); mouse/narrow-desktop stays 1:1
  DPR=Math.min(IS_MOBILE?1.5:2,devicePixelRatio||1);                    // cap fill-rate on mobile GPUs (1.5 vs retina 2)
  cv.width=W*DPR;cv.height=H*DPR;cv.style.width=W+'px';cv.style.height=H+'px';ctx.setTransform(DPR,0,0,DPR,0,0);needsDraw=true;}
resize();addEventListener('resize',resize);

/* ========== INPUTS ========== */
const keys={};
// Test Mode (one-hit bosses) is gated to specific DEV accounts by Supabase auth id — no personal data in source,
// evaluated LIVE so it picks up the session after async login. window.neonDevId() (dev-tools.js) prints your id.
const DEV_IDS=['e743acde-03d3-404a-b1e2-4fe16843fff8'];   // account ids allowed to toggle Test Mode; empty = nobody. (yosef)
function isDev(){try{const p=typeof getPlayer==='function'&&getPlayer();return !!(p&&p.id&&DEV_IDS.indexOf(p.id)>=0);}catch(e){return false;}}
addEventListener('keydown',e=>{if(e.target&&e.target.tagName==='INPUT')return;   // let text fields (username) type normally
  const k=e.key.toLowerCase();keys[k]=true;
  if(k==='p'&&(state==='play'||state==='pause'))togglePause();
  if(k==='escape'){const qc=document.getElementById('quitconfirm');   // Esc = pause/resume alias; first dismisses an open quit-confirm
    if(qc&&qc.classList.contains('show'))qc.classList.remove('show');
    else if(state==='play'||state==='pause')togglePause();}
  if(k==='m')Sound.toggle();
  if(k==='f3'){e.preventDefault();if(typeof togglePerf!=='undefined')togglePerf();}   // dev FPS benchmark overlay (debug-overlay.js)
  if(k==='b'&&state==='play'&&isDev()){_test=!_test;if(_test&&!bossOn)spawnBoss();}   // Test Mode (dev-account-gated): one-hit bosses (toggle off→on to respawn)
  if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();});
addEventListener('keyup',e=>{if(e.key)keys[e.key.toLowerCase()]=false;});   // guard e.key (undefined on autofill/IME keyups)
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
(()=>{const hb=document.getElementById('haptics');if(hb&&typeof Haptics!=='undefined'){hb.textContent=Haptics.label();hb.onclick=()=>Haptics.toggle();}})();   // vibration toggle: init label + bind tap
const mpauseBtn=document.getElementById('mpause');   // touch pause (P is unreachable on a phone)
if(mpauseBtn)mpauseBtn.onclick=()=>{if(state==='play'||state==='pause')togglePause();};

/* ========== INTERFACE FLOW ========== */
const HUD={score:document.getElementById('score'),wave:document.getElementById('wave'),time:document.getElementById('time'),
  hpfill:document.getElementById('hpfill'),hplabel:document.getElementById('hplabel'),
  xpfill:document.getElementById('xpfill'),lvlnum:document.getElementById('lvlnum'),lowhp:document.getElementById('lowhp'),
  diff:document.getElementById('diff'),cleared:document.getElementById('cleared')};
const _hud={score:-1,wave:-1,time:'',hp:-1,maxhp:-1,xp:-1,next:-1,lvl:-1,low:-1,cleared:false};
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
  // post-boss CLEARED banner: first 15 s of the ramp only — the tail of the 30 s ease-back shouldn't keep it up (toggle only on change)
  const onB=(typeof breatherT!=='undefined')&&breatherT>((typeof BOSS!=='undefined'?BOSS.breatherT:1800)-900);
  if(onB!==_hud.cleared){if(HUD.cleared)HUD.cleared.classList.toggle('show',onB);_hud.cleared=onB;}
}
function flashHit(){const f=document.getElementById('flash');f.style.transition='none';f.style.opacity='.5';
  requestAnimationFrame(()=>{f.style.transition='opacity .4s';f.style.opacity='0';});}
/* DEV DEBUG OVERLAY (F3) lives in js/debug-overlay.js (loaded just before this file) — the loop below
 * feeds _perf.ticks + calls perfFrame; typeof-guarded so harnesses that load main.js alone stay clean. */
let _wasPlaying=null;   // state-change guard: toggle the cursor class only on transition, not every frame
function loop(ts){now=ts;
  const playing=state==='play';
  if(playing!==_wasPlaying){document.body.classList.toggle('playing',playing);_wasPlaying=playing;   // hide cursor only while playing
    if(!playing&&HUD.cleared){HUD.cleared.classList.remove('show');_hud.cleared=false;}}   // drop the CLEARED banner when play pauses/ends
  if(playing){
    if(!lastTs)lastTs=ts;
    let dt=ts-lastTs;lastTs=ts;
    if(dt>250)dt=250;                                  // tab-stall guard — never simulate a huge jump
    if(slowmo>0){slowmo-=dt;dt*=.35;}                  // boss-death slow-motion (real-time, frame-rate independent)
    acc+=dt;
    let n=0;
    while(acc>=STEP&&n<MAXSUBSTEP&&state==='play'){                          // update() may flip state (gameOver/levelup) → stop simulating at once
      update();
      acc-=STEP;n++;}
    if(n===MAXSUBSTEP)acc=0;                           // drop unrecoverable backlog
    if(typeof _perf!=='undefined')_perf.ticks=n;
    alpha=acc/STEP;                                    // fractional sim tick → render interpolation factor
    if(state==='over')drawBackdrop();else draw();      // gameOver() can flip state mid-frame → paint a clean backdrop, never the frozen battlefield
  }else{
    lastTs=0;acc=0;                                    // park the clock; resume seamlessly next play frame
    if((state==='levelup'||state==='pause'||state==='map')&&needsDraw){alpha=1;draw();needsDraw=false;}   // static scene: draw once at the settled position
  }
  if(typeof perfFrame!=='undefined')perfFrame(ts);
  requestAnimationFrame(loop);}
function startGame(){
  Sound.init();Sound.resume();Music.start();reset();state='play';
  HUD.diff.textContent=tr(DIFF.label.toUpperCase());HUD.diff.style.color=DIFF.col;   // show the chosen difficulty in the HUD, tinted to its colour
  if(typeof Ach!=='undefined')Ach.onRunStart();                            // reset run counters + open a server run token
  document.getElementById('start').classList.add('hidden');document.getElementById('over').classList.add('hidden');
  document.getElementById('sound').classList.add('show');
  const hb=document.getElementById('haptics');if(hb)hb.classList.add('show');   // reveal vibration toggle (CSS gates it to mobile)
  const mp=document.getElementById('mpause');if(mp)mp.hidden=false;}   // reveal touch-pause for the run (CSS gates it to mobile)
function playAgain(){startGame();}
function dismissToasts(){const t=document.getElementById('toast');if(t)t.classList.remove('show');   // drop lingering map/boss + achievement toasts so they can't bleed behind the game-over/menu overlay
  if(typeof showToast==='function')clearTimeout(showToast._t);if(typeof AchUI!=='undefined'&&AchUI.dismiss)AchUI.dismiss();}
function gameOver(){state='over';Music.die();
  const lh=document.getElementById('lowhp');lh.classList.remove('danger');lh.style.opacity=0;_hud.low=-1;
  const newBest=score>best;if(newBest){best=score;localStorage.setItem('neon_best',best);}
  const elapsed=(now-t0)/1000,m=Math.floor(elapsed/60),s=Math.floor(elapsed%60);
  const run={score,secs:Math.floor(elapsed),wave,kills,level:player.level,difficulty:DIFF.key};
  if(typeof reportRun==='function')reportRun(run);                          // concurrent submit+fetch + dynamic feedback
  else if(typeof submitScore==='function')submitScore(run);                 // fallback: bare submit if engine absent
  if(typeof Ach!=='undefined'){Ach.reportRun(run);Ach.renderPanel();}        // fold run into achievements (optimistic + server-validated)
  if(typeof Skins!=='undefined')Skins.renderGallery();                        // refresh the Skins panel (new skins may have unlocked)
  if(typeof RewardEngine!=='undefined')RewardEngine.renderTrackGallery();      // refresh the Soundtrack tab (new tracks may have unlocked)
  dismissToasts();   // clear mid-run AND run-end-fired toasts (reportRun above can unlock) so none bleed behind the game-over overlay
  if(typeof renderNetStatus==='function')renderNetStatus();   // show, on the death screen, whether this run reached the global board
  document.getElementById('finalscore').textContent=score;
  document.getElementById('finalmeta').textContent=`${tr('survived')} ${m}:${String(s).padStart(2,'0')} · ${tr('wave')} ${wave} · ${tr('Lv')} ${player.level} · ${tr(DIFF.label)}`;
  document.getElementById('hibest').textContent=newBest?tr('★ NEW BEST!'):tr('best:')+' '+best;
  document.getElementById('over').classList.remove('hidden');}
function syncPauseIcon(){const b=document.getElementById('mpause');if(b)b.textContent=state==='pause'?'▶':'⏸';}
function togglePause(){
  if(state==='play'){state='pause';needsDraw=true;Music.pause();pauseStart=performance.now();showPause();}
  else if(state==='pause'){state='play';Music.resume();t0+=performance.now()-pauseStart;
    document.getElementById('pause').classList.add('hidden');}
  syncPauseIcon();}
function showPause(){
  const p=player,elapsed=(now-t0)/1000,m=Math.floor(elapsed/60),s=Math.floor(elapsed%60);
  const dps=elapsed>0?(score/elapsed).toFixed(1):'0';
  const stats=[['⏱ '+m+':'+String(s).padStart(2,'0'),'survived'],[score,'score'],[kills,'kills'],
    [wave,'wave'],[tr('Lv')+' '+p.level,'level'],[Math.ceil(p.hp)+'/'+p.maxhp,'health'],
    [enemies.length,'on screen'],[dps,'score / s'],[(p.lifesteal||p.regenRate?tr('on'):'—'),'sustain']];
  document.getElementById('pausestats').innerHTML=stats.map(([v,l])=>`<div class="pstat"><b>${v}</b><span>${tr(l)}</span></div>`).join('');
  const owned=UPGRADES.filter(u=>Up[u.id]);
  document.getElementById('pausebuild').innerHTML=owned.length
    ?owned.map(u=>`<div class="pchip"><i>${u.ico}</i>${tr(u.name)} <b>${tr('Lv')}${Up[u.id]}</b></div>`).join('')
    :`<div class="none">${tr('no upgrades yet — collect XP orbs to level up')}</div>`;
  /* merged/evolved weapons: full name + what each does, so the pause screen is the live build reference */
  const evo=p.evo||{};
  const merged=(typeof SYNERGIES!=='undefined'?SYNERGIES:[]).filter(sy=>evo[sy.slot]);
  document.getElementById('pauseevo').innerHTML=merged.length
    ?merged.map(sy=>`<div class="pevorow"><i>${sy.ico}</i> <b>${tr(sy.name)}</b> — <span>${tr(sy.desc)}.</span></div>`).join('')
    :`<div class="none">${tr('none yet — pair the right upgrades to merge a weapon (see 🔀 Weapon merges on the menu)')}</div>`;
  const cs=[
    ['🗡️ Damage',p.dmg.toFixed(1)],['⚡ Fire rate',(60/p.rate).toFixed(1)+tr('/s')],
    ['🔱 Projectiles',p.multi],['➶ Pierce',p.pierce],
    ['➹ Bullet spd',p.bulletSpd.toFixed(1)],['🥾 Move spd',p.speed.toFixed(2)],
    ['❤️ Max HP',p.maxhp],['🧲 Magnet',Math.round(p.magnet)],
    ['✚ Regen',p.regenRate+tr('/s')],['🩸 Lifesteal',p.lifesteal+tr('/kill')]];
  if(p.missile)cs.push(['🚀 Missiles',tr('Lv')+' '+p.missile]);
  if(p.shield)cs.push(['🛡️ Shield',tr('Lv')+' '+p.shield]);
  if(p.chain)cs.push(['🌩️ Lightning',tr('Lv')+' '+p.chain]);
  document.getElementById('pausecombat').innerHTML=cs.map(([k,v])=>`<div class="pchip">${tr(k)} <b>${v}</b></div>`).join('');
  document.getElementById('quitconfirm').classList.remove('show');   // always start collapsed
  document.getElementById('pause').classList.remove('hidden');
}

/* The start-menu REFERENCE panels (pickups/weapons/merges/boss rewards + the difficulty picker) live in
 * js/menu-content.js, and every leaderboard view (the #global menu panel + the death-screen feedback) in
 * js/leaderboard-engine.js — both load before this file, which only calls renderLegends/updDiffHint/
 * renderGlobal/syncGlobalTab from the bootstrap below. Kept out of main.js to hold it under 28 KB. */

/* ===== identity onboarding (gates the menu) — Supabase Auth when online, local name when not =====
 * The "GRID ACCESS" modal: password is the primary login, a 6-digit OTP is the alternate login, and
 * signup sets a password + confirms via an emailed code. 'editname'/'local' cover the local name. */
function sanitizeName(s){return String(s||"").replace(/[\u0000-\u001f]/g,"").replace(/\s+/g," ").trim().slice(0,16);}
/* The Grid Access modal UI (showAuth / confirmUsername) and the AchSync→UI hooks (onAuthResolved /
 * onAuthRequired / onAuthOffline) live in js/auth-uplink.js — which self-wires its own buttons — kept
 * out of main.js so this file stays under the 28 KB truncation line. sanitizeName + bootMenu stay here. */
function bootMenu(){   // auth-gated when online/configured; otherwise legacy local name on first run
  if(typeof AchSync!=='undefined'&&AchSync.enabled()){
    // cover the screen with #boot while the Supabase SDK loads async — otherwise the bare HUD
    // shows through the gap between hiding #start and the auth modal/menu appearing. onAuth* clears it.
    document.getElementById('start').classList.add('hidden');
    document.getElementById('boot').classList.remove('hidden');AchSync.boot();return;}
  if(typeof getPlayer==='function'&&!getPlayer()){
    document.getElementById('start').classList.add('hidden');showAuth('local');}}

function showMenu(){
  document.getElementById('over').classList.add('hidden');
  document.getElementById('pause').classList.add('hidden');
  document.getElementById('sound').classList.remove('show');
  const hb=document.getElementById('haptics');if(hb)hb.classList.remove('show');   // re-stow vibration toggle when leaving the run
  const mp=document.getElementById('mpause');if(mp)mp.hidden=true;   // re-stow touch-pause when leaving the run
  document.getElementById('start').classList.remove('hidden');
  if(typeof drawBackdrop==='function')drawBackdrop();   // wipe any frozen run frame so it can't bleed behind the menu
  dismissToasts();   // and any in-flight toast
  _gdiff=(typeof DIFF!=='undefined'&&DIFF.key)||'normal';   // open on the difficulty you just played
  syncGlobalTab(_gdiff);if(typeof LBSync!=='undefined')LBSync.syncAll();renderGlobal(_gdiff);   // re-warm stale boards; instant if fresh
  if(typeof AchSync!=='undefined'&&AchSync.ready&&AchSync.ready())AchSync.pull();   // re-pull cloud achievements earned on another device (cross-device freshness without a restart)
  if(typeof renderNetStatus==='function')renderNetStatus();   // refresh the ONLINE/OFFLINE badge on the menu
  if(typeof Music!=='undefined')Music.menu();}   // chill menu theme (audio must already be unlocked by a prior gesture)
function quitToMenu(){            // abandon the current run — all progress lost
  state='start';   // showMenu() swaps to the chill menu theme
  const lh=document.getElementById('lowhp');lh.classList.remove('danger');lh.style.opacity=0;_hud.low=-1;
  document.getElementById('quitconfirm').classList.remove('show');
  showMenu();}

document.getElementById('startbtn').onclick=startGame;
document.getElementById('againbtn').onclick=playAgain;
document.getElementById('resumebtn').onclick=()=>{if(state==='pause')togglePause();};
document.getElementById('quitbtn').onclick=()=>document.getElementById('quitconfirm').classList.add('show');
document.getElementById('quitno').onclick=()=>document.getElementById('quitconfirm').classList.remove('show');
document.getElementById('quityes').onclick=quitToMenu;
document.getElementById('tomenu').onclick=showMenu;
/* Grid Access modal buttons (unameok / authotp / authtoggle / editname + input Enter keys) self-wire in
 * js/auth-uplink.js — see that file's _isBrowser block. Kept there so all auth UI lives in one place. */
renderLegends();updDiffHint();
/* live EN⇄HE switch: re-render every dynamically built surface in the new language */
if(typeof I18N!=='undefined')I18N.onChange(()=>{renderLegends();updDiffHint();renderGlobal(_gdiff);
  if(typeof DIFF!=='undefined'&&HUD.diff)HUD.diff.textContent=tr(DIFF.label.toUpperCase());
  const sn=document.getElementById('sound');if(sn&&typeof Sound!=='undefined')sn.textContent=Sound.muted?tr('🔇 muted'):tr('🔊 sound');
  const hb=document.getElementById('haptics');if(hb&&typeof Haptics!=='undefined')hb.textContent=Haptics.label();
  if(typeof Ach!=='undefined')Ach.renderPanel();
  if(typeof Skins!=='undefined')Skins.renderGallery();
  if(typeof RewardEngine!=='undefined')RewardEngine.renderTrackGallery();
  if(typeof renderNetStatus==='function')renderNetStatus();
  if(state==='pause')showPause();});
if(typeof Ach!=='undefined')Ach.renderPanel();   // paint the achievements grid from the local mirror
if(typeof Skins!=='undefined')Skins.renderGallery();   // paint the separate Skins panel from the local mirror
if(typeof RewardEngine!=='undefined')RewardEngine.renderTrackGallery();   // paint the Soundtrack tab from the local mirror

if(typeof LBSync!=='undefined')LBSync.syncAll();   // kick concurrent prefetch of all difficulty boards at startup
syncGlobalTab(_gdiff);   // light the tab that matches the board we're about to show, so the active tab never disagrees with the rows
renderGlobal(_gdiff);   // prime the visible tab (skeleton until rows land; offline/empty when unconfigured)
bootMenu();             // first-run players get the username modal before the menu
// browsers block autoplay until a gesture: on the first interaction, unlock audio + start the menu theme.
// Sound.init/resume stay inside the gesture (autoplay policy); the Music graph build waits one frame so the tap paints first (INP)
addEventListener('pointerdown',function _au(){ if(typeof Sound!=='undefined'){Sound.init();Sound.resume();} requestAnimationFrame(()=>setTimeout(()=>{ if(typeof Music!=='undefined'&&typeof state!=='undefined'&&state==='start')Music.menu(); },0)); },{once:true});
addEventListener('rethemeGrid',function(){needsDraw=true;});   // Total Genre Conversion broadcast → repaint menu chrome next frame (audio already rethemed by GenreOrchestrator)
// Leave the tab (switch app / background) → pause the run and SUSPEND all audio so nothing keeps playing behind you;
// returning re-wakes audio but leaves the game PAUSED (tap to resume). Autoplay-safe: the context was already unlocked.
document.addEventListener('visibilitychange',function(){
  if(document.hidden){ if(typeof state!=='undefined'&&state==='play')togglePause();
    if(typeof Music!=='undefined'&&Music.stopPreview)Music.stopPreview();
    if(typeof Sound!=='undefined'&&Sound.ac&&Sound.ac.state==='running')Sound.ac.suspend(); }
  else if(typeof Sound!=='undefined'&&Sound.resume)Sound.resume(); });
generateNebula();   // build the deep-space background tile once at startup
requestAnimationFrame(loop);
