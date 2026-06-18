---
name: neon-survivor
description: Efficient workflow for editing the single-file NEON SURVIVOR game (index.html). Use when modifying, debugging, verifying, or extending the game so you don't re-discover structure or re-author test harnesses (saves tokens).
---

# NEON SURVIVOR dev skill

NEON SURVIVOR is a vanilla-JS HTML5 canvas game (no deps, runs offline), split across `index.html`,
`css/style.css`, and five classic scripts loaded in order: `js/core.js → world.js → sim.js → render.js → main.js`.
The canonical map of its internals lives in **`CLAUDE.md`** (project root) — read that first instead of grepping/reading whole files.

## Golden rules (token efficiency)
1. **Don't re-read whole files.** Use `CLAUDE.md`'s system map + `Grep` for the section header (e.g. `/* ========== COMBAT ========== */`) to jump to the ~20 lines you need, in the right `js/*.js`.
2. **Edit by unique anchor strings.** Code is dense one-liners; match an exact existing snippet and keep the same terse style.
3. **Always verify after editing — don't write a new harness.** Run:
   ```
   node .claude/skills/neon-survivor/verify.cjs
   ```
   It syntax-checks, headless-loads (catches out-of-scope/ReferenceErrors), then starts a game, forces a boss, runs ~220 frames, and kills the boss. Prints `PASS — ...` or a `RUNTIME ERROR` with stack. Exit code 0 = good.
   For behavior-preserving refactors also run `verify-equiv.cjs` (900-frame golden hash vs `baseline-original.js`; re-anchor the baseline only for *intentional* logic changes).
4. After a durable change, update `CLAUDE.md` (map / upgrade table) so the next session stays cheap.

## Common pitfalls (seen in this codebase)
- **Out-of-scope vars in `draw()`/`render()`** — drawing functions can't see locals declared in `update()`/`loop()`. Persist such values on `player` or a global. (This caused a blank-canvas bug once.)
- **Splice during forward iteration** — collision loops call `damageEnemy()` which may `splice` an enemy mid-scan. Use live `enemies.length` in the loop bound, never a cached length.
- **Function hoisting masks duplicates** — duplicate `function foo(){}` definitions don't error; the last wins. `verify.cjs` + a quick dup-scan catch accidental double-paste.
- **Background must not tile** — draw the nebula image once stretched to `W,H` (tiling shows seams).
- **Fixed timestep, not dt-scaling** — the sim runs in discrete 1/60 s ticks (accumulator in `main.js loop`). Movement code stays in per-tick units (`x += v`); never multiply by a frame delta. New moving bodies need `px/py` (snapshotted atop `update()`) and the `ix/iy` lerp in `draw()` or they'll stutter on high-refresh monitors.
- **`update()` may flip `state`** (gameOver/levelup) — the sub-step loop guards on `state==='play'` so it stops simulating immediately; keep that guard if you touch the loop.
