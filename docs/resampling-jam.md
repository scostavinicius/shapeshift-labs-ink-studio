# Editable resampling jams

A jam pins an editable [pad performance](pad-patterns.md) and
[sample kit](sample-kits.md). Fork the same phrase through different
sample playback speeds and [rack](audio-racks.md) settings, audition a
common window, and keep the passage as a regular [audio print](audio-prints.md)
with its editable source.

```sh
ink-studio music jam inspect jam.json
ink-studio music jam branch jam.json forks.json --out branched.json
ink-studio music jam audition library branched.json comparison.json --out listen
ink-studio music jam render library branched.json render.json --out render
ink-studio music jam keep library branched.json selection.json --out print
ink-studio music jam recover library relay-print-wet --out reopened
```

## Pin the phrase

A project has the format `ink-studio/resampling-jam`, version `1`, a
lowercase `id`, an inline `kit` definition, and an inline `performance`
document with `events` and `options`. Use the output of `music pads
program`, `capture`, or `edit`, or author events with unique IDs.

```json
{
  "format": "ink-studio/resampling-jam",
  "version": 1,
  "id": "relay",
  "assets": {"hit": {"sample": "steel-relay"}},
  "kit": {
    "id": "relay",
    "pads": {
      "strike": {"articulations": {"default": [{"id": "body", "takes": [{"asset": "hit"}]}]}}
    }
  },
  "performance": {
    "events": [
      {"id": "call", "pad": "strike", "time": {"beat": 0}, "velocity": 0.9},
      {"id": "answer", "pad": "strike", "time": {"beat": 1.5, "offset": 0.012}, "velocity": 0.72}
    ],
    "options": {"sampleRate": 32000, "duration": 4, "map": {"tempo": 108}}
  },
  "racks": {},
  "branches": [{"id": "slow", "speed": 0.73}]
}
```

Assets can reference catalog samples, [edits](sample-edit.md), prints,
or WAVs. Use a relative WAV path or `{"wav":"take.wav","fromSample":100,
"toSample":32000}` for a direct slice. A WAV reference can include its
`sha256`. Put inline rack definitions under `racks`, keyed by alias.
The rack's `main` port receives the rendered phrase. Other audio ports
and processor assets resolve by alias from `assets`. Jams run native racks.

The first branch, `source`, is the pinned kit at normal playback speed.
Use `performance.options.duration` to reserve time for tails. Omit it to
take the length from the source kit render. All branches share that
sample clock and length. A branch's `speed` multiplies each hit's sample
playback rate from 0.25× to 4×. This changes the hit's pitch and natural
length while preserving trigger and gate times, velocities, sample
choices, and timing offsets. Rack processing can smear or retrigger the
result according to its own controls.

## Fork and audition

In `forks.json`, supply `branches`, a `sweep`, or both. A branch inherits
its earlier parent's speed and rack. Switch racks to start from the new
rack's defaults, set `rack: null` to remove the rack, or use `bypass: true`.
A macro override accepts a unit value or a regular automation lane.
Macros omitted on a child branch retain their inherited values or lanes.

This example uses the rack alias `bench` and macros `focus` and `fog`.

```json
{
  "branches": [
    {"id": "bench", "rack": "bench"},
    {"id": "hollow", "from": "bench", "speed": 0.68, "macros": {"focus": 0.2}},
    {"id": "shards", "from": "bench", "speed": 1.42, "macros": {"focus": 0.83}}
  ],
  "sweep": {
    "from": "bench",
    "prefix": "scan",
    "axes": [
      {"control": "speed", "values": [0.75, 1.2]},
      {"control": "macros.focus", "values": [0.2, 0.8]},
      {"control": "macros.fog", "values": [0.1, 0.72]}
    ]
  }
}
```

The sweep expands its Cartesian product in authored order and produces
`scan-01` through `scan-08`. Use up to three axes and 32 combinations.
A project holds up to 64 authored branches. Branch files keep relative
asset references working when written in another directory.

`comparison.json` names the branch IDs and a common half-open range in
the phrase's output samples. The reel uses bounded RMS matching and a
peak ceiling. Its report includes the shared event clock, source range,
effective rack state, and gain and position for each listening clip.
Choose excerpts of up to 15 seconds, with up to 90 seconds of clips per reel.

```json
{
  "branches": ["hollow", "shards", "scan-04"],
  "range": {"firstSample": 32000, "endSample": 96000},
  "levels": {"targetRmsDb": -20, "peakDb": -3, "gapSeconds": 0.5}
}
```

For `render`, pass `{"branch":"hollow","range":{"firstSample":32000,
"endSample":96000}}`. The dry tap is the branch's kit audio before its
rack, including the branch playback speed. The wet tap is after its rack.
Each render starts at phrase zero so grains, automation, filters, and
delay have their original context at the start of the window.

## Print a passage and reopen it

```json
{
  "branch": "scan-04",
  "range": {"firstSample": 32000, "endSample": 96000},
  "takes": ["dry","wet"],
  "sample": {"id": "relay-print", "label": "Relay print", "material": "metal"},
  "markers": [{"id": "answer", "at": 64000, "kind": "attack"}],
  "note": "Keep the stretched answer before the final strike."
}
```

The print uses the branch's production gain staging. A paired selection
publishes `relay-print-dry` and `relay-print-wet` to the catalog. Choose
one take to use the unsuffixed sample ID. The output folder contains
`print.json`, reusable WAV and sample-edit files, and an independent
`source/` folder. The selected range, markers, note, and resolved rack
state are in the print's provenance. Each source snapshot holds the full
performance, rack definitions, branches, and hash-checked PCM inputs.

`music jam recover` follows the catalog print back to an independent
source snapshot in the library, even after the original project or
export folder moves. It writes an editable `jam.json`, its WAV assets,
and `selection.json` into your chosen workspace. Edit the recovered
performance or rack and render again. The previous print remains a
separate playable sample. Use a new sample ID to keep a revision.

Use the print in a sampler with a catalog ID or
`{"print":"print/print.json","take":"wet","slice":"answer"}`.
To move the print and its source together, copy the entire output folder.

For JavaScript use `KIT.procedural.mediaGraph.resamplingJam`.
Its pure source document excludes the file-based `assets` table. Pass
named PCM separately to `render` and `audition`. The graph operations
`music.branchResamplingJam`, `music.renderResamplingJam`, and
`music.auditionResamplingJam` have runnable examples in the graph catalog.
Pipe the dry or wet output into `audio.print` when building a larger graph.

Run [Capstan Relay](../examples/music-production/resampling-jam-workshop.cjs)
with `node examples/music-production/resampling-jam-workshop.cjs output`.
It compares three treatments, prints exactly two seconds, recalls the
source, and plays the new sample in a different phrase.
