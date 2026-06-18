#!/usr/bin/env python3
"""Generate the optional boss 'drop' intro one-shot (audio/boss/intro.ogg).

A 1-bar (150 BPM => 1.6 s) non-looping riser: ascending distorted saw sweep + a swelling noise
riser, amplitude building to the downbeat so the looping boss track catches it cleanly. Standalone
so it doesn't re-render the 10 main stems. WAV -> OGG via the surrounding ffmpeg pass.
"""
import math, wave, struct, random, os
from array import array

SR = 44100
DUR = 1.6                      # one bar at 150 BPM
N = int(round(DUR * SR))
def midi(m): return 440.0 * 2.0 ** ((m - 69) / 12.0)
def frac(x): return x - math.floor(x)

buf = array('d', bytes(8 * N))

# ascending saw sweep midi 28 -> 52, exponential, heavy drive, swelling amplitude
ph = 0.0
for i in range(N):
    p = i / N
    f = midi(28) * (2.0 ** (((52 - 28) * p) / 12.0))
    ph += 2.0 * math.pi * f / SR
    saw = 2.0 * frac(ph / (2.0 * math.pi)) - 1.0
    saw = math.tanh(saw * 8.0)
    amp = p * p                                   # swell into the drop
    buf[i] += saw * 0.5 * amp

# swelling high-pass noise riser
prev = 0.0
for i in range(N):
    nz = random.random() * 2.0 - 1.0
    out = nz - prev; prev = nz                    # crude high-pass
    amp = (i / N) ** 1.5
    buf[i] += out * 0.45 * amp

# normalize to -6 dBFS
pk = max(abs(x) for x in buf) or 1.0
g = (10.0 ** (-6.0 / 20.0)) / pk
out = bytearray()
for x in buf:
    s = int(max(-1.0, min(1.0, x * g)) * 32767)
    out += struct.pack('<hh', s, s)

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = os.path.join(root, "audio", "boss", "intro.wav")
w = wave.open(path, 'w'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes(bytes(out)); w.close()
print("wrote", path, f"({DUR}s)")
