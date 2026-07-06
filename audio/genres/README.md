# audio/genres — unlockable genre soundtracks

These are the **achievement-reward** soundtracks. Equipping one in the Showcase → **Soundtrack** tab
performs a **Total Genre Conversion** — menu, wave and boss themes all re-point to that genre. Each file
is **copyright-free (Public Domain / CC0)** — never a copyrighted recording. Missing files fall back to a
built-in **per-genre procedural bed** (distinct tempo + harmony + drive per genre), so an unlocked genre
always sounds different even before a real recording is supplied.

## Layout
One folder per genre — `audio/genres/<genre>/` — with these slots (all optional, resolved by
`AUDIO_MANIFEST` in `js/audio-manifest.js`, THE asset registry):

| File | Role |
| :--- | :--- |
| `wave.mp3` | standard gameplay loop |
| `menu.mp3` | chill menu / pause version |
| `boss-revenant.mp3` · `boss-maelstrom.mp3` · `boss-overseer.mp3` | the 3 boss-archetype themes (bosses cycle `(tier-1)%3`) |

`audio/` is browser-cached 30 days (`vercel.json`) — when a track's **content** changes, **rename** the
file and update its path in `js/audio-manifest.js` (a new URL forces a fresh fetch).

## Supplied tracks
All wave loops are **HoliznaCC0** recordings, released **CC0 1.0 Universal** (public-domain dedication, no
attribution required) — sourced from the Free Music Archive (https://freemusicarchive.org/music/holiznacc0/).

| File | Genre | Recording (CC0) | Unlocked by |
| :--- | :--- | :--- | :--- |
| `acoustic/wave.mp3` | Acoustic | *Busted Guitar (Jazz)* — "1 (jazz)" | `bare_bones` / `wave_rider` |
| `pop/wave.mp3`      | Pop      | *Gamer Beats!* — "Legends"          | `veteran` — finish 10 runs |
| `metal/wave.mp3`    | Metal    | *Rock Montage* — "Punk"             | `ascendant_rush` — level 20 in 5 min |
| `rap/wave.mp3`      | Rap      | *Only In The Milky Way* — "Gangsters In Space" (lo-fi hip-hop) | `massacre_clock` — 250 kills in 3 min |

`classical/` has no files yet — it plays entirely on its procedural nocturne/storm beds (`ascetic` unlock).

## Supplying real recordings (must be PD/CC0)
Drop a **CC0/PD** instrumental at the target path (`.mp3`, or `.ogg` if you also edit the path in
`js/audio-manifest.js`) from a CC0 library such as Pixabay Music, the Free Music Archive CC0 set, or
ccMixter. `./fetch-music.sh` tries Wikimedia Commons for PD/CC0 audio, but PD/CC0 pop/metal/rap is sparse
there, so those usually need a manual drop.

## Verify
- `node .claude/skills/neon-survivor/verify.cjs` — procedural path (incl. genre beds) + boss sim
- `node .claude/skills/neon-survivor/verify-jukebox.cjs` — real-track selection + crossfade + low-HP filter + fallback
- `node .claude/skills/neon-survivor/verify-achievements.cjs` — client ↔ server reward lockstep
