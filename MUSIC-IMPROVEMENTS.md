# NEON SURVIVOR — Music System: Test Report & Improvements

_Audit of the dynamic music engine, the bugs found, and the changes shipped on
`claude/music-features-testing-oa66jb`._

## TL;DR

- **Root cause of "the rap isn't rap":** the procedural composer rendered **every** genre
  through the same five orchestral voices (strings / winds / brass / timpani / choir) — only
  BPM and chords changed. Since there are **no real audio files** in `audio/genres/**` yet,
  that one orchestral synth is 100% of what you actually hear. So "rap" was a slow chord loop
  on sawtooth strings + a choir pad. That is now fixed with a real genre **beat engine**.
- **Rap → real Trap.** Half-time syncopated kick, gliding 808 sub-bass, hi-hat rolls, dark
  minor stabs.
- **Added EDM** (aggressive dubstep / complextro: four-on-the-floor kick, growling wobble bass,
  offbeat open hats, supersaw stabs) and **Trance** (psy/hard driving: 4-on-floor kick, rolling
  offbeat bass, climbing 16th supersaw arps, euphoric pad).
- **2 bugs fixed** in the Soundtrack preview path.
- All 9 `verify*.cjs` suites pass; the `verify-equiv` golden run is still **byte-identical**.

---

## 1. What was tested

| Area | How | Result |
|---|---|---|
| Headless load of all audio scripts | `verify.cjs` | ✅ loads, boss sim runs |
| 28 KB silent-truncation guard | `verify-size.cjs` | ✅ all under cap |
| Reward/achievement client↔server lockstep | `verify-achievements.cjs` | ✅ 40 defs · 40 rewards |
| Sim determinism (audio must not perturb it) | `verify-equiv.cjs` | ✅ 900 frames byte-identical |
| Auth / OTP / censor / full-cycle / grid | `verify-otp/censor/fullcycle/grid.cjs` | ✅ pass |
| Hebrew UI (menu + level-up, RTL) | `verify-ui-he.cjs` | ✅ pass |
| **Genre beat engine (new)** | custom Web-Audio-mock harness | ✅ rap/EDM/trance schedule real drums + synth; orchestral untouched |

The beat-engine harness drives the composer through each styled bed for two bars and counts the
node kinds actually scheduled:

```
[trap  wave]  noise(hats/snare)=26  osc(kick/808/stab)=16
[edm   wave]  noise=10              osc(kick/wobble/saw)=64
[trance wave] noise=8               osc(kick/roll/arp)=118
[orchestral]  noise=0  ← proves the drum kit is correctly gated to styled beds only
```

---

## 2. Bugs / glitches found & fixed

### BUG-1 — Preview of a missing track muted the menu music to silence for 9 s _(fixed)_
`previewTrack()` ducks the live menu bed (`_duckBed(true)`) so the preview clip plays alone,
then restores after a 9 s timer. But every genre track file is currently absent, so the preview
`<audio>` 404s and never plays — leaving the menu **ducked to silence for the full 9 seconds**
with nothing in its place. Every genre "▶ Preview" hit this today.
**Fix:** attach an `error` listener that calls `stopPreview()` immediately, so an absent/404 clip
restores the bed at once instead of dead air. (`js/audio-orchestrator.js`, `previewTrack`.)

### BUG-2 — Previewing from the PAUSE menu restored the bed too loud _(fixed)_
`_duckBed(false)` always restored the master gain to `0.9` (the menu level). If you opened the
Soundtrack tab **while paused** (the pause overlay has a Music-Sync readout, so it's reachable)
and previewed a track, ending the preview snapped the paused mix from its muffled `0.4` up to a
full `0.9` — louder than a paused game should be.
**Fix:** `_duckBed(false)` now restores to `0.4` when `state === 'PAUSED'`, else `0.9`.
(`js/audio-orchestrator.js`, `_duckBed`.)

### Verified-NOT-bugs (checked, working as intended)
- Genre boss keys (`rapboss0`…) don't collide with orchestral `boss0`. ✅
- `reset()`'s `indexOf('boss')` genre-boss detection is correct. ✅
- Boss sting still fires for procedural beds via the composer's 8-step boundary. ✅
- Danger low-pass, pause muffle, and equal-power crossfades untouched. ✅

---

## 3. The genre BEAT ENGINE (the "make rap be rap" fix)

A bed in `AUDIO_MANIFEST` can now carry a **`style`** tag (`'trap' | 'edm' | 'trance'`). When the
composer picks a styled bed, it renders through `Orchestra._beat()` — a real rhythm/timbre engine —
instead of the orchestral voices. Untagged beds (orchestral / classical / pop / metal / acoustic)
are completely unchanged.

**New synth voices** (`js/genre-orchestrator.js`, attached onto `Orchestra` to keep
`audio-orchestrator.js` under the 28 KB cap):
- `_drum(layer,t,kind,vol)` — a synth **drum kit**: `kick` (pitch-dropped sine), `snare`
  (band-passed noise), `hat`/`ohat` (high-passed noise).
- `_saw(...)` — a 3-oscillator detuned **supersaw** for EDM/trance stabs and arps.
- `_noiseBuf()` — a cached noise buffer for the percussion (uses `Math.random`, which is **audio
  texture only** — the composer never runs headless, so `verify-equiv` stays byte-identical).

**Per-genre patterns** (8th-note grid, `idx 0..7` = one bar; `boss=true` busies it):
- **Trap (rap):** kick on `0,3,6`; clap on beat 3 (`idx 4`); 8th hats + 16th doubles + a roll into
  the downbeat; gliding 808 sub on `0,6`; dark minor stab on the downbeat.
- **EDM:** four-on-the-floor kick (`0,2,4,6`); backbeat clap; offbeat open hats; a retriggered
  octave-bouncing saw bass that reads as a wobble; complextro supersaw stabs on offbeats.
- **Trance:** driving 4-on-floor kick; rolling offbeat psy-bass; a climbing 16th supersaw arp
  (2 notes/step); a euphoric sustained pad on the downbeat.

`_tick()` is now style-aware: for a beat-driven bed the five section layers are held **open**
(the orchestral vertical-remix curve doesn't fit a drum kit — the composer owns the density
instead) and the low-pass floor rides **brighter** so electronic genres read crisp.

---

## 4. EDM & Trance genres added

Wired end-to-end, in lockstep across every table the verifier cross-checks:

| Genre | Unlock achievement | Music reward | JUKE src | Warden title |
|---|---|---|---|---|
| **EDM** | `bass_cannon` — _Bass Cannon_, reach **level 15** in a run | `festival_edm` (Festival Drop) | `edm` | BASS DROP |
| **Trance** | `hypnotic` — _Hypnotic_, reach **wave 15** in a run | `hypno_trance` (Hypno Pulse) | `trance` | HYPNOSIS |

Touched: `js/audio-manifest.js` (genre defs + styled beds), `js/reward-map.js` +
`api/verify.js` REWARD_MAP (music rewards), `js/achievements.js` + `api/verify.js` CATALOG
(the two new achievements, identical `{id,conds,difficulty}` projection), `js/lang-he.js`
(Hebrew for the new labels / titles / descriptions / Warden titles). `GENRE_MAP` builds itself
from the manifest, so the Genre Orchestrator, Music-Sync readout, and Soundtrack gallery pick up
EDM/Trance automatically.

---

## 5. Known limitations / suggested next steps

1. **Real audio files are still absent.** Everything above is the **procedural** layer (offline,
   no assets). Dropping CC0/PD `.mp3`s into `audio/genres/{rap,edm,trance}/…` will override the
   beds automatically via `_playReal`. Until then, "▶ Preview" has nothing to play for genre
   tracks (it just no-ops now instead of muting the menu — see BUG-1).
2. **Pop / Metal / Classical / Acoustic still use the orchestral voices.** They were out of scope
   here, but they have the same underlying issue and would benefit from their own `style` beds
   (e.g. `'rock'`, `'house'`, `'lofi'`) using the same engine.
3. The wobble bass and 16th arp are **approximations** of real synthesis (no per-note LFO/filter
   automation on the shared graph). They read correctly as EDM/trance but a real supersaw+LFO
   patch would sound richer if the graph is extended later.
