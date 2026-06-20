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
  { id:'first_blood',   metric:'kills',  threshold:1,     difficulty:null },
  { id:'swarm_breaker', metric:'kills',  threshold:100,   difficulty:null },
  { id:'one_man_army',  metric:'kills',  threshold:500,   difficulty:null },
  { id:'high_scorer',   metric:'score',  threshold:10000, difficulty:null },
  { id:'score_legend',  metric:'score',  threshold:50000, difficulty:null },
  { id:'wave_rider',    metric:'wave',   threshold:10,    difficulty:null },
  { id:'wave_master',   metric:'wave',   threshold:20,    difficulty:null },
  { id:'boss_slayer',   metric:'bosses', threshold:1,     difficulty:null },
  { id:'warden_hunter', metric:'bosses', threshold:10,    difficulty:null },
  { id:'power_surge',   metric:'level',  threshold:10,    difficulty:null },
  { id:'ascended',      metric:'level',  threshold:25,    difficulty:null },
  { id:'veteran',       metric:'runs',   threshold:10,    difficulty:null },
  { id:'hardcore',      metric:'wave',   threshold:10,    difficulty:'hard' },
];

/* pure: which achievement ids a stats bag satisfies (difficulty-gated defs require a matching run) */
function evaluate(stats) {
  return CATALOG.filter(d => {
    if (d.difficulty && d.difficulty !== stats.difficulty) return false;
    const v = stats[d.metric];
    return typeof v === 'number' && v >= d.threshold;
  }).map(d => d.id);
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

  try {
    // 1) fetch the trusted run row (must belong to this player)
    const rows = await sb('runs?select=*&run_token=eq.' + encodeURIComponent(b.run_token) +
                          '&player_id=eq.' + encodeURIComponent(b.player_id));
    const runRow = Array.isArray(rows) ? rows[0] : null;

    // 2) idempotency: a verified token returns its stored grant, never double-grants
    if (runRow && runRow.verified) {
      const owned = await sb('player_achievements?select=achievement_id&player_id=eq.' + encodeURIComponent(b.player_id));
      res.status(200).json({ accepted:true, replayed:true, newAchievements:(owned||[]).map(r => r.achievement_id) });
      return;
    }

    // 3) validate the claim against the server's own anchor
    const v = validateRun(runRow, claim);
    if (!v.ok) { res.status(200).json({ accepted:false, reason:v.reason }); return; }

    // 4) grant: compute earned ids from the VALIDATED numbers, insert ignoring duplicates
    const earned = evaluate(claim);
    if (earned.length) {
      const payload = earned.map(id => ({
        player_id: b.player_id, achievement_id: id, run_score: claim.score,
      }));
      await sb('player_achievements', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(payload),
      });
    }

    // 5) close the run token (idempotency anchor) — service role only
    await sb('runs?run_token=eq.' + encodeURIComponent(b.run_token), {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ verified:true, final_score:claim.score }),
    });

    res.status(200).json({ accepted:true, newAchievements:earned });
  } catch (e) {
    res.status(500).json({ accepted:false, reason:'server_error', detail:String(e && e.message || e) });
  }
};

// exported for headless cross-checks in verify-achievements.cjs (handler is the Vercel default)
module.exports.CATALOG = CATALOG;
module.exports.evaluate = evaluate;
module.exports.validateRun = validateRun;
module.exports.RATE = RATE;
