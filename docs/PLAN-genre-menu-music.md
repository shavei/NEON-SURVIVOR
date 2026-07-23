# Implementation Plan — Genre-Aware, Varying Menu (and In-Game) Music

> ## 🟢 STATUS: EXECUTED (verified 2026-07-23)
> Shipped. Per-genre procedural menu beds (`_bed()`/`menuBed`) and time-varying composition
> (`_vary()`) are live in `js/audio-orchestrator.js` + `js/genre-orchestrator.js`, and the
> behavior is documented in `CLAUDE.md`. The "scaffold only" note below is historical.

> Scaffold/plan only. No game logic changed yet. Grounded in the current audio stack
> (`js/audio-orchestrator.js` `Orchestra`, `js/genre-orchestrator.js` `GenreOrchestrator`/`GENRE_MAP`,
> `js/audio-manifest.js` `AUDIO_MANIFEST`, `js/reward-granting-engine.js` `RewardEngine.equipMusic`).
> Deferred out of the audio-fixes PR (#121) by request — this is the "feature", not the two bugs.

## The ask (from playtest feedback)

> "The music when you open the app should be the music that you **equipped** — but maybe some
> different type, similar, so it's **not the same the whole time**. And in the game, the same."

Two distinct wants, one of which is mostly already handled:

1. **Startup/menu music should match the equipped genre.** *(Mostly done — see audit.)*
2. **The music should VARY over time** within that genre's character, instead of looping one
   fixed bed forever — in the menu **and** in gameplay. *(This is the real gap.)*

---

## 0 — Audit findings (what exists today)

| Concern | Where | Notes |
|---|---|---|
| Equipped genre resolves at boot | `js/genre-orchestrator.js:26` `GO.current()` | Reads `RewardEngine.equippedMusic()` → localStorage `_trackKey()`. So `current()` already returns the equipped genre on a **fresh load**, not just after an in-session equip. |
| Menu key re-points through genre | `js/audio-orchestrator.js` `menu()` → `_playReal('menu','menu')` → `_resolve` → `GenreOrchestrator.resolveKey('menu')` (`genre-orchestrator.js:37`) | Equipped genre `g` maps `menu → g+'menu'` via `GENRE_MAP`. **So the menu already tries the equipped genre's menu track on startup.** |
| ...but most genres ship no `menu.mp3` | `audio/genres/README.md` (only `wave.mp3` supplied for pop/metal/rap) | `_playReal` returns false when the `g+'menu'` slot has no file → falls back to the **procedural bed** (`_bed()`), which for the menu is a single generic ambient loop — *not* strongly genre-flavoured, and identical every visit. |
| Bed is one fixed loop | `js/audio-orchestrator.js` `sched()` reads `this.TRACKS[this._bed()]` | 8-bar procedural cycle (`T.prog`/`T.bass`), same harmony/tempo every loop. No variation, no rotation. This is the "same the whole time" the feedback names. |
| Gameplay bed | same `sched()` path, `active` = `ambient`/`boss` | Same single-loop limitation in-game. |
| Live retheme on equip | `js/reward-granting-engine.js:88` `equipMusic` → `GenreOrchestrator.rethemeGrid()` (`genre-orchestrator.js:50`) | Already swaps the live bed + broadcasts `rethemeGrid`. Variation must ride on top of this, not fight it. |
| Preview isolation | `Orchestra._duckBed()` (added in #121) | Preview ducks the live bed — any variation scheme must still restore to the `0.9` bed level `_duckBed(false)` expects. |

**Takeaway:** want #1 is ~90% done — the equipped genre already drives the menu on boot. The
felt problem is really **(a) genres lacking a `menu.mp3` fall back to a flavourless shared bed**,
and **(b) nothing varies** — menu or gameplay. So the plan is: make the fallback genre-flavoured,
and add cheap **variation** to the procedural composer.

**Key constraint:** classic globals, fixed load order, everything headless/offline-safe
(`verify.cjs` loads with no DOM/audio → guard `Audio`/`Sound.ac`). Determinism: the procedural
composer is **cosmetic** (excluded from the equiv hash), but any variation must **not** touch
seeded gameplay RNG (`srng`) — use a separate cosmetic clock/`rand`, never `srng`, so
`verify-equiv` stays byte-identical.

---

## 1 — Make the menu bed genre-flavoured (fallback path)

Today `_bed()` returns one TRACKS key for the ambient/menu state regardless of genre. Give each
genre a distinct **procedural menu bed** (tempo + harmony + drive), the same way boss beds already
differ per genre.

- Extend `GENRE_MAP` (or `TRACKS`) with a per-genre `menuBed` descriptor (bpm / `prog` / `bass` /
  `drive` / `ostinato`) — reuse the existing `TRACKS` shape so `sched()` needs no new voice code.
- `_bed()` (or `_resolve('menu')` when the real slot is absent) picks the equipped genre's `menuBed`
  instead of the shared ambient loop. Orchestral (`current()==='orchestral'`) keeps today's bed.
- Net: an equipped genre with no `menu.mp3` still *sounds like that genre* in the menu, not generic.

## 2 — Variation: "not the same the whole time"

Add cheap, deterministic-per-visit-but-non-repeating variation to the procedural composer so a
loop doesn't feel identical bar after bar. Pick one (or layer them); all are cosmetic-only:

- **A. Chord-cycle rotation (cheapest).** `sched()` already walks `T.prog[ci]` where
  `ci = (bar>>1) % prog.length`. Add 1–2 extra progression variants per bed and rotate the *variant*
  every N cycles (e.g. every 4 loops), so the harmony evolves then returns. ~1 data field + a modulo.
- **B. Section transposition.** Every M loops, shift the whole bed by a scale-step (±2/±5 semis) for
  one cycle then resolve back — a "key lift" that reads as movement without new assets.
- **C. Layer rotation.** Toggle `winds`/`brass`/`choir`/`ostinato` presence on a slow cycle so the
  texture breathes (thin → full → thin) independent of the intensity gate.
- **D. Multi-file playlist (if real recordings arrive).** Let a genre supply `menu.mp3` **and**
  `menu2.mp3`; `_playReal` rotates between them on loop-end. Manifest + fallback only; no engine
  rewrite. (Respect the 30-day `audio/` cache → new content = new filename.)

**Recommended first cut:** A + C on the procedural beds (zero new assets, tiny code, immediately
fixes the "same the whole time" complaint in menu *and* gameplay), with D as the upgrade path once
CC0 stems exist. Drive the variation clock from a **cosmetic** counter (loop count / `performance.now`),
never `srng`.

## 3 — Gameplay parity

The same procedural path (`sched()` + `_bed()`) drives gameplay (`active==='ambient'`/`'boss'`), so
§2's variation applies in-game for free. Confirm boss overdrive still pins intensity to 1 and the
war-drum/stab layer is unaffected (variation should sit under the boss-overdrive branch, not fight it).

---

## 4 — Verification & efficiency

- **Determinism (non-negotiable):** `node .claude/skills/neon-survivor/verify-equiv.cjs` must stay
  byte-identical — proves the variation rides a cosmetic clock and never `srng`.
- **Headless load:** `verify.cjs` green — new `GENRE_MAP`/`TRACKS` data + `_bed()` branch must guard
  `Audio`/`Sound.ac` and load with no DOM.
- **Genre swap audit:** `debugGenre(id)` for each genre → confirm the menu bed audibly differs and
  varies over ~1 min; `debugGenre(null)` reverts to the equipped/default cleanly.
- **Size guard:** `verify-size.cjs` — the new bed data lands in `audio-orchestrator.js` /
  `genre-orchestrator.js` / `audio-manifest.js`; keep each under 28 KB (audio-orchestrator has room,
  main.js does **not** — don't put it there).
- **Manual:** open app cold with a genre equipped → menu sounds like that genre and evolves; start a
  run → same character carries in, varies, and boss overdrive still hits; `▶ Preview` still ducks the
  (now varying) bed and restores it.

## 5 — Out of scope / follow-ups

- Real per-genre `menu.mp3` stems (CC0/PD) — track under `audio/genres/README.md` supply table.
- User-facing "menu music: on/off/variation" toggle — only if requested.

## Sequencing
1. Per-genre procedural `menuBed` data + `_bed()`/`_resolve('menu')` fallback branch (§1).
2. Variation scheme A + C on the procedural composer, cosmetic clock (§2) — verify-equiv green.
3. Confirm gameplay + boss parity (§3).
4. (Later) multi-file playlist support in the manifest (§2-D) when stems exist.
5. Verify: `verify*.cjs` green · `vercel` preview · `debugGenre` audit · manual cold-boot walk.
6. Commit per `feat:` convention → draft PR; update `CLAUDE.md` audio map + `audio/genres/README.md`.
