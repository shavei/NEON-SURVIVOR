/* NEON SURVIVOR — /api/meta.js : Vercel Serverless (Node) — THE ARMORY wallet (spend + sync).
 * The server-authoritative counterpart to the browser shop. Signed-in players' Credits + owned upgrade
 * levels live in public.player_meta (owner-read RLS, NO client write policy), so a browser can read but
 * never WRITE its wallet — only this endpoint (service role) can. Earning is handled in /api/verify from
 * server-validated run numbers; this endpoint handles spending and cross-device sync.
 *
 * Actions (POST JSON { action }):
 *   get   → returns the caller's wallet { credits, levels }.
 *   buy   → { action:'buy', upgrade } : server RE-COMPUTES the price from the shipped roster, checks the
 *           server-held balance + level cap, debits + bumps the level ATOMICALLY (meta_mutate, FOR UPDATE),
 *           returns the new wallet. The client never sends a price, so it can't buy cheap or without funds.
 *   adopt → { action:'adopt', guest:{credits,levels} } : ONE-TIME seed of a brand-new account from the
 *           player's pre-account (guest) local wallet, so signing up never wipes an early grind. Gated to
 *           "no existing row" (insert-ignore-duplicates) and the credits are CAPPED, so it can seed at most
 *           a bounded head start once; every credit earned AFTER sign-up is forge-proof via /api/verify.
 *
 * Auth: the wallet is bound to the bearer's auth.uid() (never a body-supplied id), so a caller can only
 * ever touch their OWN wallet. No session → 401 (guests use the local wallet, they don't hit this).
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server only, same as /api/verify).
 */

const SUPA_URL = process.env.SUPABASE_URL || process.env.SUPA_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// shared single source of truth for the roster + price curve + sanitizer (classic browser script; in Node
// it just sets module.exports = Shop). authUid is reused from /api/verify so the bearer→uid logic can't drift.
let _SHOP = null; try { _SHOP = require('../js/shop.js'); } catch (e) { _SHOP = null; }
let _authUid = null; try { _authUid = require('./verify.js').authUid; } catch (e) { _authUid = null; }

const IMPORT_CAP = 3000;   // max credits a one-time guest→account seed may carry (a few early upgrades, not an account-max)

/* thin Supabase REST helper (service-role key, bypasses RLS — trusted server context) */
async function sb(pathAndQuery, opts = {}) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + pathAndQuery, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!res.ok) { const err = new Error('supabase ' + res.status + ': ' + text); err.status = res.status; err.body = text; throw err; }
  return body;
}

async function readWallet(uid) {
  const rows = await sb('player_meta?select=credits,levels&player_id=eq.' + encodeURIComponent(uid) + '&limit=1');
  const r = Array.isArray(rows) && rows[0];
  return r ? { credits: r.credits | 0, levels: r.levels || {} } : { credits: 0, levels: {} };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok:false, reason:'method_not_allowed' }); return; }
  if (!SUPA_URL || !SERVICE_KEY) { res.status(500).json({ ok:false, reason:'server_unconfigured' }); return; }
  if (!_SHOP || !_authUid) { res.status(500).json({ ok:false, reason:'server_unconfigured' }); return; }

  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b) { res.status(400).json({ ok:false, reason:'bad_request' }); return; }

  // identity: the wallet is ALWAYS the bearer's own — never a body-supplied id. No session → not for guests.
  const uid = await _authUid(req);
  if (!uid) { res.status(401).json({ ok:false, reason:'auth_required' }); return; }

  const action = String(b.action || 'get');
  try {
    if (action === 'get') { res.status(200).json({ ok:true, wallet: await readWallet(uid) }); return; }

    if (action === 'buy') {
      const u = _SHOP.CATALOG.find(x => x.id === String(b.upgrade || ''));
      if (!u) { res.status(400).json({ ok:false, reason:'unknown_upgrade' }); return; }
      const w = await readWallet(uid);
      const lv = (w.levels && (w.levels[u.id] | 0)) || 0;
      if (lv >= u.max) { res.status(200).json({ ok:false, reason:'maxed', wallet:w }); return; }
      const cost = _SHOP.cost(u, lv);                                   // SERVER-computed price (client never sends it)
      if (w.credits < cost) { res.status(200).json({ ok:false, reason:'insufficient', wallet:w }); return; }
      try {
        const rows = await sb('rpc/meta_mutate', { method:'POST', body: JSON.stringify({ p_uid: uid, p_earn: 0, p_buy: u.id, p_cost: cost, p_max: u.max }) });
        const r = Array.isArray(rows) ? rows[0] : rows;
        res.status(200).json({ ok:true, bought:u.id, wallet: r ? { credits:r.credits|0, levels:r.levels||{} } : w });
      } catch (e) {
        // meta_mutate raised (concurrent spend lost the race, or cap) — re-read the authoritative wallet and report
        const reason = /insufficient/.test(String(e.body||e.message)) ? 'insufficient' : /maxed/.test(String(e.body||e.message)) ? 'maxed' : 'conflict';
        res.status(200).json({ ok:false, reason, wallet: await readWallet(uid) });
      }
      return;
    }

    if (action === 'respec') {
      // full refund: server recomputes the spent total from the roster, zeroes levels, returns credits.
      // Compare-and-swap on the current balance so a concurrent buy can't be lost; one retry on conflict.
      for (var attempt = 0; attempt < 2; attempt++) {
        var w = await readWallet(uid);
        var refund = 0;
        _SHOP.CATALOG.forEach(function (u) { var lv = (w.levels && (w.levels[u.id] | 0)) || 0; for (var i = 0; i < lv; i++) refund += _SHOP.cost(u, i); });
        var newCredits = Math.min(100000000, w.credits + refund);
        var patched = await sb('player_meta?player_id=eq.' + encodeURIComponent(uid) + '&credits=eq.' + w.credits, {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ credits: newCredits, levels: {}, updated_at: new Date().toISOString() }),
        });
        if (Array.isArray(patched) && patched.length) { res.status(200).json({ ok:true, wallet: { credits: patched[0].credits|0, levels: patched[0].levels||{} } }); return; }
        if (!w.credits && (!w.levels || !Object.keys(w.levels).length)) { res.status(200).json({ ok:true, wallet: w }); return; }  // nothing to refund / no row
      }
      res.status(200).json({ ok:false, reason:'conflict', wallet: await readWallet(uid) });
      return;
    }

    if (action === 'adopt') {
      // one-time seed from the guest local wallet. insert-ignore-duplicates → no-op if a row already exists,
      // so it can never be replayed to stack credits. Credits capped; levels sanitized to the roster bounds.
      const gb = b.guest || {};
      const g = _SHOP._norm({ credits: gb.credits, lv: gb.levels });   // client sends {credits, levels}; _norm reads .lv
      const credits = Math.max(0, Math.min(IMPORT_CAP, g.credits | 0));
      try {
        await sb('player_meta', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify([{ player_id: uid, credits, levels: g.lv }]),
        });
      } catch (e) {}
      res.status(200).json({ ok:true, wallet: await readWallet(uid) });
      return;
    }

    res.status(400).json({ ok:false, reason:'unknown_action' });
  } catch (e) {
    res.status(500).json({ ok:false, reason:'server_error', detail: String((e && e.message) || e) });
  }
};

module.exports.readWallet = readWallet;
module.exports.IMPORT_CAP = IMPORT_CAP;
