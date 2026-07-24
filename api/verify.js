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

/* Reuse the SHIPPED cross-language callsign censor (single source of truth — no server-side blocklist to
 * drift from the client). It's a classic browser script that attaches to globalThis; requiring it here just
 * runs that side-effect. Best-effort: if it can't load, cleanName() degrades to a length cap. */
let _CF = null;
try { require('../js/callsign-filter.js'); _CF = (typeof globalThis !== 'undefined' && globalThis.CallsignFilter) || null; } catch (e) { _CF = null; }
function cleanName(raw) {
  const n = (String(raw == null ? '' : raw).trim().slice(0, 16)) || 'anon';
  try { if (_CF && _CF.blocked(n)) return 'anon'; } catch (e) {}
  return n;
}

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
  { id:'bass_cannon',   conds:[['level',15]],     difficulty:null, tier:'silver', chain:null },
  { id:'hypnotic',      conds:[['wave',15]],      difficulty:null, tier:'silver', chain:null },
  // skill (intent-based, cosmetic-only)
  { id:'ghost_grid',        conds:[['noHitWave',10]],                 difficulty:null, tier:'silver', chain:'flawless' },
  { id:'untouchable',       conds:[['noHitWave',20]],                 difficulty:null, tier:'gold',   chain:'flawless' },
  { id:'flawless_protocol', conds:[['flawlessBoss',1]],               difficulty:null, tier:'gold',   chain:null },
  { id:'factory_settings',  conds:[['starterWave',15]],               difficulty:null, tier:'silver', chain:null },
  { id:'overclocked',       conds:[['peakWeapons',3],['wave',15]],    difficulty:null, tier:'silver', chain:null },
  { id:'second_wind',       conds:[['cameback',1]],                   difficulty:null, tier:'bronze', chain:null },
  { id:'glass_cannon',      conds:[['glassWave',12]],                 difficulty:null, tier:'silver', chain:null },
  { id:'weaponsmith',       conds:[['evolutions',1]],                 difficulty:null, tier:'silver', chain:null },
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
  { id:'bare_bones',        conds:[['peakWeapons','<=',1],['wave',20]],difficulty:null, tier:'gold',   chain:null },
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
  pacifist_protocol: 'radiant_aura',
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
  high_scorer:       { kind:'palette', id:'aurora_drift' },
  score_legend:      { kind:'skin',  id:'regent' },
  neon_god:          { kind:'trail', id:'neon_god_trail' },
  wave_rider:        { kind:'music', id:'midnight_jazz',       src:'acoustic' },
  wave_master:       { kind:'music', id:'maelstrom_waltz',     src:'boss1' },
  abyss_walker:      { kind:'skin',  id:'void_warden' },
  power_surge:       { kind:'trail', id:'surge_arc' },
  ascended:          { kind:'palette', id:'violet_void' },
  veteran:           { kind:'music', id:'neon_pop',            src:'pop'   },
  hardcore:          { kind:'skin',  id:'cinder_frame' },
  bass_cannon:       { kind:'music', id:'festival_edm',        src:'edm'    },
  hypnotic:          { kind:'music', id:'hypno_trance',        src:'trance' },
  boss_slayer:       { kind:'palette', id:'crimson_nebula' },
  warden_hunter:     { kind:'music', id:'requiem_hunt',        src:'boss0' },
  warden_legend:     { kind:'trail', id:'warden_halo' },
  ghost_grid:        { kind:'trail', id:'ghost_streak' },
  untouchable:       { kind:'trail', id:'phase_trail' },
  flawless_protocol: { kind:'skin',  id:'wardens_bane' },
  factory_settings:  { kind:'trail', id:'factory_line' },
  overclocked:       { kind:'music', id:'overclock_toccata',   src:'boss1' },
  second_wind:       { kind:'trail', id:'second_wind_gust' },
  glass_cannon:      { kind:'skin',  id:'prism_shard' },
  weaponsmith:       { kind:'trail', id:'evolver_arc' },
  power_spike:       { kind:'trail', id:'spike_trail' },
  ascendant_rush:    { kind:'music', id:'overdrive_rock',      src:'metal' },
  blitz:             { kind:'trail', id:'blitz_streak' },
  killer_instinct:   { kind:'skin',  id:'predator' },
  massacre_clock:    { kind:'music', id:'breakbeat_rap',       src:'rap'   },
  objector:          { kind:'trail', id:'objector_halo' },
  pacifist_protocol: { kind:'skin',  id:'radiant_aura' },
  minimalist:        { kind:'skin',  id:'monoline' },
  ascetic:           { kind:'music', id:'ascetic_nocturne',    src:'classical' },
  bare_bones:        { kind:'music', id:'acoustic_grid',       src:'acoustic'  },
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
  claim.evolutions   = cl(b.evolutions, 0, Math.min(5, Math.max(0, lv - 1)));  // 5 synergies exist; each costs upgrade picks
}

/* per-difficulty plausibility ceilings (mirror DIFFS in js/core.js) — a real score lives under
 * kills·killCeil + earnedTime·secCeil (+ slack). Anything above is fabricated → reject, don't clamp. */
const RATE = {
  easy:   { kill:60,  sec:120 },
  normal: { kill:90,  sec:200 },
  hard:   { kill:160, sec:380 },
};

/* In-game score is 100% kill-driven (world.js: `score += e.sc`) — wall-clock alone never mints a point.
 * So the time term is slack for boss/elite burst score, and it must be EARNED by kills: an AFK bot that
 * just holds a run_token and waits has zero kills, so it gets zero time allowance. We let each kill bank
 * up to KILL_SECS seconds of time slack (≥1 kill per ~3 s covers any real run, where the swarm is
 * relentless — even a 24-kill pacifist scores far under its capped allowance). */
const KILL_SECS = 3;

/* Kills can't outrun the wall clock. Wave spawns grow ~linearly with elapsed time (batch size rises with
 * the minute), so the CUMULATIVE kill count a real run can reach grows ~quadratically in `secs`. killsCeil()
 * is that curve with a wide safety margin (≥3.7× the actual spawn model at every run length / difficulty),
 * so it never rejects real play — but it anchors `kills` to the clock. Without it, `kills` had NO upper
 * bound tied to the wall clock, so a `secs:1` claim with `kills:14e6` lifted the score ceiling to ~2 billion
 * points (red-team C1). Bounding kills also caps the kill-count badge grants (annihilator/massacre_clock). */
function killsCeil(secs) { return secs * 8 + secs * secs * 0.07 + 300; }

/* Level is XP-gated: reaching level L costs a fixed cumulative XP total (world.js: next=8, then
 * next=floor(next·1.32+3)), and a single kill banks at most MAX_KILL_XP experience — a boss under a 2× magnet
 * on Hard is 35·1.4·2 = 98, the hard ceiling; every other kill yields far less. So `kills` bound the level a
 * run can reach. maxLevelForKills() inverts the curve with the generous 100-XP/kill ceiling: it never caps
 * real play, but a forged `level:25` on a 5-kill run (red-team C2) clamps to a non-qualifying level. */
const MAX_KILL_XP = 100;
function maxLevelForKills(kills) {
  let lvl = 1, need = 8, bank = Math.max(0, kills | 0) * MAX_KILL_XP;
  while (bank >= need && lvl < 999) { bank -= need; lvl++; need = Math.floor(need * 1.32 + 3); }
  return lvl;
}

/* Bosses are time-gated: the first Warden spawns at 60 s and the next 50 s after each one falls (world.js),
 * so the count a SINGLE run can reach is bounded by its wall clock. bossesCeil() is that cadence with slack —
 * it caps this run's boss contribution before it's banked into the server-summed lifetime tally (red-team C2,
 * so a throwaway run can't claim `bosses:50` and mint warden_legend). */
function bossesCeil(secs) { return secs < 55 ? 0 : Math.floor((secs - 55) / 40) + 1; }

/* pure, server-authoritative run check. runRow = the trusted `runs` row; c = the client claim. */
function validateRun(runRow, c) {
  if (!runRow) return { ok:false, reason:'unknown_run' };
  if (runRow.verified) return { ok:false, reason:'already_verified' };
  if (c.difficulty !== runRow.difficulty) return { ok:false, reason:'difficulty_mismatch' };
  if (!(c.score >= 0 && c.wave >= 1 && c.kills >= 0 && c.secs >= 0 && c.level >= 1))
    return { ok:false, reason:'bad_range' };
  const elapsed = (Date.now() - new Date(runRow.started_at).getTime()) / 1000;
  if (c.secs > elapsed + 5) return { ok:false, reason:'time_impossible' };       // can't survive longer than the wall clock
  if (c.kills > killsCeil(c.secs)) return { ok:false, reason:'kills_impossible' }; // kills anchored to the clock → can't inflate the score ceiling below
  const r = RATE[c.difficulty] || RATE.normal;
  const earnedSecs = Math.min(c.secs, c.kills * KILL_SECS);                       // idle time (no kills) banks no score
  if (c.score > c.kills * r.kill + earnedSecs * r.sec + 500) return { ok:false, reason:'score_impossible' };
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

/* resolve the caller's authenticated user id from a Supabase session bearer token (GoTrue /auth/v1/user).
 * Returns the uid for a valid USER token, or null when the token is absent/invalid (the legacy-anon path).
 * The service key is never accepted as a user. Never throws — a network hiccup degrades to null, and the
 * handler's no-session branch then refuses to target any registered account. */
async function authUid(req) {
  const h = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  const tok = m && m[1];
  if (!tok || tok === SERVICE_KEY) return null;
  try {
    const res = await fetch(SUPA_URL + '/auth/v1/user', { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + tok } });
    if (!res.ok) return null;
    const u = await res.json();
    return (u && u.id) || null;
  } catch (e) { return null; }
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
  // C2: level is XP-gated, so bound it by kills before it can grant a badge. (kills itself is clock-anchored
  // in validateRun.) `runs`/`bosses` are re-derived from server state below; sanitizeIntent runs once they are.
  claim.level = Math.min(Math.max(1, claim.level), maxLevelForKills(claim.kills));
  let runBosses = 0;   // this run's clock-bounded boss count — banked into the runs row so lifetime sums stay honest

  try {
    // 0) IDENTITY BINDING (red-team H1): a run may only be verified onto a player_id by that player.
    //    A valid session bearer must MATCH the claimed id; and a claim carrying NO session may never target
    //    a registered account (a profiles row) — so a forged/orphaned player_id can't mint onto a real user.
    //    (Legacy/offline anon ids have no profile, so local play keeps writing as before.)
    const uid = await authUid(req);
    if (uid) {
      if (uid !== b.player_id) { res.status(403).json({ accepted:false, reason:'identity_mismatch' }); return; }
    } else {
      let prof = null;
      try { prof = await sb('profiles?select=id&id=eq.' + encodeURIComponent(b.player_id) + '&limit=1'); } catch (e) { prof = null; }
      if (Array.isArray(prof) && prof.length) { res.status(403).json({ accepted:false, reason:'auth_required' }); return; }
    }

    // 0b) RATE LIMIT (red-team M2): cap how many run tokens one identity can burn in a short window. A real
    //     game runs for minutes and opens ONE token, so a generous per-minute ceiling never trips legit play
    //     but throttles board / badge / table-growth spam. Best-effort: a count hiccup never blocks a grant.
    try {
      const since = new Date(Date.now() - 60000).toISOString();
      const recent = await sb('runs?select=run_token&player_id=eq.' + encodeURIComponent(b.player_id) +
                              '&started_at=gte.' + encodeURIComponent(since));
      if (Array.isArray(recent) && recent.length > 30) { res.status(429).json({ accepted:false, reason:'rate_limited' }); return; }
    } catch (e) {}

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

    // 3b) SERVER-DERIVED LIFETIME METRICS (red-team C2): `runs` and `bosses` are re-computed from THIS player's
    //     own verified run history, never trusted from the body. runs = past verified-run count (+1 for the run
    //     we're about to close); bosses = the sum of each past run's clock-bounded boss count plus this run's
    //     (also clock-bounded). So a throwaway run can no longer mint veteran / warden_hunter / warden_legend.
    let priorRuns = 0, priorBosses = 0;
    try {
      const hist = await sb('runs?select=bosses&player_id=eq.' + encodeURIComponent(b.player_id) + '&verified=eq.true');
      if (Array.isArray(hist)) { priorRuns = hist.length; priorBosses = hist.reduce((s, r) => s + (r.bosses | 0), 0); }
    } catch (e) {}
    runBosses = Math.min(bossesCeil(claim.secs), Math.max(0, b.runBosses | 0));
    claim.runs = priorRuns + 1;
    claim.bosses = priorBosses + runBosses;
    sanitizeIntent(claim, b);   // fold intent fields in NOW — clamped against the server-bounded level/bosses

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
      // gold cosmetic ids still ride the response (newCosmetics → the client's local-mirror reconcile),
      // but the legacy cosmetics_inventory table is DEPRECATED and no longer written — user_inventory
      // below is the single cloud inventory (the client's pullInventory reads only it; no reader remains).
      const cos = cosmeticsFor(ids);
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

    // 4d) leaderboard write — server-authoritative, from the SAME re-validated numbers (service role bypasses
    //     RLS; the client `anyone can insert` policy is gone). Best-effort: a leaderboard hiccup must NOT undo
    //     the achievement grant above. Runs once per token — the verified early-return (step 2) blocks replays.
    //     H2: the board name is RESOLVED from the player's set-once, censor-checked profile — never trusted from
    //     the body. A registered player always posts under their unique, filtered callsign (can't impersonate
    //     another player or slip profanity past the censor); an anon/local id with no profile falls back to a
    //     length-capped, filter-screened body name (cleanName), so the callsign filter is no longer bypassable.
    try {
      let uname = 'anon';
      try {
        const prof = await sb('profiles?select=username&id=eq.' + encodeURIComponent(b.player_id) + '&limit=1');
        if (Array.isArray(prof) && prof.length && prof[0].username) uname = String(prof[0].username).slice(0, 16);
        else uname = cleanName(b.username);
      } catch (e) { uname = cleanName(b.username); }
      await sb('leaderboard', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          player_id: b.player_id, username: uname, score: claim.score,
          difficulty: claim.difficulty, wave: claim.wave, secs: claim.secs,
        }),
      });
    } catch (e) {}

    // 5) close the run token (idempotency anchor) — service role only. `bosses` banks THIS run's clock-bounded
    //    count so the next run's lifetime sum (step 3b) is server-authoritative, not re-trusted from the client.
    await sb('runs?run_token=eq.' + encodeURIComponent(b.run_token), {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ verified:true, final_score:claim.score, bosses:runBosses }),
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
module.exports.killsCeil = killsCeil;
module.exports.maxLevelForKills = maxLevelForKills;
module.exports.bossesCeil = bossesCeil;
module.exports.cleanName = cleanName;
module.exports.RATE = RATE;
module.exports.COSMETIC_MAP = COSMETIC_MAP;
module.exports.cosmeticsFor = cosmeticsFor;
module.exports.REWARD_MAP = REWARD_MAP;
module.exports.rewardsFor = rewardsFor;
module.exports.authUid = authUid;
