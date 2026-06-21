# PLAN — Achievement Cloud Sync & Persistent Identity

Status: **proposal / scaffold** · Owner: TBD · Target branch: `claude/nifty-newton-p2rix0`

Goal (as stated): achievements survive a browser clear by living in Supabase keyed to a
durable user identity instead of a per-browser localStorage token, restorable on any device.

---

## 0. Audit findings — read this first (the premise needs correcting)

A discovery pass over `js/achievements.js`, `js/net.js`, `api/verify.js`, `supabase/schema.sql`,
`js/config.js`, and `js/main.js` shows the system is **further along than the brief assumes**.
Three premises in the request are inaccurate against the current code; the real work is narrower
and different from "migrate localStorage writes to the cloud."

| Brief says | Reality in repo | Citation |
|---|---|---|
| Achievements live in localStorage and reset on clear | **Authoritative store is already Supabase** `public.player_achievements`, written server-side. localStorage `neon_ach` is only an *optimistic display mirror*. | `js/achievements.js:42-47`, `supabase/schema.sql:56-64` |
| Replace localStorage writes with calls to `/api/verify-achievement.js` | That endpoint exists today as **`/api/verify.js`** and is already the only trusted writer. No new endpoint needed. | `api/verify.js:83-135`, `js/achievements.js:87-107` |
| Link the existing `profiles` table to a `user_achievements` table | **Neither table exists.** The schema has `player_achievements` (per-player unlocks) and `runs`. There is no `profiles` table and no Supabase Auth anywhere. | `supabase/schema.sql` (whole file); grep for `profiles`/`auth` → none |

**What is actually broken.** Identity, not storage. The "user id" is `neon_player.id` — a random
UUID minted into **localStorage** with no auth behind it (`js/net.js:11-18`). The server keys every
badge to that UUID (`player_achievements.player_id`). Clear the browser → a *new* UUID is minted →
the old badges still sit in Supabase but are now **orphaned and unreachable**, indistinguishable
from a brand-new player. So the badges don't "reset" — they're stranded under a lost key.

**The second real gap.** The client **never reads `player_achievements` back from Supabase.**
`renderPanel()` paints purely from the local mirror (`js/achievements.js:120-130`, called at
`js/main.js:265`). Even today, a fresh browser shows an empty grid although the server holds the
unlocks. There is no "initial fetch" at all.

So the project reduces to two changes, in this order:
1. **Durable identity** — replace the localStorage-only UUID with a Supabase Auth `user_id`, so the
   same person resolves to the same `player_id` on every device/browser.
2. **Initial fetch + reconcile** — on login, pull `player_achievements` for that id and hydrate the
   mirror, so the grid and toasts reflect cloud truth on any device.

The write path (`/api/verify.js`, run token, RLS) is already correct and stays. localStorage becomes
a *cache keyed by user_id*, never the source of truth.

### localStorage write sites to retire/repurpose
| Key | Where | Disposition |
|---|---|---|
| `neon_ach` (unlocked + lifetime stats) | `js/achievements.js:43-47` (`_load`/`_save`) | Keep as a **cache**, but namespace by `user_id` and treat Supabase as authoritative on login. |
| `neon_player` (`{id,name}`) | `js/net.js:16-18` (`getPlayer`/`savePlayer`) | `id` becomes the **Auth `user_id`** (not a random UUID); `name` mirrors the profile display name. |
| `neon_pending` (offline score queue) | `js/net.js:21-25` | Unchanged — orthogonal to achievements. |

---

## 1. Persistent user identity

### 1a. Auth integration (Supabase Auth → stable `user_id`)

Reuse the existing username modal (`showUsername`/`confirmUsername`, `js/main.js:223-239`) as the
login surface rather than adding a new screen. The modal already gates the menu on first run.

Chosen auth method (approved): **email + password** (`SB.auth.signUp` / `signInWithPassword`).
Supabase stores the password hash (bcrypt) server-side — the client never sees it — and the session
survives a browser clear via the auth refresh token. (Anonymous-auth was floated in
`docs/PLAN-achievements-multiplayer.md:295-297` but anonymous sessions do **not** survive a browser
clear, so it's rejected for this task.) The modal grows two fields (email, password) plus a
"new here? / returning?" toggle that picks `signUp` vs `signInWithPassword`; password min length 6
(Supabase default), surfaced through the existing `unameerr` slot for inline errors.

Startup flow (replaces the current "mint a UUID locally" path):

```
boot
 └─ net.js initialises SB (existing)
 └─ SB.auth.getSession()
      ├─ session exists  → user_id = session.user.id → resolve player → fetch achievements → menu
      └─ no session      → show login modal (email + password, sign-up / sign-in toggle)
            ├─ signUp(email,pw):          SB.auth.signUp({email,password})           → session
            ├─ signIn(email,pw): SB.auth.signInWithPassword({email,password})          → session
            └─ on error (bad creds / dup email / weak pw) → show message in #unameerr, stay on modal
      └─ on session → SB.auth.onAuthStateChange → resolve path (profile upsert + fetch)
 └─ offline / SB === null → fall back to the legacy local UUID, local-only play (headless-safe)
```

Note: if "confirm email" is enabled on the Supabase project, `signUp` returns a session only after
the user clicks the confirmation link — decide at setup whether to require confirmation (more secure,
adds a round-trip) or disable it for instant play. Recommend **disabled** for a game.

`getPlayer()`/`savePlayer()` (`js/net.js:16-18`) are refactored so `id` is sourced from
`SB.auth.getUser()` when a session exists, falling back to the legacy UUID only when offline. Every
existing caller (`submitScore`, `Ach.onRunStart`, `Ach._submit`) keeps working because the shape
`{id,name}` is unchanged — only the *provenance* of `id` changes.

Backward-compat / no-lockout guardrails:
- **Headless & offline must never block.** All auth touches are guarded exactly like the current
  `SB`/`localStorage` guards so `verify.cjs` and offline play still load (CLAUDE.md "headless/offline-safe").
- **One-time claim of legacy progress (APPROVED — ship in P3).** On first successful login, if a
  legacy `neon_player.id` exists locally, POST it to a new `/api/claim.js` (service role) which
  re-keys that old `player_achievements.player_id` (and `runs.player_id`) to the new `user_id`,
  idempotently, server-side. This rescues the badges already stranded by past browser clears. The
  client clears the legacy id from localStorage once the claim returns 200 so it can't double-fire.

### 1b. Profile pairing (link a profile to unlocks so progress is global)

There is no `profiles` table yet, so we create the minimal one and **anchor it on `auth.users.id`** —
that single id is what makes progress global across devices.

```sql
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null check (char_length(username) between 1 and 16),
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles readable"       on public.profiles for select using (true);
create policy "owner upserts own profile" on public.profiles for insert
  with check (auth.uid() = id);
create policy "owner updates own profile" on public.profiles for update
  using (auth.uid() = id);
```

Pairing `profiles` ↔ `player_achievements`: **no schema change to `player_achievements` is required** —
its `player_id` simply becomes the Auth `user_id` (= `profiles.id`). Because the same id keys both
tables, a join (`profiles.id = player_achievements.player_id`) yields "this user's badges" globally.
Add a FK for integrity once all rows are auth-backed — **deferred to P3** (approved), because the
legacy-claim re-key (§2a / P3) must run first or the constraint would reject still-orphaned
`player_id`s:

```sql
-- run in P3, AFTER /api/claim.js has re-keyed legacy rows
alter table public.player_achievements
  add constraint player_achievements_player_fk
  foreign key (player_id) references public.profiles(id) on delete cascade;
```

The `runs` table (`schema.sql:68-75`) keys on `player_id` too and rides along unchanged.

---

## 2. Cloud state migration

### 2a. Legacy cleanup (retire localStorage as source of truth)

The server write path already exists and is correct — **do not add new write endpoints.** The cleanup
is about demoting localStorage from "truth" to "cache" and making the server endpoint auth-aware:

1. `js/achievements.js` — `_load`/`_save` (`:43-47`) stop being authoritative. Namespace the cache key
   by user (`neon_ach:<user_id>`) so two accounts on one browser don't bleed, and have it **overwritten
   by the cloud fetch on login** (§2b). The optimistic toast/evaluate logic stays for instant feedback.
2. `_submit` (`:87-107`) already POSTs to `/api/verify`. Upgrade it to send the Supabase **access token**
   (`Authorization: Bearer <session.access_token>`) so `/api/verify.js` can verify `auth.uid()` matches
   the claimed `player_id` server-side — closing the last spoof gap (today it trusts the posted
   `player_id`). RLS already blocks direct client writes (`schema.sql:86-88`), so no client write path
   to remove — there was never one.
3. Move the new sync/fetch logic into a **dedicated module** (§3), keeping `achievements.js` focused on
   catalog + optimistic UI.

Net effect: every *authoritative* achievement write stays server-side in `/api/verify.js`; localStorage
holds only a per-user display cache that is reconciled against the cloud on each login.

### 2b. Initial fetch (restore state on any device)

New read, called immediately after a session resolves (and on `onAuthStateChange`), living in the new
module (§3):

```
async function pullAchievements(user_id):
  if (!SB) return                                  // offline/headless → keep local cache
  const { data } = await SB
    .from('player_achievements')
    .select('achievement_id, run_score, unlocked_at')
    .eq('player_id', user_id)
  const cloud = (data||[]).map(r => r.achievement_id)
  // reconcile: cloud is authoritative; union in any optimistic local ids not yet server-granted
  const merged = unique(cloud.concat(localMirror.unlocked))
  saveMirror(user_id, { unlocked: merged, life: localMirror.life })
  Ach.renderPanel()                                // repaint grid from cloud truth
```

This read is already permitted — `player_achievements` is world-readable
(`schema.sql:86-88`), so it works with the anon key today and with the auth session after §1.
Wiring point: replace the bare `Ach.renderPanel()` at `js/main.js:265` with `pullAchievements(id)`
inside the post-login resolve path, so the grid hydrates from Supabase, not the empty local mirror.

---

## 3. Efficiency & truncation guard

### Modularity — `js/achievement-sync.js` (new classic global)

All new identity/sync code lands in one new file, **not** in `main.js` or `achievements.js`:

- Load order (CLAUDE.md fixed chain): insert **after `net.js`/`achievements.js`, before `main.js`** so
  it can call `SB`, `getPlayer`, and `Ach.*`, and `main.js` can call into it. Add one `<script defer>`
  line in `index.html` between achievements and main.
- Surface (small): `AchSync.resolveSession()`, `AchSync.login(email)`, `AchSync.pullAchievements(id)`,
  `AchSync.claimLegacy(oldId)`. `main.js` calls these; the modal calls `login`.
- Same headless/offline guards as the rest (every `SB`/`localStorage`/`fetch`/`document` touch wrapped),
  so `verify.cjs` loads it clean.

### Truncation guard (28 KB silent-truncation threshold)

Current sizes (bytes): `main.js` **24554**, `core.js` 22530, `world.js` 21770 — `main.js` is the closest
to the 28 KB line and is where login wiring would naturally accrete. Putting sync logic in a fresh
`achievement-sync.js` (est. 3–5 KB) keeps `main.js` from crossing the threshold. **Budget rule:** if a
file would exceed ~26 KB, split rather than append. Re-check sizes in the verify step below.

### Working set (files this change touches — nothing else read/edited)
- `supabase/schema.sql` — add `profiles`, RLS; FK deferred to P3.
- `js/net.js` — `getPlayer`/`savePlayer` source `id` from the auth session.
- `js/achievements.js` — cache key namespacing; send bearer token in `_submit`.
- `js/achievement-sync.js` — **new** identity + fetch/reconcile module.
- `api/verify.js` — verify `auth.uid()` against `player_id`; **new `api/claim.js`** for legacy re-key (P3).
- `js/main.js` — swap modal to email+password login; call `pullAchievements` on resolve.
- `index.html` — one `<script defer>` line for the new module; email/password fields in the modal.

---

## 4. Verification

Per CLAUDE.md "Verification gap — REQUIRED before any push": all three verifiers green
(`verify.cjs`, `verify-upgrades.cjs`, `verify-equiv.cjs`) plus `verify-achievements.cjs` (catalog
lockstep) and a `vercel` preview build, before any commit is pushed. Also re-run the byte-size check
so no file crosses 28 KB.

### Cross-device proof (the acceptance test the brief asks for)
1. Browser A: sign up / log in as `you@example.com` with a password. Play a run that earns e.g.
   **First Blood** + **Wave Rider**. Confirm the toasts fire and the badges show ✓ in the panel.
2. Browser B (or a private/incognito window — **separate localStorage**): log in with the **same**
   email + password. **Before playing anything**, open the achievements panel.
   - **Pass:** First Blood + Wave Rider already show ✓, hydrated by `pullAchievements` from Supabase.
   - **Fail (today's behaviour):** the panel is empty because identity didn't carry and there's no fetch.
3. Negative control: log in as a **different** email in browser B → panel is empty (no badge bleed),
   proving unlocks are scoped to `user_id`, not the browser.
4. DB spot-check (optional): `select * from player_achievements where player_id = '<user_id>'` returns
   exactly the earned rows; `select * from profiles` shows one row per account.

---

## 5. Phasing
- **P1 — Auth + identity ✅ IMPLEMENTED:** `profiles` table + RLS (`supabase/schema.sql`); **email+password**
  login in the modal (`js/achievement-sync.js` `showAuth`/`confirmUsername`); `getPlayer`/`savePlayer`
  source `user_id` (`js/net.js`). Behind the existing offline fallback.
- **P2 — Fetch + reconcile ✅ IMPLEMENTED:** `AchSync.pull()` hydrates the panel on login; cache
  namespaced by user (`Ach._key()` → `neon_ach:<id>`). ← delivers the cross-device proof.
- **P3 — Hardening (TODO, follow-up):** bearer-token check in `/api/verify.js`; **`/api/claim.js` legacy
  re-key** (rescues stranded badges); then add the `player_achievements → profiles` FK once rows are
  auth-backed. Left out of this PR to keep the catalog byte-identical check + serverless fn untouched.

### Decisions (approved)
1. **Auth method — email + password** (`SB.auth.signUp` / `signInWithPassword`). Session survives a
   browser clear via the refresh token; recommend disabling email-confirmation for instant play.
2. **Rescue legacy badges — yes.** `/api/claim.js` re-keys old `player_id` → new `user_id` on first
   login (P3), idempotent, clears the legacy id locally on success.
3. **FK on `player_achievements` — deferred to P3**, added only after the legacy claim has re-keyed
   orphaned rows so the constraint won't reject them.
