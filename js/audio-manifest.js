/* NEON SURVIVOR — audio-manifest.js : pure-DATA audio asset registry (no logic, no DOM/audio touches).
 * Classic global, loads after config-sim.js and BEFORE audio-orchestrator.js / genre-orchestrator.js,
 * which build their jukebox (JUKE), procedural-bed (TRACKS) and genre (GENRE_MAP) tables from it. THE
 * single source of truth for every music asset path + the crossfade / low-HP-filter voicings.
 *   • genres — 6 total-conversion soundtracks. `orchestral` is the free default; every other genre stays
 *     LOCKED until a music reward carrying its genre is owned — granted authoritatively by api/verify.js
 *     (service role) into user_inventory, hydrated by RewardEngine.pullInventory. `unlock` names the
 *     primary granting achievement (acoustic has TWO: wave_rider + bare_bones).
 *   • per genre: wave = gameplay loop · menu = chill menu/pause version · boss = the 3 archetype themes
 *     (REVENANT / MAELSTROM / OVERSEER — bosses cycle (tier-1)%3, see config-sim.js). Every path is
 *     OPTIONAL: a missing file falls back to that genre's procedural bed/bossbed (TRACKS schema: bpm ·
 *     chord prog · bass roots (MIDI) · drive · ostinato), so the game is never silent and each genre is
 *     audibly distinct offline TODAY. Files must be PD/CC0 only — fetch-music.sh / manual drop.
 *   • audio/ is browser-cached 30 days (vercel.json): when a track's CONTENT changes, RENAME it here.
 *   • xfade — equal-power GainNode crossfade seconds per transition kind (Orchestra._playReal).
 *   • lowHealth — the DANGER muffle: hp under hpFrac of max sweeps the shared low-pass BiquadFilter to
 *     freq Hz / q resonance over ramp s — a real-time effect on the LIVE mix, never a track swap. */
const AUDIO_MANIFEST = {
  ver: 1,
  xfade: { boss: 1.2, wave: 2.4, menu: 2.4, over: 0.8 },
  lowHealth: { freq: 700, q: 1.6, ramp: 0.35, hpFrac: 0.30 },
  genres: {
    orchestral: { unlock: null, label: 'Orchestral', ico: '🎼', wardenTitle: 'WARDEN PROTOCOL',
      menu: 'audio/orchestral/menu.ogg',                          // Debussy — Clair de Lune (not yet supplied → procedural)
      wave: 'audio/orchestral/gameplay.mp3',                      // Mozart — Symphony No.40 i (urgent)
      over: 'audio/orchestral/gameover.ogg',                      // Chopin — Marche funèbre (somber)
      boss: { revenant:  'audio/orchestral/boss-revenant.mp3',    // Mozart — Requiem: Dies Irae
              maelstrom: 'audio/orchestral/boss-maelstrom.mp3',   // Bach — Toccata & Fugue in D minor
              overseer:  'audio/orchestral/boss-overseer.ogg' } },// Mussorgsky — Night on Bald Mountain
    classical: { unlock: 'ascetic', label: 'Classical', ico: '🎹', wardenTitle: 'GRAND RECITAL',
      menu: 'audio/genres/classical/menu.mp3', wave: 'audio/genres/classical/wave.mp3',
      boss: { revenant: 'audio/genres/classical/boss-revenant.mp3', maelstrom: 'audio/genres/classical/boss-maelstrom.mp3', overseer: 'audio/genres/classical/boss-overseer.mp3' },
      bed:     { bpm: 76,  prog: [[57,60,64],[55,59,62],[53,57,60],[50,53,57]], bass: [33,31,29,26], drive: false, ostinato: false },   // serene nocturne triads
      menubed: { bpm: 66,  prog: [[57,60,64],[52,55,59],[53,57,60],[55,59,62]], bass: [33,28,29,31], drive: false, ostinato: false },   // hushed lobby nocturne
      bossbed: { bpm: 138, prog: [[52,55,59],[50,54,57],[51,54,58],[48,52,55]], bass: [28,26,27,24], drive: true,  ostinato: true  } }, // storm-movement minor drive
    pop: { unlock: 'veteran', label: 'Pop', ico: '🎤', wardenTitle: 'HEADLINER',
      menu: 'audio/genres/pop/menu.mp3',
      wave: 'audio/genres/pop/wave.mp3',                          // HoliznaCC0 — Legends / Gamer Beats! [CC0]
      boss: { revenant: 'audio/genres/pop/boss-revenant.mp3', maelstrom: 'audio/genres/pop/boss-maelstrom.mp3', overseer: 'audio/genres/pop/boss-overseer.mp3' },
      bed:     { bpm: 118, prog: [[60,64,67],[55,59,62],[57,60,64],[53,57,60]], bass: [36,31,33,29], drive: true,  ostinato: false },   // bright I–V–vi–IV
      menubed: { bpm: 100, prog: [[60,64,67],[57,60,64],[53,57,60],[55,59,62]], bass: [36,33,29,31], drive: false, ostinato: false },   // mellow lounge-pop shimmer
      bossbed: { bpm: 150, prog: [[57,60,64],[53,57,60],[55,59,62],[52,55,59]], bass: [33,29,31,28], drive: true,  ostinato: true  } }, // minor-key anthem drop, full-tilt
    metal: { unlock: 'ascendant_rush', label: 'Metal', ico: '🎸', wardenTitle: 'MAIN STAGE',
      menu: 'audio/genres/metal/menu.mp3',
      wave: 'audio/genres/metal/wave.mp3',                        // HoliznaCC0 — Punk / Rock Montage [CC0]
      boss: { revenant: 'audio/genres/metal/boss-revenant.mp3', maelstrom: 'audio/genres/metal/boss-maelstrom.mp3', overseer: 'audio/genres/metal/boss-overseer.mp3' },
      bed:     { bpm: 140, prog: [[57,64,69],[53,60,65],[55,62,67],[52,59,64]], bass: [33,29,31,28], drive: true,  ostinato: true  },   // driving power chords
      menubed: { bpm: 92,  prog: [[57,64,69],[52,59,64],[55,62,67],[53,60,65]], bass: [33,28,31,29], drive: false, ostinato: true  },   // brooding clean-tone hold
      bossbed: { bpm: 184, prog: [[52,59,64],[50,57,62],[51,58,63],[48,55,60]], bass: [28,26,27,24], drive: true,  ostinato: true  } }, // thrash power-chord descent, blast tempo
    acoustic: { unlock: 'bare_bones', label: 'Acoustic', ico: '🪕', wardenTitle: 'MIDNIGHT SET',
      menu: 'audio/genres/acoustic/menu.mp3',
      wave: 'audio/genres/acoustic/wave.mp3',                     // HoliznaCC0 — Busted Guitar (acoustic jazz) [CC0]
      boss: { revenant: 'audio/genres/acoustic/boss-revenant.mp3', maelstrom: 'audio/genres/acoustic/boss-maelstrom.mp3', overseer: 'audio/genres/acoustic/boss-overseer.mp3' },
      bed:     { bpm: 96,  prog: [[60,64,67,71],[57,61,64,67],[62,65,69,72],[55,59,62,65]], bass: [36,33,38,31], drive: false, ostinato: false },  // mellow 7th-chord swing
      menubed: { bpm: 80,  prog: [[60,64,67,71],[55,59,62,65],[57,61,64,67],[53,57,60,64]], bass: [36,31,33,29], drive: false, ostinato: false },  // soft fingerpicked 7ths at rest
      bossbed: { bpm: 160, prog: [[55,58,62,65],[53,56,60,63],[51,55,58,62],[50,53,57,60]], bass: [31,29,27,26], drive: true,  ostinato: true  } },// frantic minor-7th chase, walking-bass sprint
    rap: { unlock: 'massacre_clock', label: 'Rap', ico: '🎧', wardenTitle: 'FINAL VERSE',
      menu: 'audio/genres/rap/menu.mp3',
      wave: 'audio/genres/rap/wave.mp3',                          // HoliznaCC0 — Gangsters In Space [CC0]
      boss: { revenant: 'audio/genres/rap/boss-revenant.mp3', maelstrom: 'audio/genres/rap/boss-maelstrom.mp3', overseer: 'audio/genres/rap/boss-overseer.mp3' },
      // style:'trap' → the composer renders REAL trap: half-time syncopated kick, gliding 808 sub, hi-hat rolls, dark stabs (not orchestral voices)
      bed:     { bpm: 140, prog: [[57,60,64],[56,59,62],[53,57,60],[55,58,62]], bass: [33,32,29,31], drive: false, ostinato: true, style: 'trap' },    // trap: syncopated kick, 808 sub, hat rolls
      menubed: { bpm: 120, prog: [[57,60,64],[53,56,60],[55,58,62],[52,55,59]], bass: [33,29,31,28], drive: false, ostinato: true, style: 'trap' },    // half-time chill trap head-nod
      bossbed: { bpm: 150, prog: [[53,56,60],[51,55,58],[50,53,57],[48,51,55]], bass: [29,27,26,24], drive: false, ostinato: true, style: 'trap' } },  // menacing dark trap, busier kicks
    edm: { unlock: 'bass_cannon', label: 'EDM', ico: '🔊', wardenTitle: 'BASS DROP',
      menu: 'audio/genres/edm/menu.mp3', wave: 'audio/genres/edm/wave.mp3',
      boss: { revenant: 'audio/genres/edm/boss-revenant.mp3', maelstrom: 'audio/genres/edm/boss-maelstrom.mp3', overseer: 'audio/genres/edm/boss-overseer.mp3' },
      // style:'edm' → four-on-the-floor kick, growling retrig'd wobble bass, offbeat open hats, complextro supersaw stabs
      bed:     { bpm: 140, prog: [[57,60,64],[53,57,60],[55,58,62],[52,55,59]], bass: [33,29,31,28], drive: true,  ostinato: true, style: 'edm' },    // aggressive dubstep/complextro floor
      menubed: { bpm: 128, prog: [[57,60,64],[55,58,62],[53,57,60],[52,55,59]], bass: [33,31,29,28], drive: true,  ostinato: false, style: 'edm' },   // big-room pulse at rest
      bossbed: { bpm: 150, prog: [[52,55,59],[50,53,57],[51,54,58],[48,51,55]], bass: [28,26,27,24], drive: true,  ostinato: true, style: 'edm' } },  // festival drop, full-tilt
    trance: { unlock: 'hypnotic', label: 'Trance', ico: '🌀', wardenTitle: 'HYPNOSIS',
      menu: 'audio/genres/trance/menu.mp3', wave: 'audio/genres/trance/wave.mp3',
      boss: { revenant: 'audio/genres/trance/boss-revenant.mp3', maelstrom: 'audio/genres/trance/boss-maelstrom.mp3', overseer: 'audio/genres/trance/boss-overseer.mp3' },
      // style:'trance' → driving 4-on-floor kick, rolling offbeat bass (psy), climbing 16th supersaw arp, euphoric pad
      bed:     { bpm: 138, prog: [[57,60,64],[55,59,62],[53,57,60],[50,53,57]], bass: [33,31,29,26], drive: true,  ostinato: true, style: 'trance' },   // rolling psy/hard driving
      menubed: { bpm: 132, prog: [[57,60,64],[52,55,59],[53,57,60],[55,59,62]], bass: [33,28,29,31], drive: false, ostinato: true, style: 'trance' },   // dreamy breakdown arps
      bossbed: { bpm: 145, prog: [[52,55,59],[50,54,57],[51,54,58],[48,52,55]], bass: [28,26,27,24], drive: true,  ostinato: true, style: 'trance' } }, // hard/psy driving, darker
  },
};
