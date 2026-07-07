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
- `js/config.js` public Supabase URL + anon key (empty → local-only) · `js/config-sim.js` `BOSSES`/`SPIT` (ranged caster)/sim tunables
- `js/core.js` foundation, sprite cache, DIFFS, BOSS, Sound, SynthMusic
- `js/audio-orchestrator.js` SampleKit→RealMusic→SynthMusic, `Music` facade; boss overdrive — under any boss the procedural bed pins intensity to 1 (full-throttle `MIX`, 8th-note war drums + top-octave stabs in `sched()`, brighter filter) while the equipped genre's boss bed keeps the character
- `js/upgrade-logic.js` `UPGRADES` registry — each item's `applyLogic(p,level)` (absolute stat recalc from `p.base`×scalar) + `getLabel(level)` (dynamic card text); `window.debugUpgrade(id,level)` stat/desc audit
- `js/world.js` state globals, reset, spawning, combat, weapons, `applyUpgrade`/`openLevelUp` (delegate to `UPGRADES`), gainXP
- `js/sim.js` `update()` (one 1/60 s tick) · `js/render.js` `draw()` (interpolated)
- `js/rewards.js` `Reward` in-game JUICE facade (shake/pulse) · `js/synergy.js`/`js/map-system.js` evolutions + boss rewards
- `js/net.js` Supabase scoreboard: `getPlayer`/`savePlayer`/`submitScore`/`fetchTop` (headless/offline-safe, SB=null)
- `js/debug-overlay.js` F3 dev overlay (`_perf`/`togglePerf`/`perfFrame` — main's loop feeds ticks, typeof-guarded)
- `js/main.js` init/wiring, loop, menus, flow, `sanitizeName`

**Identity / achievement / reward stack** (loads after net, before main; all headless/offline-safe):
`achievements → achievements-ui → reward-map → genre-orchestrator → reward-granting-engine → skins-ui → theme-system → achievement-sync → callsign-filter → auth-uplink → leaderboard-sync → leaderboard-engine`.
- `js/achievements.js` `Ach` catalog + local mirror, `evaluate`, `_grantRewards`, `mockGrant`
- `js/achievements-ui.js` `AchUI` gallery + non-pausing unlock toasts; `unlockToast(id)` → fires the reward handshake
- `js/reward-map.js` pure DATA: `REWARD_MAP` (per-achievement rewards: skin/trail/music/palette) + `TRAIL_COL` swatches
- `js/genre-orchestrator.js` Total Genre Conversion 'Director': `GENRE_MAP` (genre → menu/wave/boss JUKE keys + Warden title the boss toast shows), per-genre BOSS jukebox slots (`audio/genres/<g>-boss.mp3`, absent → per-genre procedural boss bed; both merged into `Orchestra` at load), `rethemeGrid()` live retheme (fired by `equipMusic`; broadcasts a `rethemeGrid` CustomEvent), `window.debugGenre(id)` thematic-swap audit; `Orchestra._resolve`/`_bed` delegate here (null = legacy path)
- `js/reward-granting-engine.js` `RewardEngine` (reads `REWARD_MAP` from reward-map.js); music rewards span orchestral + unlockable **genre** soundtracks (jazz/pop/rock/rap — `genre` field; equipping re-points the gameplay theme, with a per-genre procedural bed when the file is absent); `onUnlock(id)` = grant handshake (toast + optimistic `user_inventory` insert), Soundtrack/Grids galleries, equip/preview
- `js/achievement-sync.js` `AchSync` durable identity: signUp/signIn/OTP wrappers, `_adopt`, `_setProfile`, `pull`/`pullInventory`
- `js/callsign-filter.js` `CallsignFilter` cross-language (EN↔HE) censorship: `normalizeCallsign(text)`→{latin,hebrew} comparison strings, inline canonical blocklist, `window.debugCensor(text)`; auth-uplink gates on `blocked()` before any cloud write
- `js/auth-uplink.js` `confirmUsername()` GRID ACCESS modal — one overlay, `_stage` machine (login·signup·signup-code·otp-code·local·callsign)
- `js/theme-system.js` `Theme` map palettes · `js/skins-ui.js` `Skins` showcase · `js/leaderboard-*.js` board sync/UI
- `api/verify.js` THE authoritative server grantor (service role): validates a run, writes `player_achievements`/`cosmetics_inventory`/`user_inventory`. `REWARD_MAP`/`CATALOG`/`COSMETIC_MAP` here MUST stay in lockstep with the client.
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
- Enemy roster (`spawnEnemy` base table, world.js): `grunt`·`fast`·`tank` (all melee) + **`spitter`** — a late-wave (elapsed>90 s, off-boss) ranged **caster** that kites to a standoff band and fires slow, telegraphed aimed bolt-spreads (`spitFire`, tuned in `SPIT`; `e.tele`/`e.fcd` = wind-up + cadence, mirrors the boss telegraph). `SPIT.cap` hard-limits on-screen bolts so the storm stays fair. This is the non-boss "bullet-storm" layer.
- **Wave rhythm** (sim.js spawn block): past 90 s and off-boss, the spawn interval is sine-modulated (`surge`) into ~18 s crescendo→lull cycles so late waves *breathe* instead of grinding flat. Early game (<90 s) keeps the original clean ramp — this also keeps the `verify-equiv` golden run (first ~15 s) byte-identical. Very-late HP super-linear term softened (0.00012→0.0001) so difficulty rides on readable density, not bullet-sponges.
- 3 boss archetypes in `BOSSES` (config-sim.js), cycled by tier `(tier-1)%3`: **REVENANT** (crimson brawler — dash/slam), **MAELSTROM** (cyan zoner — rotating bullet-storm + aimed spread), **OVERSEER** (violet swarm-lord — summons drones + blink). Each boss has a looping `seq` of attack ids (0 burst·1 dash·2 slam·3 spiral·4 spread·5 summon·6 blink); `bossNext()` advances the sequence. Per-type sprite via `bossSprite(bt)`.
- Edit by unique anchor string; keep the terse one-liner style.
- **i18n:** every NEW player-visible string gets `tr('…')` at its **display** site (never translate ids/keys) plus a
  `LANG_HE` entry in `js/lang-he.js`; static HTML gets `data-i18n` instead. Hebrew reading direction is CSS-only
  (`html[lang=he] …{direction:rtl}` in style.css) — layout stays LTR. Watch `verify-size.cjs`: lang-he.js grows with
  every entry, and main.js (~25 KB) / achievements.js / world.js sit within ~3 KB of the 28 KB cap.
