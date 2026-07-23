/* NEON SURVIVOR — /api/claim.js : one-time legacy-progress re-key (P3).
 * Rescues achievements/rewards/runs stranded under a browser-minted localStorage id (net.js' pre-auth uuid)
 * by re-keying them onto the caller's durable Supabase auth id. Authenticated + safe by construction:
 *   • the DESTINATION id must equal the session bearer's auth.uid() → you can only pull progress INTO your own account;
 *   • a legacy id that is itself a registered account (has a profiles row) is REFUSED → you can't steal another player's badges.
 * Idempotent (a legacy id with no rows is a no-op) and headless-safe. Zero npm deps: Supabase via the Node 18+
 * global fetch, so package.json / pnpm-lock stay untouched. The service-role key lives ONLY in Vercel env.
 *
 * Env (Vercel Project → Settings → Environment Variables):
 *   SUPABASE_URL                = https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   = <service_role secret>   (NEVER put this in js/config.js)
 */

const SUPA_URL = process.env.SUPABASE_URL || process.env.SUPA_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/* resolve the caller's authenticated user id from a session bearer token (GoTrue /auth/v1/user). Returns
 * the uid for a valid USER token, or null when absent/invalid. The service key is never accepted as a user. */
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
  if (req.method !== 'POST') { res.status(405).json({ ok:false, reason:'method_not_allowed' }); return; }
  if (!SUPA_URL || !SERVICE_KEY) { res.status(500).json({ ok:false, reason:'server_unconfigured' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  const newId = b && b.player_id, oldId = b && b.legacy_id;
  if (!newId || !oldId) { res.status(400).json({ ok:false, reason:'bad_request' }); return; }
  if (!UUID_RE.test(String(oldId)) || !UUID_RE.test(String(newId))) { res.status(400).json({ ok:false, reason:'bad_id' }); return; }
  if (oldId === newId) { res.status(200).json({ ok:true, moved:0, note:'noop' }); return; }

  // caller must own the DESTINATION account (bearer → auth.uid() === newId)
  const uid = await authUid(req);
  if (!uid || uid !== newId) { res.status(403).json({ ok:false, reason:'identity_mismatch' }); return; }

  try {
    // refuse to claim a legacy id that is itself a real account (has a profile) — that would be theft
    const prof = await sb('profiles?select=id&id=eq.' + encodeURIComponent(oldId) + '&limit=1');
    if (Array.isArray(prof) && prof.length) { res.status(409).json({ ok:false, reason:'legacy_is_account' }); return; }

    // re-key achievements: copy legacy rows onto the new id (ignore-duplicates on the PK), then delete legacy.
    const rows = await sb('player_achievements?select=achievement_id,run_score,is_unlocked,current_progress&player_id=eq.' + encodeURIComponent(oldId));
    let moved = 0;
    if (Array.isArray(rows) && rows.length) {
      await sb('player_achievements', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(rows.map(r => ({
          player_id: newId, achievement_id: r.achievement_id, run_score: r.run_score | 0,
          is_unlocked: r.is_unlocked !== false, current_progress: r.current_progress | 0,
        }))),
      });
      await sb('player_achievements?player_id=eq.' + encodeURIComponent(oldId), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      moved = rows.length;
    }

    // re-key the unified reward inventory the same way (best-effort — the table may be absent on older deploys)
    try {
      const inv = await sb('user_inventory?select=reward_id,kind&player_id=eq.' + encodeURIComponent(oldId));
      if (Array.isArray(inv) && inv.length) {
        await sb('user_inventory', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(inv.map(r => ({ player_id: newId, reward_id: r.reward_id, kind: r.kind }))),
        });
        await sb('user_inventory?player_id=eq.' + encodeURIComponent(oldId), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      }
    } catch (e) {}

    // runs key on run_token (PK), so re-pointing the owner id can't collide — a straight PATCH (best-effort)
    try { await sb('runs?player_id=eq.' + encodeURIComponent(oldId), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ player_id: newId }) }); } catch (e) {}

    res.status(200).json({ ok:true, moved });
  } catch (e) {
    res.status(500).json({ ok:false, reason:'server_error', detail:String(e && e.message || e) });
  }
};

// exported for headless cross-checks (handler is the Vercel default export)
module.exports.authUid = authUid;
module.exports.UUID_RE = UUID_RE;
