#!/usr/bin/env node
/* NEON SURVIVOR — verify-size.cjs : the 28 KB silent-truncation guard.
 *   node .claude/skills/neon-survivor/verify-size.cjs
 * Served classic scripts (js/*.js, listed in index.html) are concatenated into one global scope at
 * runtime, but each is fetched as its OWN file — and a file pushed past ~28 KB is silently TRUNCATED
 * (the tail vanishes with no error), which is how a "one-liner" edit can quietly break a module. This
 * harness fails loudly the moment any served module crosses the line, so an edit is caught BEFORE it
 * ships. The verify*.cjs harnesses themselves are never served, so they are intentionally not checked. */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');

const LIMIT = 28 * 1024;   // 28672 — the silent-truncation ceiling
const WARN  = LIMIT - 1024; // flag the last 1 KB of headroom so a near-full module gets attention early

// the authoritative list = exactly the <script src> tags index.html serves (order preserved)
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]).filter(s => s.endsWith('.js'));

let fail = 0, warn = 0;
console.log('  bytes   / 28672   headroom  module');
console.log('  ------------------------------------------------');
srcs.forEach(s => {
  const bytes = fs.statSync(path.join(ROOT, s)).size;
  const head = LIMIT - bytes;
  const mark = bytes > LIMIT ? 'TRUNCATED' : bytes > WARN ? 'WARN' : 'ok';
  if (bytes > LIMIT) fail++; else if (bytes > WARN) warn++;
  console.log('  ' + String(bytes).padStart(6) + '            ' + String(head).padStart(6) + '   ' + s + '  ' + (mark === 'ok' ? '' : '<< ' + mark));
});

console.log('  ------------------------------------------------');
if (fail) console.error('\nSIZE — ' + fail + ' MODULE(S) OVER 28 KB (silent truncation risk)');
else if (warn) console.log('\nSIZE — ALL UNDER 28 KB (' + warn + ' within the final 1 KB — watch these)');
else console.log('\nSIZE — ALL PASS (every served module under 28 KB)');
process.exit(fail ? 1 : 0);
