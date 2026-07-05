/* NEON SURVIVOR — reward-map.js : pure-DATA reward catalog (no logic).
 * Classic global. Loads BEFORE reward-granting-engine.js (which reads REWARD_MAP/TRAIL_COL) — split out
 * so the engine stays under the 28 KB silent-truncation threshold, same data-file pattern as config.js/
 * config-sim.js. Headless-safe: two const tables, zero DOM/SB/localStorage touches. */

/* achievement id → reward. kind ∈ skin | trail | music | palette. For music, `src` is the audio-orchestrator
 * JUKE key previewed/equipped; for palette, `id` is a Theme.PALETTES key (the unlockable map colour scheme).
 * The 8 gold ids reuse their existing COSMETICS ids byte-for-byte so nothing already granted breaks. MUST stay
 * in lockstep with REWARD_MAP in api/verify.js — verify-achievements.cjs cross-checks the {kind,id,src}
 * projection is identical. title/ico are client-only UI metadata. */
const REWARD_MAP = {
  // ---- combat ----
  first_blood:       { kind:'trail', id:'first_blood_spark',   title:'First Blood Spark',   ico:'🩸' },
  swarm_breaker:     { kind:'trail', id:'swarm_pulse',         title:'Swarm Pulse',         ico:'💢' },
  one_man_army:      { kind:'skin',  id:'legionnaire',         title:'Legionnaire',         ico:'🟧' },
  annihilator:       { kind:'skin',  id:'crimson_husk',        title:'Crimson Husk',        ico:'🟥' },
  // ---- survival ----
  high_scorer:       { kind:'palette', id:'aurora_drift',      title:'Aurora Drift',        ico:'🌌' },
  score_legend:      { kind:'skin',  id:'regent',              title:'Regent',              ico:'🟨' },
  neon_god:          { kind:'trail', id:'neon_god_trail',      title:'Neon God Trail',      ico:'✨' },
  wave_rider:        { kind:'music', id:'midnight_jazz',       title:'Midnight Jazz',       ico:'🎷', src:'jazz',  genre:'Jazz' },
  wave_master:       { kind:'music', id:'maelstrom_waltz',     title:'Maelstrom Waltz',     ico:'🎶', src:'boss1' },
  abyss_walker:      { kind:'skin',  id:'void_warden',         title:'Void Warden',         ico:'🟪' },
  power_surge:       { kind:'trail', id:'surge_arc',           title:'Surge Arc',           ico:'⚡' },
  ascended:          { kind:'palette', id:'violet_void',       title:'Violet Void',         ico:'🔮' },
  veteran:           { kind:'music', id:'neon_pop',            title:'Neon Pop',            ico:'🎤', src:'pop',   genre:'Pop'  },
  hardcore:          { kind:'skin',  id:'cinder_frame',        title:'Cinder Frame',        ico:'🟧' },
  // ---- boss ----
  boss_slayer:       { kind:'palette', id:'crimson_nebula',    title:'Crimson Nebula',      ico:'🟥' },
  warden_hunter:     { kind:'music', id:'requiem_hunt',        title:'Requiem of the Hunt', ico:'🎼', src:'boss0' },
  warden_legend:     { kind:'trail', id:'warden_halo',         title:'Warden Halo',         ico:'💫' },
  // ---- skill ----
  ghost_grid:        { kind:'trail', id:'ghost_streak',        title:'Ghost Streak',        ico:'👻' },
  untouchable:       { kind:'trail', id:'phase_trail',         title:'Phase Trail',         ico:'🌀' },
  flawless_protocol: { kind:'skin',  id:'wardens_bane',        title:'Warden’s Bane',       ico:'🟦' },
  factory_settings:  { kind:'trail', id:'factory_line',        title:'Factory Line',        ico:'🔧' },
  overclocked:       { kind:'music', id:'overclock_toccata',   title:'Overclock Toccata',   ico:'🎹', src:'boss1' },
  second_wind:       { kind:'trail', id:'second_wind_gust',    title:'Second Wind Gust',    ico:'🫀' },
  glass_cannon:      { kind:'skin',  id:'prism_shard',         title:'Prism Shard',         ico:'🔮' },
  weaponsmith:       { kind:'trail', id:'evolver_arc',         title:'Evolver Arc',         ico:'🔩' },
  // ---- speed ----
  power_spike:       { kind:'trail', id:'spike_trail',         title:'Spike Trail',         ico:'📈' },
  ascendant_rush:    { kind:'music', id:'overdrive_rock',      title:'Overdrive',           ico:'🎸', src:'rock',  genre:'Rock' },
  blitz:             { kind:'trail', id:'blitz_streak',        title:'Blitz Streak',        ico:'⏱️' },
  killer_instinct:   { kind:'skin',  id:'predator',            title:'Predator',            ico:'🎯' },
  massacre_clock:    { kind:'music', id:'breakbeat_rap',       title:'Breakbeat',           ico:'🎧', src:'rap',   genre:'Rap'  },
  // ---- challenge ----
  objector:          { kind:'trail', id:'objector_halo',       title:'Objector Halo',       ico:'✋' },
  pacifist_protocol: { kind:'skin',  id:'radiant_aura',        title:'Radiant Aura',        ico:'☀️' },
  minimalist:        { kind:'skin',  id:'monoline',            title:'Monoline',            ico:'➖' },
  ascetic:           { kind:'music', id:'ascetic_nocturne',    title:'Ascetic Nocturne',    ico:'🧘', src:'menu'  },
  bare_bones:        { kind:'music', id:'acoustic_grid',       title:'Acoustic Grid',       ico:'🎵', src:'menu'  },
  // ---- secret ----
  any_percent:       { kind:'trail', id:'any_percent_blip',    title:'Any% Blip',           ico:'🏁' },
  leet:              { kind:'skin',  id:'leet_chrome',         title:'1337 Chrome',         ico:'😎' },
  completionist:     { kind:'skin',  id:'prism_core',          title:'Prism Core',          ico:'🟩' },
};

/* trail reward id → streak colour (client-only — render.js draws the equipped trail behind every bullet in
 * this hue, the Trails gallery shows it as a swatch). Keys are the 13 kind:'trail' reward ids above. */
const TRAIL_COL = {
  first_blood_spark:'#ff3b6b', swarm_pulse:'#ff6b3b', neon_god_trail:'#ffd95e', surge_arc:'#5ec8ff',
  warden_halo:'#b98cff', ghost_streak:'#d6f0ff', phase_trail:'#54e6ff', factory_line:'#9db0ff',
  second_wind_gust:'#54e6b5', spike_trail:'#7cff6b', blitz_streak:'#ffe45e', objector_halo:'#ff9d2e',
  any_percent_blip:'#ffffff', evolver_arc:'#ff5fd0',
};
