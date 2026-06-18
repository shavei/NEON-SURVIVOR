# NEON SURVIVOR — codebase map

HTML5 canvas game, vanilla JS, no deps, fully offline. Vampire-Survivors-style auto-shooter: move (WASD), gun auto-fires at nearest enemy, kill → XP orbs → level up → pick 1 of 3 upgrades. Has weapons, map pickups, 3 difficulties, bosses, menu + leaderboard, synth music.

## File structure (split from a former single index.html → then engine.js split into 4)
All `js/*.js` are `<script defer>` **classic** scripts (NOT modules), so top-level `const`/`let` are shared
across files. **Load order is fixed: core → audio-engine → world → sim → render → main** (declarations must exist
before the main.js bootstrap runs; only main.js executes game code at load).
- **`index.html`** — markup only: canvas + overlay/HUD DOM, links `css/style.css`, loads the 6 scripts in order.
- **`css/style.css`** — all styles.
- **`js/core.js`** — foundation (`cv/ctx/W/H/DPR/needsDraw/rand/clamp`), sprite cache, `DIFFS`, `Sound`, `SynthMusic` (the procedural music fallback; the public `Music` facade lives in audio-engine.js).
- **`js/audio-engine.js`** — real instrument audio: `RealMusic` (async-loaded OGG stem loops, intensity-layered, gapless) + the `Music` **facade** that game code calls. Falls back to `SynthMusic` when stems aren't loaded. See `AUDIO_SPEC.md` for the stem sourcing brief.
- **`js/world.js`** — sim clock globals (`STEP/acc/alpha/lerp/slowmo`), all state globals, nebula/stars, `reset`, spawning, combat, pickups, weapons, upgrades, `gainXP`.
- **`js/sim.js`** — `update()` only (the per-tick simulation).
- **`js/render.js`** — `draw()` (interpolated renderer) + `roundRect`.
- **`js/main.js`** — init & wiring: `resize`, input listeners, `HUD`/`updateHUD`/`flashHit`, the dev debug overlay (`_perf`/`togglePerf`/`perfFrame` + `_bossLine`/`_statLine`/`_ATK`, toggle **F3** — 3 lines: perf / live boss FSM / player stats; reads globals only, never mutates sim), the fixed-timestep `loop`, flow (`startGame`/`gameOver`/`togglePause`/`showPause`/`quitToMenu`/`showMenu`), menus + leaderboard, button bindings, and the startup bootstrap (`generateNebula()`, `requestAnimationFrame(loop)`).

## Workflow (do this every time)
- **Read this map + `Grep` a section header** in the relevant `js/*.js` (core/world/sim/render/main) to jump to code; don't read whole files.
- **Edit by unique anchor string**, keep the terse one-liner style.
- **Verify after every edit:** `node .claude/skills/neon-survivor/verify.cjs` (syntax + headless load + boss sim; auto-reads all `<script src>` in order). Exit 0 = good.
- **After touching any upgrade logic:** `node .claude/skills/neon-survivor/verify-upgrades.cjs` — for every id in `UPGRADES[]`, asserts `applyUpgrade(id)` changes *only* its own `player` field(s) by the exact delta (locks the Vitality-class bug shut). Keep its `EXP` table in lockstep with `applyUpgrade()` in world.js.
- **After any refactor that should preserve behavior:** `node .claude/skills/neon-survivor/verify-equiv.cjs` — seeds `Math.random`, runs 900 scripted frames of the live `core+world+sim+render+main` build vs the frozen `baseline-original.js`, asserts an identical state hash. (Update the baseline only for *intentional* logic changes — it was last re-anchored to the post-fixed-timestep build; regenerate by concatenating the current `js/*.js` in load order.)
- Open to eyeball: `start "" index.html` (Windows).
- See `.claude/skills/neon-survivor/SKILL.md` for pitfalls.

## System map (find via these section-header comments; line numbers drift)
- `SPRITE CACHE` — `_spr`, `dotSprite(color)`, `EMETA`, `enemySprite(type,white)`, `shipSprite(rage,r)`. Glow baked once → `drawImage`. Add new enemy visuals to `EMETA`. **`fast` enemies are amber `#ff9d2e` with a baked pale outline (`EMETA.fast.ring`) + an amber particle trail (sim.js) — deliberately contrasted against the teal `#54e6b5` XP orbs so threats ≠ pickups.** (If you change `fast`'s color, change it in BOTH `EMETA` and the `spawnEnemy` base table so the death burst matches.)
- `DIFFICULTY` — `DIFFS{easy,normal,hard}` (spawn/hp/dmg multipliers), `DIFF` current.
- `SOUND ENGINE` — `Sound` (Web Audio): `shoot/death/boom/pickup/hurt/zap/ping/level`, `toggle`, `master`.
- `AUDIO ARCHITECTURE` (audio-engine.js) — **`Music` is a facade**, not the synth. Game code (`main.js`, `world.js`) only ever calls `Music.{start,stop,die,enterBoss,exitBoss,reset}` + `Music.bossMode`. **Delegation chain (each hands off to the next if its assets aren't loaded): `SampleKit` (default) → `RealMusic` (stem loops) → `SynthMusic` (procedural fallback, core.js).** Exactly one engine sounds at a time; engines upgrade live as assets decode (synth from frame 1 → stems/samples when ready), so the game never hangs.
  - **`SampleKit`** (DEFAULT) — recorded one-shot **sampler**: loads ~8 short hits from `audio/samples/` (`kick/snare/hat/openhat/chug/chord/bass/lead`) and a step sequencer (`sched()`, 8th-note grid, 8-bar loop, reads `this.active` for tempo/prog) triggers + **pitch-shifts** them (`playbackRate = 2^((note - MANIFEST.roots[file])/12)`) into a full song. Per-layer gain buses (`drums/rhythm/bass/lead/fx`) → filter → master; layered by intensity via **`RealMusic.MIX`** (reused) + a ticker. Inherently gapless (discrete retriggered hits — no loop seam); tiny assets (~85 KB). Roots are mid-range so pitch shifts stay small. Generated placeholders: `tools/gen_samples.py`; overwrite any `.ogg` with a real CC0 hit **at the same pitch root** — zero code change.
  - **`RealMusic`** (stem-loop engine, fallback) — `RealMusic`: per-track `MANIFEST` (stem files, data not branches) + `MIX` (intensity→per-stem gain curves); `load()` is async (`fetch`→`decodeAudioData`, guarded — no fetch at load, runtime failures caught → stays on synth, so headless/asset-less/`file://` all fall back cleanly); graph is `stem src(loop) → stemGain → trackBus → filter → master → Sound.master`; gapless looping pins `src.loopEnd` to the exact bar-grid length (`bars*4*60/bpm`), NOT `buffer.duration` — codec decode-padding (Vorbis decodes a few ms long) would otherwise gap each loop; `enterBoss/exitBoss` crossfade trackBuses (+ optional `audio/boss/intro.ogg` one-shot drop); a `setInterval` ticker ramps stem gains by the same intensity computation as the synth. **Stems live in `audio/normal/` + `audio/boss/` (5 each + boss `intro.ogg`); absent → synth fallback.** Current stems are SYNTHESIZED (free, no license) by `tools/gen_stems.py` + `tools/gen_intro.py` (pure stdlib → WAV → ffmpeg OGG q5); overwrite any `.ogg` with a real recording, zero code change. **Real audio needs HTTP (`fetch` is blocked on `file://`) — serve via the `neon` launch config / `npx http-server`; `file://` double-click still runs on synth.** `reset()` (called from world.js) clears boss state on both engines.
- `MUSIC` (SynthMusic, core.js) — procedural synth fallback (kick/snare/hats/toms/sub/bass/pad/arp/lead/bells/stabs); reacts to enemy count + low HP. `start/stop/sched`. **Track config is data, not branches:** `Music.TRACKS{normal,boss}` holds per-track tempo (`spb`)/mix (`baseGain`,`gainScale`,`cutBase`,`cutScale`,`q`)/layer flags (`fourFloor`,`heavy`); `sched()` reads `T=TRACKS[bossMode?'boss':'normal']` — add a new track (e.g. final-boss) as a table entry, not another `if(boss)` in the hot loop. **Distortion bus:** `Music.drive` (a `WaveShaper`, tanh curve via `makeDriveCurve`) → `filter`; `voice()` takes an optional `dest` arg so heavy layers route saws through it for an overdriven "guitar" tone. **Boss mode (heavy/trance):** `Music.enterBoss()` (from `spawnBoss`) swaps to `bossProg`/`bossBass`, plays a fight-start sting **+ a 1-bar riser into the drop**, sets `bossMode=true` → `sched()` runs the boss track: ~150 BPM, four-on-the-floor + 8th-note double-kick, distorted root+fifth+octave power chords and a driving lead through `drive`, higher filter `Q`. `Music.exitBoss()` (from `killEnemy`'s boss branch) restores the normal progression (crossfades via `setTargetAtTime`) + a triumphant resolve chord. **`Music.die()`** (from `gameOver()`, replaces the old abrupt `stop()`) does a turntable power-down (pitch-bend + filter close + descending groan) then tears down nodes after 850 ms — guarded so a quick `startGame()` within that window isn't killed. `bossMode` survives `stop()/start()` (pause/resume keeps the boss track); `reset()` clears it (dying mid-fight doesn't leak the boss track into the next run).
- `generateNebula()` (built once at startup) + `STAR_FIELD`/`initStars()` — background. Nebula drawn **once stretched to W,H** (no tiling).
- State globals: `state, player, enemies, bullets, orbs, particles, floats, missiles, bolts, items, ebullets`, `nextBoss, bossOn`, `WORLD, cam`, `needsDraw`.
- `reset()` — init/zero everything for a new run (also clears `Up`).
- `spawnEnemy()`, `spawnBoss()`, `bossAttack(e)`, `bossCD()`. All boss stats (HP/dmg/speed, attack cadence, telegraph, hitbox/i-frames, **dash + slam tunables**) come from the `BOSS` config object in `core.js` (next to `DIFFS`) — tune there, not in the hot loops. Boss attacks **telegraph**: when `bossT` hits 0 the boss sets `e.tele=BOSS.teleT` (drawn in `render.js`) and only fires when `tele` expires. **3-attack cycle** via `e.atk` (set in `spawnBoss`): `0` CIRCULAR BURST (aimed radial `ebullets`), `1` TARGETED DASH (locks a vector → charges `e.dvx/dvy` for `BOSS.dashT` ticks; the dash sub-state lives in the sim.js enemy-movement loop, which overrides chase movement and advances cadence/`atk` when `dashT` hits 0), `2` AOE GROUND SLAM (outward shockwave ring of `ebullets` to outrun). `bossAttack` dispatches on `e.atk`; burst/slam are instant (reset cadence + advance `atk` there), dash defers that to dash-end. Telegraphs are **color-coded per attack** in `render.js`: red ring (burst) / amber lunge line (dash) / growing cyan ground ring (slam), plus an amber dash motion-streak while `dashT>0`.
- `fire()`, `burst()`, `floatText()`, `damageEnemy()`, `killEnemy()` (boss death = big rewards + item drop + `bossOn=false`).
- pickups: `ITEMS`, `spawnItem()`, `showToast()`, `pickItem()` (heal/bomb/magnet/rage).
- weapons: `fireMissiles()`, `explodeMissile()`, `castChain()`.
- upgrades: `UPGRADES[]`, `Up{}` (counts), `applyUpgrade(id)`, `renderLoadout()`, `openLevelUp()`, `gainXP()`.
- `update()` (sim.js) — one **fixed 1/60 s tick**: snapshots prev positions (`px/py`) for interpolation, then movement, camera dead-zone, weapons, spawns incl. boss trigger, all collision loops. `draw()` (render.js) — render, lerping every moving body (player/cam/enemies/bullets/missiles/ebullets/orbs) by `alpha`; particles/floats/items NOT interpolated by design. `updateHUD()` (cached refs + change-guards; low-HP vignette is now a CSS `.danger` pulse, JS only sets `--sev`). **Guard convention: key each change-guard on the RAW operands a readout displays, never a derived ratio.** The HP label shows `hp / maxhp` but once guarded only on the `%` — so Vitality at full HP (`hp` & `maxhp` both +30 → % unchanged) skipped the DOM write and the label looked frozen. It now guards on `ceil(hp)` + `maxhp` (and XP on `xp` + `next`); the bar `width` may still use the ratio.
- **Timing (main.js `loop`):** fixed-timestep accumulator — frame-rate independent (same speed on 60/144/240 Hz). `acc += dt` (clamped 250 ms), runs `update()` while `acc>=STEP` up to `MAXSUBSTEP=5`, then `alpha=acc/STEP`, then one `draw()`. The sub-step `while` also breaks if `update()` flips `state` (gameOver/levelup). `slowmo` (ms) scales `dt` for boss-death slow-mo. Static scenes (pause/levelup) draw once at `alpha=1`. **F3** toggles the `#perfhud` debug overlay: line 1 perf (fps/avg/worst/tick-per-frame/bodies), line 2 boss FSM (`atk`=BURST/DASH/SLAM · dash/tele/cd sub-state · HP · `Music.bossMode`), line 3 the upgrade-mutated player stats — repaint throttled ~5×/s, one `textContent` write, dev-only (off by default, never shipped on).
- flow: `startGame/gameOver/togglePause/showPause`, leaderboard `loadScores/saveScore/renderLeaderboard`, `renderLegends`, button bindings.

## `player` object & what each upgrade changes (for stat displays)
`{ hp, maxhp, speed, rate, dmg, multi, pierce, bulletSpd, magnet, magnetSq, regen, lifesteal, missile, shield, chain, level, xp, next, rageT, px, py, ... }` (`px/py` = previous-tick position for render interpolation; same on enemies/bullets/missiles/ebullets/orbs/`cam`).

| Upgrade (id) | Effect on player |
|---|---|
| Sharper Rounds `dmg` | `dmg *= 1.35` |
| Rapid Fire `rate` | `rate *= 0.78` (frames between shots; min 6 → shots/s = 60/rate) |
| Split Shot `multi` | `multi += 1` (projectiles per volley) |
| Piercing `pierce` | `pierce += 1` |
| Hyper Velocity `velocity` | `bulletSpd *= 1.3`, `dmg *= 1.08` |
| Swift Boots `spd` | `speed *= 1.12` |
| Vitality `maxhp` | `maxhp += 30`, heal 30 |
| Magnet Core `magnet` | `magnet *= 1.6` (XP pickup radius) |
| Regeneration `regen` | `regen += 1` (HP/s) |
| Lifesteal `lifesteal` | `lifesteal += 1` (HP/kill, capped ~10/s) |
| Homing Missiles `missile` | `missile += 1` (Lv) |
| Orbiting Shield `shield` | `shield += 1` (Lv) |
| Chain Lightning `chain` | `chain += 1` (Lv) |

## Conventions / gotchas
- Per-enemy contact cooldown `e.cdmg` (density = danger) + small global `p.inv`.
- Collision loops use **live `enemies.length`** (killEnemy splices mid-scan).
- Drawing fns must NOT read `update()`/`loop()` locals — persist on `player`/globals (caused a blank-canvas bug).
- Hot loops avoid `atan2/cos/sin` — normalized vectors via one `sqrt`.
- Bosses: first at 60s, then 50s after each kill; HP bar drawn screen-space at top. Boss contact uses a shrunk hitbox (`e.r*BOSS.hitRMul`) and longer i-frames (`BOSS.invContact`/`BOSS.invProj`) than regular enemies.
- **Test Mode** (`_test` global, world.js): key **B** in play toggles it — spawns a boss immediately and makes bosses 1-HP so attack patterns/telegraph are easy to study (toggle off→on to respawn). A "TEST MODE" label shows bottom-left. Debug-only; never ship enabled.
- **Movement is per-tick (1/60 s), NOT per-second** — velocities/cooldowns/`regen` stay in per-tick units; the accumulator (not a `dt` multiply) gives frame-rate independence, so existing constants are unchanged. New movement code adds `+= v` per tick as before; do NOT multiply by `dt`.
- **Interpolation:** anything that visibly moves needs `px/py` snapshotted at the top of `update()` and drawn via the `ix(e)/iy(e)` lerp helpers in `draw()`. Bodies spawned mid-tick lack `px` for one frame — the helpers `?? `-guard that. World-space screen math in `draw()` uses the interpolated camera `icx/icy`, not `cam.x/y`.
