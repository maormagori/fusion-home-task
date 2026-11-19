import sys
import wave

import numpy as np

SAMPLE_RATE = 44100
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
INTRO_BARS = 1
STRUM_GAP = 0.012
# C → G → Am → F, as MIDI note numbers (root first)
CHORDS = [
    [60, 64, 67],
    [55, 59, 62],
    [57, 60, 64],
    [53, 57, 60],
]
ARPEGGIO_STEPS = [0, 1, 2, 1, 0, 2, 1, 2]


def main() -> None:
    out_path = sys.argv[1]
    duration = float(sys.argv[2])
    track = np.zeros(int((duration + 2) * SAMPLE_RATE))
    bar_count = int(duration / BAR) + 1
    rng = np.random.default_rng(7)
    for bar in range(bar_count):
        add_bar(track, bar, CHORDS[bar % len(CHORDS)], rng)
    track = track[: int(duration * SAMPLE_RATE)]
    track = track / np.max(np.abs(track)) * 0.8
    write_wav(out_path, track)


def add_bar(track: np.ndarray, bar: int, chord: list[int], rng: np.random.Generator) -> None:
    bar_start = bar * BAR
    has_drums = bar >= INTRO_BARS
    for beat in range(4):
        beat_start = bar_start + beat * BEAT
        offbeat = beat_start + BEAT / 2
        for index, note in enumerate(chord):
            mix(track, offbeat + index * STRUM_GAP, 0.22 * pluck(midi_to_hz(note), 0.45, rng))
        if beat in (0, 2):
            mix(track, beat_start, 0.5 * pluck(midi_to_hz(chord[0] - 24), 0.9, rng))
        if beat == 3:
            mix(track, offbeat, 0.35 * pluck(midi_to_hz(chord[0] - 24), 0.4, rng))
        if has_drums and beat in (0, 2):
            mix(track, beat_start, 0.6 * kick())
        if has_drums:
            mix(track, offbeat, 0.06 * hihat(rng))
    for step, chord_index in enumerate(ARPEGGIO_STEPS):
        note_start = bar_start + step * BEAT / 2
        mix(track, note_start, 0.12 * bell(midi_to_hz(chord[chord_index] + 12)))


def midi_to_hz(note: int) -> float:
    return 440.0 * 2 ** ((note - 69) / 12)


def pluck(freq: float, seconds: float, rng: np.random.Generator) -> np.ndarray:
    # Karplus-Strong: a noise burst through a damped delay line sounds like a plucked string, not a cold sine.
    period = int(SAMPLE_RATE / freq)
    buffer = rng.uniform(-1, 1, period)
    out = np.empty(int(seconds * SAMPLE_RATE))
    for i in range(len(out)):
        out[i] = buffer[i % period]
        buffer[i % period] = 0.497 * (buffer[i % period] + buffer[(i + 1) % period])
    return out * fade_out(len(out))


def bell(freq: float) -> np.ndarray:
    t = np.arange(int(0.6 * SAMPLE_RATE)) / SAMPLE_RATE
    tone = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2 * t)
    return tone * np.exp(-t * 7)


def kick() -> np.ndarray:
    t = np.arange(int(0.3 * SAMPLE_RATE)) / SAMPLE_RATE
    pitch = 50 + 70 * np.exp(-t * 30)
    phase = 2 * np.pi * np.cumsum(pitch) / SAMPLE_RATE
    return np.sin(phase) * np.exp(-t * 12)


def hihat(rng: np.random.Generator) -> np.ndarray:
    t = np.arange(int(0.05 * SAMPLE_RATE)) / SAMPLE_RATE
    noise = rng.uniform(-1, 1, len(t))
    return np.diff(noise, prepend=0) * np.exp(-t * 80)


def fade_out(length: int) -> np.ndarray:
    envelope = np.ones(length)
    tail = min(length, int(0.05 * SAMPLE_RATE))
    envelope[-tail:] = np.linspace(1, 0, tail)
    return envelope


def mix(track: np.ndarray, start_seconds: float, sound: np.ndarray) -> None:
    start = int(start_seconds * SAMPLE_RATE)
    end = min(len(track), start + len(sound))
    if end > start:
        track[start:end] += sound[: end - start]


def write_wav(path: str, track: np.ndarray) -> None:
    with wave.open(path, 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes((track * 32767).astype('<i2').tobytes())


main()
