/* NEON SURVIVOR — achievements.js : client catalog, progress tracking, optimistic unlock UI.
 * Classic global (loads AFTER net.js/network.js, BEFORE main.js). Headless/offline-safe — every
 * DOM/network/storage touch is guarded, so verify.cjs loads it and offline play still works.
 *
 * Trust model: the client tracks progress and shows badges OPTIMISTICALLY for instant feedback,
 * but the authoritative grant is /api/verify.js (service role). A run opens a server `run_token`
 * at startGame and submits its finished stats at gameOver; the server re-validates and grants.
 * Local unlocks are a mirror for display — they never write the DB (RLS forbids it anyway). */

/* ---- catalog: id/conds/difficulty MUST match api/verify.js (verify-achievements.cjs cross-checks the
 *      {id,conds,difficulty} projection is byte-identical). cat/hidden/tier/ico/title/desc are UI metadata
 *      (server catalog omits them). A cond is [metric,value] (op defaults to '>=') or [metric,op,value]
 *      with op ∈ '>=' | '<=' | '=='. ALL conds + the difficulty gate must hold for the id to be earned.
 *      gold tier → cosmetic (COSMETICS below). cat drives the gallery tab; hidden → secret '???' card. ---- */
const ACH_CATALOG = [
  // ---- progression (server-derived, leaderboard-safe) ----
  { id:'first_blood',   conds:[['kills',1]],      cat:'combat',   difficulty:null, ico:'🩸', title:'Draw First Blood', desc:'Get your first kill.',                 tier:'bronze', chain:null },
  { id:'swarm_breaker', conds:[['kills',100]],    cat:'combat',   difficulty:null, ico:'💥', title:'Swarm Breaker',    desc:'Kill 100 enemies in a single run.',    tier:'bronze', chain:'combat_kills' },
  { id:'one_man_army',  conds:[['kills',500]],    cat:'combat',   difficulty:null, ico:'⚔️', title:'One-Man Army',     desc:'Kill 500 enemies in a single run.',    tier:'silver', chain:'combat_kills' },
  { id:'annihilator',   conds:[['kills',1000]],   cat:'combat',   difficulty:null, ico:'🔆', title:'Annihilator',      desc:'Kill 1,000 enemies in a single run.',  tier:'gold',   chain:'combat_kills' },
  { id:'high_scorer',   conds:[['score',10000]],  cat:'survival', difficulty:null, ico:'🏆', title:'High Scorer',      desc:'Score 10,000 in a single run.',        tier:'bronze', chain:'score_run' },
  { id:'score_legend',  conds:[['score',50000]],  cat:'survival', difficulty:null, ico:'👑', title:'Score Legend',     desc:'Score 50,000 in a single run.',        tier:'silver', chain:'score_run' },
  { id:'neon_god',      conds:[['score',100000]], cat:'survival', difficulty:null, ico:'🌟', title:'Neon God',         desc:'Score 100,000 in a single run.',       tier:'gold',   chain:'score_run' },
  { id:'wave_rider',    conds:[['wave',10]],      cat:'survival', difficulty:null, ico:'🌊', title:'Wave Rider',       desc:'Reach wave 10.',                       tier:'bronze', chain:'wave_depth' },
  { id:'wave_master',   conds:[['wave',20]],      cat:'survival', difficulty:null, ico:'🌀', title:'Wave Master',      desc:'Reach wave 20.',                       tier:'silver', chain:'wave_depth' },
  { id:'abyss_walker',  conds:[['wave',30]],      cat:'survival', difficulty:null, ico:'🕳️', title:'Abyss Walker',     desc:'Reach wave 30.',                       tier:'gold',   chain:'wave_depth' },
  { id:'boss_slayer',   conds:[['bosses',1]],     cat:'boss',     difficulty:null, ico:'💀', title:'Boss Slayer',      desc:'Defeat your first boss.',              tier:'bronze', chain:'boss_hunt' },
  { id:'warden_hunter', conds:[['bosses',10]],    cat:'boss',     difficulty:null, ico:'☠️', title:'Boss Hunter',      desc:'Defeat 10 bosses (lifetime).',         tier:'silver', chain:'boss_hunt' },
  { id:'warden_legend', conds:[['bosses',50]],    cat:'boss',     difficulty:null, ico:'😇', title:'Apex Predator',    desc:'Defeat 50 bosses (lifetime).',         tier:'gold',   chain:'boss_hunt' },
  { id:'power_surge',   conds:[['level',10]],     cat:'survival', difficulty:null, ico:'⚡', title:'Power Surge',      desc:'Reach level 10 in a single run.',      tier:'bronze', chain:null },
  { id:'ascended',      conds:[['level',25]],     cat:'survival', difficulty:null, ico:'✨', title:'Ascended',         desc:'Reach level 25 in a single run.',      tier:'silver', chain:null },
  { id:'veteran',       conds:[['runs',10]],      cat:'survival', difficulty:null, ico:'🎖️', title:'Veteran',          desc:'Finish 10 runs (lifetime).',           tier:'bronze', chain:null },
  { id:'hardcore',      conds:[['wave',10]],      cat:'survival', difficulty:'hard', ico:'🔥', title:'Hardcore',        desc:'Reach wave 10 on Hard.',               tier:'silver', chain:null },

  // ---- skill (intent-based, cosmetic-only trust) ----
  { id:'ghost_grid',        conds:[['noHitWave',10]],                 cat:'skill',     difficulty:null, ico:'👻', title:'Ghost in the Grid', desc:'Reach wave 10 without taking a single hit.',        tier:'silver', chain:'flawless' },
  { id:'untouchable',       conds:[['noHitWave',20]],                 cat:'skill',     difficulty:null, ico:'🛸', title:'Untouchable',       desc:'Reach wave 20 without taking a single hit.',        tier:'gold',   chain:'flawless' },
  { id:'flawless_protocol', conds:[['flawlessBoss',1]],               cat:'skill',     difficulty:null, ico:'🦾', title:'Flawless Protocol', desc:'Destroy a boss without taking a hit in the fight.', tier:'gold',  chain:null },
  { id:'factory_settings',  conds:[['starterWave',15]],               cat:'skill',     difficulty:null, ico:'🔧', title:'Factory Settings',  desc:'Reach wave 15 using only the starting gun.',        tier:'silver', chain:null },
  { id:'overclocked',       conds:[['peakWeapons',3],['wave',15]],    cat:'skill',     difficulty:null, ico:'🎛️', title:'Overclocked',       desc:'Wield all three weapons at once and reach wave 15.', tier:'silver', chain:null },
  { id:'second_wind',       conds:[['cameback',1]],                   cat:'skill',     difficulty:null, ico:'🫀', title:'Second Wind',       desc:'Survive into a new wave after dropping below 10% HP.', tier:'bronze',chain:null },
  { id:'glass_cannon',      conds:[['glassWave',12]],                 cat:'skill',     difficulty:null, ico:'🔮', title:'Glass Cannon',      desc:'Reach wave 12 without ever raising max HP.',        tier:'silver', chain:null },

  // ---- speed (server-derived) ----
  { id:'power_spike',       conds:[['level',10],['secs','<=',90]],    cat:'speed',     difficulty:null, ico:'📈', title:'Power Spike',       desc:'Reach level 10 within 90 seconds.',                 tier:'bronze', chain:null },
  { id:'ascendant_rush',    conds:[['level',20],['secs','<=',300]],   cat:'speed',     difficulty:null, ico:'🚄', title:'Ascendant Rush',    desc:'Reach level 20 within 5 minutes.',                  tier:'silver', chain:null },
  { id:'blitz',             conds:[['wave',10],['secs','<=',240]],    cat:'speed',     difficulty:null, ico:'⏱️', title:'Blitz',             desc:'Reach wave 10 within 4 minutes.',                   tier:'bronze', chain:null },
  { id:'killer_instinct',   conds:[['bossKillSecs','<=',15]],         cat:'speed',     difficulty:null, ico:'🎯', title:'Killer Instinct',   desc:'Destroy a boss within 15s of its spawn.',           tier:'silver', chain:null },
  { id:'massacre_clock',    conds:[['kills',250],['secs','<=',180]],  cat:'speed',     difficulty:null, ico:'⏲️', title:'Massacre Clock',    desc:'Get 250 kills in the first 3 minutes.',             tier:'silver', chain:null },

  // ---- challenge / strategy divergence ----
  { id:'objector',          conds:[['soloWave',8]],                   cat:'challenge', difficulty:null, ico:'✋', title:'Conscientious Objector', desc:'Reach wave 8 while still at level 1.',         tier:'silver', chain:null },
  { id:'pacifist_protocol', conds:[['kills','<=',24],['secs',300]],   cat:'challenge', difficulty:null, ico:'🕊️', title:'Pacifist Protocol', desc:'Survive 5 minutes with fewer than 25 kills.',       tier:'gold',   chain:null },
  { id:'minimalist',        conds:[['peakWeapons','<=',1],['wave',12]],cat:'challenge',difficulty:null, ico:'➖', title:'Minimalist',        desc:'Reach wave 12 owning at most one weapon.',          tier:'silver', chain:null },
  { id:'ascetic',           conds:[['asceticWave',10]],               cat:'challenge', difficulty:null, ico:'🧘', title:'Ascetic',           desc:'Reach wave 10 collecting zero pickups.',            tier:'silver', chain:null },

  // ---- secret (hidden until unlocked) ----
  { id:'any_percent',  conds:[['secs','<=',5],['wave',1]],            cat:'secret',    difficulty:null, hidden:true, ico:'🏁', title:'Any% Speedrun',          desc:'Die within 5 seconds of starting a run.',       tier:'bronze', chain:null },
  { id:'leet',         conds:[['kills','==',1337]],                   cat:'secret',    difficulty:null, hidden:true, ico:'😎', title:'Leet',                   desc:'Finish a run with exactly 1,337 kills.',        tier:'silver', chain:null },
  { id:'completionist',conds:[['unlockedPct',80]],                    cat:'secret',    difficulty:null, hidden:true, ico:'🧩', title:'The Completionist’s Curse', desc:'Unlock 80% of every other achievement.', tier:'gold', chain:null },
];

/* ---- cosmetic rewards: each GOLD achievement drops one skin/trail into cosmetics_inventory (server-granted).
 *      Mirrors supabase cosmetics_definitions; the UI reads this to label the showcase. ---- */
const COSMETICS = [
  { id:'crimson_husk',   kind:'skin',  title:'Crimson Husk',   from:'annihilator',       ico:'🟥' },
  { id:'void_warden',    kind:'skin',  title:'Void Warden',    from:'abyss_walker',      ico:'🟪' },
  { id:'neon_god_trail', kind:'trail', title:'Neon God Trail', from:'neon_god',          ico:'✨' },
  { id:'warden_halo',    kind:'trail', title:'Warden Halo',    from:'warden_legend',     ico:'💫' },
  { id:'phase_trail',    kind:'trail', title:'Phase Trail',    from:'untouchable',       ico:'🌀' },
  { id:'wardens_bane',   kind:'skin',  title:'Warden’s Bane',  from:'flawless_protocol', ico:'🟦' },
  { id:'dove_halo',      kind:'trail', title:'Dove Halo',      from:'pacifist_protocol', ico:'🕊️' },
  { id:'prism_core',     kind:'skin',  title:'Prism Core',     from:'completionist',     ico:'🟩' },
];
/* gold achievement id → cosmetic id (drives the in-game "cosmetic unlocked" toast). MUST match api/verify.js. */
const COSMETIC_MAP = COSMETICS.reduce((m,c)=>{ m[c.from]=c.id; return m; }, {});

const Ach = {
  CATALOG: ACH_CATALOG,
  run: { bosses: 0 },                 // run-scoped counters (the only stat not in the gameOver bag)
  _token: null,                       // server-issued run_token for /api/verify
  _last: null,                        // last /api/verify response (debug overlay reads this)

  /* pure: ids satisfied by a stats bag. A cond is [metric,value] (op '>=') or [metric,op,value] with
   * op ∈ '>='|'<='|'=='. ALL conds + the difficulty gate must hold. Byte-identical to api/verify.js. */
  _meets(stats, conds, difficulty) {
    if (difficulty && difficulty !== stats.difficulty) return false;
    for (let i = 0; i < conds.length; i++) {
      const c = conds[i], m = c[0], op = c.length === 2 ? '>=' : c[1], v = c.length === 2 ? c[1] : c[2];
      const x = stats[m];
      if (typeof x !== 'number') return false;
      if (op === '>=') { if (!(x >= v)) return false; }
      else if (op === '<=') { if (!(x <= v)) return false; }
      else if (op === '==') { if (x !== v) return false; }
      else return false;
    }
    return true;
  },
  evaluate(stats) { return this.CATALOG.filter(d => this._meets(stats, d.conds, d.difficulty)).map(d => d.id); },

  /* persistent mirror, keyed per-identity (neon_ach:<player_id>) so two accounts on one browser don't
   * bleed and a sign-in can overwrite it from the cloud. Cache only — /api/verify is authoritative. */
  _key() { try { const p = (typeof getPlayer === 'function') && getPlayer(); return 'neon_ach:' + ((p && p.id) || 'local'); } catch (e) { return 'neon_ach:local'; } },
  /* mirror shape: { unlocked:[ids], cosmetics:[ids], life:{kills,bosses,runs,bestKills,bestScore,bestWave,bestLevel} }.
   * bestKills/best* feed the gallery progress bars (per-metric best-known value); life.kills/bosses/runs are cumulative. */
  _load() {
    try { const r = localStorage.getItem(this._key()) || localStorage.getItem('neon_ach'); if (r) { const s = JSON.parse(r); if (!s.cosmetics) s.cosmetics = []; if (!s.tracks) s.tracks = []; if (s.life && s.life.bestKills == null) s.life.bestKills = 0; if (s.life && !s.life.best) s.life.best = {}; return s; } } catch (e) {}
    return { unlocked: [], cosmetics: [], tracks: [], life: { kills:0, bosses:0, runs:0, bestKills:0, bestScore:0, bestWave:0, bestLevel:0, best:{} } };
  },
  _save(s) { try { localStorage.setItem(this._key(), JSON.stringify(s)); } catch (e) {} },

  /* the metric that drives a def's progress bar = its FIRST cond's metric (compound goals show their
   * headline metric). best-known value comes from life.best (intent metrics) with a fallback to the
   * legacy best* fields. inverted ('<=') / equality ('==') conds render as binary in the UI. */
  driverCond(def) { return (def.conds && def.conds[0]) || ['kills', 0]; },
  progressValue(def) {
    const c = this.driverCond(def), m = c[0], l = this._load().life;
    const legacy = { kills:l.bestKills||0, score:l.bestScore||0, wave:l.bestWave||0, level:l.bestLevel||0, bosses:l.bosses||0, runs:l.runs||0 };
    return (l.best && l.best[m] != null) ? l.best[m] : (legacy[m] || 0);
  },
  progressFrac(def) {
    const c = this.driverCond(def), op = c.length === 2 ? '>=' : c[1], v = c.length === 2 ? c[1] : c[2];
    if (op !== '>=' || !v) return this.isUnlocked(def.id) ? 1 : 0;            // '<='/'==' goals → binary bar
    return Math.max(0, Math.min(1, this.progressValue(def) / v));
  },
  isUnlocked(id) { return this._load().unlocked.indexOf(id) >= 0; },

  /* called from startGame(): reset ALL run-scoped state and (when online) open a server run token.
   * The *Wave markers hold the wave at the FIRST occurrence of an event (-1 = never), so a milestone
   * like "highest wave reached without taking a hit" is a single monotonic number, threshold-friendly. */
  onRunStart() {
    this.run = {
      bosses: 0, dmgTaken: 0, flawlessBoss: 0, peakWeapons: 0, pickups: 0,
      firstHitWave: -1, firstWeaponWave: -1, firstLevelWave: -1, firstPickWave: -1, firstMaxhpWave: -1,
      minHpPct: 100, lowWave: -1, bossKillSecs: 9999, _bossDmgMark: 0, _bossSpawnSecs: 0,
    };
    this._token = null; this._last = null;
    const p = (typeof getPlayer === 'function') && getPlayer();
    const diff = (typeof DIFF !== 'undefined' && DIFF.key) || 'normal';
    if (!p || typeof SB === 'undefined' || !SB) return;                    // offline / headless → local-only
    try {
      SB.from('runs').insert({ player_id:p.id, difficulty:diff }).select('run_token').single()
        .then(({ data }) => { if (data) this._token = data.run_token; }, () => {});
    } catch (e) {}
  },

  /* ---- intent hooks, fired from sparse event sites (no per-tick cost) ---- */
  onBossSpawn(secs) { this.run._bossDmgMark = this.run.dmgTaken; this.run._bossSpawnSecs = secs | 0; },
  onBossKill(secs) {                                                       // killEnemy() boss branch
    const r = this.run; r.bosses++;
    if (r.dmgTaken === r._bossDmgMark) r.flawlessBoss++;                   // no hit taken during the fight
    const dt = (secs | 0) - r._bossSpawnSecs; if (dt >= 0 && dt < r.bossKillSecs) r.bossKillSecs = dt;
  },
  onDamage(wave, hpPct) {                                                  // sim.js, on every player hit
    const r = this.run; r.dmgTaken++;
    if (r.firstHitWave < 0) r.firstHitWave = wave | 0;
    if (hpPct < r.minHpPct) r.minHpPct = hpPct;
    if (hpPct < 10 && r.lowWave < 0) r.lowWave = wave | 0;
  },
  onUpgrade(id, isWeapon, wave, distinctWeapons) {                        // applyUpgrade()
    const r = this.run;
    if (isWeapon && r.firstWeaponWave < 0) r.firstWeaponWave = wave | 0;
    if (id === 'maxhp' && r.firstMaxhpWave < 0) r.firstMaxhpWave = wave | 0;
    if (distinctWeapons > r.peakWeapons) r.peakWeapons = distinctWeapons;
  },
  onLevelUp(wave) { if (this.run.firstLevelWave < 0) this.run.firstLevelWave = wave | 0; },
  onPickup(wave) { const r = this.run; r.pickups++; if (r.firstPickWave < 0) r.firstPickWave = wave | 0; },

  /* fold the run's raw counters + the gameOver bag into the full stats object the catalog evaluates.
   * Milestone markers become "highest wave reached under the constraint" (marker, or final wave if never). */
  _runStats(entry) {
    const r = this.run, fin = entry.wave | 0, mark = (m) => m >= 0 ? m : fin;
    const life = this._load().life;
    return {
      kills: entry.kills | 0, score: entry.score | 0, wave: fin, level: entry.level | 0, secs: entry.secs | 0,
      bosses: (life.bosses | 0) + r.bosses, runs: (life.runs | 0) + 1, difficulty: entry.difficulty,
      noHitWave: mark(r.firstHitWave), starterWave: mark(r.firstWeaponWave), soloWave: mark(r.firstLevelWave),
      asceticWave: mark(r.firstPickWave), glassWave: mark(r.firstMaxhpWave),
      flawlessBoss: r.flawlessBoss, peakWeapons: r.peakWeapons, bossKillSecs: r.bossKillSecs,
      cameback: (r.lowWave >= 0 && fin > r.lowWave) ? 1 : 0,
    };
  },

  /* called from gameOver(): fold the run into lifetime stats, fire optimistic toasts, submit to /api/verify */
  reportRun(entry) {
    const s = this._load(), life = s.life;
    life.runs++; life.kills += (entry.kills | 0); life.bosses += this.run.bosses;
    life.bestKills = Math.max(life.bestKills || 0, entry.kills | 0);
    life.bestScore = Math.max(life.bestScore, entry.score | 0);
    life.bestWave  = Math.max(life.bestWave,  entry.wave | 0);
    life.bestLevel = Math.max(life.bestLevel, entry.level | 0);

    const stats = this._runStats(entry);
    if (!life.best) life.best = {};                                        // per-metric best-known (intent metrics) → progress bars
    ['noHitWave','starterWave','soloWave','asceticWave','glassWave','flawlessBoss','peakWeapons']
      .forEach(m => { life.best[m] = Math.max(life.best[m] || 0, stats[m] || 0); });

    let earned = this.evaluate(stats), fresh = earned.filter(id => s.unlocked.indexOf(id) < 0);
    if (fresh.length) { s.unlocked = s.unlocked.concat(fresh); this._grantCosmetics(s, fresh); this._grantRewards(s, fresh); this._notify(fresh); }

    // 2nd pass: the meta "completionist" depends on how many OTHER achievements are now owned
    const others = this.CATALOG.filter(d => d.id !== 'completionist').length;
    const owned  = s.unlocked.filter(id => id !== 'completionist').length;
    stats.unlockedPct = others ? Math.floor(owned / others * 100) : 0;
    const meta = this.evaluate(stats).filter(id => s.unlocked.indexOf(id) < 0);
    if (meta.length) { s.unlocked = s.unlocked.concat(meta); this._grantCosmetics(s, meta); this._grantRewards(s, meta); this._notify(meta); fresh = fresh.concat(meta); }
    this._save(s);

    this._submit(entry, stats);     // authoritative grant (no-op offline/headless)
    return fresh;
  },

  /* optimistic cosmetic mirror: any fresh GOLD unlock drops its mapped cosmetic into the local inventory
   * and toasts it. The server (api/verify.js) is authoritative — this just makes the reward feel instant. */
  _grantCosmetics(s, ids) {
    if (typeof COSMETIC_MAP === 'undefined') return;
    ids.forEach(id => {
      const cid = COSMETIC_MAP[id]; if (!cid || s.cosmetics.indexOf(cid) >= 0) return;
      s.cosmetics.push(cid);
      if (typeof AchUI !== 'undefined' && AchUI.cosmeticToast) AchUI.cosmeticToast(cid);
    });
  },

  /* drop EVERY earned achievement's reward (skin/trail/music) into the local mirror — the superset of the
   * gold-only _grantCosmetics above. Skins/trails land in s.cosmetics, music tracks in s.tracks. Operates on
   * the SAME `s` the caller will _save, so the optimistic grant persists. Toasts + the user_inventory insert
   * are fired separately by RewardEngine.onUnlock (the AchUI.unlockToast hook). No-op if REWARD_MAP absent. */
  _grantRewards(s, ids) {
    if (typeof REWARD_MAP === 'undefined') return;
    if (!s.tracks) s.tracks = [];
    ids.forEach(id => {
      const r = REWARD_MAP[id]; if (!r) return;
      const arr = r.kind === 'music' ? s.tracks : s.cosmetics;
      if (arr.indexOf(r.id) < 0) arr.push(r.id);
    });
  },

  /* POST the run to the server validator; reconcile any server-granted ids the client missed */
  _submit(entry, stats) {
    const p = (typeof getPlayer === 'function') && getPlayer();
    if (!p || !this._token || typeof fetch !== 'function') return;         // offline / headless → skip
    const base = (typeof SUPA_FUNCTIONS_URL === 'string' && SUPA_FUNCTIONS_URL) || '';
    try {
      fetch(base + '/api/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: p.id, run_token: this._token,
          score: stats.score, wave: stats.wave, secs: entry.secs | 0, kills: stats.kills,
          level: stats.level, bosses: stats.bosses, runs: stats.runs, difficulty: stats.difficulty,
          // intent fields (cosmetic-only; server clamps to plausible bounds before granting)
          noHitWave: stats.noHitWave, starterWave: stats.starterWave, soloWave: stats.soloWave,
          asceticWave: stats.asceticWave, glassWave: stats.glassWave, flawlessBoss: stats.flawlessBoss,
          peakWeapons: stats.peakWeapons, bossKillSecs: stats.bossKillSecs, cameback: stats.cameback,
        }),
      }).then(r => r.json()).then(j => {
        this._last = j;
        if (j && j.accepted && Array.isArray(j.newAchievements)) {
          const s = this._load(), add = j.newAchievements.filter(id => s.unlocked.indexOf(id) < 0);
          const cos = (Array.isArray(j.newCosmetics) ? j.newCosmetics : []).filter(c => s.cosmetics.indexOf(c) < 0);
          if (add.length || cos.length) {
            if (add.length) s.unlocked = s.unlocked.concat(add);
            if (cos.length) { s.cosmetics = s.cosmetics.concat(cos); cos.forEach(c => { if (typeof AchUI !== 'undefined' && AchUI.cosmeticToast) AchUI.cosmeticToast(c); }); }
            this._save(s); if (add.length) this._notify(add);
          }
        }
      }, () => {});
    } catch (e) {}
  },

  /* unlock feedback: prefer the high-fidelity, self-queuing #achtoast (achievements-ui.js) — it slides
   * in WITHOUT pausing the run. Fall back to the single-slot world toast (staggered) when AchUI is absent. */
  _notify(ids) {
    if (typeof AchUI !== 'undefined' && AchUI.unlockToast) { ids.forEach(id => AchUI.unlockToast(id)); return; }
    if (typeof showToast !== 'function') return;
    ids.forEach((id, i) => {
      const d = this.CATALOG.find(x => x.id === id); if (!d) return;
      setTimeout(() => showToast(d.ico, 'ACHIEVEMENT — ' + d.title, '#ffd95e'), 1200 * i);
    });
  },

  /* DEV: locally unlock an id (+ its cosmetic) and fire the unlock/cosmetic toasts — drives AchUI.mock().
   * Mirror-only (RLS forbids client DB writes anyway); never reaches the server. */
  mockGrant(id) {
    const d = this.CATALOG.find(x => x.id === id); if (!d) return false;
    const s = this._load();
    if (s.unlocked.indexOf(id) < 0) { s.unlocked.push(id); this._grantCosmetics(s, [id]); this._grantRewards(s, [id]); this._notify([id]); }
    this._save(s);
    if (typeof AchUI !== 'undefined' && AchUI.renderGallery) AchUI.renderGallery(); else this.renderPanel();
    return true;
  },

  /* main-menu panel: delegate to the high-fidelity gallery (achievements-ui.js) when present;
   * fall back to the legacy flat list so headless/standalone loads still render something. */
  renderPanel() {
    if (typeof AchUI !== 'undefined' && AchUI.renderGallery) return AchUI.renderGallery();
    if (typeof document === 'undefined') return;
    const el = document.getElementById('achlist'); if (!el) return;
    const owned = this._load().unlocked;
    el.innerHTML = this.CATALOG.map(d => {
      const got = owned.indexOf(d.id) >= 0;
      return `<div class="achrow${got ? ' got' : ''}"><span class="achico">${d.ico}</span>` +
             `<div class="achtext"><b>${d.title}</b><span>${d.desc}</span></div>` +
             `<span class="achmark">${got ? '✓' : '🔒'}</span></div>`;
    }).join('');
  },
};
