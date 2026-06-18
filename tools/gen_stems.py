#!/usr/bin/env python3
"""Generate the 10 instrument stems for NEON SURVIVOR (free, no deps, fully owned output).

Pure-stdlib additive synthesis -> 16-bit stereo WAV per stem. A separate ffmpeg pass converts
WAV->OGG (see gen_stems.sh / the surrounding workflow). These are SYNTHESIZED stems (not recorded
instruments) but they are real, layerable audio assets matching AUDIO_SPEC.md: per-track 5 stems
(drums/rhythm/bass/lead/fx), exact 8-bar loop lengths, seamless looping (event tails wrap onto the
loop head via modulo indexing), and ~-6 dBFS peak headroom so up to 5 layers sum without clipping.

Drop-in replaceable: overwrite any audio/<track>/<stem>.ogg with a real recording, no code change.
"""
import math, wave, struct, random, os
from array import array

SR = 44100

def midi(m): return 440.0 * 2.0 ** ((m - 69) / 12.0)
def frac(x): return x - math.floor(x)

# ---- track musical config (key A-minor family; mirrors the synth engine's progressions) ----
TRACKS = {
    "normal": {  # hype rock, 125 BPM
        "bpm": 125, "bars": 8,
        "roots": [57, 53, 55, 52],    # Am F G Em  (2 bars each)
        "bass":  [33, 29, 31, 28],
        "drive_rhythm": 6.0, "drive_lead": 5.0, "four_floor": False,
    },
    "boss": {    # heavy metal / trance, 150 BPM
        "bpm": 150, "bars": 8,
        "roots": [52, 51, 53, 50],    # darker, lower
        "bass":  [28, 27, 29, 26],
        "drive_rhythm": 11.0, "drive_lead": 9.0, "four_floor": True,
    },
}

def new_buf(n): return array('d', bytes(8 * n))   # n zeroed doubles

def add_osc(buf, t0, dur, freq, vol, wave_t='saw', drive=0.0, atk=0.004, dec=0.12, detune=0.0):
    """Render one enveloped oscillator note; wraps past the loop end onto the head (seamless)."""
    N = len(buf)
    i0 = int(t0 * SR); n = int(dur * SR)
    if n <= 0: return
    a = max(1, int(atk * SR)); dk = max(1.0, dec * SR)
    w = 2.0 * math.pi / SR
    f2 = freq * (1.0 + detune)
    nd = 1.0 / math.tanh(drive) if drive else 1.0
    for i in range(n):
        e = (i / a) if i < a else math.exp(-(i - a) / dk)
        ph = freq * i / SR
        if wave_t == 'saw':   v = 2.0 * frac(ph) - 1.0
        elif wave_t == 'sq':  v = 1.0 if frac(ph) < 0.5 else -1.0
        else:                 v = math.sin(w * freq * i)
        if detune:            v = 0.5 * v + 0.5 * (2.0 * frac(f2 * i / SR) - 1.0)
        if drive:             v = math.tanh(v * drive) * nd
        buf[(i0 + i) % N] += v * vol * e

def add_noise(buf, t0, dur, vol, dec=0.06, hp=False):
    N = len(buf); i0 = int(t0 * SR); n = int(dur * SR)
    if n <= 0: return
    dk = max(1.0, dec * SR); prev = 0.0
    for i in range(n):
        nz = random.random() * 2.0 - 1.0
        out = (nz - prev) if hp else nz
        prev = nz
        e = math.exp(-i / dk)
        buf[(i0 + i) % N] += out * vol * e

def add_kick(buf, t0, vol):
    N = len(buf); i0 = int(t0 * SR); n = int(0.13 * SR); ph = 0.0
    for i in range(n):
        f = 45.0 + 95.0 * math.exp(-i / SR / 0.025)   # 140 -> 45 Hz punch
        ph += 2.0 * math.pi * f / SR
        e = math.exp(-i / (0.11 * SR))
        buf[(i0 + i) % N] += math.sin(ph) * vol * e

def add_snare(buf, t0, vol):
    add_noise(buf, t0, 0.13, vol * 0.9, dec=0.05, hp=True)
    add_osc(buf, t0, 0.10, 180.0, vol * 0.35, 'sine', dec=0.05)

def normalize(buf, peak_db=-6.0):
    pk = max((abs(x) for x in buf), default=0.0)
    if pk < 1e-9: return
    g = (10.0 ** (peak_db / 20.0)) / pk
    for i in range(len(buf)): buf[i] *= g

def write_wav(path, buf):
    w = wave.open(path, 'w'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    out = array('h', bytes(0))
    out = bytearray()
    for x in buf:
        s = int(max(-1.0, min(1.0, x)) * 32767)
        out += struct.pack('<hh', s, s)   # mono -> dual-mono stereo
    w.writeframes(bytes(out)); w.close()

def gen_track(name, cfg, outdir):
    bpm = cfg["bpm"]; bars = cfg["bars"]
    beat = 60.0 / bpm; bar = beat * 4.0; total = bar * bars
    N = int(round(total * SR))
    roots = cfg["roots"]; bassn = cfg["bass"]; ff = cfg["four_floor"]
    def chord_at(b): return roots[(b // 2) % len(roots)]   # chord changes every 2 bars
    def bass_at(b):  return bassn[(b // 2) % len(bassn)]

    stems = {k: new_buf(N) for k in ("drums", "rhythm", "bass", "lead", "fx")}

    for b in range(bars):
        bt = b * bar
        root = chord_at(b); bn = bass_at(b)
        for beatn in range(4):
            t = bt + beatn * beat
            # DRUMS
            if ff:
                add_kick(stems["drums"], t, 0.95)                      # four-on-the-floor
                add_kick(stems["drums"], t + beat * 0.5, 0.5)          # 8th double-kick
            else:
                if beatn in (0, 2): add_kick(stems["drums"], t, 0.95)  # rock 1 & 3
            if beatn in (1, 3): add_snare(stems["drums"], t, 0.8)      # backbeat 2 & 4
            for h in range(2):                                          # 8th-note hats
                add_noise(stems["drums"], t + h * beat * 0.5, 0.04, 0.18, dec=0.02, hp=True)
            # BASS — driving 8th notes on the root
            for e8 in range(2):
                add_osc(stems["bass"], t + e8 * beat * 0.5, beat * 0.5, midi(bn), 0.9,
                        'saw', drive=2.5, atk=0.003, dec=0.18, detune=0.006)
                add_osc(stems["bass"], t + e8 * beat * 0.5, beat * 0.5, midi(bn - 12), 0.5,
                        'sine', dec=0.18)   # sub
            # RHYTHM — palm-mute power-chord chug (root + fifth + octave), 8th notes
            for e8 in range(2):
                tt = t + e8 * beat * 0.5
                for iv, vv in ((0, 0.55), (7, 0.4), (12, 0.4)):
                    add_osc(stems["rhythm"], tt, beat * 0.46, midi(root + iv), vv,
                            'saw', drive=cfg["drive_rhythm"], atk=0.002, dec=0.10, detune=0.008)
        # LEAD — a sparse melodic motif over the bar (enters at high intensity via MIX)
        motif = [0, 3, 7, 10, 7, 3]
        for k, deg in enumerate(motif):
            tt = bt + k * (bar / len(motif))
            add_osc(stems["lead"], tt, bar / len(motif) * 0.95, midi(root + 12 + deg), 0.5,
                    'saw', drive=cfg["drive_lead"], atk=0.01, dec=0.22, detune=0.01)
        # FX — a tension swell per bar (danger-only layer): rising filtered noise + high shimmer
        add_noise(stems["fx"], bt, bar * 0.9, 0.5, dec=bar * 0.6, hp=True)
        add_osc(stems["fx"], bt, bar * 0.9, midi(root + 24), 0.25, 'sine', atk=bar * 0.4, dec=bar * 0.5)

    os.makedirs(outdir, exist_ok=True)
    for k, buf in stems.items():
        normalize(buf, -6.0)
        write_wav(os.path.join(outdir, k + ".wav"), buf)
        print(f"  {name}/{k}.wav  ({total:.2f}s)")

if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for name, cfg in TRACKS.items():
        print(f"[{name}] {cfg['bpm']} BPM, {cfg['bars']} bars")
        gen_track(name, cfg, os.path.join(root, "audio", name))
    print("done")
