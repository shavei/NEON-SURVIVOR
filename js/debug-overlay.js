/* NEON SURVIVOR — debug-overlay.js : DEV DEBUG OVERLAY (toggle F3) — perf + live boss state + player stats.
 * Classic global. Loads just BEFORE main.js (whose loop feeds _perf.ticks and calls perfFrame each frame;
 * the F3 keybind there calls togglePerf) — split out so main.js stays under the 28 KB truncation threshold.
 * Off by default (zero cost), reads globals only (never mutates sim state, so verify-equiv stays identical).
 * Line 1 perf: fps, avg/worst frame-time, sim ticks-per-frame (proves the accumulator catches up: ~1 at
 *   60 Hz, <1 at 144 Hz), live body count. Lines 2-3 (play only): boss FSM + the upgrade-mutated stats. */
const _perf={on:false,el:null,n:0,sum:0,worst:0,ticks:0,last:0};
const _ATK=['BURST','DASH','SLAM','SPIRAL','SPREAD','SUMMON','BLINK'];   // mirrors e.atk dispatch in world.js (0-6: all 3 archetypes, MAELSTROM uses 3/4, OVERSEER 5/0/6)
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
    +`HP ${Math.ceil(p.hp)}/${p.maxhp} · MAG ${Math.round(p.magnet)} · REGEN ${p.regenRate} · RUSH ${p.rushT} · LS ${p.lifesteal} · MSL ${p.missile} · SHLD ${p.shield} · CHN ${p.chain} · Lv${p.level}`;}
function perfFrame(ts){
  if(!_perf.on)return;
  if(_perf.last){const d=ts-_perf.last;_perf.sum+=d;if(d>_perf.worst)_perf.worst=d;_perf.n++;}
  _perf.last=ts;
  if(_perf.sum>=200){                        // repaint ~5×/s to avoid its own DOM thrash
    const avg=_perf.sum/_perf.n,ec=player?enemies.length+bullets.length+orbs.length+particles.length+missiles.length+ebullets.length:0;   // body arrays are undefined until reset() — guard so F3 on the menu doesn't throw out of the rAF loop
    let txt=`${(1000/avg).toFixed(0)} fps · ${avg.toFixed(1)}ms avg · ${_perf.worst.toFixed(1)}ms max · ${_perf.ticks} tick/f · ${ec} bodies`;
    if(state==='play'&&player)txt+='\n'+_bossLine()+'\n'+_statLine();   // boss/stat lines need a live run (player exists, t0 set)
    _perf.el.textContent=txt;                // single write — one reflow, not per-field
    _perf.n=0;_perf.sum=0;_perf.worst=0;}}
