/* NEON SURVIVOR — map-system.js
 * NodeNavigator (Nav) — the branching "Grid Map". Triggered on each BOSS KILL (a natural triumphant
 * beat, not a forced timer), it pauses the run and offers a 3-node choice: 🛒 Shop · ☠ Elite · 💎 Treasure.
 * Reuses the engine's CLOCK-SAFE pause (t0 += paused time) so spawn/boss scaling is never corrupted.
 * The map is a DOM modal (state==='map'); the loop static-draws it like level-up/pause.
 * Every node payout funnels through Reward.trigger → guaranteed shake + neon pulse.
 * Classic script (shared global scope). Load AFTER rewards/world. Headless-safe. */

const Nav={
  _pending:false,                                                      // a boss just fell → open once the slow-mo beat ends

  reset(){ this._pending=false; },                                     // called from reset() each new run

  /* killEnemy() boss branch calls this. Elites (map-spawned) pass skip=true so they don't re-open a map. */
  onBossDown(skip){ if(!skip)this._pending=true; },

  /* polled at the end of update() — wait out the boss-death slow-mo, THEN raise the map */
  tick(){ if(this._pending&&state==='play'&&(typeof slowmo==='undefined'||slowmo<=0)){this._pending=false;this.open();} },

  /* Three reward choices for clearing a boss. Two are safe, one is a risk/reward gamble — the desc
     spells out exactly what each does so the trade-off is obvious at a glance. */
  NODES:[
    {id:'shop',     ico:'🛒',col:'#ffd95e',name:'FREE UPGRADE', desc:'Safe · pick any one upgrade now — like an extra level-up.'},
    {id:'treasure', ico:'💎',col:'#54e6b5',name:'LOOT DROP',    desc:'Safe · two power-ups (heal / nuke / magnet / overdrive) drop at your feet.'},
    {id:'elite',    ico:'☠',col:'#ff3b6b',name:'ELITE FIGHT',  desc:'Risky · a tough elite pack spawns — kill it for a guaranteed power-up.'},
  ],

  open(){
    if(typeof state==='undefined')return;
    state='map'; if(typeof needsDraw!=='undefined')needsDraw=true;
    if(typeof pauseStart!=='undefined')pauseStart=performance.now();   // freeze the difficulty clock
    if(typeof Reward!=='undefined')Reward.pulse('#7c8cff');            // arrival flourish (no shake — combat just ended)
    if(typeof document==='undefined')return;
    const wrap=document.getElementById('mapcards'); if(!wrap)return;
    wrap.innerHTML='';
    this.NODES.forEach(nd=>{
      const el=document.createElement('div'); el.className='upg'; el.style.setProperty('--c',nd.col);
      el.innerHTML=`<div class="uico">${nd.ico}</div><h3>${nd.name}</h3><p>${nd.desc}</p>`;
      el.onclick=()=>Nav.choose(nd.id);
      wrap.appendChild(el);
    });
    const m=document.getElementById('map'); if(m)m.classList.add('show');
  },

  choose(id){
    if(typeof document!=='undefined'){const m=document.getElementById('map'); if(m)m.classList.remove('show');}
    if(typeof state!=='undefined')state='play';
    if(typeof t0!=='undefined'&&typeof pauseStart!=='undefined')t0+=performance.now()-pauseStart;   // un-freeze clock
    const p=(typeof player!=='undefined')?player:null;
    if(id==='shop'){
      if(typeof pendingLevels!=='undefined')pendingLevels++;            // next tick → openLevelUp() (its own clock-safe pause)
      if(typeof Reward!=='undefined')Reward.trigger('major',{col:'#ffd95e',x:p&&p.x,y:p&&p.y,text:'FREE UPGRADE',ico:'🛒'});
    }else if(id==='elite'){
      this._spawnElites();
      this._drop(p?p.x:0,(p?p.y:0)-30);                                // guaranteed cache for taking the risk
      if(typeof Reward!=='undefined')Reward.trigger('major',{col:'#ff3b6b',x:p&&p.x,y:p&&p.y,text:'ELITE FIGHT',ico:'☠'});
    }else{                                                              // treasure
      if(p){this._drop(p.x-26,p.y);this._drop(p.x+26,p.y);}
      if(typeof Reward!=='undefined')Reward.trigger('major',{col:'#54e6b5',x:p&&p.x,y:p&&p.y,text:'LOOT DROP',ico:'💎'});
    }
  },

  /* reinforced pack: reuse the live spawn curve, then beef the freshest arrivals into elites */
  _spawnElites(){
    if(typeof spawnEnemy!=='function'||typeof enemies==='undefined')return;
    const n=4; for(let i=0;i<n;i++)spawnEnemy();
    for(let i=enemies.length-1,c=0;i>=0&&c<n;i--,c++){const e=enemies[i];
      e.hp*=1.6;e.maxhp*=1.6;e.sc=Math.round(e.sc*2);e.dmg*=1.15;e.r=Math.round(e.r*1.25);e.elite=true;}   // bigger hitbox to match the 1.3× elite sprite
  },

  /* drop a random power-up on the field (same shape spawnItem/killEnemy use) */
  _drop(x,y){
    if(typeof items==='undefined'||typeof ITEMS==='undefined')return;
    const it=ITEMS[Math.floor((typeof srand==='function'?srand(0,ITEMS.length):Math.random()*ITEMS.length))];
    items.push({id:(typeof _iid!=='undefined'?++_iid:Math.random()),x,y,type:it.id,ico:it.ico,col:it.col,label:it.label,r:16,life:900,bob:Math.random()*7});
  },
};
