/* NEON SURVIVOR — /api/verify.js : Vercel Serverless (Node) run + achievement validator.
 * THE ONLY trusted writer of player_achievements. Holds the service-role key (server env ONLY,
 * never shipped to the browser). A finished run is validated against its server-anchored run token,
 * then achievements are granted from the SERVER's own re-validated numbers — a forged client claim
 * can't mint a badge. Zero npm deps: talks to Supabase via REST using the Node 18+ global fetch,
 * so package.json / pnpm-lock stay untouched and the Vercel build needs no extra install.
 *
 * Env (Vercel Project → Settings → Environment Variables):
 *   SUPABASE_URL                = https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   = <service_role secret>   (NEVER put this in js/config.js)
 */

const SUPA_URL = process.env.SUPABASE_URL || process.env.SUPA_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/* ---- achievement catalog: MUST stay in lockstep with js/achievements.js.
 *      verify-achievements.cjs cross-checks the two are byte-identical. ---- */
const CATALOG = [
  // progression (server-derived)
  { id:'first_blood',   conds:[['kills',1]],      difficulty:null, tier:'bronze', chain:null },
  { id:'swarm_breaker', conds:[['kills',100]],    difficulty:null, tier:'bronze', chain:'combat_kills' },
  { id:'one_man_army',  conds:[['kills',500]],    difficulty:null, tier:'silver', chain:'combat_kills' },
  { id:'annihilator',   conds:[['kills',1000]],   difficulty:null, tier:'gold',   chain:'combat_kills' },
  { id:'high_scorer',   conds:[['score',10000]],  difficulty:null, tier:'bronze', chain:'score_run' },
  { id:'score_legend',  conds:[['score',50000]],  difficulty:null, tier:'silver', chain:'score_run' },
  { id:'neon_god',      conds:[['score',100000]], difficulty:null, tier:'gold',   chain:'score_run' },
  { id:'wave_rider',    conds:[['wave',10]],      difficulty:null, tier:'bronze', chain:'wave_depth' },
  { id:'wave_master',   conds:[['wave',20]],      difficulty:null, tier:'silver', chain:'wave_depth' },
  { id:'abyss_walker',  conds:[['wave',30]],      difficulty:null, tier:'gold',   chain:'wave_depth' },
  { id:'boss_slayer',   conds:[['bosses',1]],     difficulty:null, tier:'bronze', chain:'boss_hunt' },
  { id:'warden_hunter', conds:[['bosses',10]],    difficulty:null, tier:'silver', chain:'boss_hunt' },
  { id:'warden_legend', conds:[['bosses',50]],    difficulty:null, tier:'gold',   chain:'boss_hunt' },
  { id:'power_surge',   conds:[['level',10]],     difficulty:null, tier:'bronze', chain:null },
  { id:'ascended',      conds:[['level',25]],     difficulty:null, tier:'silver', chain:null },
  { id:'veteran',       conds:[['runs',10]],      difficulty:null, tier:'bronze', chain:null },
  { id:'hardcore',      conds:[['wave',10]],      difficulty:'hard', tier:'silver', chain:null },
  // skill (intent-based, cosmetic-only)
  { id:'ghost_grid',        conds:[['noHitWave',10]],                 difficulty:null, tier:'silver', chain:'flawless' },
  { id:'untouchable',       conds:[['noHitWave',20]],                 difficulty:null, tier:'gold',   chain:'flawless' },
  { id:'flawless_protocol', conds:[['flawlessBoss',1]],               difficulty:null, tier:'gold',   chain:null },
  { id:'factory_settings',  conds:[['starterWave',15]],               difficulty:null, tier:'silver', chain:null },
  { id:'overclocked',       conds:[['peakWeapons',3],['wave',15]],    difficulty:null, tier:'silver', chain:null },
  { id:'second_wind',       conds:[['cameback',1]],                   difficulty:null, tier:'bronze', chain:null },
  { id:'glass_cannon',      conds:[['glassWave',12]],                 difficulty:null, tier:'silver', chain:null },
  // speed (server-derived)
  { id:'power_spike',       conds:[['level',10],['secs','<=',90]],    difficulty:null, tier:'bronze', chain:null },
  { id:'ascendant_rush',    conds:[['level',20],['secs','<=',300]],   difficulty:null, tier:'silver', chain:null },
  { id:'blitz',             conds:[['wave',10],['secs','<=',240]],    difficulty:null, tier:'bronze', chain:null },
  { id:'killer_instinct',   conds:[['bossKillSecs','<=',15]],         difficulty:null, tier:'silver', chain:null },
  { id:'massacre_clock',    conds:[['kills',250],['secs','<=',180]],  difficulty:null, tier:'silver', chain:null },
  // challenge / divergence
  { id:'objector',          conds:[['soloWave',8]],                   difficulty:null, tier:'silver', chain:null },
  { id:'pacifist_protocol', conds:[['kills','<=',24],['secs',300]],   difficulty:null, tier:'gold',   chain:null },
  { id:'minimalist',        conds:[['peakWeapons','<=',1],['wave',12]],difficulty:null, tier:'silver', chain:null },
  { id:'ascetic',           conds:[['asceticWave',10]],               difficulty:null, tier:'silver', chain:null },
  // secret (hidden)
  { id:'any_percent',  conds:[['secs','<=',5],['wave',1]],            difficulty:null, tier:'bronze', chain:null },
  { id:'leet',         conds:[['kills','==',1337]],                   difficulty:null, tier:'silver', chain:null },
  { id:'completionist',conds:[['unlockedPct',80]],                    difficulty:null, tier:'gold',   chain:null },
];

/* gold achievement id → cosmetic id. MUST match COSMETIC_MAP in js/achievements.js. A gold grant also
 * drops the mapped cosmetic into cosmetics_inventory in the SAME request — server-validated, unforgeable. */
const COSMETIC_MAP = {
  annihilator:       'crimson_husk',
  abyss_walker:      'void_warden',
  neon_god:          'neon_god_trail',
  warden_legend:     'warden_halo',
  untouchable:       'phase_trail',
  flawless_protocol: 'wardens_bane',
  pacifist_protocol: 'dove_halo',
  completionist:     'prism_core',
};

/* pure: cosmetic ids unlocked by a set of earned achievement ids (gold caps only) */
function cosmeticsFor(ids) {
  return ids.map(id => COSMETIC_MAP[id]).filter(Boolean);
}

/* every achievement id → its unique reward (skin/trail/music). The superset of COSMETIC_MAP: the 8 gold
 * ids reuse their cosmetic id byte-for-byte; the rest add the non-gold + music rewards. Drives the unified
 * user_inventory table. MUST stay in lockstep with REWARD_MAP in js/reward-granting-engine.js —
 * verify-achievements.cjs cross-checks the {kind,id,src} projection. */
const REWARD_MAP = {
  first_blood:       { kind:'trail', id:'first_blood_spark' },
  swarm_breaker:     { kind:'trail', id:'swarm_pulse' },
  one_man_army:      { kind:'skin',  id:'legionnaire' },
  annihilator:       { kind:'skin',  id:'crimson_husk' },
  high_scorer:       { kind:'trail', id:'scorch_trail' },
  score_legend:      { kind:'skin',  id:'regent' },
  neon_god:          { kind:'trail', id:'neon_god_trail' },
  wave_rider:        { kind:'music', id:'tide_overture',       src:'play'  },
  wave_master:       { kind:'music', id:'maelstrom_waltz',     src:'boss1' },
  abyss_walker:      { kind:'skin',  id:'void_warden' },
  power_surge:       { kind:'trail', id:'surge_arc' },
  ascended:          { kind:'trail', id:'ascension_wake' },
  veteran:           { kind:'music', id:'veterans_march',      src:'over'  },
  hardcore:          { kind:'skin',  id:'cinder_frame' },
  boss_slayer:       { kind:'trail', id:'slayer_mark' },
  warden_hunter:     { kind:'music', id:'requiem_hunt',        src:'boss0' },
  warden_legend:     { kind:'trail', id:'warden_halo' },
  ghost_grid:        { kind:'trail', id:'ghost_streak' },
  untouchable:       { kind:'trail', id:'phase_trail' },
  flawless_protocol: { kind:'skin',  id:'wardens_bane' },
  factory_settings:  { kind:'trail', id:'factory_line' },
  overclocked:       { kind:'music', id:'overclock_toccata',   src:'boss1' },
  second_wind:       { kind:'trail', id:'second_wind_gust' },
  glass_cannon:      { kind:'skin',  id:'prism_shard' },
  power_spike:       { kind:'trail', id:'spike_trail' },
  ascendant_rush:    { kind:'music', id:'ascendant_theme',     src:'play'  },
  blitz:             { kind:'trail', id:'blitz_streak' },
  killer_instinct:   { kind:'skin',  id:'predator' },
  massacre_clock:    { kind:'music', id:'clockwork_dies_irae', src:'boss0' },
  objector:          { kind:'trail', id:'objector_halo' },
  pacifist_protocol: { kind:'trail', id:'dove_halo' },
  minimalist:        { kind:'skin',  id:'monoline' },
  ascetic:           { kind:'music', id:'ascetic_nocturne',    src:'menu'  },
  any_percent:       { kind:'trail', id:'any_percent_blip' },
  leet:              { kind:'skin',  id:'leet_chrome' },
  completionist:     { kind:'skin',  id:'prism_core' },
};

/* pure: inventory rows ({reward_id,kind}) unlocked by a set of earned achievement ids (all tiers) */
function rewardsFor(ids) {
  return ids.map(id => REWARD_MAP[id]).filter(Boolean).map(r => ({ reward_id: r.id, kind: r.kind }));
}

/* pure: a cond is [metric,value] (op '>=') or [metric,op,value], op ∈ '>='|'<='|'=='. ALL conds + the
 * difficulty gate must hold. Byte-identical projection to Ach._meets in js/achievements.js. */
function meets(stats, conds, difficulty) {
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
}

/* pure: which achievement ids a stats bag satisfies (difficulty-gated defs require a matching run) */
function evaluate(stats) {
  return CATALOG.filter(d => meets(stats, d.conds, d.difficulty)).map(d => d.id);
}

/* fold the client-asserted intent fields (no-hit, flawless, etc.) into the VALIDATED claim, each clamped
 * to a bound the trusted numbers allow. These grant cosmetic-only badges, so we never reject a run over
 * them — a forged value just clamps to a non-qualifying one. `b` is the raw request body. */
function sanitizeIntent(claim, b) {
  const cl = (n, lo, hi) => Math.max(lo, Math.min(hi, n | 0));
  const w = claim.wave, lv = claim.level, bo = claim.bosses;
  claim.noHitWave   = cl(b.noHitWave,   0, w);                 // can't out-survive the wave you reached
  claim.starterWave = cl(b.starterWave, 0, w);
  claim.soloWave    = cl(b.soloWave,    0, w);
  claim.asceticWave = cl(b.asceticWave, 0, w);
  claim.glassWave   = cl(b.glassWave,   0, w);
  claim.flawlessBoss = cl(b.flawlessBoss, 0, bo);              // can't flawless more bosses than you killed
  claim.peakWeapons  = cl(b.peakWeapons, 0, Math.min(3, Math.max(0, lv - 1)));  // each weapon costs a level-up
  claim.bossKillSecs = bo >= 1 ? cl(b.bossKillSecs, 0, Math.max(claim.secs, 0)) : 9999;  // no boss → no fast kill
  claim.cameback     = (b.cameback && w >= 2) ? 1 : 0;         // a comeback means surviving into a new wave
}

/* per-difficulty plausibility ceilings (mirror DIFFS in js/core.js) — a real score lives under
 * kills·killCeil + secs·secCeil (+ slack). Anything above is fabricated → reject, don't clamp. */
const RATE = {
  easy:   { kill:60,  sec:120 },
  normal: { kill:90,  sec:200 },
  hard:   { kill:160, sec:380 },
};

/* pure, server-authoritative run check. runRow = the trusted `runs` row; c = the client claim. */
function validateRun(runRow, c) {
  if (!runRow) return { ok:false, reason:'unknown_run' };
  if (runRow.verified) return { ok:false, reason:'already_verified' };
  if (c.difficulty !== runRow.difficulty) return { ok:false, reason:'difficulty_mismatch' };
  if (!(c.score >= 0 && c.wave >= 1 && c.kills >= 0 && c.secs >= 0 && c.level >= 1))
    return { ok:false, reason:'bad_range' };
  const elapsed = (Date.now() - new Date(runRow.started_at).getTime()) / 1000;
  if (c.secs > elapsed + 5) return { ok:false, reason:'time_impossible' };       // can't survive longer than the wall clock
  const r = RATE[c.difficulty] || RATE.normal;
  if (c.score > c.kills * r.kill + c.secs * r.sec + 500) return { ok:false, reason:'score_impossible' };
  if (c.wave > 1 && c.kills < (c.wave - 1)) return { ok:false, reason:'wave_kill_mismatch' };
  return { ok:true };
}

/* thin Supabase REST helper using the service-role key (bypasses RLS — trusted server context) */
async function sb(pathAndQuery, opts = {}) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + pathAndQuery, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!res.ok) throw new Error('supabase ' + res.status + ': ' + text);
  return body;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ accepted:false, reason:'method_not_allowed' }); return; }
  if (!SUPA_URL || !SERVICE_KEY) { res.status(500).json({ accepted:false, reason:'server_unconfigured' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || !b.player_id || !b.run_token) { res.status(400).json({ accepted:false, reason:'bad_request' }); return; }

  const claim = {
    score: b.score | 0, wave: b.wave | 0, secs: b.secs | 0, kills: b.kills | 0,
    level: b.level | 0, bosses: b.bosses | 0, runs: b.runs | 0, difficulty: String(b.difficulty || ''),
  };
  sanitizeIntent(claim, b);   // fold client-asserted intent fields in, each clamped to a plausible bound

  try {
    // 1) fetch the trusted run row (must belong to this player)
    const rows = await sb('runs?select=*&run_token=eq.' + encodeURIComponent(b.run_token) +
                          '&player_id=eq.' + encodeURIComponent(b.player_id));
    const runRow = Array.isArray(rows) ? rows[0] : null;

    // 2) idempotency: a verified token returns its stored grant, never double-grants
    if (runRow && runRow.verified) {
      const owned = await sb('player_achievements?select=achievement_id&player_id=eq.' + encodeURIComponent(b.player_id));
      const ids = (owned||[]).map(r => r.achievement_id);
      res.status(200).json({ accepted:true, replayed:true, newAchievements:ids, newCosmetics:cosmeticsFor(ids) });
      return;
    }

    // 3) validate the claim against the server's own anchor
    const v = validateRun(runRow, claim);
    if (!v.ok) { res.status(200).json({ accepted:false, reason:v.reason }); return; }

    // 4) grant: compute earned ids from the VALIDATED numbers, insert ignoring duplicates.
    //    is_unlocked=true / current_progress=driver-cond value mark these rows as completed badges.
    const driverVal = d => { const c = (d.conds && d.conds[0]) || []; return (c.length === 2 ? c[1] : c[2]) | 0; };
    const grant = async ids => {
      if (!ids.length) return;
      const byId = id => CATALOG.find(d => d.id === id) || { conds: [] };
      await sb('player_achievements', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(ids.map(id => ({
          player_id: b.player_id, achievement_id: id, run_score: claim.score,
          is_unlocked: true, current_progress: driverVal(byId(id)),
        }))),
      });
      const cos = cosmeticsFor(ids);
      if (cos.length) await sb('cosmetics_inventory', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(cos.map(cid => ({ player_id: b.player_id, cosmetic_id: cid }))),
      });
      // unified reward inventory (skins/trails/tracks, all tiers). Best-effort: a missing user_inventory
      // table must NOT fail the authoritative player_achievements grant above, so swallow its error.
      const rewards = rewardsFor(ids);
      if (rewards.length) { try { await sb('user_inventory', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(rewards.map(r => ({ player_id: b.player_id, reward_id: r.reward_id, kind: r.kind }))),
      }); } catch (e) {} }
      return cos;
    };
    const earned = evaluate(claim);
    const newCosmetics = (await grant(earned)) || [];

    // 4c) meta: "completionist" depends on how many OTHER achievements this player now owns. Recount from
    //     the table (authoritative) and grant once the threshold cond is met — server-derived, unforgeable.
    let metaEarned = [];
    try {
      const ownedRows = await sb('player_achievements?select=achievement_id&player_id=eq.' + encodeURIComponent(b.player_id));
      const ownedIds = (ownedRows || []).map(r => r.achievement_id);
      const others = CATALOG.filter(d => d.id !== 'completionist').length;
      const ownedOthers = ownedIds.filter(id => id !== 'completionist').length;
      claim.unlockedPct = others ? Math.floor(ownedOthers / others * 100) : 0;
      metaEarned = evaluate(claim).filter(id => ownedIds.indexOf(id) < 0);   // = ['completionist'] when it crosses
      const metaCos = (await grant(metaEarned)) || [];
      metaCos.forEach(c => { if (newCosmetics.indexOf(c) < 0) newCosmetics.push(c); });
    } catch (e) {}
    earned.push(...metaEarned);

    // 5) close the run token (idempotency anchor) — service role only
    await sb('runs?run_token=eq.' + encodeURIComponent(b.run_token), {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ verified:true, final_score:claim.score }),
    });

    res.status(200).json({ accepted:true, newAchievements:earned, newCosmetics });
  } catch (e) {
    res.status(500).json({ accepted:false, reason:'server_error', detail:String(e && e.message || e) });
  }
};

// exported for headless cross-checks in verify-achievements.cjs (handler is the Vercel default)
module.exports.CATALOG = CATALOG;
module.exports.evaluate = evaluate;
module.exports.meets = meets;
module.exports.sanitizeIntent = sanitizeIntent;
module.exports.validateRun = validateRun;
module.exports.RATE = RATE;
module.exports.COSMETIC_MAP = COSMETIC_MAP;
module.exports.cosmeticsFor = cosmeticsFor;
module.exports.REWARD_MAP = REWARD_MAP;
module.exports.rewardsFor = rewardsFor;
