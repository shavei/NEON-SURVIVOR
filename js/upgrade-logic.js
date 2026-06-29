/* ========== UPGRADE REGISTRY — level-aware dynamic upgrades ==========
 * Classic script (NOT a module); loads BEFORE world.js. Headless/offline-safe.
 *
 * Each entry owns TWO functions driven by ONE scalar, so the number a player READS and the stat they
 * GET can never drift:
 *   applyLogic(p,level) — ABSOLUTE recalc of the stat from the player's captured base × scalar^level
 *                         (idempotent + order-independent; reproduces the old incremental math exactly).
 *   getLabel(level)     — the dynamic card description for the level a pick would REACH (1-based).
 *
 * Per-pick stack counts live in the global Up{} tracker (world.js); lvl(id) reads it. The player's base
 * stats are snapshotted into p.base by makeAvatar() (world.js) — the single source of base truth.
 */
function lvl(id){ return (typeof Up!=='undefined' && Up[id]) || 0; }   // current stack count of an upgrade
function pct(scalar,l){ return Math.round((Math.pow(scalar,l)-1)*100); }
function _recomputeDmg(p){   // dmg is shared by BOTH 'dmg' (×1.35) and 'velocity' (×1.08) — combine factors
  p.dmg = p.base.dmg * Math.pow(1.35, lvl('dmg')) * Math.pow(1.08, lvl('velocity'));
}

const UPGRADES=[
  { id:'dmg', ico:'🗡️', c:'#ff5fa2', name:'Sharper Rounds',
    applyLogic:(p,l)=>{ _recomputeDmg(p); },
    getLabel:(l)=>`<b class="up">+${pct(1.35,l)}%</b> bullet damage` },
  { id:'rate', ico:'⚡', c:'#ffd95e', name:'Rapid Fire',
    applyLogic:(p,l)=>{ p.rate = Math.max(6, p.base.rate*Math.pow(.78,l)); },
    getLabel:(l)=>`<b class="up">+${pct(1/.78,l)}%</b> fire rate` },
  { id:'multi', ico:'🔱', c:'#7c8cff', name:'Split Shot',
    applyLogic:(p,l)=>{ p.multi = p.base.multi + l; },
    getLabel:(l)=>`Fires <b class="up">${1+l}</b> projectiles per volley` },
  { id:'pierce', ico:'➶', c:'#54e6b5', name:'Piercing',
    applyLogic:(p,l)=>{ p.pierce = p.base.pierce + l; },
    getLabel:(l)=>`Bullets pass through <b class="up">${l}</b> ${l===1?'enemy':'enemies'}` },
  { id:'spd', ico:'🥾', c:'#d97757', name:'Swift Boots',
    applyLogic:(p,l)=>{ p.speed = p.base.speed*Math.pow(1.12,l); },
    getLabel:(l)=>`<b class="up">+${pct(1.12,l)}%</b> move speed` },
  { id:'maxhp', ico:'❤️', c:'#ff5fa2', name:'Vitality',
    applyLogic:(p,l)=>{ p.maxhp = p.base.maxhp + 30*l; p.hp = Math.min(p.maxhp, p.hp+30); },
    getLabel:(l)=>`<b class="up">+${30*l}</b> max HP &amp; heal 30` },
  { id:'magnet', ico:'🧲', c:'#54e6b5', name:'Magnet Core',
    applyLogic:(p,l)=>{ p.magnet = p.base.magnet*Math.pow(1.6,l); p.magnetSq = p.magnet*p.magnet; },
    getLabel:(l)=>`<b class="up">+${pct(1.6,l)}%</b> XP pickup range` },
  { id:'regen', ico:'✚', c:'#ffd95e', name:'Regeneration',
    applyLogic:(p,l)=>{ p.regenRate = p.base.regenRate + l; },
    getLabel:(l)=>`<b class="up">+${l}</b> HP / sec` },
  { id:'lifesteal', ico:'🩸', c:'#ff5fa2', name:'Lifesteal',
    applyLogic:(p,l)=>{ p.lifesteal = p.base.lifesteal + l; },
    getLabel:(l)=>`Heal <b class="up">+${l}</b> HP on every kill` },
  { id:'velocity', ico:'➹', c:'#7c8cff', name:'Hyper Velocity',
    applyLogic:(p,l)=>{ p.bulletSpd = p.base.bulletSpd*Math.pow(1.3,l); _recomputeDmg(p); },
    getLabel:(l)=>`<b class="up">+${pct(1.3,l)}%</b> bullet speed &amp; <b class="up">+${pct(1.08,l)}%</b> damage` },
  { id:'missile', ico:'🚀', c:'#ffd95e', name:'Homing Missiles', weapon:'missile',
    applyLogic:(p,l)=>{ p.missile = p.base.missile + l; },
    getLabel:(l)=>l===1?`Launch a homing missile that seeks &amp; explodes (AoE)`:`Homing missiles <b class="up">Lv ${l}</b> — faster salvos (AoE)` },
  { id:'shield', ico:'🛡️', c:'#54e6b5', name:'Orbiting Shield', weapon:'shield',
    applyLogic:(p,l)=>{ p.shield = p.base.shield + l; },
    getLabel:(l)=>`<b class="up">${Math.min(l+1,6)}</b> guardian orb${l+1===1?'':'s'} circle you, shredding contact` },
  { id:'chain', ico:'🌩️', c:'#7c8cff', name:'Chain Lightning', weapon:'chain',
    applyLogic:(p,l)=>{ p.chain = p.base.chain + l; },
    getLabel:(l)=>l===1?`Periodic bolt that arcs between enemies`:`Chain Lightning <b class="up">Lv ${l}</b> — faster, arcs more` },
];

/* ---- Stat & Description Audit -------------------------------------------------------------------
 * window.debugUpgrade(id, level): replays applyLogic on a FRESH base avatar up to `level` and logs the
 * generated label alongside the resulting stat deltas, so text↔logic sync can be eyeballed/asserted.
 * Pure: uses a throwaway avatar and restores the global Up[id] it touches during the replay. */
function debugUpgrade(id, level){
  const u=UPGRADES.find(x=>x.id===id);
  if(!u){ console.warn('debugUpgrade: no upgrade "'+id+'"'); return null; }
  level=level||1;
  const p=makeAvatar(0,0), before={};
  for(const k in p) if(typeof p[k]==='number') before[k]=p[k];
  const prevUp=(typeof Up!=='undefined')?Up[id]:undefined;
  for(let i=1;i<=level;i++){ if(typeof Up!=='undefined')Up[id]=i; u.applyLogic(p,i); }
  if(typeof Up!=='undefined'){ if(prevUp===undefined)delete Up[id]; else Up[id]=prevUp; }   // restore
  const label=u.getLabel(level);
  const changed=Object.keys(before)
    .filter(k=>Math.abs(p[k]-before[k])>1e-9)
    .map(k=>`${k}: ${before[k]} → ${+p[k].toFixed(4)}`);
  const plain=label.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&');
  if(typeof console!=='undefined')
    console.log(`[upgrade ${id}] Lv${level}\n  label: ${plain}\n  stats: ${changed.join(', ')||'(none)'}`);
  return { id, level, label, plain, changed };
}

if(typeof window!=='undefined'){ window.UPGRADES=UPGRADES; window.debugUpgrade=debugUpgrade; }
