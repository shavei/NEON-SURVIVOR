# audio/orchestral — real orchestral recordings

The audio engine (`js/audio-orchestrator.js`) plays a real public-domain orchestral recording per game
state, and falls back to a built-in **procedural** orchestral bed for any file that's missing or that the
browser can't decode — so the game always has music.

## Current files
| File | State | Piece (public-domain composition) | Format | Status |
| :--- | :--- | :--- | :--- | :--- |
| `gameplay.mp3` | playing | Mozart — *Symphony No. 40* in G minor, i | MP3 | ✅ |
| `boss-revenant.mp3` | boss · REVENANT | Mozart — *Requiem*: "Dies Irae" | MP3 | ✅ |
| `boss-maelstrom.mp3` | boss · MAELSTROM | Bach — *Toccata & Fugue in D minor* | MP3 | ✅ |
| `boss-overseer.ogg` | boss · OVERSEER | Mussorgsky — *Night on Bald Mountain* | Ogg Vorbis | ✅ |
| `gameover.ogg` | game over | Chopin — *Marche funèbre* | Ogg Vorbis | ✅ |
| `menu.ogg` | menu | Debussy — *Clair de Lune* | — | ⏳ not yet added → procedural |

Recordings are public-domain performances (Musopen / Wikimedia Commons). The file the engine looks for
is set in the `JUKE` manifest at the top of `js/audio-orchestrator.js`.

## Notes
- **Safari & Ogg Vorbis:** Safari can't decode `.ogg`, so on Safari `boss-overseer` and `gameover` fall
  back to the procedural bed. MP3 plays everywhere. To make them universal, re-export those two as MP3
  (any tool, or `fetch-music.sh`'s ffmpeg step) and update the two `JUKE` paths to `.mp3`.
- **Add the menu theme:** drop a PD/CC0 `menu.ogg` (or `menu.mp3` + edit the manifest) here.
- The level-up and Tier-3 synergy **stings** are synthesized in-engine (no files needed).

## Verify
- `node .claude/skills/neon-survivor/verify.cjs` — procedural path + boss sim
- `node .claude/skills/neon-survivor/verify-jukebox.cjs` — real-track selection per state + fallback
