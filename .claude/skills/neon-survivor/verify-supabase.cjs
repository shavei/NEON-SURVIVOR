#!/usr/bin/env node
/* NEON SURVIVOR — Supabase leaderboard RLS lockdown check (network-gated, run on demand).
 *   node .claude/skills/neon-survivor/verify-supabase.cjs
 * Reads SUPA_URL/SUPA_ANON_KEY from js/config.js. If unconfigured, SKIPS (exit 0) so the offline verify
 * gate is unaffected. When configured, it asserts the SECURITY property of the /api/verify cutover: an
 * anon client INSERT into leaderboard must be DENIED by RLS (the old "anyone can insert" policy is gone),
 * while the public SELECT (board read) still works. The authoritative write path is /api/verify.js
 * (service role) — covered live by verify-fullcycle.cjs --live, not here. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const cfg = fs.readFileSync(path.resolve(__dirname, '../../../js/config.js'), 'utf8');
const ctx = {}; vm.createContext(ctx); vm.runInContext(cfg + ';this.U=SUPA_URL;this.K=SUPA_ANON_KEY;', ctx);
const URL = ctx.U, KEY = ctx.K;
if (!URL || !KEY || !/^https:\/\//.test(URL) || KEY.length < 20) {
  console.log('SKIP — js/config.js has no Supabase URL/anon key (game runs local-only).'); process.exit(0);
}
const base = URL.replace(/\/$/, '') + '/rest/v1/leaderboard';
const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const row = { player_id: '00000000-0000-4000-8000-000000000000', username: '__verify__', score: 1, difficulty: 'easy', wave: 1, secs: 1 };
(async () => {
  try {
    // 1) anon INSERT must be DENIED by RLS (no client insert policy). PostgREST returns 401/403/42501.
    const ins = await fetch(base, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
    if (ins.ok) {
      const body = await ins.json().catch(() => null);
      console.error('FAIL — anon INSERT was ACCEPTED (leaderboard is still client-writable!):', JSON.stringify(body));
      process.exit(1);
    }
    console.log('PASS (1/2) — anon INSERT denied by RLS (HTTP ' + ins.status + '), as expected after the /api/verify cutover.');
    // 2) public SELECT (board read) must still work.
    const sel = await fetch(base + '?difficulty=eq.easy&order=score.desc&limit=10', { headers });
    if (!sel.ok) throw new Error('select HTTP ' + sel.status + ' (public board read should still be allowed)');
    const rows = await sel.json();
    console.log('PASS (2/2) — public board SELECT works (' + (Array.isArray(rows) ? rows.length : 0) + ' rows). RLS lockdown verified.');
    process.exit(0);
  } catch (e) { console.error('FAIL —', e.message); process.exit(1); }
})();
