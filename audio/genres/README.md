# audio/genres — unlockable genre soundtracks

These are the **achievement-reward** soundtracks. Equipping one in the Showcase → **Soundtrack** tab
re-points the in-game gameplay theme to that genre. Each file is **copyright-free (Public Domain / CC0)**
— never a copyrighted recording. Missing files fall back to a built-in **per-genre procedural bed**
(distinct tempo + harmony + drive per genre), so an unlocked genre always sounds different even before a
real recording is supplied.

## Tracks
| File | Genre | Unlocked by | Status |
| :--- | :--- | :--- | :--- |
| `jazz.ogg` | Jazz (Midnight Jazz) | `wave_rider` — reach wave 10 | ⏳ procedural swing bed until supplied |
| `pop.ogg`  | Pop (Neon Pop)       | `veteran` — finish 10 runs   | ⏳ procedural pop bed until supplied |
| `rock.ogg` | Rock (Overdrive)     | `ascendant_rush` — level 20 in 5 min | ⏳ procedural rock bed until supplied |
| `rap.ogg`  | Rap (Breakbeat)      | `massacre_clock` — 250 kills in 3 min | ⏳ procedural rap bed until supplied |

The file each genre looks for is set in the `JUKE` manifest at the top of `js/audio-orchestrator.js`.

## Supplying real recordings (must be PD/CC0)
- `./fetch-music.sh` tries Wikimedia Commons for PD/CC0 audio (the jazz pick — *Livery Stable Blues*,
  1917 — is public domain). PD/CC0 pop/rock/rap is sparse on Commons, so those usually need a manual drop.
- Drop your own **CC0** instrumental at the target path (e.g. `audio/genres/rock.ogg`) from a CC0 library
  such as Pixabay Music, the Free Music Archive CC0 set, or ccMixter. `.ogg` or `.mp3` both work — if you
  use `.mp3`, edit that genre's path in the `JUKE` manifest.

## Verify
- `node .claude/skills/neon-survivor/verify.cjs` — procedural path (incl. genre beds) + boss sim
- `node .claude/skills/neon-survivor/verify-jukebox.cjs` — real-track selection + fallback
- `node .claude/skills/neon-survivor/verify-achievements.cjs` — client ↔ server reward lockstep
