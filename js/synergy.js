/* NEON SURVIVOR — synergy.js
 * SynergyRegistry — specific upgrade pairings cross a threshold and a weapon TRANSFORMS to an evolved
 * state. Build-planning mastery is the core retention hook, so completing a pair fires the marquee
 * Reward.trigger('evolution') and the level-up card telegraphs "EVOLVES" one pick early.
 * Counts are read from the existing Up{} tracker (applyUpgrade increments it for EVERY pick, weapons
 * included). Evolved flags live on player.evo{} (reset() clears it each run). Behavior branches live
 * in the weapon fns (world.js/sim.js), keyed on player.evo[slot].
 * Classic script (shared global scope). Load AFTER rewards, world. Headless-safe. */

const SYNERGIES=[
  {id:'cluster', slot:'missile',   need:{missile:1,pierce:2},     col:'#ffd95e', ico:'🚀',
   name:'CLUSTER WARHEADS', desc:'missiles fragment into a shrapnel burst on impact'},
  {id:'tesla',   slot:'chain',     need:{chain:1,multi:2},        col:'#7c8cff', ico:'🌩️',
   name:'TESLA WEB',        desc:'lightning forks farther and arcs through far more foes'},
  {id:'aegis',   slot:'shield',    need:{shield:2,spd:2},         col:'#54e6b5', ico:'🛡️',
   name:'AEGIS DRIVE',      desc:'guardian orbs swell, multiply, and knock enemies back'},
  {id:'railgun', slot:'bullet',    need:{velocity:2,pierce:2},    col:'#ff5fa2', ico:'➹',
   name:'RAILGUN',          desc:'shots become a hyper-velocity infinite-pierce lance'},
  {id:'reaper',  slot:'lifesteal', need:{lifesteal:3,rate:2},     col:'#ff3b6b', ico:'🩸',
   name:'CRIMSON STORM',    desc:'lifesteal procs on EVERY kill — the cooldown is gone'},
];

const Synergy={
  _lvl(id){ return (typeof Up!=='undefined'&&Up[id])||0; },           // owned level of an upgrade id
  _met(need, bump){                                                    // are all thresholds met? (bump: +1 to one id for preview)
    for(const k in need){ let n=this._lvl(k); if(bump===k)n++; if(n<need[k])return false; } return true;
  },

  /* called from applyUpgrade() after every pick — evolve any pair that just crossed its threshold */
  check(){
    if(typeof player==='undefined'||!player)return;
    player.evo=player.evo||{};
    for(const s of SYNERGIES){
      if(player.evo[s.slot])continue;                                  // slot already evolved → skip
      if(this._met(s.need))this.transformToEvolved(s);
    }
  },

  transformToEvolved(s){
    player.evo=player.evo||{};
    player.evo[s.slot]=s.id;                                           // weapon fns branch on this flag
    if(typeof Reward!=='undefined')
      Reward.trigger('evolution',{col:s.col,x:player.x,y:player.y,text:s.name,toast:s.name+' — EVOLVED',ico:s.ico});
    if(typeof Fx!=='undefined')Fx.loadout&&Fx.loadout();              // refresh weapon pips (shows evolved name)
    if(typeof Ach!=='undefined'&&Ach.onSynergy)Ach.onSynergy(s.id);   // optional achievements hook (safe if absent)
  },

  /* would picking `id` next COMPLETE a not-yet-earned synergy? → returns the synergy (for the card badge) */
  previews(id){
    if(typeof player==='undefined'||!player)return null;
    const evo=player.evo||{};
    for(const s of SYNERGIES){
      if(evo[s.slot])continue;
      if(!(id in s.need))continue;                                     // this pick doesn't feed the pair
      if(this._met(s.need))continue;                                   // already complete without it (shouldn't happen)
      if(this._met(s.need, id))return s;                               // complete only WITH this pick → telegraph it
    }
    return null;
  },
};
