/* NEON SURVIVOR — achievements.js : client catalog, progress tracking, optimistic unlock UI.
 * Classic global (loads AFTER net.js/network.js, BEFORE main.js). Headless/offline-safe — every
 * DOM/network/storage touch is guarded, so verify.cjs loads it and offline play still works.
 *
 * Trust model: the client tracks progress and shows badges OPTIMISTICALLY for instant feedback,
 * but the authoritative grant is /api/verify.js (service role). A run opens a server `run_token`
 * at startGame and submits its finished stats at gameOver; the server re-validates and grants.
 * Local unlocks are a mirror for display — they never write the DB (RLS forbids it anyway). */

/* ---- catalog: id/metric/threshold/difficulty MUST match api/verify.js (verify-achievements.cjs checks) ---- */
const ACH_CATALOG = [
  { id:'first_blood',   metric:'kills',  threshold:1,     difficulty:null, ico:'🩸', title:'Draw First Blood', desc:'Get your first kill.' },
  { id:'swarm_breaker', metric:'kills',  threshold:100,   difficulty:null, ico:'💥', title:'Swarm Breaker',    desc:'Kill 100 enemies in a single run.' },
  { id:'one_man_army',  metric:'kills',  threshold:500,   difficulty:null, ico:'⚔️', title:'One-Man Army',     desc:'Kill 500 enemies in a single run.' },
  { id:'high_scorer',   metric:'score',  threshold:10000, difficulty:null, ico:'🏆', title:'High Scorer',      desc:'Score 10,000 in a single run.' },
  { id:'score_legend',  metric:'score',  threshold:50000, difficulty:null, ico:'👑', title:'Score Legend',     desc:'Score 50,000 in a single run.' },
  { id:'wave_rider',    metric:'wave',   threshold:10,    difficulty:null, ico:'🌊', title:'Wave Rider',       desc:'Reach wave 10.' },
  { id:'wave_master',   metric:'wave',   threshold:20,    difficulty:null, ico:'🌀', title:'Wave Master',      desc:'Reach wave 20.' },
  { id:'boss_slayer',   metric:'bosses', threshold:1,     difficulty:null, ico:'💀', title:'Boss Slayer',      desc:'Defeat your first Warden.' },
  { id:'warden_hunter', metric:'bosses', threshold:10,    difficulty:null, ico:'☠️', title:'Warden Hunter',    desc:'Defeat 10 Wardens (lifetime).' },
  { id:'power_surge',   metric:'level',  threshold:10,    difficulty:null, ico:'⚡', title:'Power Surge',      desc:'Reach level 10 in a single run.' },
  { id:'ascended',      metric:'level',  threshold:25,    difficulty:null, ico:'✨', title:'Ascended',         desc:'Reach level 25 in a single run.' },
  { id:'veteran',       metric:'runs',   threshold:10,    difficulty:null, ico:'🎖️', title:'Veteran',          desc:'Finish 10 runs (lifetime).' },
  { id:'hardcore',      metric:'wave',   threshold:10,    difficulty:'hard',ico:'🔥', title:'Hardcore',         desc:'Reach wave 10 on Hard.' },
];

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

  /* persistent mirror in localStorage: { unlocked:[ids], life:{kills,bosses,runs,bestScore,bestWave,bestLevel} } */
  _load() {
    try { const r = localStorage.getItem('neon_ach'); if (r) return JSON.parse(r); } catch (e) {}
    return { unlocked: [], life: { kills:0, bosses:0, runs:0, bestScore:0, bestWave:0, bestLevel:0 } };
  },
  _save(s) { try { localStorage.setItem('neon_ach', JSON.stringify(s)); } catch (e) {} },

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
    life.bestScore = Math.max(life.bestScore, entry.score | 0);
    life.bestWave  = Math.max(life.bestWave,  entry.wave | 0);
    life.bestLevel = Math.max(life.bestLevel, entry.level | 0);

    const stats = {
      kills: entry.kills | 0, score: entry.score | 0, wave: entry.wave | 0, level: entry.level | 0,
      bosses: life.bosses, runs: life.runs, difficulty: entry.difficulty,
    };
    const earned = this.evaluate(stats);
    const fresh = earned.filter(id => s.unlocked.indexOf(id) < 0);
    if (fresh.length) { s.unlocked = s.unlocked.concat(fresh); this._notify(fresh); }
    this._save(s);

    this._submit(entry, stats);     // authoritative grant (no-op offline/headless)
    return fresh;
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
          if (add.length) { s.unlocked = s.unlocked.concat(add); this._save(s); this._notify(add); }
        }
      }, () => {});
    } catch (e) {}
  },

  /* unlock feedback: reuse the in-world toast (world.js) so it matches the game's voice */
  _notify(ids) {
    if (typeof showToast !== 'function') return;
    ids.forEach((id, i) => {
      const d = this.CATALOG.find(x => x.id === id); if (!d) return;
      // stagger so multiple unlocks don't stack on one frame (toast is single-slot)
      setTimeout(() => showToast(d.ico, 'ACHIEVEMENT — ' + d.title, '#ffd95e'), 1200 * i);
    });
  },

  /* main-menu panel: every badge, locked ones dimmed */
  renderPanel() {
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
