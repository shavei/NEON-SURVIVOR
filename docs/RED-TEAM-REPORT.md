# NEON SURVIVOR — Red-Team Report

**Date:** 2026-07-02 · **Branch:** `claude/game-red-team-report-nby7oc` · **Scope:** full game — client sim,
serverless validator (`api/verify.js`), Supabase RLS/schema, identity/auth, cosmetics economy, supply chain, UI.
**Method:** static review of every shipped asset + the server validator, live headless play-through (Chromium),
and **executable proofs-of-concept run against the real exported `api/verify.js` functions**. No code was changed.

> **Read note.** A prior audit (`docs/AUDIT-REPORT.md`, 2026-06-21) predates a large refactor. Its four
> "criticals" were mostly the **multiplayer/lockstep** subsystem (`network-sync.js`, `multiplayer-combat.js`,
> `network.js`) and the broken verifier harness. **All of that is now resolved**: the multiplayer files are
> gone, and **13 of 14 verifiers pass** (the 14th, `verify-supabase`, fails only on blocked network egress in
> this sandbox — environmental, not a code defect). This report supersedes it and focuses on what is live today.

---

## Verdict

The game is **functionally healthy and well-built** — clean sim, graceful offline degradation, a genuinely
thoughtful server-authoritative design with the service-role key correctly server-only and XSS-safe rendering.
**But the anti-cheat boundary it advertises does not hold.** The two headline security claims made throughout
the codebase — *"a forged client claim can't mint a badge"* (`api/verify.js:4`) and *"the forged 0:00
billion-point rows"* are closed (`net.js:34`, `schema.sql:29`) — are **both false**. I reproduced a
2,000,000,000-point leaderboard row and minted every "unforgeable" gold cosmetic, using only the shipped
`/api/verify` path, proven against the real server code.

## Severity summary

| Sev | # | Headline |
|-----|---|----------|
| **Critical** | 2 | Leaderboard score forgery via `/api/verify` (unbounded `kills`) · every achievement + gold cosmetic forgeable (no server anchor on lifetime/level/boss metrics) |
| **High** | 2 | No identity binding — `/api/verify` + `runs` trust a client `player_id`, so scores/badges can be minted onto **another player's** account · leaderboard username is unfiltered & unbound to profile (bypasses the entire callsign censor + set-once uniqueness) |
| **Medium** | 2 | `world_state` is anon-writable by any room name (open write surface, no live consumer) · no rate limiting — unlimited `runs` tokens → board/badge/storage spam |
| **Low / Info** | 2 | CDN scripts loaded without SRI and a floating major version (`supabase-js@2`) — supply-chain exposure · lifetime counters double as griefing amplifier |
| **Positive** | 6 | Service key server-only · `esc()` escapes usernames (XSS-safe) · AFK-no-kills score banking blocked · idempotent run tokens · RLS-only read model · cross-language callsign filter at signup |

---

## CRITICAL

### C1 — Leaderboard score forgery through the "hardened" `/api/verify` path
**`api/verify.js:184-197` (`validateRun`), `:293-305` (leaderboard write).**

The plausibility ceiling is `score ≤ kills·rate.kill + earnedSecs·rate.sec + 500`, where
`earnedSecs = min(secs, kills·3)`. The design intent (`api/verify.js:176-181`) is that *time must be earned by
kills* — and the AFK case is correctly blocked. **But `kills` itself has no upper bound tied to the wall clock.**
`claim.kills = b.kills | 0` accepts any value up to 2³¹. So an attacker just inflates the *kills* claim to lift
the ceiling arbitrarily.

**Proof (run against the real exported `validateRun`/`evaluate`):**
```
runRow opened 60s ago, difficulty "hard"
body = { score:2_000_000_000, wave:2, secs:1, kills:14_000_000, difficulty:"hard" }
→ validateRun: { ok:true }
→ ACCEPTED, score=2,000,000,000 written to the global leaderboard
→ also mints: first_blood, swarm_breaker, one_man_army, annihilator, high_scorer,
              score_legend, neon_god, massacre_clock, any_percent
→ cosmetics: crimson_husk, neon_god_trail
```

This is the exact class of row `supabase/cleanup-forged-scores.sql` was written to delete ("1,215,752,191
points in 0:00"). The cutover to `/api/verify` was supposed to close it; it did not. **The fix is a bound on
`kills` relative to `earnedSecs`/wave** (e.g. `kills ≤ wave · perWaveCeil + secs · killsPerSec`), so inflating
kills can no longer inflate the score ceiling.

### C2 — Every achievement and gold cosmetic is forgeable (no server anchor on lifetime metrics)
**`api/verify.js:147-166, 224-227` + `js/achievements.js:172-183`.**

The server re-derives progression from the claim, but `level`, `bosses`, `runs` — and, via `sanitizeIntent`,
`flawlessBoss` (clamped to `bosses`) and `peakWeapons` (clamped to `level-1`) — are **client-supplied with no
server-side anchor**. `validateRun` never checks them. So a throwaway 5-kill run mints the "unforgeable" gold
tier:

**Proof:**
```
runRow difficulty "normal", body = { score:1000, wave:2, secs:5, kills:5,
                                     level:25, bosses:50, runs:10, difficulty:"normal" }
→ validateRun: { ok:true }
→ badges: first_blood, boss_slayer, warden_hunter, warden_legend, power_surge,
          ascended, veteran, power_spike, ascendant_rush, killer_instinct, any_percent
→ cosmetic: warden_halo  (a GOLD reward the schema calls service-role-only / unforgeable)
```

The schema comments (`schema.sql:37-39, 78-83`) and `api/verify.js:63-64` assert these grants are unforgeable.
They are only unforgeable for the four *single-run kill/score/wave* golds bounded by `validateRun`; every
lifetime/level/boss-gated badge and its cosmetic can be minted at will. **Fix: derive `runs`/`bosses`/`level`
from server-side state (the `runs` table row count, a persisted lifetime tally), not the request body.**

---

## HIGH

### H1 — No identity binding: scores and badges can be minted onto *another* player's account
**`api/verify.js:220-233` + `supabase/schema.sql:166-171` (`runs insert open`).**

`/api/verify` reads `player_id` straight from the POST body and never validates it against a Supabase session
bearer token. The `runs` insert policy checks only `verified = false and final_score is null` — **not
`auth.uid() = player_id`** — so any anon client can open a run token bound to *any* `player_id`. Player ids are
public (world-readable from `player_achievements`/`cosmetics_inventory`). Combined with C1/C2, an attacker opens
a token for a victim's id and mints forged high scores, badges, and cosmetics **onto the victim's identity** —
or floods the board under throwaway ids. **Fix: bind both the `runs` insert and the `/api/verify` body to
`auth.uid()` from the JWT; reject a `player_id` that doesn't match the bearer token.**

### H2 — Leaderboard username is unfiltered and unbound to the player's profile
**`api/verify.js:296-304`.** The server writes `b.username` (only `slice(0,16)`) directly to the public
`leaderboard`. It never runs `CallsignFilter` (the whole `verify-censor` cross-language EN↔HE censorship stack)
and never checks the name equals the player's set-once, unique `profiles.username`. So the callsign filter and
the case-insensitive uniqueness index (`schema.sql:191-206`) are **fully bypassable on the public board** — post
profanity, or impersonate any other player's callsign, by calling `/api/verify` with an arbitrary `username`.
**Fix: resolve the display name server-side from `profiles` by `player_id`; do not trust `b.username`.**

---

## MEDIUM

### M1 — `world_state` is anon-writable by any room name, with no live consumer
**`supabase/schema.sql:284-306`.** The table keeps open `insert`/`update` policies gated only by
`char_length(room) between 1 and 64`. Any anon client can create or overwrite any room's `jsonb` snapshot. The
multiplayer client that used to read it is **gone** in this refactor, so this is now a pure open write surface:
unbounded row creation and arbitrary-payload storage abuse against the project, with nothing legitimately
consuming it. **Fix: drop the table/policies, or gate writes behind `auth.uid()` + a bounded row quota.**

### M2 — No rate limiting; unlimited run tokens
**`supabase/schema.sql:166-169` + `api/verify.js` (no throttle).** Anon can open unlimited `runs` rows and fire
unlimited `/api/verify` calls. Each accepted call writes a leaderboard row and can mint badges. With C1/H1 this
is a board-spam / badge-spam / table-growth vector with no cost to the attacker. **Fix: per-ip / per-identity
rate limit on token creation and on `/api/verify`.**

---

## LOW / INFO

### L1 — CDN scripts without SRI, floating major version (supply-chain)
**`index.html:24` (`@vercel/speed-insights@2.0.0`), `js/net.js:27` (`@supabase/supabase-js@2`).** Both load from
`cdn.jsdelivr.net` with **no `integrity` hash**, and the Supabase SDK floats the entire major (`@2`). A CDN or
registry compromise executes arbitrary JavaScript in the page — the same context that holds the anon key and the
user's auth session. **Fix: pin exact versions and add SRI hashes, or self-host the SDK.**

### L2 — Lifetime counters amplify griefing
Because `runs`/`bosses` are client-set (C2) *and* identity is spoofable (H1), an attacker can also inflate a
victim's progression counters, corrupting their gallery/progress state. Same root cause as C2/H1.

---

## What's solid (verified, not assumed)

- **Service-role key is server-only.** No `service_role`/`SERVICE_KEY` string appears in any shipped `js/`,
  `css/`, or `index.html` asset — grep-clean. It lives only in Vercel env (`api/verify.js:13-14`).
- **XSS-safe rendering.** Leaderboard usernames render through `esc()` (`main.js:232`), a correct
  `& < > "` HTML-escaper, so even a forged/profane username (H2) cannot inject script.
- **AFK score-banking is blocked.** A 0-kill run claiming 50k on a 55s-old token is correctly rejected
  (`score_impossible`) — the "time must be earned by kills" idea works; it's only the *kills* input that's
  unbounded (C1).
- **Idempotent run tokens.** A verified token early-returns its stored grant and never double-grants
  (`api/verify.js:236-242`).
- **Read model is RLS-only and public by design** — the anon key + URL are safe to ship (`config.js:1-6`); reads
  degrade gracefully to on-device play when the backend is unreachable (observed live: *"Global board offline.
  Scores still save on this device."*).
- **Cross-language callsign filter** runs at signup (`callsign-filter.js`, `auth-uplink.js`) — solid, but see H2:
  it's bypassed at the leaderboard write.

## Harness health

`verify · verify-upgrades · verify-achievements · verify-censor · verify-otp · verify-size · verify-determinism ·
verify-equiv · verify-simcore · verify-gauntlet · verify-jukebox · verify-fullcycle` — **all pass**.
`verify-supabase` fails only on blocked egress to `*.supabase.co` in this sandbox (HTTP 000 / 403), matching the
documented environmental limitation — not a code defect.

## Root cause (fix these two and most findings collapse)

1. **The score/achievement ceiling trusts a client input it never bounds (`kills`), and trusts lifetime metrics
   with no server state behind them.** → C1, C2, L2.
2. **No server-side identity: the `player_id` and `username` are taken from the request body, and `runs` inserts
   aren't bound to `auth.uid()`.** → H1, H2, M2.

Everything else (M1 dead-table write surface, L1 supply chain) is independent hardening.

## Screenshots

Live headless play-through captures are in `audit-screens/rt-*.png`:
`rt-05-menu-top.png` (menu + legends), `rt-02-gameplay.png` (wave 1, HUD/minimap/tracer),
`rt-03-levelup.png` (upgrade card), `rt-06-board-ach.png` (offline board + achievement/showcase galleries).
