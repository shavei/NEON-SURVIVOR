# audio/orchestral — real orchestral recordings

The audio engine (`js/audio-orchestrator.js`) plays a real public-domain orchestral recording per game
state, and falls back to a built-in **procedural** orchestral bed for any file that's missing — so the
game always has music, even before these files exist.

## Expected files (drop-in)
| File | State | Piece (public-domain composition) | Mood |
| :--- | :--- | :--- | :--- |
| `menu.ogg` | menu | Debussy — *Clair de Lune* | calm |
| `gameplay.ogg` | playing | Mozart — *Symphony No. 40* in G minor, i | urgent |
| `boss-revenant.ogg` | boss (archetype 0) | Mozart — *Requiem*: "Dies Irae" | furious |
| `boss-maelstrom.ogg` | boss (archetype 1) | Bach — *Toccata & Fugue in D minor* | swirling |
| `boss-overseer.ogg` | boss (archetype 2) | Mussorgsky — *Night on Bald Mountain* | dark |
| `gameover.ogg` | game over | Chopin — *Marche funèbre* | somber |

## How to get them
Run **`./fetch-music.sh`** from the repo root (needs `curl`, `jq`, `ffmpeg`). It searches Wikimedia
Commons, accepts only **Public Domain / CC0** recordings, and transcodes them to normalized web OGG here.
Then commit the `.ogg` files.

## Licensing note
A Mozart/Bach *composition* is public domain, but every *recording* carries its own copyright from the
performers. Only PD/CC0 recordings are safe to ship — `fetch-music.sh` enforces that. To swap a track,
drop your own PD/CC0 file at the matching path above (any format ffmpeg can read → re-export as `.ogg`).

The level-up and Tier-3 synergy **stings** are synthesized in-engine (no files needed).
