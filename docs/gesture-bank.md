# Searchable audio gesture bank

A bank lives inside an existing sample library. It organizes full recordings
into named sessions and takes, and indexes short, nondestructive slices by
the sound they contain. An agent can rank results, hear a level-matched
reel, and keep the chosen perspective as an ordinary catalog sample for
[sample kits](sample-kits.md) and the [instrument builder](sample-instrument-builder.md).

## Index a recording session

Use [sample capture](sample-capture.md) to add each full recording once.
Register their catalog IDs in a take and define slices on the common clock.

```json
{
  "session": {"id": "stairwell", "label": "Stairwell Foley"},
  "take": {
    "id": "t03",
    "label": "Breath studies / take 3",
    "perspectives": {
      "close": {"sample": "t03-close"},
      "room": {"sample": "t03-room", "offsetSamples": 192}
    }
  },
  "slices": [
    {
      "id": "lift",
      "label": "Lift into air",
      "fromSample": 810240,
      "toSample": 834720,
      "analyze": "close",
      "material": "voice",
      "articulation": "breath",
      "tags": ["foley", "exhale"]
    }
  ]
}
```

```sh
ink-studio music gestures ingest library take.json
ink-studio music gestures inspect library stairwell
```

A slice uses an inclusive start and exclusive end in take samples. Ink adds
the signed offset to each endpoint to read a specific perspective. The
example reads room audio starting at sample 810432. Perspectives share a
sample rate and each covers the whole slice. Set offsets from a sync marker
or an editorial alignment. Ink preserves acoustic delays already present in
the aligned recordings. Originals are mono or stereo at 8–96 kHz and have
the full [WAV library](sample-capture.md) budget. Individual analyzed slices
are capped at 15 seconds. [Sample editing](sample-edit.md) can propose
transient markers for choosing those intervals.

Use lowercase session, take, slice, and perspective IDs. Add more takes
under the same session, or repeat the take details with additional slices.
Publishing the same address and values is idempotent. Give a revised
slice a fresh ID to retain both versions. An empty `slices` array registers a
take before editing. The stored take references the original sample IDs and
content hashes. The index keeps one descriptor set per slice, from the
perspective named in `analyze`. That catalog entry supplies default tags,
material, articulation, and the searchable license.

## Find and audition

```sh
ink-studio music gestures search library "a short breath with a rising pitch and a rough tail"
ink-studio music gestures search library query.json
ink-studio music gestures audition library shortlist.json --out reel
ink-studio music gestures keep library keep.json
```

The phrase vocabulary covers short/long, rising/falling/steady pitch,
rough/smooth tail, and the authored articulation labels breath/scrape/metal.
Use structured search for other articulations, exact filters, and acoustic
targets. Filters support session, take, material, articulation, tag,
perspective availability, license, and origin (`recording` or `procedural`).

```json
{
  "filters": {"articulation": "breath", "perspective": "room"},
  "targets": {
    "duration": {"value": 0.48, "weight": 1, "tolerance": 0.35},
    "pitchMotion": {"value": 4, "weight": 2, "tolerance": 5},
    "tailRoughness": {"value": 0.8, "weight": 1.5}
  },
  "limit": 6
}
```

Targets also accept a bare number. Search returns the interpreted query, the
matched descriptors, per-target weighted distances, and their weighted mean.
Lower distances rank first. The distance for each target saturates at its
tolerance. Equal scores sort by stable address. An unvoiced or too-short
trajectory has a null pitch-motion value and pays the full pitch penalty.

| Descriptor | Coordinate |
| --- | --- |
| `duration` | Seconds |
| `pitchMotion` | Semitones between the early and late voiced regions |
| `tailRoughness` | 0–1 heuristic combining active aperiodic frames and high-frequency energy in the last third |
| `voicedFraction` | Fraction of active analysis frames with a credible pitch |
| `brightness` | 0–1 high-frequency energy proxy |
| `tailLevel` | Last-third RMS relative to the whole clip in dB |
| `attackRate` | Detected transients per second |

The descriptors also include peak, RMS, and the pitch analyzer's root proposal
when available. A moving pitch can produce a valid contour and a weak root.

`shortlist.json` selects stable addresses. Use the analysis perspective by
default or name alternate perspectives for an A/B.

```json
{
  "clips": [
    "stairwell/t03/lift",
    {"id": "stairwell/t03/lift", "perspective": "room"}
  ],
  "options": {"targetRmsDb": -23, "peakDb": -3, "gapSeconds": 0.35}
}
```

The audition renderer targets a common RMS with a peak ceiling and a cap on
added gain. Quiet or high-crest-factor sounds can land below the target.
The report gives actual gains and levels, exact positions in the reel, and
the native recording ranges, including the original capture clock. A different reel sample rate uses band-limited
resampling.

Use `keep.json` to save the raw winning perspective. Preview normalization
is separate from the stored sample. The kept entry inherits license
information from its original and carries an address back to the gesture.

```json
{
  "id": "stairwell/t03/lift",
  "perspective": "room",
  "sample": {"id": "stairwell-air", "label": "Stairwell air / room"}
}
```

## Generate sources

```sh
ink-studio music gestures generate library breath.json
```

```json
{
  "session": {"id": "exciter-study", "label": "Exciter study"},
  "id": "lift",
  "samplePrefix": "study-lift",
  "material": "air",
  "synthesis": {
    "model": "breath",
    "seed": 23,
    "duration": 0.55,
    "room": 0.65,
    "parameters": {"pitchStart": 128, "pitchEnd": 205, "voice": 0.86, "roughTail": 1}
  }
}
```

- **Breath** mixes a voiced source and seeded turbulence through resonant
  bands. Shape it with `pitchStart`, `pitchEnd`, `voice`, `roughTail`, and
  `throat` (the resonant center in Hz).
- **Scrape** drives resonators with irregular slips and filtered friction.
  Control `speed`, `pressure`, `body` in Hz, and `grain`.
- **Metal** excites inharmonic modes with a short contact impulse. Control
  `body` in Hz, `hardness`, `decay` in seconds, and `strike` position.

Each model prints a mono direct perspective. A nonzero `room` also prints
stereo early reflections from the same source clock. Each take records the
resolved parameters, seed, and version for replay. The model names are
also the default articulations.

## Tool and graph API

Use `ink.openGestureBank(libraryPath)` for `ingest`, `inspect`, `get`,
`search`, `load`, `audition`, `keep`, and `generate`. In a render graph,
`audio.describeGesture` describes PCM, `audio.searchGestures` ranks a supplied
index, `audio.auditionGestures` builds a reel from named audio clips, and
`audio.synthesizeGesture` emits the direct PCM, a perspective table, and
the synthesis recipe. Use `ink-studio graph describe <node>` for runnable
examples.

Run the [workshop](../examples/music-production/gesture-bank-workshop.cjs)
with an output directory and an optional WAV conversion of
[hugh’s public-domain *Breathing man* recording](https://commons.wikimedia.org/wiki/File:Breathing_man.ogg).
It creates a portable library, auditions the shortlist, and sequences the
three models through an existing Ink sample kit.

The descriptor search follows the general approach in [IRCAM's SkataRT
documentation](https://support.ircam.fr/docs/skatart/). The source models
use compact excitation and resonance designs in the tradition of the
[STK instruments](https://chuck.cs.princeton.edu/doc/reference/ugens-stk.html).
