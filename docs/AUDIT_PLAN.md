# Implementation Plan — Game-Wide Audit (Next Phase)

## Phase 0 — Sync Check (gate, before ANY destructive edit)
1. `git fetch origin && git status` — confirm clean working tree, no unpushed/unpulled commits.
2. Diff local desktop folder vs remote: `git fetch origin && git diff --stat HEAD origin/<branch>`
   (and `git status --porcelain` for untracked). Resolve until **1:1 (zero drift)**.
3. Tag a rollback point: `git tag pre-audit-$(date +%Y%m%d)`.
4. **Do not proceed** to any rename/delete/move until 1–3 are green.

## Phase 1 — Truncation Risk (modularize files near the 28 KB limit)
Current sizes (bytes): core.js 21164 · audio-engine.js 19412 · world.js 17768 ·
main.js 14613 · render.js 11432 · sim.js 8091. None over 28 KB yet; **core.js and
audio-engine.js are the watch list.**
1. Set a soft cap (e.g. 24 KB) as the split trigger; add a size check to verify.cjs.
2. **core.js** → split sprite cache + EMETA into `js/sprites.js` (load before world); keep
   DIFFS/BOSS/Sound/SynthMusic in core. Preserve **load order** (declarations before main).
3. **audio-engine.js** → if it grows, peel SampleKit into `js/audio-samplekit.js`, leaving the
   `Music` facade + RealMusic in audio-engine.
4. Each split is a behavior-preserving refactor → must pass `verify-equiv.cjs` (identical hash).
5. Update `index.html` `<script>` order + the CLAUDE.md file map in the same commit.

## Phase 2 — Audit Sweep
1. Lint/structure pass per file; flag dead code, duplicated math, magic numbers.
2. Confirm hot loops avoid atan2/cos/sin; vectors via one sqrt.
3. Confirm all moving bodies interpolate (px/py + ix/iy).

## Phase 3 — Verify & Ship
1. Run all `verify*.cjs` (exit 0).
2. `vercel` preview build — confirm no errors.
3. Commit per conventional format; open a **draft PR**.
4. `vercel --prod` only after review + green CI.
