import math
import struct
import sys
import wave

SAMPLE_RATE = 44100
CHORD_SECONDS = 4.0
BEAT_SECONDS = 0.5
# Cmaj7 → Am7 → Fmaj7 → G6, in Hz
CHORDS = [
    [261.63, 329.63, 392.00, 493.88],
    [220.00, 261.63, 329.63, 392.00],
    [174.61, 220.00, 261.63, 329.63],
    [196.00, 246.94, 293.66, 329.63],
]


def main() -> None:
    out_path = sys.argv[1]
    duration = float(sys.argv[2])
    frame_count = int(duration * SAMPLE_RATE)
    with wave.open(out_path, 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for i in range(frame_count):
            t = i / SAMPLE_RATE
            value = 0.6 * pad(t) + 0.4 * arpeggio(t)
            frames += struct.pack('<h', int(max(-1.0, min(1.0, value)) * 32767 * 0.5))
        out.writeframes(bytes(frames))


def chord_at(t: float) -> list[float]:
    return CHORDS[int(t // CHORD_SECONDS) % len(CHORDS)]


def pad(t: float) -> float:
    position = t % CHORD_SECONDS
    # Short fades at chord edges avoid clicks when the notes change.
    envelope = min(1.0, position / 0.8, (CHORD_SECONDS - position) / 0.4)
    total = 0.0
    for freq in chord_at(t):
        total += math.sin(2 * math.pi * freq * t) + 0.5 * math.sin(2 * math.pi * freq * 1.003 * t)
    return envelope * total / 6


def arpeggio(t: float) -> float:
    beat = int(t // BEAT_SECONDS)
    since_beat = t - beat * BEAT_SECONDS
    notes = chord_at(t)
    freq = notes[beat % len(notes)] * 2
    return math.exp(-since_beat * 6) * math.sin(2 * math.pi * freq * t)


main()
