# NEON SURVIVOR — workflow

HTML5 canvas auto-shooter, vanilla JS, no deps, offline. WASD move, gun auto-fires,
kill → XP → level up → pick 1 of 3 upgrades. Weapons, pickups, 3 difficulties, bosses,
menu/leaderboard, synth + sample music.

## Files (load order fixed)
`<script defer>` **classic** scripts (NOT modules) — globals shared across files.
Order: **config → core → audio-engine → world → sim → render → net → main**.
- `index.html` markup · `css/style.css` styles
- `js/config.js` public Supabase URL + anon key (empty → local-only)
- `js/core.js` foundation, sprite cache, DIFFS, BOSS, Sound, SynthMusic
- `js/audio-engine.js` SampleKit→RealMusic→SynthMusic, `Music` facade
- `js/world.js` state globals, reset, spawning, combat, weapons, upgrades, gainXP
- `js/sim.js` `update()` (one 1/60 s tick) · `js/render.js` `draw()` (interpolated)
- `js/net.js` Supabase scoreboard: `getPlayer`/`savePlayer`/`submitScore`/`fetchTop` (headless/offline-safe, SB=null)
- `js/main.js` init/wiring, loop, menus, flow, username modal, global board, F3 debug overlay

## Verify (run after every edit)
- `node .claude/skills/neon-survivor/verify.cjs` — syntax + headless load + boss sim
- `node .claude/skills/neon-survivor/verify-upgrades.cjs` — after upgrade logic
- `node .claude/skills/neon-survivor/verify-equiv.cjs` — after behavior-preserving refactors

## Deploy (Vercel)
- `vercel` — build a **preview** deployment
- `vercel --prod` — **ship** to production

## GitHub commits
Conventional prefixes: `feat:` (feature), `fix:` (bug), `refactor:` (no behavior change),
also `chore:`/`docs:`/`perf:`. One logical change per commit, imperative subject.

## Verification gap — REQUIRED before any push
Never push until **all three apply**:
1. `vercel` preview build succeeds (no build errors)
2. all `verify*.cjs` tests pass (exit 0)
3. changes committed with a conventional message

## Gotchas
- Movement is **per-tick (1/60 s)**, not per-second — `+= v`, never `* dt`.
- Anything that moves needs `px/py` snapshot + `ix()/iy()` lerp in `draw()`.
- Collision loops use live `enemies.length` (killEnemy splices mid-scan).
- Tune boss/difficulty in the `BOSS`/`BOSSES`/`DIFFS` config objects, not hot loops.
- 3 boss archetypes in `BOSSES` (config-sim.js), cycled by tier `(tier-1)%3`: **REVENANT** (crimson brawler — dash/slam), **MAELSTROM** (cyan zoner — rotating bullet-storm + aimed spread), **OVERSEER** (violet swarm-lord — summons drones + blink). Each boss has a looping `seq` of attack ids (0 burst·1 dash·2 slam·3 spiral·4 spread·5 summon·6 blink); `bossNext()` advances the sequence. Per-type sprite via `bossSprite(bt)`.
- Edit by unique anchor string; keep the terse one-liner style.
