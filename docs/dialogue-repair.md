# Dialogue repair and intelligibility

Repair a source recording with an editable recipe. Ink prints the ridden
bypass, the repaired line, and the signal taken out. Audition the removed
signal for speech or room tone you wanted to keep. Then use the cleaned
line as the key for a dynamic EQ on the music or effects bus.

```sh
ink-studio music repair dialogue.wav repair.json --out review
```

The equivalent graph node is `audio.repairDialogue`. Its outputs are
`value` (repaired), `before`, `removed`, and `report`. The JavaScript entry
point is `KIT.procedural.mediaGraph.repairDialogue(audio, options)`.
The CLI writes all three WAVs and `report.json`.

## Restore the source

Every operation is optional. Coordinates are zero-based PCM frames on the
source's own grid. Ranges include the first frame and exclude the last.
Use mono or stereo audio at 8 to 96 kHz.

```json
{
  "declick": {
    "auto": true,
    "thresholdDb": -33,
    "sensitivity": 8,
    "ranges": [{"fromSample": 12080, "toSample": 12084}]
  },
  "hum": {
    "frequency": "auto",
    "harmonics": 3,
    "reference": {"fromSample": 800, "toSample": 10800}
  },
  "spectral": [{
    "fromSample": 46000,
    "toSample": 62500,
    "lowHz": 2720,
    "highHz": 3060,
    "size": 1024,
    "mode": "interpolate",
    "amountDb": 32,
    "fadeSamples": 384,
    "featherHz": 52
  }],
  "gainDb": {
    "unit": "samples",
    "points": [{"at": 0, "value": 0}, {"at": 72500, "value": 0}, {"at": 76200, "value": 4}]
  },
  "deess": {"hz": 6200, "q": 1.2, "thresholdDb": -29, "rangeDb": 6},
  "preview": {"fromSample": 44100, "toSample": 96000}
}
```

- **De-click** detects isolated spikes against their local waveform.
  Mark longer clicks explicitly with `ranges` (up to 20 ms per range).
  Ink replaces each marked span by interpolating between its neighboring
  samples. Supplying a range list defaults `auto` to false, so you can
  review automatic results and then rerun just the selected repairs.
- **Hum** fits a stationary fundamental and its harmonics per channel.
  `"auto"` compares 50 and 60 Hz. Give it a reference with at least 75 ms
  of mostly hum and room tone when available. An explicit fundamental
  between 40 and 70 Hz supports an off-nominal source. `amount` from 0 to
  1 controls how much of the fitted signal is subtracted.
- **Spectral repair** removes only selected frequency bins inside a time
  range. `attenuate` applies the requested reduction. `interpolate` pulls
  the magnitude toward the surrounding audio while keeping the phase
  and never boosting a bin. It needs one full FFT window of context on
  either side. The time fade and frequency feather soften the boundary.
  Patches apply in list order.
- **Clip gain and de-essing** come after waveform restoration. That lets
  the hum fit operate on the original recording level. The gain ride is
  applied to both audition paths. The de-esser uses a stereo-linked
  sibilance detector to reduce a high-frequency band. Its threshold,
  ratio, range, and wet control can be automated on the mixer grid.
- **Preview** exports one aligned range while honoring earlier envelope
  state and later context. Ink applies one shared gain for safe headroom.
  Adding the removed signal to the repaired line reconstructs the ridden
  bypass, within WAV rounding. The report lists click ranges, the hum fit,
  spectral patches, resolved gain points, and residual RMS.

Use a repair node in a [scene soundtrack graph asset](scene-audio.md#soundtrack-file)
to pair the editable recipe with the original recording. Route the repaired
output to `dialogue`. Use the `removed` output as a separate audition asset.

## Make room under a line

The [mixer](audio-mixer.md) and [scene post buses](foley-perspective.md#route-a-soundtrack-by-role)
accept `deesser` and `band-duck` inserts. `deesser` uses its own signal.
`band-duck` accepts an external key from the dialogue strip. The keyed
processor changes a peaking EQ at `hz` and `q`, with a maximum reduction
in `rangeDb`. It leaves the rest of the score playing.

This scene post section keys the music strip from the dialogue before
its fader. The limit rises at the line and falls to zero at its end.
Remove `rangeDb` automation to let the key drive the cut throughout
the scene. A mixer recipe uses the same strip and processor definitions.

```json
{
  "strips": {
    "music": {
      "inserts": [{"processor": "space", "sidechain": {"strip": "dialogue", "tap": "pre"}}]
    }
  },
  "processors": {
    "space": {
      "type": "band-duck",
      "hz": 2200,
      "q": 1.1,
      "keyHz": 1100,
      "thresholdDb": -34,
      "ratio": 5,
      "attack": 0.008,
      "release": 0.16,
      "rangeDb": {"unit": "seconds", "points": [
        {"at": 0, "value": 0},
        {"at": 1.1, "value": 0},
        {"at": 1.18, "value": 7},
        {"at": 2.9, "value": 7},
        {"at": 3.15, "value": 0}
      ]}
    }
  }
}
```

`keyHz` and `keyQ` tune an optional detector band independently of the
affected band. Time the limit or wet control in beats, seconds, or samples.
For a mixer comparison, export a tap on the music strip at `input` and
another at `post`. The `post` tap includes any other inserts and fader moves.

[Receiver Check](../examples/music-production/dialogue-repair-workshop.cjs)
adds known faults to two spoken WAVs, prints the residual and repair, and
exports a pair of scene mixes with and without dialogue-keyed EQ.

```sh
node examples/music-production/dialogue-repair-workshop.cjs first.wav second.wav review
```
