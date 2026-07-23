# NEON SURVIVOR — workflow

HTML5 canvas auto-shooter, vanilla JS, no deps, offline. WASD move, gun auto-fires,
kill → XP → level up → pick 1 of 3 upgrades. Weapons, pickups, 3 difficulties, bosses,
menu/leaderboard, synth + sample music.

## Files (load order fixed — see index.html `<script defer>` tags for the authoritative order)
`<script defer>` **classic** scripts (NOT modules) — globals shared across files. Every served `js/*.js`
must stay **under 28 KB** (a larger file is silently truncated → tail vanishes with no error).
**Game core:** i18n → lang-he → config → config-sim → core → audio-orchestrator → upgrade-logic → world → sim → render → rewards →
synergy → map-system → ui-engine → net → … → debug-overlay → main.
- `index.html` markup · `css/style.css` · `css/achievements.css` · `css/skins.css`
- `js/i18n.js` EN⇄HE layer: `I18N` (lang / localStorage `neon_lang` / `apply()` / `onChange`) + global `tr(s)`; static DOM marked `data-i18n`/`data-i18n-html`/`data-i18n-ph`; `.langbtn` toggles it (start·pause·auth overlays); `window.debugLang(en,he)` live per-string override (localStorage `neon_he_ov`, wins over `LANG_HE`; `debugLang(en,null)` drops, `debugLang()` lists)
- `js/lang-he.js` `LANG_HE` Hebrew dictionary — **exact English display strings are the keys**; missing entry ⇒ English fallback
- `js/config.js` public Supabase URL + anon key (empty → local-only) · `js/config-sim.js` `BOSSES`/`SPIT` (ranged caster)/`PHIT` (core hitbox+graze)/sim tunables
- `js/core.js` foundation, sprite cache, DIFFS, BOSS, Sound, SynthMusic
- `js/audio-orchestrator.js` SampleKit→RealMusic→SynthMusic, `Music` facade; boss overdrive — under any boss the procedural bed pins intensity to 1 (full-throttle `MIX`, 8th-note war drums + top-octave stabs in `sched()`, brighter filter) while the equipped genre's boss bed keeps the character. Off-boss the composer picks a **per-genre bed** (`_bed()`): a distinct chill **menu bed** (`<g>menu` in `TRACKS`, from manifest `menubed`) when in the MENU state with no real `g+'menu'` file, else the genre's wave bed — so a `menu.mp3`-less genre still sounds like itself at the title screen. All procedural beds **vary over time** (`_vary()` — a cosmetic `_loops` clock, NEVER `srng`, rotates the progression phase, lifts the key ±a scale-step and breathes the texture thin↔full) so a loop never repeats bar-for-bar; variation is pinned OFF under a boss (overdrive owns the mix) and never runs in `verify-equiv` (headless = no audio graph), so the golden run stays byte-identical. Soundtrack ▶ **Preview** ducks the live in-graph mix via `_duckBed()` (bed + real track both feed `_g.master`) so it's never heard *over* the menu music — the preview clip is a standalone `<audio>` outside the graph, so the duck doesn't touch it
- `js/upgrade-logic.js` `UPGRADES` registry — each item's `applyLogic(p,level)` (absolute stat recalc from `p.base`×scalar) + `getLabel(level)` (dynamic card text); `window.debugUpgrade(id,level)` stat/desc audit
- `js/world.js` state globals, reset, spawning, combat, weapons, `applyUpgrade`/`openLevelUp` (delegate to `UPGRADES`), gainXP
- `js/sim.js` `update()` (one 1/60 s tick) · `js/render.js` `draw()` (interpolated)
- `js/rewards.js` `Reward` in-game JUICE facade (shake/pulse) · `js/synergy.js`/`js/map-system.js` evolutions + boss rewards
- `js/net.js` Supabase scoreboard: `getPlayer`/`savePlayer`/`submitScore`/`fetchTop` (headless/offline-safe, SB=null)
- `js/debug-overlay.js` F3 dev overlay (`_perf`/`togglePerf`/`perfFrame` — main's loop feeds ticks, typeof-guarded)
- `js/main.js` init/wiring, loop, menus, flow, `sanitizeName`; a `visibilitychange` handler pauses an in-progress run (via `togglePause`, which also freezes the sim clock) + suspends the AudioContext when the tab is hidden, so nothing plays in the background — returning re-wakes audio and leaves the game **paused** (tap to resume)

**Identity / achievement / reward stack** (loads after net, before main; all headless/offline-safe):
`achievements → achievements-ui → reward-map → genre-orchestrator → reward-granting-engine → skins-ui → theme-system → achievement-sync → callsign-filter → auth-uplink → leaderboard-sync → leaderboard-engine`.
- `js/achievements.js` `Ach` catalog + local mirror, `evaluate`, `_grantRewards`, `mockGrant`
- `js/achievements-ui.js` `AchUI` gallery + non-pausing unlock toasts; `unlockToast(id)` → fires the reward handshake
- `js/reward-map.js` pure DATA: `REWARD_MAP` (per-achievement rewards: skin/trail/music/palette) + `TRAIL_COL` swatches
- `js/genre-orchestrator.js` Total Genre Conversion 'Director': `GENRE_MAP` (genre → menu/wave/boss JUKE keys + Warden title the boss toast shows), per-genre BOSS jukebox slots (`audio/genres/<g>-boss.mp3`, absent → per-genre procedural boss bed; both merged into `Orchestra` at load), `menuBed()`/`bossBed()` name the genre's procedural menu/boss beds (`_bed()` delegates here), `rethemeGrid()` live retheme (fired by `equipMusic`; broadcasts a `rethemeGrid` CustomEvent), `window.debugGenre(id)` thematic-swap audit; `Orchestra._resolve`/`_bed` delegate here (null = legacy path)
- `js/reward-granting-engine.js` `RewardEngine` (reads `REWARD_MAP` from reward-map.js); music rewards span orchestral + unlockable **genre** soundtracks (jazz/pop/rock/rap — `genre` field; equipping re-points the gameplay theme, with a per-genre procedural bed when the file is absent); `onUnlock(id)` = grant handshake (toast + optimistic `user_inventory` insert), Soundtrack/Grids galleries, equip/preview
- `js/achievement-sync.js` `AchSync` durable identity: signUp/signIn/OTP wrappers, `_adopt`, `_setProfile`, `pull`/`pullInventory`
- `js/callsign-filter.js` `CallsignFilter` cross-language (EN↔HE) censorship: `normalizeCallsign(text)`→{latin,hebrew} comparison strings, inline canonical blocklist, `window.debugCensor(text)`; auth-uplink gates on `blocked()` before any cloud write
- `js/auth-uplink.js` `confirmUsername()` GRID ACCESS modal — one overlay, `_stage` machine (login·signup·signup-code·otp-code·local·callsign)
- `js/theme-system.js` `Theme` map palettes · `js/skins-ui.js` `Skins` showcase · `js/leaderboard-*.js` board sync/UI
- `api/verify.js` THE authoritative server grantor (service role): validates a run, writes `player_achievements`/`cosmetics_inventory`/`user_inventory`. `REWARD_MAP`/`CATALOG`/`COSMETIC_MAP` here MUST stay in lockstep with the client. `authUid()` binds the write to the session bearer's `auth.uid()` (a mismatched `player_id` → 403; a no-session claim can't target a registered account) — `js/achievements.js` `_submit` sends the token.
- `api/claim.js` one-time legacy re-key (service role): moves `player_achievements`/`user_inventory`/`runs` from a pre-auth localStorage id onto the durable auth id (bearer must own the destination; refuses a legacy id that is itself an account). Wired to `AchSync.claimLegacy` (fires once on first login, `neon_legacy_claimed` marker).
- `supabase/schema.sql` RLS + the `profiles_username_unique` (case-insensitive UNIQUE callsign) index + `callsign_available` RPC

## Verify (run after every edit)
- `node .claude/skills/neon-survivor/verify.cjs` — syntax + headless load + boss sim
- `node .claude/skills/neon-survivor/verify-upgrades.cjs` — after upgrade logic
- `node .claude/skills/neon-survivor/verify-equiv.cjs` — after behavior-preserving refactors
- `node .claude/skills/neon-survivor/verify-achievements.cjs` — after achievement/reward catalog or `api/verify.js` edits (client↔server lockstep)
- `node .claude/skills/neon-survivor/verify-otp.cjs` — after auth-uplink / achievement-sync edits (signup-code · otp-code · instant-resume)
- `node .claude/skills/neon-survivor/verify-censor.cjs` — after callsign-filter / auth-gate edits (cross-language EN↔HE censorship: blocked · allowed · convergence · `debugCensor`)
- `node .claude/skills/neon-survivor/verify-fullcycle.cjs` — full identity arc: login → unique callsign → unlock → reward → showcase (`--live` for a real Supabase round-trip)
- `node .claude/skills/neon-survivor/verify-grid.cjs` — 'Grid-Grade' regression: OTP login → Tier-3 synergy juice (shake/pulse/toast/sting) → gold reward → captured `user_inventory` write
- `node .claude/skills/neon-survivor/verify-size.cjs` — 28 KB silent-truncation guard for every served `js/*.js`
- `node .claude/skills/neon-survivor/verify-ui-he.cjs` — Hebrew UI snapshot test (headless Chromium via global playwright): boots in `he`, asserts menu + level-up strings/RTL/no-clipping, saves PNGs to `$UIHE_OUT` (or tmp) — run after `lang-he.js` or RTL-CSS edits

## Deploy (Vercel)
- `vercel` — build a **preview** deployment
- `vercel --prod` — **ship** to production

## GitHub commits
Conventional prefixes: `feat:` (feature), `fix:` (bug), `refactor:` (no behavior change),
also `chore:`/`docs:`/`perf:`. One logical change per commit, imperative subject.

## Verification gap — REQUIRED before any push
Never push until **all three apply**:
1. `vercel` preview build succeeds (no build errors). Static site, no build step — if the Vercel CLI is
   unavailable, it's still satisfied for changes that touch **no** served asset (`index.html`/`css`/`js`/`api`),
   e.g. test-harness-only or docs-only changes; say so explicitly rather than claiming a build that didn't run.
2. all `verify*.cjs` tests pass (exit 0)
3. changes committed with a conventional message

## Gotchas
- `audio/` + `icons/` are browser-cached 30 days (`vercel.json`) — **rename the file** when its content changes, or players keep the stale one; js/css/html stay on revalidate-every-visit so a deploy can't mix script versions.
- Movement is **per-tick (1/60 s)**, not per-second — `+= v`, never `* dt`.
- Anything that moves needs `px/py` snapshot + `ix()/iy()` lerp in `draw()`.
- Collision loops use live `enemies.length` (killEnemy splices mid-scan).
- Tune boss/difficulty in the `BOSS`/`BOSSES`/`DIFFS` config objects, not hot loops.
- Enemy roster (`spawnEnemy` base table, world.js): `grunt` (steady chaser — the readable baseline unit, deliberately kept dumb so the equiv golden run stays byte-identical) · `fast` · `tank` (melee) + **`spitter`** — a late-wave (elapsed>90 s, off-boss) ranged **caster** that kites to a standoff band and fires slow, telegraphed aimed bolt-spreads (`spitFire`, tuned in `SPIT`; `e.tele`/`e.fcd` = wind-up + cadence, mirrors the boss telegraph). `SPIT.cap` hard-limits on-screen bolts so the storm stays fair. This is the non-boss "bullet-storm" layer.
- **Melee LUNGE** (`LUNGE` in config-sim.js; fast enemies, sim.js movement loop): `fast` rushers don't just home — in a mid-range band, on cadence (`e.lcd`), they wind up a readable telegraph (`e.tele`, amber charge-line in render.js) then COMMIT to a straight dash (`e.dvx/dvy/dashT`, reusing the boss-dash fields) you dodge like an aimed bolt, then recover. Lunge cadence tightens with elapsed → escalating but always telegraphed. Only `fast` lunges (grunt/tank stay steady) — and `fast` never spawns in the <15 s golden run, so equiv is unaffected.
- **Wave rhythm** (sim.js spawn block): past 90 s and off-boss, the spawn interval is sine-modulated (`surge`) into ~18 s crescendo→lull cycles so late waves *breathe* instead of grinding flat. Early game (<90 s) keeps the original clean ramp — this also keeps the `verify-equiv` golden run (first ~15 s) byte-identical.
- **Difficulty-cliff smoothing** (the ~150–240 s "boss-2 → boss-3" wall, from playtest feedback — four escalators were all peaking at once): the very-late HP super-linear term (`world.js`) was softened over time (0.00012→0.0001→**0.00006**) *and* its **onset pushed 180→270 s** so it no longer ignites the instant the post-boss breather lifts; the spawn **batch** grows every **90 s** (was 70 s, `sim.js` `floor(elapsed/90)`); and the post-boss **breather** ramps density back over **45 s** (was 30 s, `BOSS.breatherT` 1800→2700). Difficulty now rides on readable density that *climbs* — not bullet-sponges or a 30 s-lull→instant-flood light switch. All four levers are zero before their onset, so the golden run stays byte-identical (`verify-equiv` still matches).
- **Bullet-hell fairness** (`PHIT` in config-sim.js): enemy PROJECTILES collide against a tiny core radius (`PHIT.core`=6), NOT the ship sprite (r:14) — the glowing centre dot IS the hitbox and flares cyan on a graze. Enemy BODY contact uses a reduced `PHIT.body`=10 (not the full sprite) so you can weave through a swarm — same tiny-core philosophy, but bodies stay fatter than bolts. A bolt inside `PHIT.graze` but outside the core calls `graze(b)` (world.js) once per bolt → core flare (`p.grazeT`) + `p.grazes`++ + `+PHIT.grazeScore`, all **deterministic (no rand)** so the equiv golden run stays RNG-locked. This is what lets bullet DENSITY go "insane" while staying fair — dodge the storm, don't out-tank it. Density scales past **tier 1 only** (2nd offset burst ring; `spitFire` fan widens 3→5) so the equiv tier-1 boss is untouched. Graze/hitbox never trigger in the 15 s golden run (player is never within the band there), so no baseline re-anchor was needed.
- 3 boss archetypes in `BOSSES` (config-sim.js), cycled by tier `(tier-1)%3`: **REVENANT** (crimson brawler — dash/slam), **MAELSTROM** (cyan zoner — rotating bullet-storm + aimed spread), **OVERSEER** (violet swarm-lord — summons drones + blink). Each boss has a looping `seq` of attack ids (0 burst·1 dash·2 slam·3 spiral·4 spread·5 summon·6 blink); `bossNext()` advances the sequence. Per-type sprite via `bossSprite(bt)`.
- Edit by unique anchor string; keep the terse one-liner style.
- **i18n:** every NEW player-visible string gets `tr('…')` at its **display** site (never translate ids/keys) plus a
  `LANG_HE` entry in `js/lang-he.js`; static HTML gets `data-i18n` instead. Hebrew reading direction is CSS-only
  (`html[lang=he] …{direction:rtl}` in style.css) — layout stays LTR. Watch `verify-size.cjs`: lang-he.js grows with
  every entry, and main.js (~27 KB, ~1.3 KB of headroom) / achievements.js / world.js sit near the 28 KB cap.
