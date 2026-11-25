# Harmonic and percussive separation

Split a mono or stereo WAV into a tonal layer and a percussive layer. Ink
keeps both on the original sample grid and opens them in one editable
[editorial session](audio-editorial.md). The harmonic take keeps its original
duration when transposed. Each detected attack has a clip with a sync
point that can move independently.

```sh
ink-studio music separate break.wav --out split
ink-studio music editorial edit split/project.json changes.json --out split/edited.json
ink-studio music editorial render split/edited.json --out print --stems
```

The split writes `harmonic.wav`, `percussive.wav`, `project.json`, and
`report.json`. Look up clip IDs in `report.json` or use
`music editorial inspect`. The example pitches the harmonic take up five
semitones and delays a suggested hit by 3,200 samples.

```json
[
  { "op": "transpose", "clip": "harmonic", "semitones": 5 },
  { "op": "nudge", "clip": "hit-19840", "offsetSamples": 3200 }
]
```

A `transpose` edit accepts −24 to +24 semitones and can target a named
alternate with `take`. Zero clears the edit. Ink analyzes the take's asset
once per pitch in a render and keeps the native sample addresses, timing and
handles. The [tonal warp](audio-warp.md) restores the duration after the pitch
change. Add a `tail` in the separation settings if you want space to move the
last hit past the original duration.

Detected hit slices overlap briefly before the attacks. Complementary linear
fades sum to the percussive layer at the original spots. A hit move takes the
slice's local decay along with it. Very dense hits or pitched drums can be
spread across the layers. Review suggested attacks before rearranging an
unfamiliar recording.

## Settings and analysis

Pass an optional settings JSON after the WAV filename.

```json
{
  "id": "relay-break",
  "separation": { "timeMedian": 19, "frequencyMedian": 17, "balance": 1.0 },
  "detect": { "minGap": 0.065, "minStrength": 0.024 },
  "tail": 0.25
}
```

The median sizes are odd counts of time frames or frequency bins between
3 and 63. The defaults cover approximately 320 ms and 13 bins. Larger time windows favor sustained tones over short attacks.
Use `balance` from 0.25 to 4 to tilt ambiguous energy toward the percussive or
tonal layer. `sharpness` from 0.5 to 4 sets how strongly the mask favors
the larger median. The FFT size defaults to the nearest power of two to
46 ms, bounded to 512–4096, and the hop defaults to a quarter window.
Set `detect` to `false` for a single percussive clip. Longer recordings are
subject to the spectral and session budgets.

Ink computes a shared mask from both channels' spectral power so stereo
phase survives the split. The percussive layer is the complement of the
reconstructed harmonic layer. If an individual layer would peak above
full scale, both files use one reported `layerGain`. The editable session
restores a common level within its normal gain and output limits. Exact
source length is kept in the WAVs. The session includes the source on a
30 fps editorial grid.

Use `KIT.procedural.mediaGraph.harmonicPercussive.split` for aligned PCM or
`harmonicPercussive.session` for an editorial session and assets.
The graph operations `audio.separateHarmonicPercussive` and
`audio.separateEditorial` expose the same operations.

Run `node examples/harmonic-percussive/demo.cjs <output-directory>` to hear
an original stereo break, its two separated layers, their recombination, and
an editable remix. The page lets you transpose the tonal layer and move two
snare hits independently.

The spectral masks follow the time and frequency median method described
by FitzGerald. [Harmonic/Percussive Separation Using Median Filtering](https://www.dafx.de/paper-archive/details/DsmIVcydPX66AuaqEmKyTQ)
