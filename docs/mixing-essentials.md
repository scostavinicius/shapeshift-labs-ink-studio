# Mixing essentials

Each tool is a named insert on an existing [mixer strip](audio-mixer.md).
Use the same mixes and taps in the CLI and audio graph.

Use [dialogue repair and intelligibility](dialogue-repair.md) for a dialogue-keyed
EQ band, source restoration, and an audible difference preview.

## Shape a strip

```json
{
  "voice-eq": {
    "type": "eq",
    "bands": [
      {"mode": "highpass", "hz": 90},
      {"mode": "peak", "hz": 620, "q": 1.2, "gainDb": -2.5},
      {"mode": "high-shelf", "hz": 4200, "gainDb": 1.5}
    ]
  },
  "keyed-comp": {"type": "compressor", "thresholdDb": -28, "ratio": 4,
    "attack": 0.005, "release": 0.12, "lookahead": 0.006},
  "room-gate": {"type": "gate", "thresholdDb": -38, "rangeDb": 36,
    "hysteresisDb": 4, "attack": 0.002, "hold": 0.024, "release": 0.075},
  "hat-expander": {"type": "expander", "thresholdDb": -33, "rangeDb": 12, "ratio": 1.8},
  "rim-shape": {"type": "transient", "attackDb": 5, "sustainDb": -4, "fast": 0.003, "slow": 0.05},
  "bass-color": {"type": "saturation", "driveDb": 12, "bias": 0.2, "toneHz": 4800, "outputDb": -8, "wet": 0.65},
  "master-ceiling": {"type": "limiter", "ceilingDbTP": -1, "lookahead": 0.005, "release": 0.08}
}
```

- EQ bands can be `peak`, `notch`, `low-shelf`, `high-shelf`, `lowpass`,
  or `highpass`. Each has `hz` and `q`, and bells and shelves have
  `gainDb`. Changing a band retains its filter state. [Cytomic on the trapezoidal state-variable filter](https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf)
- A gate closes by up to `rangeDb` below the threshold. Hysteresis sets
  a separate closing threshold and hold protects a hit through short
  dips. An expander lowers soft material continuously according to its
  `ratio`, within the chosen range.
- A compressor, gate, or expander can read an external detector by using
  `{"processor":"keyed-comp","sidechain":{"strip":"kick","tap":"pre"}}`
  in a strip's insert list. The main signal and detector are
  latency-aligned. Omit the sidechain to use the insert input.
- Transient shaping applies `attackDb` when its fast envelope overtakes
  its slow envelope and `sustainDb` as the tail decays. Saturation adds
  soft clipping with an adjustable asymmetric bias, a tone filter and
  output trim.

Gain, thresholds, ratios, range, hysteresis, EQ controls, and saturation
controls take the mixer's automation lanes. Envelope times and lookahead
are fixed seconds. The limiter's `inputDb` can be automated.

## Catch inter-sample peaks

Place the limiter last on the master with its fader at unity for a
delivery ceiling. It looks ahead on a four-times reconstructed
signal, tracks a linked stereo gain, and verifies the limited PCM
at eight times the sample rate. A small guard trim catches overs
introduced by the gain envelope. The insert report gives the requested
ceiling, detected and verified peaks, maximum gain reduction,
guard trim, and algorithmic latency in samples. True peak is an
estimate of the reconstructed waveform. [ITU-R BS.1770-5, Annex 2](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I)

## Check translation

```sh
ink-studio music mix meter mix.wav --out meter.json
ink-studio music mix meter mix.wav --from-sample 48000 --to-sample 96000
ink-studio music mix monitor mix.wav --mode mono --focus hook.wav --out checks/mono
ink-studio music mix monitor mix.wav --mode small-speaker --focus hook.wav --out checks/speaker
```

Metering gives sample peak, 8× reconstructed true peak, RMS, crest
factor, K-weighted gated integrated loudness, stereo correlation,
and the level change when folded to mono. Silence or an undefined ratio
is reported as `null` in logarithmic fields. Set `meter: true` on a mixer
recipe for a master reading in its render report. In a graph use
`audio.meterMix` with optional sample-window settings.

Monitor through stereo, a half-sum mono fold, or a mono speaker-band
approximation. The small-speaker default starts at 260 Hz and reaches
4.6 kHz when the sample rate permits. Use `--low-hz` and `--high-hz`
for another bandwidth. Preview WAVs leave the mix file intact.
An optional focus stem must match the mix's duration and sample rate.
Its report compares focus RMS before and after monitoring, including
its relative level against the mix. Audition the preview to judge
musical masking and intelligibility.

In a graph use `audio.monitorMix` with `options.mode` and optional
`references.focus`. The preview and report are distinct outputs.
JavaScript uses `KIT.procedural.mediaGraph.mixerMonitor` with
`meter(source, settings)` or `preview(source, settings, focus)`.

Run [Pocket Radio](../examples/music-production/mixing-essentials-workshop.cjs)
with `node examples/music-production/mixing-essentials-workshop.cjs output`.
It prints a four-bar reference and processed mix, plus mono and speaker
auditions. The delayed side pad is designed to disappear in mono. Its
centered keys are the focus stem used to measure what survives.
