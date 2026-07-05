/* NEON SURVIVOR — dev-tools.js
 * Console-only diagnostics, loaded last so every game global exists. Kept out of main.js/world.js to stay
 * under the 28 KB silent-truncation threshold. Headless-safe (every call guards the globals it touches).
 *
 *   window.stressTest(1000)  → start a run if needed, spawn N enemies at once, then sample real framerate
 *                              for ~2 s and log fps + live body count. Verifies the projectile pools / hot
 *                              loops hold up under load (pair with the F3 perf overlay for per-tick detail). */
if (typeof window !== 'undefined') window.stressTest = function (count) {
  count = (count | 0) || 1000;
  if (typeof startGame === 'function' && typeof state !== 'undefined' && state !== 'play') startGame();
  if (typeof spawnEnemy !== 'function') { console.warn('[stressTest] game not loaded'); return; }
  for (let i = 0; i < count; i++) spawnEnemy();
  const bodies = function () { return enemies.length + bullets.length + ebullets.length + missiles.length + particles.length; };
  console.log('[stressTest] spawned ' + count + ' enemies (' + bodies() + ' bodies) — sampling FPS for ~2s…');
  if (typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') return;
  let frames = 0; const start = performance.now();
  (function tick() {
    frames++;
    const dt = performance.now() - start;
    if (dt < 2000) { requestAnimationFrame(tick); return; }
    const fps = (frames / dt * 1000);
    console.log('[stressTest] ' + count + ' enemies · ' + fps.toFixed(1) + ' fps over ' + (dt / 1000).toFixed(1) + 's · ' + bodies() + ' bodies live');
  })();
  return 'stressTest(' + count + ') running — see console for the FPS readout in ~2s';
};

/* ===== DEV DEBUG OVERLAY (toggle F3) — perf + live boss state + player stats =====
 * Off by default (zero cost), reads globals only (never mutates sim state, so verify-equiv stays identical).
 * The `_perf` state object lives in main.js (its loop writes _perf.ticks; audio/LBSync gate on _perf.on) —
 * only the overlay rendering lives here. Line 1 perf: fps, avg/worst frame-time, sim ticks-per-frame (proves
 * the accumulator catches up: ~1 at 60 Hz, <1 at 144 Hz), live body count. Lines 2-3 (play only): boss FSM
 * + the upgrade-mutated stats. */
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

/* ----- DEV verification tool (console) : prove a reward end-to-end -----
 *   debugAchievement('wave_master', 100)             → unlock it + confirm the FULL cycle, then report.
 *   debugAchievement('ghost_grid', 80)               → drive the badge bar to 80% (no unlock) — progress UI.
 *   debugAchievement('wave_master', 100, {live:true})→ also re-pull user_inventory from Supabase and log
 *                                                       whether the reward round-tripped back from the cloud.
 * Confirms each stage of the cycle [earned] → [toast] → [sync] → [showcase] and returns a `cycle` checklist
 * (booleans) + a one-line `summary`, alongside the legacy {unlocked,reward,inMirror,selectable,inventory}
 * fields. Mirror-only + optimistic insert by default — the authoritative server grant only happens through a
 * real online run via /api/verify (or verify-fullcycle.cjs --live), so prod data is safe. */
if (typeof window !== 'undefined') window.debugAchievement = function (id, pct, opts) {
  if (typeof Ach === 'undefined' || typeof AchUI === 'undefined') return 'no Ach/AchUI';
  const d = Ach.CATALOG.find(function (x) { return x.id === id; }); if (!d) return 'unknown achievement: ' + id;
  if (pct == null) pct = 100;
  const frac = Math.max(0, Math.min(1, pct / 100));
  AchUI.mock(id, frac);                            // <100 → bar only; ==100 → mockGrant → _notify → onUnlock hook
  if (frac < 1) return { id: id, progress: Math.round(frac * 100) + '%', unlocked: false, cycle: { earned: false } };

  // ---- full-cycle proof: [earned] → [toast] → [sync] → [showcase] ----
  const r = RewardEngine.rewardFor(id), s = Ach._load();
  const earned = Ach.isUnlocked(id);               // STAGE 1 — local mirror flipped (mockGrant)
  const toast = !!(AchUI && AchUI.unlockToast);     // STAGE 2 — unlock + reward toast fired (mockGrant→_notify→onUnlock)
  const inMirror = r ? ((r.kind === 'music' ? (s.tracks || []) : (s.cosmetics || [])).indexOf(r.id) >= 0) : false;
  let pid = null; try { pid = (typeof getPlayer === 'function') && getPlayer() && getPlayer().id; } catch (e) {}
  const online = !RewardEngine._invOff && typeof SB !== 'undefined' && !!SB && !!pid;   // STAGE 3 — cloud reachable
  const inventory = online ? 'insert-sent' : 'mirror-only(offline/no-table)';

  let selectable = false;                          // STAGE 4 — pickable in the Showcase
  if (r) {
    if (r.kind === 'music') { RewardEngine.equipMusic(r.id); selectable = RewardEngine.equippedMusic() === r.id; }   // prove it's equippable
    else if (r.kind === 'palette') { RewardEngine.equipPalette(r.id); selectable = RewardEngine.equippedPalette() === r.id; }   // prove the grid theme equips
    else if (r.kind === 'skin') selectable = (typeof Skins !== 'undefined' && Skins.owns(r.id));
    else if (r.kind === 'trail') { RewardEngine.equipTrail(r.id); selectable = RewardEngine.equippedTrail() === r.id; }   // prove the trail equips + renders
    else selectable = inMirror;
  }
  if (typeof Skins !== 'undefined' && Skins.renderGallery) Skins.renderGallery();
  RewardEngine.renderTrailGallery();
  RewardEngine.renderTrackGallery();
  RewardEngine.renderGridGallery();

  // opt-in live confirm: re-pull user_inventory from Supabase and assert the reward round-tripped back
  if (opts && opts.live && r && online && RewardEngine.pullInventory) {
    Promise.resolve(RewardEngine.pullInventory()).then(function () {
      const back = (r.kind === 'music' ? (Ach._load().tracks || []) : (Ach._load().cosmetics || [])).indexOf(r.id) >= 0;
      try { console.log('[debugAchievement] live sync round-trip for ' + r.id + ' → ' + (back ? 'CONFIRMED in cloud' : 'NOT FOUND (insert pending/blocked)')); } catch (e) {}
    });
  }

  const cycle = { earned: earned, toast: toast, sync: online, showcase: selectable };
  const mk = function (b) { return b ? '✓' : '✗'; };
  const summary = id + '  ' + mk(earned) + 'earned  ' + mk(toast) + 'toast  ' +
                  (online ? '✓sync' : '·sync[' + inventory + ']') + '  ' + mk(selectable) + 'showcase';
  return { id: id, unlocked: earned, toast: toast, reward: r && { kind: r.kind, id: r.id, title: r.title },
           inMirror: inMirror, selectable: selectable, inventory: inventory, cycle: cycle, summary: summary };
};
