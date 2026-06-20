# Implementation Plan — Secure Achievements + Peaceful Multiplayer Lobby

> **Scaffold/plan only. No game logic written yet.** Grounded in the current codebase:
> classic `<script defer>` globals (`index.html:120-129`), `state` machine (`js/world.js:6`),
> existing Supabase scoreboard (`js/net.js`), and the fixed-timestep + `alpha` lerp sim
> (`js/world.js` `STEP`/`MAXSUBSTEP`/`lerp`). Awaiting approval before any code.

---

## 0 — Audit: what exists and what's exploitable today

| Concern | Where | Finding |
|---|---|---|
| Score submit | `js/net.js:39-45` | Client builds the row (`score`, `wave`, `secs`) and inserts directly. |
| Insert policy | `supabase/schema.sql:29-34` | `anyone can insert` with only range checks → **client fully controls score. Spoofable.** |
| Identity | `js/net.js:16-18` | `neon_player = {id:uuid, name}` in localStorage. No auth, no signature. |
| Trust boundary | none | No `/api/`, no Edge Function, no server validation. Anon key + RLS is the only gate. |
| Sim clock | `js/world.js` `STEP=1000/60`, `MAXSUBSTEP=5`, `alpha`, `lerp()` | Fixed tick; bodies snapshot `px/py` and lerp by `alpha` in `draw()`. **Reuse this for remote players.** |
| Game stats | `js/world.js:201-205` (`killEnemy`), `:334` (`gainXP`) | `kills`, `score`, `wave`, `player.level`, boss kills — the achievement signal sources. |
| Headless verify | `.claude/skills/neon-survivor/verify.cjs` | `readFileSync`s every `<script src>` and loads in Node with no DOM/network. **Every new browser file must guard `window`/`document`/`supabase`/`fetch` or verify breaks.** |

**Core design principle:** the client is hostile. Achievements and any score that unlocks them
must be **server-validated**. The browser may *claim* progress; only `/api/verify.js` (holding the
`service_role` key, server-side only) may *grant* it. RLS denies all client writes to the
achievement tables.

---

## 1 — Architecture & File Structure

Reconciliation: this repo uses `js/` for runtime classic scripts (no `/src/`, no bundler). The
plan keeps your `/api/` and `/supabase/` paths (build/deploy artifacts) and maps your
`/src/network.js` onto the existing convention as **`js/network.js`**.

```
neon-survivor/
├── js/
│   ├── config.js          (existing) + SUPA_FUNCTIONS_URL constant for the Edge/API base
│   ├── net.js             (existing) leaderboard — UNCHANGED in phase 1
│   ├── achievements.js    NEW · classic global · catalog + client-side progress tracker (display only)
│   ├── network.js         NEW · classic global · Supabase Presence lobby + remote-player lerp state
│   └── netdebug.js        NEW · classic global · Network Debug Overlay (extends F3), dev-only
├── api/
│   └── verify.js          NEW · Vercel Serverless/Edge Function · the ONLY writer of scores+achievements
├── supabase/
│   └── schema.sql         (existing) EXTENDED · new tables, RLS, RPC, indexes (Section 2)
└── .claude/skills/neon-survivor/
    ├── verify-achievements.cjs   NEW · headless threshold/catalog test (Section 5)
    └── verify-net.cjs            NEW · headless lerp + presence-state test (Section 5)
```

**Load order** (extends `index.html:120-129`):
`config → core → audio-engine → world → sim → render → ui-engine → net → network → achievements → leaderboard-engine → netdebug → main`

- `network.js` after `net.js` (shares the lazily-loaded `supabase` SDK / `SB` client).
- `achievements.js` after `network` (lobby unlock toasts may reference presence) but before `main`.
- `netdebug.js` last before `main` so it can read every other module's globals for the overlay.

### 1.1 `js/network.js` — responsibilities (no code yet)
- **`Lobby` facade** (mirrors the `Music`/`Net` facade pattern): `join(roomId)`, `leave()`,
  `setLocalState(x,y,...)`, `onPeerJoin/onPeerLeave/onPeerState` callbacks, `peers` map.
- Wraps **Supabase Realtime Presence** on a channel `lobby:<roomId>`. Peaceful = **no combat
  packets**: presence broadcasts position/cosmetic only; no damage, no authoritative enemy state.
- Holds a `peers` map: `{ id → { name, x,y, px,py, tx,ty, lastSeen } }` for lerp (Section 3).
- **Headless-safe:** all entry points no-op when `!_isBrowser || !SB` (same guard style as
  `js/net.js:8,29`), so `verify.cjs` loads it without a DOM or network.

### 1.2 `api/verify.js` — responsibilities (no code yet)
- Vercel function (Node runtime). Holds `SUPABASE_SERVICE_ROLE_KEY` from **Vercel env vars**
  (never committed, never shipped to the client).
- Single POST endpoint `POST /api/verify`. Body: `{ player_id, run_token, score, wave, secs,
  kills, difficulty, events[] }`.
- **Validates server-side** (Section 4), then writes the score **and** any earned achievements
  via the service-role client — bypassing RLS legitimately because it's trusted server code.
- Returns `{ accepted:bool, score:int, newAchievements:[id,...], reason? }`.

---

## 2 — Database Schema & RLS (`supabase/schema.sql`, additive)

> Append to the existing file; the current `leaderboard` table stays. New objects below.
> SQL is included here (schema is a requested deliverable); **no application code**.

```sql
-- ============================================================
-- ACHIEVEMENTS — server-granted, client-readable, client-UNwritable
-- ============================================================

-- Static catalog (definitions). Seeded by an admin/migration, read by everyone.
create table if not exists public.achievement_defs (
  id          text primary key,                              -- e.g. 'first_boss','kills_1000','wave_20'
  title       text not null,
  description text not null,
  metric      text not null check (metric in ('kills','score','wave','level','bosses','runs')),
  threshold   integer not null check (threshold >= 0),
  difficulty  text check (difficulty in ('easy','normal','hard')),  -- null = any difficulty
  sort        integer not null default 0
);

-- Per-player unlocks. Written ONLY by the service role (via /api/verify). RLS blocks all client writes.
create table if not exists public.player_achievements (
  player_id      uuid not null,
  achievement_id text not null references public.achievement_defs(id),
  unlocked_at    timestamptz not null default now(),
  run_score      integer not null default 0,                 -- the validated score that earned it
  primary key (player_id, achievement_id)
);
create index if not exists player_ach_player_idx on public.player_achievements (player_id);

-- One row per validated run, keyed by a server-issued token to make submits idempotent
-- and to give /api/verify a server-side anchor (start time, difficulty) it can sanity-check against.
create table if not exists public.runs (
  run_token   uuid primary key default gen_random_uuid(),
  player_id   uuid not null,
  difficulty  text not null check (difficulty in ('easy','normal','hard')),
  started_at  timestamptz not null default now(),
  verified    boolean not null default false,
  final_score integer
);

-- ---------- RLS ----------
alter table public.achievement_defs     enable row level security;
alter table public.player_achievements  enable row level security;
alter table public.runs                  enable row level security;

-- Catalog: world-readable, never client-writable.
drop policy if exists "defs readable" on public.achievement_defs;
create policy "defs readable" on public.achievement_defs for select using (true);
-- (no insert/update/delete policy → only service_role, which bypasses RLS, can seed it)

-- Unlocks: world-READABLE (show anyone's badges), but NO insert/update/delete policy at all.
-- Absence of a write policy = every client write is denied. The service role bypasses RLS,
-- so /api/verify is the sole writer. THIS is the anti-spoofing core.
drop policy if exists "achievements readable" on public.player_achievements;
create policy "achievements readable" on public.player_achievements for select using (true);

-- Runs: a player may CREATE a run token (to start), but may NOT update score/verified.
drop policy if exists "runs insert own"  on public.runs;
drop policy if exists "runs read own"    on public.runs;
create policy "runs insert own" on public.runs for insert
  with check (verified = false and final_score is null);   -- client can open a run, never close it
create policy "runs read own"   on public.runs for select using (true);
-- no update/delete policy → client can never flip verified or set final_score. Server-only.

-- ---------- harden the EXISTING leaderboard (phase 2 migration) ----------
-- Today's "anyone can insert" (schema.sql:29) lets any client post any score. Once /api/verify
-- ships, drop that policy so the service role becomes the only writer:
--   drop policy if exists "anyone can insert" on public.leaderboard;
-- (Staged: keep the old policy until the Edge Function is live to avoid a write outage.)
```

**Why this defeats client spoofing**

- `player_achievements` has **read-only RLS** (no write policy). A forged `SB.from('player_achievements').insert(...)` from the browser is rejected by Postgres — full stop.
- The anon key cannot escalate: RLS is enforced regardless of key.
- The client can open a `runs` token but can never write `final_score` or `verified` — only `/api/verify` (service role) closes the loop.
- Score legitimacy is decided **once**, server-side, and the achievement grant is derived from that same validated number — they can't diverge.

---

## 3 — Networking: Lerp + Presence Sync Strategy

**Peaceful lobby = soft-state only.** No authoritative simulation, no anti-cheat on movement
(there's nothing to cheat *at* — no combat). Goal is smooth co-presence: see other players drift
around the hub.

### 3.1 Transport — Supabase Presence
- One Realtime channel per room: `supabase.channel('lobby:'+roomId, { presence:{ key: player_id }})`.
- **Presence `track()`** carries the slow-changing identity payload: `{ name, color, room }`.
- **Position updates** go over `channel.send({ type:'broadcast', event:'pos', payload:{...} })`
  at a **throttled tick (~10 Hz)**, *not* via presence (presence is for join/leave + identity;
  broadcasting 60 Hz through presence would thrash the sync). This separation is the key strategy:
  - `presence sync` event → reconcile the `peers` roster (who's here).
  - `broadcast 'pos'` event → update a peer's **target** position `(tx,ty)`.

### 3.2 Lerp calculation (reuses the game's existing alpha pattern)
Remote peers arrive at 10 Hz but we render at display refresh (up to 240 Hz). We **interpolate
toward the last received target**, mirroring how the sim lerps local bodies by `alpha`
(`js/world.js` `lerp`, `draw()` `ix()/iy()`).

For each peer, store `cur (x,y)`, `target (tx,ty)`, snapshot `prev (px,py)`:
- On `'pos'` receive: `peer.px=peer.x; peer.py=peer.y; peer.tx=payload.x; peer.ty=payload.y; peer.tRecv=now`.
- Per render frame (in `draw()`), advance current toward target:
  ```
  // exponential smoothing — frame-rate independent, no overshoot, matches "peaceful" drift
  const SMOOTH = 12;                         // higher = snappier, lower = floatier
  const k = 1 - Math.exp(-SMOOTH * dtSeconds);
  peer.x = lerp(peer.x, peer.tx, k);
  peer.y = lerp(peer.y, peer.ty, k);
  ```
  Using `1 - exp(-k·dt)` (not raw `lerp(a,b,fixedT)`) keeps smoothing **independent of refresh
  rate**, consistent with the CLAUDE.md gotcha that movement must not be naively frame-scaled.
- **Stale-peer cull:** if `now - peer.lastSeen > 5000ms`, drop the peer (covers silent
  disconnects Presence missed).
- **Local send budget:** only `channel.send` when the local player moved > epsilon since last send,
  capped at 10 Hz — keeps the channel quiet when idle (peaceful).

### 3.3 State ownership
- Each client is **authoritative over its own avatar only**. No one simulates anyone else.
- No enemies/bullets are networked (the lobby is a non-combat hub). When a player leaves the lobby
  into a solo run, `Lobby.leave()` untracks presence; the existing single-player sim is untouched.

---

## 4 — Security: Edge Function validation logic (`/api/verify.js`)

Validation pipeline (server-side, before any write). **Reject, don't clamp**, on hard failures:

1. **Auth/identity:** require `player_id` (uuid) + a `run_token` that exists in `runs`,
   belongs to that `player_id`, and has `verified=false`. Unknown/closed token → 403.
2. **Idempotency:** if the token is already `verified`, return the stored result (no double-grant).
3. **Difficulty match:** submitted `difficulty` must equal the `runs.difficulty` recorded at start
   (client can't downgrade difficulty after the fact).
4. **Temporal sanity:** `secs` must be plausible vs `now() - runs.started_at`
   (e.g. `secs <= elapsed + 5s` and `secs >= 0`). Catches replayed/fabricated long runs.
5. **Score plausibility (rate ceiling):** derive a max achievable score from `secs`, `wave`, and
   `kills` against per-difficulty constants mirrored from `core.js` `DIFFS`/`BOSS`
   (e.g. `score <= kills * MAX_PER_KILL * difficultyMult` and `score <= secs * MAX_SCORE_PER_SEC`).
   Out of envelope → reject as spoofed.
6. **Monotonic/consistency:** `wave >= 1`, `kills >= 0`, `score >= 0`, `kills` consistent with
   `wave` (a wave-20 run can't have 3 kills).
7. **Grant:** with the validated numbers, `select` `achievement_defs`, compute which thresholds the
   run satisfies, `insert ... on conflict do nothing` into `player_achievements`, write the score
   into `leaderboard`, set `runs.verified=true, final_score=score`. All via the **service-role
   client** (bypasses RLS legitimately).
8. **Response:** `{ accepted:true, newAchievements:[...] }` or `{ accepted:false, reason }`.

**Secret handling:** `SUPABASE_SERVICE_ROLE_KEY` lives only in Vercel project env vars
(server-side). It is never in `config.js`, never in any `js/` file, never in the bundle. `config.js`
gains only a public `SUPA_FUNCTIONS_URL` (the `/api` base).

**Client trust model:** the browser submits *claims* via `POST /api/verify`; it renders
achievements **optimistically** from `achievements.js` for instant feedback, but the **badge is
only real once the server echoes it back**. Optimistic UI that the server rejects is rolled back.

---

## 5 — Verification (before any commit)

Follows the existing `verify*.cjs` convention (headless Node, exit 0 = pass), plus a live overlay.

### 5.1 Network Debug Overlay (`js/netdebug.js`) — extends the F3 overlay
The game already has an F3 debug overlay (`js/main.js:101`). Add a **Net panel** toggled with
**F4** showing, live:
- Channel state (`SUBSCRIBED`/`CLOSED`), roomId, local `player_id`.
- Peer table: `id · name · (x,y) · target (tx,ty) · lerp-lag ms · lastSeen age`.
- **Lag/jitter sim controls** (dev-only): inject artificial latency/packet-drop on inbound `'pos'`
  to eyeball lerp smoothness under bad networks.
- Outbound send rate (Hz) + bytes/s, to confirm the 10 Hz throttle holds.
- Last `/api/verify` response (`accepted`, `reason`, `newAchievements`).

### 5.2 `verify-achievements.cjs` (headless)
- Loads `achievements.js` in Node (must pass the `window`-guard so it loads at all).
- Asserts the **catalog is well-formed**: unique ids, valid `metric`, `threshold>=0`,
  difficulty in set.
- **Threshold table-test:** feed synthetic run stats `{kills,score,wave,level,bosses}` and assert
  the *exact* set of expected achievement ids fires at, just-below, and just-above each boundary
  (off-by-one guard).
- Mirrors the server grant logic so the client catalog and server thresholds can't drift.

### 5.3 `verify-net.cjs` (headless)
- Loads `network.js`; asserts all `Lobby.*` entry points **no-op safely with `SB=null`** (headless)
  — same contract as `js/net.js`, so `verify.cjs` keeps passing.
- **Pure-function lerp test:** drive the smoothing math with a fixed `dt` sequence and assert a peer
  converges monotonically to its target without overshoot, and that the result is identical across
  simulated 60/144/240 Hz frame timings (frame-rate independence).
- Stale-peer cull test: a peer past the timeout is removed.

### 5.4 Required gates (per CLAUDE.md) before commit/push
1. `vercel` preview build succeeds (now also builds `/api/verify.js`).
2. `node .claude/skills/neon-survivor/verify.cjs` + the two new `verify-*.cjs` all exit 0.
3. Manual F4 overlay check: two browser tabs in the same room see each other drift smoothly.

---

## 6 — Phasing (each phase independently shippable + verifiable)

1. **Schema + RLS** (Section 2) — deploy tables/policies; seed `achievement_defs`. No client change.
2. **`/api/verify.js`** (Section 4) + Vercel env secret — server validation live; `leaderboard`
   still dual-written by old path until cutover.
3. **`achievements.js` + UI** — read/display badges, optimistic unlock toasts; route score submit
   through `/api/verify`; then drop the old `anyone can insert` policy.
4. **`network.js` lobby** (Section 3) — Presence + lerp; gated behind a "Lobby" menu entry.
5. **`netdebug.js` + verify suites** (Section 5) — overlay & tests (land alongside 3–4).

---

### Open questions for approval
1. **Path convention:** OK to use `js/network.js` (matches the classic-globals load order) instead
   of `/src/network.js`? There is no `/src/` or bundler in this repo.
2. **Function runtime:** Vercel **Serverless** (Node, `@supabase/supabase-js`) vs **Edge** (lighter,
   but `fetch`-only to the REST/RPC endpoint)? Serverless is simpler given the existing SDK.
3. **Lobby scope:** single global hub room, or named/shareable rooms? Affects the Presence channel
   keying and the menu UI.
4. **Auth:** keep the anonymous `neon_player` uuid (current model) for phase 1, or introduce
   Supabase anonymous-auth sessions so `run_token` ownership is cryptographically bound (stronger
   anti-spoof, more work)?
```
