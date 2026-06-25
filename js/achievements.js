/* NEON SURVIVOR — achievements.js : client catalog, progress tracking, optimistic unlock UI.
 * Classic global (loads AFTER net.js/network.js, BEFORE main.js). Headless/offline-safe — every
 * DOM/network/storage touch is guarded, so verify.cjs loads it and offline play still works.
 *
 * Trust model: the client tracks progress and shows badges OPTIMISTICALLY for instant feedback,
 * but the authoritative grant is /api/verify.js (service role). A run opens a server `run_token`
 * at startGame and submits its finished stats at gameOver; the server re-validates and grants.
 * Local unlocks are a mirror for display — they never write the DB (RLS forbids it anyway). */

/* ---- catalog: id/metric/threshold/difficulty MUST match api/verify.js (verify-achievements.cjs checks).
 *      tier/chain are UI+reward metadata only (not cross-checked). gold tier → cosmetic (COSMETICS below). ---- */
const ACH_CATALOG = [
  { id:'first_blood',   metric:'kills',  threshold:1,     difficulty:null, ico:'🩸', title:'Draw First Blood', desc:'Get your first kill.',                 tier:'bronze', chain:null },
  { id:'swarm_breaker', metric:'kills',  threshold:100,   difficulty:null, ico:'💥', title:'Swarm Breaker',    desc:'Kill 100 enemies in a single run.',    tier:'bronze', chain:'combat_kills' },
  { id:'one_man_army',  metric:'kills',  threshold:500,   difficulty:null, ico:'⚔️', title:'One-Man Army',     desc:'Kill 500 enemies in a single run.',    tier:'silver', chain:'combat_kills' },
  { id:'annihilator',   metric:'kills',  threshold:1000,  difficulty:null, ico:'🔆', title:'Annihilator',      desc:'Kill 1,000 enemies in a single run.',  tier:'gold',   chain:'combat_kills' },
  { id:'high_scorer',   metric:'score',  threshold:10000, difficulty:null, ico:'🏆', title:'High Scorer',      desc:'Score 10,000 in a single run.',        tier:'bronze', chain:'score_run' },
  { id:'score_legend',  metric:'score',  threshold:50000, difficulty:null, ico:'👑', title:'Score Legend',     desc:'Score 50,000 in a single run.',        tier:'silver', chain:'score_run' },
  { id:'neon_god',      metric:'score',  threshold:100000,difficulty:null, ico:'🌟', title:'Neon God',         desc:'Score 100,000 in a single run.',       tier:'gold',   chain:'score_run' },
  { id:'wave_rider',    metric:'wave',   threshold:10,    difficulty:null, ico:'🌊', title:'Wave Rider',       desc:'Reach wave 10.',                       tier:'bronze', chain:'wave_depth' },
  { id:'wave_master',   metric:'wave',   threshold:20,    difficulty:null, ico:'🌀', title:'Wave Master',      desc:'Reach wave 20.',                       tier:'silver', chain:'wave_depth' },
  { id:'abyss_walker',  metric:'wave',   threshold:30,    difficulty:null, ico:'🕳️', title:'Abyss Walker',     desc:'Reach wave 30.',                       tier:'gold',   chain:'wave_depth' },
  { id:'boss_slayer',   metric:'bosses', threshold:1,     difficulty:null, ico:'💀', title:'Boss Slayer',      desc:'Defeat your first Warden.',            tier:'bronze', chain:'boss_hunt' },
  { id:'warden_hunter', metric:'bosses', threshold:10,    difficulty:null, ico:'☠️', title:'Warden Hunter',    desc:'Defeat 10 Wardens (lifetime).',        tier:'silver', chain:'boss_hunt' },
  { id:'warden_legend', metric:'bosses', threshold:50,    difficulty:null, ico:'😇', title:'Warden Legend',    desc:'Defeat 50 Wardens (lifetime).',        tier:'gold',   chain:'boss_hunt' },
  { id:'power_surge',   metric:'level',  threshold:10,    difficulty:null, ico:'⚡', title:'Power Surge',      desc:'Reach level 10 in a single run.',      tier:'bronze', chain:null },
  { id:'ascended',      metric:'level',  threshold:25,    difficulty:null, ico:'✨', title:'Ascended',         desc:'Reach level 25 in a single run.',      tier:'silver', chain:null },
  { id:'veteran',       metric:'runs',   threshold:10,    difficulty:null, ico:'🎖️', title:'Veteran',          desc:'Finish 10 runs (lifetime).',           tier:'bronze', chain:null },
  { id:'hardcore',      metric:'wave',   threshold:10,    difficulty:'hard',ico:'🔥', title:'Hardcore',         desc:'Reach wave 10 on Hard.',               tier:'silver', chain:null },
];

/* ---- cosmetic rewards: each GOLD achievement drops one skin/trail into cosmetics_inventory (server-granted).
 *      Mirrors supabase cosmetics_definitions; the UI reads this to label the showcase. ---- */
const COSMETICS = [
  { id:'crimson_husk',   kind:'skin',  title:'Crimson Husk',   from:'annihilator',   ico:'🟥' },
  { id:'void_warden',    kind:'skin',  title:'Void Warden',    from:'abyss_walker',  ico:'🟪' },
  { id:'neon_god_trail', kind:'trail', title:'Neon God Trail', from:'neon_god',      ico:'✨' },
  { id:'warden_halo',    kind:'trail', title:'Warden Halo',    from:'warden_legend', ico:'💫' },
];
/* gold achievement id → cosmetic id (drives the in-game "cosmetic unlocked" toast). MUST match api/verify.js. */
const COSMETIC_MAP = COSMETICS.reduce((m,c)=>{ m[c.from]=c.id; return m; }, {});

const Ach = {
  CATALOG: ACH_CATALOG,
  run: { bosses: 0 },                 // run-scoped counters (the only stat not in the gameOver bag)
  _token: null,                       // server-issued run_token for /api/verify
  _last: null,                        // last /api/verify response (debug overlay reads this)

  /* pure: ids satisfied by a stats bag {kills,score,wave,level,bosses,runs,difficulty}. Mirrors the server. */
  evaluate(stats) {
    return this.CATALOG.filter(d => {
      if (d.difficulty && d.difficulty !== stats.difficulty) return false;
      const v = stats[d.metric];
      return typeof v === 'number' && v >= d.threshold;
    }).map(d => d.id);
  },

  /* persistent mirror, keyed per-identity (neon_ach:<player_id>) so two accounts on one browser don't
   * bleed and a sign-in can overwrite it from the cloud. Cache only — /api/verify is authoritative. */
  _key() { try { const p = (typeof getPlayer === 'function') && getPlayer(); return 'neon_ach:' + ((p && p.id) || 'local'); } catch (e) { return 'neon_ach:local'; } },
  /* mirror shape: { unlocked:[ids], cosmetics:[ids], life:{kills,bosses,runs,bestKills,bestScore,bestWave,bestLevel} }.
   * bestKills/best* feed the gallery progress bars (per-metric best-known value); life.kills/bosses/runs are cumulative. */
  _load() {
    try { const r = localStorage.getItem(this._key()) || localStorage.getItem('neon_ach'); if (r) { const s = JSON.parse(r); if (!s.cosmetics) s.cosmetics = []; if (s.life && s.life.bestKills == null) s.life.bestKills = 0; return s; } } catch (e) {}
    return { unlocked: [], cosmetics: [], life: { kills:0, bosses:0, runs:0, bestKills:0, bestScore:0, bestWave:0, bestLevel:0 } };
  },
  _save(s) { try { localStorage.setItem(this._key(), JSON.stringify(s)); } catch (e) {} },

  /* best-known value for a def's metric (drives progress bars). bosses/runs are lifetime; the rest are best-single-run. */
  progressValue(def) {
    const l = this._load().life;
    const m = { kills:l.bestKills||0, score:l.bestScore||0, wave:l.bestWave||0, level:l.bestLevel||0, bosses:l.bosses||0, runs:l.runs||0 };
    return m[def.metric] || 0;
  },
  progressFrac(def) { return Math.max(0, Math.min(1, this.progressValue(def) / def.threshold)); },
  isUnlocked(id) { return this._load().unlocked.indexOf(id) >= 0; },

  /* called from startGame(): reset run counters and (when online) open a server run token */
  onRunStart() {
    this.run = { bosses: 0 };
    this._token = null; this._last = null;
    const p = (typeof getPlayer === 'function') && getPlayer();
    const diff = (typeof DIFF !== 'undefined' && DIFF.key) || 'normal';
    if (!p || typeof SB === 'undefined' || !SB) return;                    // offline / headless → local-only
    try {
      SB.from('runs').insert({ player_id:p.id, difficulty:diff }).select('run_token').single()
        .then(({ data }) => { if (data) this._token = data.run_token; }, () => {});
    } catch (e) {}
  },

  /* called from killEnemy() when a boss falls */
  onBossKill() { this.run.bosses++; },

  /* called from gameOver(): fold the run into lifetime stats, fire optimistic toasts, submit to /api/verify */
  reportRun(entry) {
    const s = this._load(), life = s.life;
    life.runs++; life.kills += (entry.kills | 0); life.bosses += this.run.bosses;
    life.bestKills = Math.max(life.bestKills || 0, entry.kills | 0);
    life.bestScore = Math.max(life.bestScore, entry.score | 0);
    life.bestWave  = Math.max(life.bestWave,  entry.wave | 0);
    life.bestLevel = Math.max(life.bestLevel, entry.level | 0);

    const stats = {
      kills: entry.kills | 0, score: entry.score | 0, wave: entry.wave | 0, level: entry.level | 0,
      bosses: life.bosses, runs: life.runs, difficulty: entry.difficulty,
    };
    const earned = this.evaluate(stats);
    const fresh = earned.filter(id => s.unlocked.indexOf(id) < 0);
    if (fresh.length) { s.unlocked = s.unlocked.concat(fresh); this._grantCosmetics(s, fresh); this._notify(fresh); }
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
    if (s.unlocked.indexOf(id) < 0) { s.unlocked.push(id); this._grantCosmetics(s, [id]); this._notify([id]); }
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
