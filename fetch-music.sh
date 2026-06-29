#!/usr/bin/env bash
# fetch-music.sh — download copyright-free orchestral recordings for NEON SURVIVOR's audio engine.
#
# WHY a script: the Claude-on-the-web sandbox can't reach the open web (network policy blocks
# Wikimedia/Musopen). Run this on YOUR machine, then commit the resulting audio/orchestral/*.ogg.
#
# WHAT it does: for each game state it searches Wikimedia Commons for an audio file of a PUBLIC-DOMAIN
# composition, accepts ONLY recordings whose license is Public Domain / CC0 (the composition being PD is
# not enough — the recording has its own copyright), downloads it, and transcodes to a normalized web OGG.
#
# Requires: bash, curl, jq, ffmpeg.   Usage: ./fetch-music.sh   (re-run to refill anything that failed)
#
# Curation (epic bosses / chill menu / etc.) — all PD compositions; the script picks a PD/CC0 recording:
#   menu           Debussy — Clair de Lune                  (calm, elegant)
#   gameplay       Mozart  — Symphony No. 40 in G minor, i  (urgent but classy)
#   boss-revenant  Mozart  — Requiem: Dies Irae             (furious — REVENANT)
#   boss-maelstrom Bach    — Toccata & Fugue in D minor     (swirling — MAELSTROM)
#   boss-overseer  Mussorgsky — Night on Bald Mountain      (dark swarm — OVERSEER)
#   gameover       Chopin  — Marche funèbre (Funeral March) (somber)
#
# Unlockable GENRE soundtracks (achievement rewards — equipping one re-points the gameplay theme):
#   jazz  Original Dixieland Jass Band — Livery Stable Blues (1917, PD)  → audio/genres/jazz.ogg
#   pop   public-domain / CC0 upbeat instrumental                       → audio/genres/pop.ogg
#   rock  public-domain / CC0 driving instrumental                      → audio/genres/rock.ogg
#   rap   public-domain / CC0 boom-bap / hip-hop instrumental           → audio/genres/rap.ogg
# PD/CC0 pop/rock/rap is sparse on Wikimedia Commons, so those queries may print "no match" — that's
# expected. Drop your own CC0 file at the target path (e.g. audio/genres/rock.ogg) from a CC0 library
# (Pixabay Music, Free Music Archive's CC0 set, ccMixter) and the engine will use it.
#
# Don't like a pick? Edit the search query in PIECES/GENRES below, or just drop your own PD/CC0 file at
# the target path (e.g. audio/orchestral/menu.ogg) and the engine will use it. Missing files fall back to
# the built-in procedural bed (orchestral, or a per-genre swing/pop/rock/rap bed), so the game always has music.

set -uo pipefail
cd "$(dirname "$0")"
OUT="audio/orchestral"; GENRE_OUT="audio/genres"; mkdir -p "$OUT" "$GENRE_OUT"
UA="neon-survivor-music-fetch/1.0 (https://github.com/shavei/NEON-SURVIVOR)"
API="https://commons.wikimedia.org/w/api.php"

for t in curl jq ffmpeg; do command -v "$t" >/dev/null || { echo "ERROR: '$t' is required but not installed."; exit 1; }; done

# name|search query  (namespace 6 = File:; the API filters to audio + PD/CC0 below)
PIECES=(
  "menu|Debussy Clair de lune"
  "gameplay|Mozart Symphony No. 40 G minor molto allegro"
  "boss-revenant|Mozart Requiem Dies irae"
  "boss-maelstrom|Bach Toccata and Fugue D minor BWV 565"
  "boss-overseer|Mussorgsky Night on Bald Mountain"
  "gameover|Chopin Funeral March marche funebre"
)

# unlockable genre soundtracks → audio/genres/<name>.ogg  (PD/CC0 only; sparse → may need a manual drop)
GENRES=(
  "jazz|Original Dixieland Jass Band Livery Stable Blues"
  "pop|public domain pop instrumental"
  "rock|public domain rock instrumental"
  "rap|public domain hip hop instrumental beat"
)

fetch_one() {
  local name="$1" query="$2" dir="${3:-$OUT}" json url lic title
  echo "── $name  ⟵  \"$query\"  (→ $dir)"
  json=$(curl -fsS -A "$UA" --get "$API" \
    --data-urlencode "action=query" --data-urlencode "format=json" \
    --data-urlencode "generator=search" --data-urlencode "gsrnamespace=6" \
    --data-urlencode "gsrsearch=$query" --data-urlencode "gsrlimit=20" \
    --data-urlencode "prop=imageinfo" --data-urlencode "iiprop=url|mime|extmetadata" \
    --data-urlencode "iiextmetadatafilter=LicenseShortName" 2>/dev/null) || { echo "   ! search failed"; return 1; }
  # first result that is audio AND Public Domain / CC0 (recording license, not just the composition)
  read -r url lic title < <(echo "$json" | jq -r '
    [.query.pages[]? | . as $p | $p.imageinfo[0]
       | select(.mime|startswith("audio/"))
       | select(((.extmetadata.LicenseShortName.value // "")|ascii_downcase) | test("public domain|cc0|pd-"))
       | {url:.url, lic:(.extmetadata.LicenseShortName.value), title:$p.title}]
    | (.[0] | "\(.url) \(.lic|gsub(" ";"_")) \(.title|gsub(" ";"_"))") // "NONE NONE NONE"')
  [ "$url" = "NONE" ] && { echo "   ! no PD/CC0 audio match — edit the query or supply $dir/$name.ogg by hand"; return 1; }
  echo "   ✓ $title  [$lic]"
  local tmp; tmp=$(mktemp); curl -fsSL -A "$UA" "$url" -o "$tmp" || { echo "   ! download failed"; rm -f "$tmp"; return 1; }
  # transcode → loudness-normalized stereo OGG Vorbis (~128 kbps); normalize so tracks sit at even volume
  ffmpeg -y -loglevel error -i "$tmp" -ac 2 -ar 44100 -c:a libvorbis -qscale:a 4 \
    -af "loudnorm=I=-16:TP=-1.5:LRA=11" "$dir/$name.ogg" \
    && echo "   → $dir/$name.ogg ($(du -h "$dir/$name.ogg" | cut -f1))" || echo "   ! ffmpeg transcode failed"
  rm -f "$tmp"
}

ok=0; for p in "${PIECES[@]}"; do fetch_one "${p%%|*}" "${p#*|}" && ok=$((ok+1)); echo; done
gok=0; for p in "${GENRES[@]}"; do fetch_one "${p%%|*}" "${p#*|}" "$GENRE_OUT" && gok=$((gok+1)); echo; done
echo "Done: $ok/${#PIECES[@]} orchestral → $OUT/ · $gok/${#GENRES[@]} genre → $GENRE_OUT/. Commit the .ogg files to ship them."
echo "Verify after committing:  node .claude/skills/neon-survivor/verify.cjs"
