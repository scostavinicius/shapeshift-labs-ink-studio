# Arrange atmosphere around a performed score

An atmosphere plan keeps separate layers for continuous beds, occasional
calls, and recurring gestures. It reads an existing score's performed
onsets and gates. It returns sample-addressed placements, protected gaps,
perspective automation, and one editable mixer recipe per layer.

```sh
ink-studio music atmosphere plan coast.json --out plan.json
ink-studio music atmosphere render coast.json plan.json --out render
ink-studio music atmosphere audition coast.json comparison.json --out listen
```

For a printed score, set `score` to a WAV anchored at score sample zero
and `performance` to an inspected production report or an event table.
Each named track is an array of events with `time` and optional `gate` or
`duration`, in seconds. To generate the reference directly, set
`production` to a production recipe. Ink inspects that performance and
renders its score when a `score` WAV is absent. Use `productionOptions`
to override its render rate, end, or tail.

The tempo map comes from the inspected production. Supply `map` for an
external event table or to set the beat clock explicitly. It accepts the
existing tempo and swing format. All layer and preview ranges are
half-open. Address a range in seconds, `{"samples":32000}`, or a musical
position such as `{"beat":8.5}`.

```json
{
  "score": "score.wav",
  "performance": "performed.json",
  "map": {"tempo": 108},
  "assets": {
    "water": "water.wav",
    "bird": {"wav": "birds.wav", "fromSample": 30250, "toSample": 38339},
    "drop": "drop.wav",
    "wash": "wash.wav"
  },
  "atmosphere": {
    "seed": 61,
    "layers": [
      {
        "id": "shore",
        "kind": "bed",
        "assets": ["water"],
        "crossfade": 0.5,
        "perspective": {
          "far": {"gainDb": -20, "cutoffHz": 1450, "pan": -0.12},
          "near": {"gainDb": -4, "cutoffHz": 6500, "pan": 0.12},
          "whenQuiet": ["kick", "snare"],
          "minQuiet": 1.4,
          "tail": 0.2,
          "attack": 0.38,
          "release": 0.46
        }
      },
      {
        "id": "calls",
        "kind": "call",
        "assets": ["bird"],
        "range": {"from": {"beat": 4}, "to": {"beat": 32}},
        "avoid": ["lead"],
        "padding": 0.13,
        "minGap": 0.32,
        "spacing": 2.8,
        "density": 0.55,
        "perspective": {"far": {"gainDb": -15, "cutoffHz": 5700, "pan": 0.29}}
      },
      {
        "id": "wake",
        "kind": "gesture",
        "assets": ["drop", "wash"],
        "every": 8,
        "offset": 0,
        "pattern": [
          {"beat": 4.25, "source": "drop"},
          {"beat": 5.5, "source": "wash", "gainDb": -5}
        ]
      }
    ]
  }
}
```

Audio assets use the same WAV, catalog, sample-edit, and print references
as [resampling jams](resampling-jam.md). Set a relative `library`
directory when a reference needs the catalog.

## Place the layers

- **Bed.** Covers the layer range with one or more sources and crossfades
  adjacent clips. A seed selects among assets when a new clip is needed.
  Long sources can cover the entire window.
- **Call.** Finds gaps in the union of protected tracks. It considers
  a source only when its entire clip fits in the gap after padding.
  `spacing` is the minimum time between candidate starts. `minGap` sets
  the shortest eligible window and `density` is the retained fraction in
  expectation. Changing density uses the same underlying candidates,
  preserving the sample choices and placements shared by two variants.
- **Gesture.** Repeats an authored group of samples at `every` beats,
  anchored at `offset` beats from score zero. Steps use beat offsets
  inside the period. Optional `avoid`, `padding`, and `minGap` protect
  performed notes. The group plays together when all its steps fit and
  its seeded density draw passes. Late steps can ring beyond the period
  when the protected gaps and layer range allow it.

Ranges default to the whole score. Timing controls such as `crossfade`,
`minGap`, `spacing`, and `padding` use seconds. The plan reports exact
sample positions, candidate counts, and free intervals. Lead protection
uses performed gates. Increase padding to leave room for long releases.

## Move the perspective

A layer defaults to a fixed distant perspective. Specify `whenQuiet`
to detect gaps across named tracks, with a post-gate `tail` allowance
and a `minQuiet` duration. In each resulting window the layer moves
toward `near` and returns to `far` before the next protected onset.
`attack` and `release` set the transitions in seconds. The plan carries
sample-addressed fader, low-pass cutoff, and stereo balance lanes. Edit
those lanes or the individual mixers in the saved plan, then pass it to
`render`. The renderer prints the mix, total atmosphere, and separate
bed, call, and gesture stems on the score's sample grid.

## Compare alternatives

```json
{
  "range": {"from": {"beat": 12}, "to": {"beat": 28}},
  "levels": {"targetRmsDb": -20, "gapSeconds": 0.6},
  "variants": [
    {"id": "score", "muted": true},
    {
      "id": "sparse",
      "layers": {"shore": {"trimDb": -5}, "calls": {"density": 0.26}}
    },
    {"id": "closer"}
  ]
}
```

Variants can override `trimDb` on any layer and `density` on call and
gesture layers. All takes use one playback gain, chosen to keep the
loudest take within the audition bounds. That preserves the score's
playback level while you judge the difference in the surroundings.
The report includes reel positions and the events and quiet windows
in each version. Audition up to eight versions of an excerpt of up to
15 seconds at a time, within the combined render budget.

Use `KIT.procedural.mediaGraph.atmosphere` from JavaScript, or compose
`music.atmosphereReference`, `music.planAtmosphere`,
`music.renderAtmosphere`, and `music.auditionAtmosphere` in a graph.
Connect `music.inspectProduction` to the reference node for performed
gates. Connect the isolated atmosphere or group stems to a mixer, rack,
or audio print to process them further.
