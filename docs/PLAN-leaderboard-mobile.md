# Implementation Plan — Global Scoreboard (Supabase) + Responsive Mobile UI

> Scaffold/plan only. No game logic changed yet. Grounded in the current codebase
> (classic `<script defer>` globals, `state` machine in `js/world.js:6`, all menus in
> `index.html`, local-only leaderboard in `js/main.js:188-216`).

## 0 — Audit findings (what exists today)

| Concern | Where | Notes |
|---|---|---|
| Screen states | `js/world.js:6` `let state='start'` | `start · play · pause · levelup · over`. No async/loading state. |
| Menu markup | `index.html:31-93` | `#start` (diff selector + `.menupanels` incl. `#leaderboard`), `#over`, `#levelup`, `#pause`. |
| Local leaderboard | `js/main.js:188-196` | `loadScores`/`saveScore`/`renderLeaderboard`, key `neon_scores`, **top 5**, entry `{score,secs,wave,diff}`. |
| Score recorded | `js/main.js:133` `gameOver()` | calls `saveScore({score,secs,wave,diff:DIFF.label})`. |
| Best score | `js/world.js:10`, `js/main.js:131` | key `neon_best`. |
| Difficulties | `js/core.js:46-49` | keys `easy/normal/hard`, labels `Easy/Normal/Hard`, `DIFF` is the live object. |
| Mobile layer | `js/main.js:11-19`, `css/style.css:194-217` | `applyDeviceMode()` → `body.mobile`; media queries `max-width:820` + `:520`; `env(safe-area-inset-*)` already used; viewport meta present (`index.html:5`). |
| Build | none | Plain static files on Vercel. **No bundler** → Supabase must arrive via CDN `<script>` + a classic global, not `import`. |
| Headless verify | `.claude/skills/neon-survivor/verify.cjs` | Loads JS in Node with no DOM/network → **any new file must guard `window`/`supabase`/`fetch`**. |

**Key constraint:** scripts are classic globals loaded in a fixed order
(`core → audio-engine → world → sim → render → main`). New code must follow the same
pattern — define globals before `main.js` consumes them, and degrade silently when the
Supabase SDK or network is absent (so headless verify and offline play still pass).

---

## 1 — Global Scoreboard (Supabase)

### 1a. Username onboarding (first-run detection)

- **Identity store:** `localStorage` key `neon_player` = `{ id: <uuid>, name: <string> }`.
  - `id` = `crypto.randomUUID()` — stable per-device owner token (lets us later show
    "your rank" / dedupe, without auth).
  - First-time test: `!localStorage.getItem('neon_player')`.
- **Modal:** new overlay `#username` in `index.html` (same `.overlay` pattern as `#start`):
  title "PICK A USERNAME", text input (`maxlength=16`), Confirm button, inline validation
  hint. Reuse `.btn` styling.
- **Flow gate:** wire in `js/main.js`. On startup, instead of going straight to `#start`,
  if no `neon_player` → show `#username`; on confirm, sanitize → persist → reveal `#start`.
  Returning players skip straight to the menu. Pre-fill the field for edits via a small
  "✎ name" affordance on the menu (optional, phase 2).
- **Sanitize:** trim, collapse whitespace, strip control chars, clamp to 3–16 chars,
  reject empty. (Server also length-checks via a column constraint — see schema.)

### 1b. Supabase schema + client init

**Table `public.leaderboard`:**
```sql
create table public.leaderboard (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null,                 -- the localStorage owner token
  username    text not null check (char_length(username) between 1 and 16),
  score       integer not null check (score >= 0),
  difficulty  text   not null check (difficulty in ('easy','normal','hard')),
  wave        integer not null default 1,
  secs        integer not null default 0,
  created_at  timestamptz not null default now()
);
-- top-N-per-difficulty read path:
create index leaderboard_diff_score_idx on public.leaderboard (difficulty, score desc);
```

**Row-Level Security (public, anon, no auth):**
```sql
alter table public.leaderboard enable row level security;
create policy "anyone can read"   on public.leaderboard for select using (true);
create policy "anyone can insert" on public.leaderboard for insert with check (
  char_length(username) between 1 and 16 and score >= 0
  and difficulty in ('easy','normal','hard')
);
-- no update/delete policy → rows are append-only from the client.
```
Anti-spam (defense-in-depth, optional): a `before insert` trigger or Postgres rate check;
acceptable to defer for a hobby game since the **anon key + RLS** is the public contract.

**Client init (new file `js/net.js`, classic global):**
- Load the UMD SDK once in `index.html`, *before* `core.js`:
  `<script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`
- `js/config.js` (or inline in `net.js`) holds the **public** project URL + **anon** key —
  safe to commit because RLS is the real boundary (never the `service_role` key).
- `net.js`:
  ```js
  const SB = (typeof supabase!=='undefined' && SUPA_URL)
    ? supabase.createClient(SUPA_URL, SUPA_ANON_KEY) : null;  // null → offline/headless
  ```
  Exposes globals `submitScore(entry)` and `fetchTop(diff)` used by `main.js`.

### 1c. Submission path

- In `gameOver()` (`js/main.js:133`) keep the existing local `saveScore(...)` (offline
  history) **and** call `submitScore({player_id, username, score, difficulty:DIFF.key, wave, secs})`.
- `submitScore` is fire-and-forget with `try/catch`; on failure (offline / `SB===null`)
  push the entry to a `neon_pending` localStorage queue and flush on next successful load —
  so a run is never lost and headless verify never throws.

### 1d. Tabbed "Global Best Runs" UI

- **Markup:** replace the single `#leaderboard` panel (`index.html:50`) — or add a dedicated
  overlay — with a tabbed block:
  - tab bar: three buttons `data-d="easy|normal|hard"` (mirrors the existing `.diff` pattern,
    `js/main.js:168`), one active at a time;
  - a results container `#gbody` reusing existing `.lbrow / .rank / .sc / .meta` styles.
- **Architecture (in `net.js` + `main.js`):**
  1. On menu open (`showMenu`, `js/main.js:197`) render the tab bar and select the last-used
     diff (or `normal`).
  2. Tab click → set active class → `renderGlobal(diff)`.
  3. `renderGlobal` shows a **skeleton/loading** row, `await fetchTop(diff)`, then paints rows
     or an empty/error state. Cache results per diff in a `{}` map for the session so
     re-clicking a tab is instant; a "↻" affordance forces a refetch.
- **Fetch (top 10 per difficulty):**
  ```js
  SB.from('leaderboard')
    .select('username,score,secs,wave,created_at')
    .eq('difficulty', diff)
    .order('score', { ascending:false })
    .limit(10);
  ```
- Keep the **local** "Best runs" panel too (clearly labelled "This device") so offline play
  still has a board.

---

## 2 — Responsive Mobile UI

### 2a. Menu scaling audit (findings → fixes)

| Screen | Risk on small phones | Fix |
|---|---|---|
| `#start` (`index.html:31`) | `.overlay` is `overflow:hidden` + centered; title+tag+keys+diffsel+hint+PLAY+3 panels can exceed viewport height → bottom **clips**. | On `body.mobile` / `max-width:520`: `.overlay{overflow-y:auto; justify-content:flex-start; padding-block: max(18px,env(safe-area-inset-top)) 24px}`. |
| New `#username` modal | must not overflow on 320px width. | Flex column, `width:min(92vw,360px)`, input `width:100%`. |
| Global leaderboard tabs | 3 tabs + rows can crowd; tabs may wrap awkwardly. | Tab bar `display:flex; gap:8px; flex-wrap:wrap; justify-content:center`; rows already flex. |
| `#pause` `.pstats` (`css/style.css:124`) | `grid repeat(3, minmax(86px,auto))` = 3×86 + gaps can exceed 320px → overflow. | `@media(max-width:380px){.pstats{grid-template-columns:repeat(2,1fr)}}`. |
| `#levelup .cards` | already stacks at 820 (`:212`). | OK — verify tall stacks scroll: `#levelup{overflow-y:auto}`. |
| `#over` | short content, OK. | Confirm button tap size (below). |

**Strategy:** keep the existing `body.mobile` hook + `max-width:820/520` breakpoints; add a
fine `max-width:380` tier and a `max-height` landscape tier. Prefer **flex column + wrap**
and `clamp()`/`min()` sizing over fixed px. Make every full-screen overlay scrollable on
mobile so nothing is ever unreachable.

### 2b. Touch accessibility (tap targets)

Current undersized controls: `.diff` (`~11px` pad), `.menubtn` (underlined text ~13px),
new tab buttons, `#sound` toggle. Target **≥44×44 px** (Apple HIG) / 48dp (Material):
```css
@media (pointer:coarse){
  .diff,.menubtn,.btn,.qcyes,.qcno,.quitbtn,#sound,[data-d]{ min-height:44px; }
  .menubtn{ padding:12px 16px; }      /* was text-only */
  .diff{ padding:13px 20px; }
}
```
`#mpause` is already 44×44 (`css/style.css:201`) — use it as the reference size.

---

## 3 — Verification & efficiency

### 3a. Supabase submission check
- **Manual:** play a run → DevTools › Network → confirm `POST …/rest/v1/leaderboard` returns
  `201`; open the Global Best Runs tab and confirm the row appears at the right rank/difficulty.
- **Scripted:** `tools/verify-supabase.cjs` — `fetch` an `insert` (test username like
  `__verify__`) then a `select` against the REST endpoint with the anon key, assert the row
  round-trips, then leave it or filter it from the UI. Network-gated, run on demand (not in
  the offline `verify.cjs` gate).
- **Regression:** `node .claude/skills/neon-survivor/verify.cjs` must still exit 0 — proves
  `net.js` guards `supabase`/`fetch`/`window` and the game loads headless with `SB===null`.

### 3b. Mobile emulator audit
- Chrome DevTools device toolbar: **iPhone SE (375×667)**, **Pixel 7**, and a 320px width.
- Walk every surface: `#username` → `#start` → Global tabs → `#levelup` → `#pause` → `#over`,
  in **portrait and landscape**. Check: no clipping, no text overlap, all overlays scroll,
  and tap targets measure ≥44px with the overlay ruler.

### 3c. Token discipline — new modular files? **Yes.**
Adding this inline would bloat `main.js` toward the 24 KB split trigger flagged in
`docs/AUDIT_PLAN.md`. Proposed additions (keeps each file single-purpose):

| File | Role | Load order |
|---|---|---|
| `js/config.js` | public Supabase URL + anon key | before `core.js` |
| `js/net.js` | client init, `submitScore`, `fetchTop`, offline queue (Node/headless-safe) | after `core.js`, before `main.js` |
| CDN `<script>` | `@supabase/supabase-js@2` UMD | before `core.js` |
| `index.html` | `#username` modal + global-tab markup | — |
| `css/style.css` | modal + tab + tap-target + scroll rules | — |

`main.js` only gains thin wiring (gate the username modal, call `submitScore` in
`gameOver`, tab click → `renderGlobal`). Update `index.html` load order **and** the
CLAUDE.md file map in the same commit.

---

## Sequencing
1. Supabase: create table + RLS + index (SQL above) → record URL/anon key.
2. `config.js` + `net.js` + CDN tag; guard for headless → `verify.cjs` green.
3. `#username` modal + first-run gate.
4. `submitScore` in `gameOver` + offline queue.
5. Global Best Runs tabbed UI (`fetchTop` + `renderGlobal`).
6. Responsive CSS (scroll overlays, `:380` tier, tap targets).
7. Verify: `verify*.cjs` green · `vercel` preview build · `verify-supabase.cjs` · mobile emulator walk.
8. Commit per `feat:`/`fix:` convention → draft PR.
