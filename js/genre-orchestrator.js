/* ========== TOTAL GENRE CONVERSION — GenreOrchestrator (the audio 'Director') ==========
 * Classic global. Loads AFTER audio-orchestrator.js (merges boss JUKE/bed data into Orchestra) and
 * reward-map.js, BEFORE reward-granting-engine.js (whose equipMusic fires rethemeGrid). All lookups are
 * runtime + typeof-guarded → headless/partial-load inert-safe. Owns EVERY per-genre mapping so the
 * near-cap modules (main/world/achievements/audio-orchestrator) stay small:
 *   • GENRE_MAP — genre → JUKE keys for menu / wave (gameplay) / boss themes + the Warden title the
 *     boss-spawn toast displays (world.js reads wardenTitle(); lang-he.js carries the Hebrew).
 *   • GENRE_BOSS_JUKE/BEDS — per-genre BOSS music: a real file slot (fetch-music.sh, absent today) with a
 *     per-genre procedural boss bed fallback, same pattern as the wave-genre beds — audible offline NOW.
 *   • rethemeGrid() — the global retheme hook: re-fires the live audio state through the new genre and
 *     broadcasts a 'rethemeGrid' CustomEvent for the visual engines. Fired by RewardEngine.equipMusic.
 *   • window.debugGenre(id) — Thematic Swap audit (mirrors debugLang/debugUpgrade/debugCensor). */
const GENRE_MAP = {
  orchestral:{ ico:'🎼', label:'Orchestral', menu:'menu', wave:'play', boss:['boss0','boss1','boss2'], wardenTitle:'WARDEN PROTOCOL' },
  jazz:      { ico:'🎷', label:'Jazz',       menu:'jazz', wave:'jazz', boss:['bossjazz'],              wardenTitle:'MIDNIGHT SET' },
  pop:       { ico:'🎤', label:'Pop',        menu:'pop',  wave:'pop',  boss:['bosspop'],               wardenTitle:'HEADLINER' },
  rock:      { ico:'🎸', label:'Rock',       menu:'rock', wave:'rock', boss:['bossrock'],              wardenTitle:'MAIN STAGE' },
  rap:       { ico:'🎧', label:'Rap',        menu:'rap',  wave:'rap',  boss:['bossrap'],               wardenTitle:'FINAL VERSE' },
};
/* per-genre boss theme slots: real recording (drop in via fetch-music.sh; CC0/PD only) … */
const GENRE_BOSS_JUKE = {
  bossjazz:'audio/genres/jazz-boss.mp3', bosspop:'audio/genres/pop-boss.mp3',
  bossrock:'audio/genres/rock-boss.mp3', bossrap:'audio/genres/rap-boss.mp3',
};
/* …and the procedural boss bed each falls back to when its file is absent — darker/faster twist on that
 * genre's wave bed (same TRACKS schema: bpm + chord prog + bass roots (MIDI) + drive/ostinato). */
const GENRE_BOSS_BEDS = {
  bossjazz:{ bpm:160, prog:[[55,58,62,65],[53,56,60,63],[51,55,58,62],[50,53,57,60]], bass:[31,29,27,26], drive:true,  ostinato:true  },  // frantic minor-7th bebop chase, walking-bass sprint
  bosspop: { bpm:150, prog:[[57,60,64],[53,57,60],[55,59,62],[52,55,59]],             bass:[33,29,31,28], drive:true,  ostinato:true  },  // minor-key anthem drop, full-tilt
  bossrock:{ bpm:184, prog:[[52,59,64],[50,57,62],[51,58,63],[48,55,60]],             bass:[28,26,27,24], drive:true,  ostinato:true  },  // thrash power-chord descent, blast tempo
  bossrap: { bpm:104, prog:[[53,56,60],[51,55,58],[50,53,57],[48,51,55]],             bass:[29,27,26,24], drive:false, ostinato:true  },  // menacing half-time low end, pushed
};
if(typeof Orchestra!=='undefined'){Object.assign(Orchestra.JUKE,GENRE_BOSS_JUKE);Object.assign(Orchestra.TRACKS,GENRE_BOSS_BEDS);}   // register the boss slots with the jukebox + composer

const GenreOrchestrator = {
  _ov:null, _last:'orchestral',   // _ov = debugGenre session override (wins over the equipped track); _last dedupes retheme refires
  // active genre id: override → equipped Soundtrack track's genre field → orchestral default
  current(){ if(this._ov)return this._ov;
    if(typeof RewardEngine!=='undefined'&&RewardEngine.equippedMusic){const eq=RewardEngine.equippedMusic();
      const m=eq&&RewardEngine.musicDefs&&RewardEngine.musicDefs().find(function(d){return d.id===eq;});
      const g=m&&m.genre&&String(m.genre).toLowerCase();if(g&&GENRE_MAP[g])return g;}
    return 'orchestral'; },
  def(){ return GENRE_MAP[this.current()]; },
  // Orchestra._resolve delegate: menu/play/bossN → this genre's JUKE key. null = no opinion (orchestral /
  // non-themed key like 'over') → the legacy Soundtrack-override path in _resolve runs unchanged.
  resolveKey(key){ const g=this.current();if(g==='orchestral')return null;const d=GENRE_MAP[g];
    if(key==='menu')return d.menu; if(key==='play')return d.wave;
    if(key&&key.indexOf('boss')===0){const bt=+key.slice(4)||0;return d.boss[bt%d.boss.length];}
    return null; },
  // procedural bed the composer renders under a boss for this genre ('boss' = the orchestral default bed)
  bossBed(){ const k=this.def().boss[0];return GENRE_BOSS_BEDS[k]?k:'boss'; },
  wardenTitle(){ return this.def().wardenTitle; },   // world.js boss-spawn toast reads this (tr() at the display site)
  // THE retheme hook: crossfade the LIVE audio state onto the new genre (menu theme mid-menu, wave/boss
  // theme mid-run) + a Full Sync toast, then broadcast to any visual engine listening for 'rethemeGrid'.
  rethemeGrid(){ const g=this.current();
    if(g!==this._last){ this._last=g;
      if(typeof Music!=='undefined'&&typeof Orchestra!=='undefined'){const st=Orchestra.state;
        if(st==='MENU')Music.menu(); else if(st==='AMBIENT'||st==='BOSS')Music.start();}   // PAUSED/OVER/BOOT: the new theme applies on the next state edge
      const d=this.def();
      if(typeof AchUI!=='undefined'&&AchUI._push)AchUI._push(`<span class="at-ico">${d.ico}</span><div class="at-text"><b>${tr('⚡ FULL SYNC')}</b><span>${tr(d.label)} ${tr('grid conversion')}</span></div>`,'#ffd95e');}
    if(typeof window!=='undefined'&&window.dispatchEvent)try{window.dispatchEvent(new CustomEvent('rethemeGrid',{detail:{genre:g}}));}catch(e){} },
};

/* Thematic Swap debugger — debugGenre('pop') instantly retunes music + Warden labels (no ownership gate,
 * session-only, no cloud write). debugGenre() lists genres; debugGenre(null) reverts to the equipped/default. */
if(typeof window!=='undefined')window.debugGenre=function(id){
  const GO=GenreOrchestrator;
  if(arguments.length===0){console.log('[GENRE] '+Object.keys(GENRE_MAP).join(' · ')+' — current: '+GO.current()+(GO._ov?' (debug override)':''));return Object.keys(GENRE_MAP);}
  if(id===null){GO._ov=null;GO.rethemeGrid();console.log('[GENRE] override cleared → '+GO.current());return GO.current();}
  id=String(id).toLowerCase();
  if(!GENRE_MAP[id]){console.log('[GENRE] unknown "'+id+'" — try: '+Object.keys(GENRE_MAP).join(' / '));return null;}
  GO._ov=id;GO.rethemeGrid();
  const d=GENRE_MAP[id],he=(typeof LANG_HE!=='undefined'&&LANG_HE[d.wardenTitle])||d.wardenTitle;
  console.log('[GENRE] '+id+' → menu:'+d.menu+' · wave:'+d.wave+' · boss:'+d.boss.join(',')+' · bossBed:'+GO.bossBed()+' — warden: "'+d.wardenTitle+'" / "'+he+'"');
  return d;
};
