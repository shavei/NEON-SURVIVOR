#!/usr/bin/env python3
"""Generate placeholder one-shot SAMPLES for the SampleKit engine (audio/samples/).

These are short, single recorded-style hits the code sequencer triggers + pitch-shifts into a full
song (drums + pitched guitar/bass/lead). Synthesized here (free, owned) as drop-in placeholders —
overwrite any file with a real CC0 recording at the SAME pitch root (see ROOTS) and it just works.

Pitch model: SampleKit plays buf at playbackRate = 2^((note - root)/12). Roots are chosen near the
middle of each part's range so shifts stay small (no 'chipmunk'). WAV -> OGG via the ffmpeg pass.
"""
import math, wave, struct, random, os
from array import array

SR = 44100
def midi(m): return 440.0 * 2.0 ** ((m - 69) / 12.0)
def frac(x): return x - math.floor(x)
def new_buf(n): return array('d', bytes(8 * n))

def add_osc(buf, t0, dur, freq, vol, wave_t='saw', drive=0.0, atk=0.004, dec=0.12, detune=0.0):
    N = len(buf); i0 = int(t0 * SR); n = min(int(dur * SR), N - i0)
    if n <= 0: return
    a = max(1, int(atk * SR)); dk = max(1.0, dec * SR); nd = 1.0 / math.tanh(drive) if drive else 1.0
    for i in range(n):
        e = (i / a) if i < a else math.exp(-(i - a) / dk)
        ph = freq * i / SR
        v = 2.0 * frac(ph) - 1.0 if wave_t == 'saw' else math.sin(2.0 * math.pi * ph)
        if detune: v = 0.5 * v + 0.5 * (2.0 * frac(freq * (1 + detune) * i / SR) - 1.0)
        if drive: v = math.tanh(v * drive) * nd
        buf[i0 + i] += v * vol * e

def add_noise(buf, t0, dur, vol, dec=0.06, hp=False):
    N = len(buf); i0 = int(t0 * SR); n = min(int(dur * SR), N - i0)
    if n <= 0: return
    dk = max(1.0, dec * SR); prev = 0.0
    for i in range(n):
        nz = random.random() * 2.0 - 1.0
        out = (nz - prev) if hp else nz; prev = nz
        buf[i0 + i] += out * vol * math.exp(-i / dk)

def kick(buf):
    ph = 0.0
    for i in range(len(buf)):
        f = 45.0 + 95.0 * math.exp(-i / SR / 0.025); ph += 2.0 * math.pi * f / SR
        buf[i] += math.sin(ph) * math.exp(-i / (0.11 * SR))

def snare(buf):
    add_noise(buf, 0, 0.14, 0.9, dec=0.05, hp=True); add_osc(buf, 0, 0.10, 180.0, 0.35, 'sine', dec=0.05)

def chordbuf(buf, root, drive, dec):
    for iv, vv in ((0, 0.55), (7, 0.4), (12, 0.4)):
        add_osc(buf, 0, len(buf) / SR, midi(root + iv), vv, 'saw', drive=drive, atk=0.002, dec=dec, detune=0.008)

def normalize(buf, peak_db=-5.0):
    pk = max((abs(x) for x in buf), default=0.0) or 1.0
    g = (10.0 ** (peak_db / 20.0)) / pk
    for i in range(len(buf)): buf[i] *= g

def write_wav(path, buf):
    w = wave.open(path, 'w'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    out = bytearray()
    for x in buf:
        s = int(max(-1.0, min(1.0, x)) * 32767); out += struct.pack('<hh', s, s)
    w.writeframes(bytes(out)); w.close()

# (name, duration_s, render-fn). Roots documented in ROOTS below / SampleKit.MANIFEST.roots.
GTR_ROOT, BASS_ROOT, LEAD_ROOT = 53, 29, 64
SAMPLES = [
    ("kick",    0.20, lambda b: kick(b)),
    ("snare",   0.16, lambda b: snare(b)),
    ("hat",     0.06, lambda b: add_noise(b, 0, 0.05, 1.0, dec=0.02, hp=True)),
    ("openhat", 0.20, lambda b: add_noise(b, 0, 0.19, 1.0, dec=0.10, hp=True)),
    ("chug",    0.24, lambda b: chordbuf(b, GTR_ROOT, 9.0, 0.10)),     # palm-mute power chord
    ("chord",   1.20, lambda b: chordbuf(b, GTR_ROOT, 7.0, 1.0)),      # sustained power chord
    ("bass",    0.50, lambda b: (add_osc(b, 0, 0.5, midi(BASS_ROOT), 0.9, 'saw', drive=3.0, dec=0.4, detune=0.006),
                                 add_osc(b, 0, 0.5, midi(BASS_ROOT - 12), 0.5, 'sine', dec=0.4))),
    ("lead",    0.60, lambda b: add_osc(b, 0, 0.6, midi(LEAD_ROOT), 0.8, 'saw', drive=6.0, dec=0.45, detune=0.01)),
]

if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(root, "audio", "samples"); os.makedirs(outdir, exist_ok=True)
    for name, dur, fn in SAMPLES:
        buf = new_buf(int(dur * SR)); fn(buf); normalize(buf)
        write_wav(os.path.join(outdir, name + ".wav"), buf)
        print(f"  samples/{name}.wav  ({dur}s)")
    print("done")
