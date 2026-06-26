# legacy-audio — synth/sample engine backup

Frozen snapshot of the pre-orchestral audio system, kept as a restore point for the
"Replace synth entirely" overhaul. Nothing in this folder is loaded by the game
(`index.html` does not reference it). It exists only so the old engine can be put back.

## What's here
- `audio-engine.js` — verbatim copy of `js/audio-engine.js`: `SampleKit` → `RealMusic`
  (stem loops) + the public `Music` facade.
- `synth-music.snippet.js` — verbatim copy of `js/core.js` **lines 116–420**: the
  `SynthMusic` procedural engine (header comment + the whole object, ending at its `};`).

Snapshot taken on branch `claude/neon-survivor-orchestral-audit-uxiabn` before any
synth code was removed from the live files.

## How to move it back (full revert)
1. Restore the engine file:
   `cp legacy-audio/audio-engine.js js/audio-engine.js`
2. Restore `SynthMusic`: paste the contents of `synth-music.snippet.js` back into
   `js/core.js` at the spot the orchestral commit removed it (right after the `Fx` object,
   before the section that followed `SynthMusic`'s closing `};`).
3. Re-add the script tag in `index.html`:
   `<script defer src="js/audio-engine.js"></script>` in load position
   **core → audio-engine → world** (i.e. immediately after `core.js`, before `world.js`).
4. Remove the orchestral wiring: `js/audio-orchestrator.js` + its `<script>` tag, and revert
   the hook edits in `sim.js`, `synergy.js`, `main.js`.
5. Verify: `node .claude/skills/neon-survivor/verify.cjs` must exit 0.

Easiest alternative: `git revert` / `git checkout` the orchestral commit — these files are
the human-readable backup for partial restores when a clean git revert isn't wanted.
