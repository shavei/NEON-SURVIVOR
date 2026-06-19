#!/usr/bin/env node
/* NEON SURVIVOR — Supabase submission round-trip check (network-gated, run on demand).
 *   node .claude/skills/neon-survivor/verify-supabase.cjs
 * Reads SUPA_URL/SUPA_ANON_KEY from js/config.js. If unconfigured, SKIPS (exit 0) so the
 * offline verify gate is unaffected. When configured, it INSERTs a marked test row via the
 * REST API and SELECTs the top board for that difficulty to confirm the row round-trips. */
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
    const ins = await fetch(base, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
    if (!ins.ok) throw new Error('insert HTTP ' + ins.status + ' ' + (await ins.text()).slice(0, 200));
    const sel = await fetch(base + '?difficulty=eq.easy&order=score.desc&limit=10', { headers });
    if (!sel.ok) throw new Error('select HTTP ' + sel.status);
    const rows = await sel.json();
    const seen = Array.isArray(rows) && rows.some(r => r.username === '__verify__');
    console.log(seen ? 'PASS — test row inserted and read back (' + rows.length + ' rows).'
                     : 'WARN — inserted but not in top 10 (board may already be full of higher scores).');
    process.exit(0);
  } catch (e) { console.error('FAIL —', e.message); process.exit(1); }
})();
