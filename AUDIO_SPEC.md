# NEON SURVIVOR — Real Instrument Audio Sourcing Spec

This is the brief for sourcing/commissioning the real instrument **stems** that replace the
synth music engine. Hand it to a composer, or use it as a checklist when buying a stem pack.

> **Why stems?** The game mixes music *vertically* — every layer of one track plays at the
> same time, phase-locked, and the game fades layers in/out by intensity. So each track must be
> delivered as separate, perfectly aligned instrument files (not one mixed-down master).

---

## 1. Two tracks, 5 stems each (10 files total)

### Track A — "HYPE ROCK" (normal gameplay)
- **Tempo:** 125 BPM, 4/4
- **Loop length:** 8 bars = **15.36 s** exactly
- **Vibe:** driving hype rock / synthwave-rock crossover, energetic but sits *under* gameplay SFX.

### Track B — "BOSS" (heavy metal / trance, boss fights)
- **Tempo:** 150 BPM, 4/4
- **Loop length:** 8 bars = **12.8 s** exactly
- **Vibe:** heavy metal + trance drive — double-kick, distorted palm-muted guitar, four-on-the-floor energy.

| Stem (file role) | Track A — Hype Rock | Track B — Boss | Always on? |
|---|---|---|---|
| `drums` | rock drum core (kick/snare/hats) | metal/trance double-kick core | ✅ always |
| `rhythm` | rhythm guitar / power chords | palm-muted distorted rhythm guitar | ✅ always |
| `bass`   | bass guitar | drop-tuned bass | scales w/ intensity |
| `lead`   | melodic lead guitar | shred / solo lead | fades in mid→high intensity |
| `fx`     | riser / ambient swell | air-raid riser / tension pad | danger / peak only |

**Filenames & layout** (exact paths the engine will look for):
```
audio/
  normal/  drums.ogg  rhythm.ogg  bass.ogg  lead.ogg  fx.ogg
  boss/    drums.ogg  rhythm.ogg  bass.ogg  lead.ogg  fx.ogg
```

---

## 2. Gapless-loop authoring rules (critical)

The loop must wrap with **zero click and zero gap**. Deliverables must satisfy ALL of:

1. **Exact length.** Each stem is exactly the bar count above — trim to the sample. No count-in, no
   lead-in silence, downbeat on sample 0.
2. **All 5 stems of a track are identical length** and start on the same downbeat — they are phase-locked.
3. **Wrap the tail.** Any reverb/cymbal/decay tail that runs past the last bar must be **wrapped back
   onto the head** (bounce the tail and mix it into the start) so the loop point is seamless.
4. **No DC offset; zero-crossing-safe ends.** Fade the absolute first/last few samples only if needed
   to kill a click — never a musical fade.
5. **Format:** OGG Vorbis, quality ~5 (≈160 kbps), **stereo**, 48 kHz.

---

## 3. Mix / levels (so layers sum without clipping)

Up to 5 stems play simultaneously, so each must leave headroom:

- **Per-stem peak ≤ −6 dBFS**, consistent loudness across stems of a track.
- Mix each stem **as if the others are playing** — don't master any single stem to be "full".
- `drums` + `rhythm` are the always-on bed; `bass` rides intensity; `lead` enters when the swarm
  thickens; `fx` only on danger/peak. Author them so the bed alone sounds complete and the upper
  layers add hype, not mud.
- Leave the low end mostly to `bass`/`drums`; keep `lead`/`fx` brighter so they cut without masking.

---

## 4. Optional: boss "drop" intro one-shot

Optional but high-impact for the boss entrance:
- `audio/boss/intro.ogg` — a **non-looping** 1–2 bar riser/impact that plays once, then the engine
  starts the 8-bar boss loop on its downbeat. (Replaces the current synth riser sting.)
- Same tempo/format; ends exactly on the bar so the loop catches it cleanly.

---

## 5. Total size budget

~10 stems × ~13–15 s × ~160 kbps stereo ≈ **2.5–3 MB total**, decoded once at load. Loaded
asynchronously with a synth fallback, so it never blocks or hangs gameplay.
