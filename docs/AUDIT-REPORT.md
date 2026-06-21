# NEON SURVIVOR — System-Wide Functional & Security Audit

**Date:** 2026-06-21 · **Branch:** `claude/zealous-brown-lqmi2i` · **Method:** 4 parallel specialist
subagents (networking / cloud-security / game-logic / UI-infra) + main-context truncation &
harness baseline. Every finding is grounded in a `file:line` reference.

## Verdict: ❌ NOT Production Ready

Blocking reasons (must clear before certification):
1. **Multiplayer co-op forks the world** the moment any player levels up (3 independent agents found this).
2. **Leaderboard & achievement writes have no server-side identity/authority** — scores and badges are forgeable from the browser.
3. **The verification harness itself is partly red** — 4 of 11 verifiers crash on stale file lists, so the "all verifies green" push-gate currently cannot be satisfied.

---

## Severity Summary

| Sev | Count | Headline |
|-----|-------|----------|
| Critical | 4 | Co-op world-fork on level-up · forgeable scores · spoofable `player_id` · broken verify harness |
| High | 8 | Identity localStorage fallback · spoofable run anchor · waitable time-gate · XP double-count risk · unsynced projectile params · unreachable host-migration · dual input-capture · no CI |
| Medium | 12 | client-supplied lifetime counters · loose rate ceilings · `world_state` open writes · gameOver tears down lockstep · hash blind to upgrades · seed re-apply · regen untested · post-boss spawn spike · no `vercel.json` · teammates off minimap · minimap size mismatch · gold/gold palette |
| Low | 9 | tracer spam · stale `saveWorld` host gate · verify race · lifesteal comment · unbounded spawn · unused dep · no SRI · dead CSS rule · main.js near truncation |

---

## CRITICAL

### C1 — Co-op level-ups/upgrades are never synced → guaranteed world fork
`js/sim.js:248` → `js/world.js:140-143` (`gainXPShared`); compare solo `js/world.js:388` + `js/sim.js:149`.
`updateShared()` (the lockstep sim) collects XP via `gainXPShared`, which raises `a.level`/`a.next`
but **never sets `pendingLevels`** and never opens the upgrade card. `applyUpgrade` only mutates the
local `player` and is never broadcast. So every machine grows different `dmg/multi/pierce` →
different bullets (C-ref `js/sim.js:228`) → different kills → the shared world diverges permanently.
**Corroborated independently by all three of the networking, game-logic, and (via path) review agents.**
The desync hash (`js/network-sync.js:180-189`, see M5) does not include upgrade state, so the guard
can't even see the fork.
**Verify:** extend `verify-lockstep-live.cjs` to drive two machines past an XP threshold and assert an
identical upgrade-pick path + identical `bullets.length`/`worldHash` afterward.

### C2 — `/api/verify` trusts a client-supplied `player_id` (no `auth.uid()` / JWT check)
`api/verify.js:89,98-99`.
The endpoint reads `player_id` straight from the POST body and never validates it against a Supabase
session bearer token. Combined with C/H2 (a run token any client can open for any id), an attacker
mints achievements onto **another player's account**. The design doc flags this as a deferred,
unshipped item — it is a known-open gap, not an accident.
**Verify:** `curl -X POST <deploy>/api/verify -d '{"player_id":"<victim-uuid>","run_token":"<self-opened>",...}'`
→ observe a 200 grant for an id you don't own.

### C3 — Leaderboard accepts forged scores with ZERO server validation
`supabase/schema.sql:29-34` ("anyone can insert") + `js/net.js:40-46` (`submitScore` → direct anon insert).
Trace end-to-end: `gameOver` → `submitScore(entry)` → `SB.from('leaderboard').insert(row)` under the
anon key. RLS checks only username length / `score>=0` / difficulty enum — **no `auth.uid()` binding,
no run-token, no rate ceiling.** `/api/verify`'s plausibility checks never touch the leaderboard path.
Any browser can post `score: 2000000000`.
**Verify:** in devtools `SB.from('leaderboard').insert({player_id:'x',username:'hax',score:2e9,difficulty:'hard',wave:99,secs:1})`
→ appears atop `fetchTop('hard')`.

### C4 — The verification harness is itself broken (the push-gate cannot go green)
4 of 11 verifiers crash at load: `verify-determinism.cjs`, `verify-lockstep.cjs`,
`verify-lockstep-live.cjs`, `verify-equiv.cjs` all throw `ReferenceError: confirmUsername is not defined`.
Root cause: `confirmUsername` is defined in `js/achievement-sync.js:161` and referenced at load time in
`js/main.js:264`, but these verifiers' **hardcoded file lists omit `achievement-sync.js`** (and
`leaderboard-*.js`, `net.js`, `network.js`, `achievements.js`) — they predate those files joining the
`index.html` load order. They build an incomplete page, so `main.js` references a missing global.
CLAUDE.md forbids pushing unless "all `verify*.cjs` pass" — today that is impossible.
(`verify-supabase.cjs` also fails, but only on sandbox network egress to `*.supabase.co` — environmental,
not a code defect.)
**Verify:** `node .claude/skills/neon-survivor/verify-lockstep.cjs` → ReferenceError; fix = add the
missing files to each verifier's concat list to match `index.html` order, then re-run to green.

---

## HIGH

- **H1 — Identity falls back to a client-minted localStorage UUID.** `js/net.js:11-19`. Offline/unauthed
  `player_id` is a random UUID in `localStorage.neon_player`; set it to any value to act as that identity.
  *Verify:* set `localStorage.neon_player` to a target uuid, submit a score, row lands under target id.
- **H2 — `runs` insert not bound to `auth.uid()`.** `supabase/schema.sql:93-94`. Open-run policy checks
  only `verified=false and final_score is null`; any client opens a run token for any `player_id` — the
  exact anchor `/api/verify` later trusts (feeds C2). *Verify:* anon `insert into runs(player_id:'<victim>')` succeeds.
- **H3 — `started_at` time-gate is bypassable by waiting.** `api/verify.js:58-59`. `secs` ceiling is just
  wall-clock; open a token, wait N seconds, submit `secs=N` under the rate formula → accepted. The gate
  stops forgery, not patience. *Verify:* open run, sleep N, submit, observe accept.
- **H4 — Legacy `applyXP` double-count risk.** `js/multiplayer-combat.js:190-192` vs lockstep
  `js/world.js:140`. Two XP mechanisms coexist; `applyXP` has no idempotency/sequence guard. Currently
  masked only because `netTick` early-returns under lockstep (H6) — one regression from double-grant.
  *Verify:* assert the two XP paths are mutually exclusive while `NetSync.lockstep` is true (no test does).
- **H5 — Remote projectile parameters are non-deterministic.** `js/sim.js:228`, `js/world.js:220-228`.
  `updateShared` spawns real shared bullets (good) but count/damage/pierce come from per-avatar
  `a.multi/a.dmg/a.pierce` which never sync (C1) → each machine spawns a different volley.
  *Verify:* two-machine test, apply upgrade on one side, hash `bullets.length` after a few fire cycles.
- **H6 — Host-timeout migration is unreachable under lockstep.** `js/multiplayer-combat.js:104-118`.
  `netTick()` returns when `NetSync.lockstep` is true, so the `HOST_TIMEOUT` self-promote never runs. A
  hard-crashed (not cleanly-left) peer freezes everyone until Presence eviction (~5s, `js/network.js:17`).
  *Verify:* `verify-lockstep-live.cjs` case where a peer never recovers; assert world resumes after roster cull.
- **H7 — Dual input-capture into one ring.** `js/sim.js:19` (`NetSync.localInput`) vs
  `js/network-sync.js:154-158` (`_sendInput`). Both can push to `_pending` with different tick semantics
  (`frame` vs `_tick`); no guard between them → ring corruption if both ever run.
  *Verify:* run `localInput` and `stepShared` against one ring (no current test does).
- **H8 — No CI; documented 3-gate push policy is unenforced.** No `.github/` directory exists.
  `package.json` defines 5 `verify*` scripts and CLAUDE.md mandates green verifies + vercel build before
  every push, but nothing runs them on a PR. *Verify:* `ls .github/workflows` → absent.

---

## MEDIUM

- **M1 — Lifetime counters `runs`/`bosses`/`level` are client-supplied & unverified.** `api/verify.js:91-93`
  + `js/achievements.js:71-79`. A first-ever run can claim `runs:10, bosses:10` and mint `veteran`/`warden_hunter`.
- **M2 — Rate ceilings are loose enough to mint most badges in one waited run.** `api/verify.js:45-49,61`.
  `level/bosses/runs` have no independent bound; `kills` bounded only by `wave-1`.
- **M3 — `world_state` is anon-writable by any room name.** `supabase/schema.sql:175-178`. Any client can
  overwrite/poison any room's snapshot (room-length check only).
- **M4 — `gameOver()`→`Coop.spectate()` tears down lockstep mid-run.** `js/main.js:138-139`, `js/sim.js:254-256`.
  Local death calls `NetSync.stop()/exitLockstep()` while peers still expect this avatar's tick input → peers stall.
- **M5 — `worldHash` is blind to upgrade/level/bullets.** `js/network-sync.js:180-189`. The desync guard
  can't detect the C1 fork — it hashes positions/score/enemies/orbs only.
- **M6 — Seed re-applies on roster change → RNG reset mid-run.** `js/network-sync.js:44-51`. A lower-id peer
  joining (or authority leaving) re-runs `seedRng`, forking all subsequent spawns. No "seed locked once active" guard.
- **M7 — Regen upgrade is effectively untested.** `verify-upgrades.cjs:56,63`. The harness watches a field
  named `regen`, but the real field is `regenRate` (`js/world.js:362`); the check is vacuous. (Regen logic
  itself is correct: `+=1`/purchase, applied as `regenRate/60` per tick at `js/sim.js:38`.) Fix: watch `regenRate`.
- **M8 — Post-boss-death spawn spike.** `js/sim.js:60-61` + `js/world.js:249`. On boss death `bossOn=false`
  un-throttles both spawn *rate* (`spawnMul 2.2→1`) and *count* (`spawnCountMul 0.5→1`) on the same tick → a
  large first batch. *Verify:* instrument `c` in the spawn block; kill a late boss and watch the next batch.
- **M9 — No `vercel.json` despite an `api/` function.** Zero-config likely works (`api/verify.js` auto-detected),
  but nothing pins Node runtime/`maxDuration`/headers/rewrites for the trusted validator. *Verify:* `vercel build`, inspect function bundling + selected Node version.
- **M10 — Co-op teammates are not drawn on the minimap.** `js/ui-engine.js:10-34`. Remote players have no
  minimap marker though they render in-world (`js/render.js:121-145`) — can't locate squadmates off-screen.
- **M11 — Minimap render size (160) ≠ coarse-pointer CSS size (108).** `js/ui-engine.js:7` / `index.html:31`
  vs `css/style.css:283`. Cosmetic (CSS downscale); markers stay correct but it's blurry/wasteful.
- **M12 — Gold XP orbs share the gold boss-ring palette.** `js/ui-engine.js:17` vs `:31`. Differentiation
  relies on size/blink, not hue — a quick-glance / colorblind readability gap.

---

## LOW

- **L1** — Legacy `'shot'` tracer still broadcasts under lockstep (wasted bandwidth, harmless). `js/world.js:228`→`js/multiplayer-combat.js:224`.
- **L2** — `saveWorld` gates on stale `Coop.host` under lockstep; snapshot authority may be wrong/stale. `js/network-sync.js:198`.
- **L3** — `/api/verify` race between the verified-check and the PATCH; dup inserts deduped by `ignore-duplicates`. `api/verify.js:103-129`.
- **L4** — Lifesteal "~10 HP/s" comment only holds at `lifesteal===1`; scales with stacks. `js/world.js:262-263`.
- **L5** — Spawn count grows unbounded (linear `1+floor(elapsed/70)`), no cap. `js/sim.js:61`.
- **L6** — `@vercel/speed-insights` declared as a dep but loaded via CDN; `pnpm install` pulls an unused package. `package.json:20-22` / `index.html:9-12`.
- **L7** — Speed-Insights CDN module has no SRI / fallback (non-fatal; offline-safe game still boots). `index.html:9-12`.
- **L8** — `.menupanels` sets `flex-direction` on a `display:grid` element (dead property); works only by `auto-fit` accident. `css/style.css:80,264`.
- **L9 (Architecture)** — see Truncation Guard below.

---

## Architecture & Token Discipline — Truncation Guard

28 KB = the silent-truncation threshold. Current core-file sizes:

| File | Bytes | % of 28 KB | Status |
|------|-------|-----------|--------|
| **js/main.js** | 25,965 | **90 %** | ⚠️ **Watch — approaching limit** |
| js/core.js | 22,530 | 78 % | watch |
| js/world.js | 21,770 | 75 % | watch |
| js/audio-engine.js | 19,412 | 67 % | ok |
| js/sim.js | 17,442 | 61 % | ok |
| js/multiplayer-combat.js | 17,052 | 59 % | ok |

**L9 — `js/main.js` is at 90 % of the truncation limit.** Proposed modularization (behavior-preserving,
must pass an *un-stubbed* `verify-equiv.cjs`):
- Peel the **auth/username modal + global-board UI** (`showAuth`/`confirmUsername` wiring, `renderGlobal`,
  `#gtabs` handlers ≈ `js/main.js:220-269`) into `js/menu-ui.js`, loaded **after** `achievement-sync.js`
  and **before** `main.js`. This also removes the load-order fragility behind C4.
- Keep the loop/init/flow in `main.js`. Update `index.html` script order + the CLAUDE.md file map in the
  same commit. Add a hard size check (fail >26 KB) to `verify.cjs` so this never regresses silently.
- core.js / world.js are next on the watch list — apply the `docs/AUDIT_PLAN.md` Phase-1 split (sprite
  cache → `js/sprites.js`) if either crosses ~24 KB.

---

## Verification Stack — the gate that must be green to certify "Production Ready"

### Current baseline (run 2026-06-21)
```
PASS  verify                 FAIL  verify-determinism   (C4: confirmUsername ReferenceError)
PASS  verify-upgrades        FAIL  verify-lockstep      (C4)
PASS  verify-achievements    FAIL  verify-lockstep-live (C4)
PASS  verify-net             FAIL  verify-equiv         (C4)
PASS  verify-coop            FAIL  verify-supabase      (env: supabase host not in egress allowlist)
PASS  verify-netsync
```
7 green / 4 red (harness) / 1 red (env). **The gate is currently un-passable.**

### Stage 0 — Repair the harness (unblocks everything; ship first)
- **T0.1** Fix C4: align every verifier's file list with `index.html` load order (add `achievement-sync.js`,
  `leaderboard-sync.js`, `leaderboard-engine.js`, `net.js`, `network.js`, `achievements.js`). Re-run → all
  four must reach green (or fail on a *real* assertion, not a load error).
- **T0.2** Fix M7: point `verify-upgrades.cjs` at `regenRate`; assert `player.regenRate===1` after one pick.
- **T0.3** Make `verify-supabase.cjs` skip-with-clear-message when the Supabase host is unreachable, so env
  ≠ red. Document the egress allowlist requirement.

### Stage 1 — New automated tests to close the findings
- **T1.1 (C1/H5/M5)** `verify-lockstep-upgrades.cjs`: two machines, drive XP past a level, assert identical
  upgrade application + identical `bullets.length`/`worldHash`. Extend `worldHash` to include `level/dmg/multi/bullets`.
- **T1.2 (H6/M4)** `verify-authority-migration.cjs`: kill/crash one peer mid-run, assert the world resumes
  (roster cull) and that a locally-dead avatar no longer stalls peers.
- **T1.3 (M6)** seed-freeze test: re-fire `onPresence` with a new lower id after `start()`, assert seed unchanged.
- **T1.4 (M8)** spawn-spike test: assert the first post-boss-death batch count is within K× of the in-boss batch.
- **T1.5 (C2/C3/H1/H2/M1-M3)** `verify-rls.cjs` (run against a staging project): assert anon cannot insert a
  `leaderboard` row for a `player_id != auth.uid()`, cannot open a `runs` row for another id, cannot write
  `player_achievements`/`world_state` for others, and that `/api/verify` rejects a body whose `player_id`
  doesn't match the bearer token.

### Stage 2 — Manual debug-log checklist (UI/mobile, not automatable headless)
- Leaderboard: at 320 px width, exactly one `.gtab.on`, tabs wrap (don't overflow), rows match selected difficulty.
- Minimap: boss ring distinguishable from gold-orb field; co-op teammate marker present (after M10 fix).
- Pause/menu: portrait + short screens scroll, never clip; tap targets ≥44 px; safe-area insets honored.
- `vercel build`: confirm `api/verify.js` bundles as a function and the static root serves.

### Stage 3 — CI gate (H8)
Add `.github/workflows/verify.yml`: on PR, run `npm run verify*` (all scripts) + `vercel build`. Block merge
on red. This is what makes the CLAUDE.md "3-gate before push" policy actually enforced.

### Certification rule
**Production Ready = Stage 0 green + Stage 1 green + Stage 2 checklist signed + Stage 3 CI passing on the PR,
with C1–C3 (the security/forking blockers) fixed and re-verified.**

---

## Cross-cutting root causes (fix these and most findings collapse)
1. **Two co-op models coexist** (legacy host-authoritative `Coop` + new lockstep `NetSync`); the upgrade/level,
   XP broadcast, host migration, and desync hash were written for the old model and never ported/disabled for
   lockstep. → drives C1, H4, H5, H6, H7, M4, M5, L1, L2.
2. **No server-side identity/authority on writes** — anon RLS + client-supplied `player_id` instead of
   `auth.uid()`/bearer tokens. → drives C2, C3, H1, H2, H3, M1, M2, M3.
3. **The verification stack drifted from the load order** and isn't enforced by CI. → drives C4, H8, M7.
