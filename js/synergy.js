/* NEON SURVIVOR — synergy.js
 * SYNERGIES — specific upgrade pairs you can build toward; meeting both thresholds EARNS a weapon
 * evolution. The evolution is never auto-applied: openLevelUp() offers it as an explicit "⚡ EVOLVE"
 * card so taking it is a real choice (take the evolution, or a normal stat upgrade instead). It stays
 * offered until taken. ready() = the next earned-but-untaken evolution; transformToEvolved() applies it.
 * Counts are read from the Up{} tracker (applyUpgrade increments it for EVERY pick). Evolved flags live
 * on player.evo{} (reset() clears it each run); weapon fns (world.js/sim.js) branch on player.evo[slot].
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
  _met(need){ for(const k in need){ if(this._lvl(k)<need[k])return false; } return true; },  // both thresholds met?

  /* the next evolution the player has EARNED but not yet taken — null if none.
     openLevelUp() offers this as an explicit "⚡ EVOLVE" card; it persists across level-ups until taken. */
  ready(){
    if(typeof player==='undefined'||!player)return null;
    player.evo=player.evo||{};
    for(const s of SYNERGIES){
      if(player.evo[s.slot])continue;                                  // slot already evolved → skip
      if(this._met(s.need))return s;                                   // earned, not yet taken → offer it
    }
    return null;
  },

  /* applied only when the player PICKS the EVOLVE card in openLevelUp() */
  transformToEvolved(s){
    player.evo=player.evo||{};
    player.evo[s.slot]=s.id;                                           // weapon fns branch on this flag
    if(typeof Reward!=='undefined')
      Reward.trigger('evolution',{col:s.col,x:player.x,y:player.y,text:s.name,toast:s.name+' — EVOLVED',ico:s.ico});
    if(typeof Fx!=='undefined')Fx.music('stingSynergy');               // evolution → orchestral evolution chord
    if(typeof Fx!=='undefined')Fx.loadout&&Fx.loadout();              // refresh weapon pips (shows evolved name)
    if(typeof Ach!=='undefined'&&Ach.onSynergy)Ach.onSynergy(s.id);   // optional achievements hook (safe if absent)
  },
};
