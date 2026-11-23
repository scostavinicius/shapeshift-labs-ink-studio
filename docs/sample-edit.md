# Slice and edit a sample

Start with a WAV in the [sample library](sample-capture.md). A sample edit
project stores the original catalog ID and audio hash, transient markers
on the source, and an ordered list of playback clips. The source WAV
stays available through the library.

Use [audio editorial](audio-editorial.md) to pin one of these original
markers to picture or a world event, manage alternates, and preview a recut.

```sh
ink-studio music samples slice library metal-take --out proposed.json
ink-studio music samples edit library proposed.json changes.json --out edit.json
ink-studio music samples render library edit.json --out playback
ink-studio music samples audition library edit.json listening.json --out preview
```

Pass an optional detector settings file after the sample ID in `slice` to
adjust `minGap`, `minStrength`, `sensitivity`, or `channel`. Ink proposes
transient markers and opens the project with a clip covering the whole
source. Markers are editable on the original PCM frame grid. All frame
ranges are zero-based and half-open.

## Correct the markers

Use `add` with a unique ID and `at`, and optional `kind` and `label`. Use
`move` with the existing ID and new `at`, or `delete` with the ID. Each
marker starts a slice that ends at the next marker or at the end of the
recording. `leading` names the material before the first marker when
there is a gap at the start.

```json
[
  { "op": "move", "id": "hit-26240", "at": 26192 },
  { "op": "add", "id": "hi-hat", "at": 47648, "label": "Hi-hat" },
  { "op": "delete", "id": "hit-57920" },
  { "op": "splitHit", "id": "hit-26240", "body": 26672, "tail": 29936,
    "bodyId": "metal-body", "tailId": "metal-tail" }
]
```

`splitHit` keeps the named marker as the attack and adds two boundaries
inside the hit. Set exact body and tail positions, or omit them to use a
short attack and the final portion of the slice as the tail. Audition a
marker with a request such as `{"marker":"metal-body","before":1600,"after":4800}`.
The report gives the marker position relative to the rendered preview.
To hear just the body, pass `{"slice":"metal-body"}` to `render`.

## Arrange the clips and hear a join

An `assemble` operation replaces the playback clip list and clears its
joins. Place a clip from a named `slice`, or specify its source `from`
and `to` frames. Each placement snapshots its source range. Marker edits
are available the next time that slice is placed. An individual clip can
be reversed, shortened, or slipped independently.

```json
[
  { "op": "assemble", "clips": [
    { "id": "ring", "from": 26192, "to": 27374 },
    { "id": "answer", "from": 57896, "to": 59035 }
  ] },
  { "op": "reverse", "id": "answer" },
  { "op": "trim", "id": "ring", "head": 4 },
  { "op": "slip", "id": "answer", "frames": 16 },
  { "op": "crossfade", "left": "ring", "right": "answer", "frames": 640, "curve": "linear" }
]
```

Trim removes positive frame counts from the playback head and tail.
Slip shifts both source endpoints by the signed frame offset and keeps
duration and direction. Crossfades overlap adjacent clips and shorten
the timeline by the overlap. Set `frames: 0` to clear a join. Choose
`linear` or `equal-power`. Adjacent fades need room to finish inside
their shared clip. A gain for any equal-power overs is shared across
the render, its crops, and its join comparisons.

Use [warp and repitch](audio-warp.md) when the assembled clip needs a new
tempo or when an attack needs to line up with a picture frame.

Use [sample kits](sample-kits.md) to play named slices from pads or MIDI notes.

Pass `{"left":"ring","right":"answer","before":6080,"after":6720}` to
`audition`. The command writes the join as edited and a hard-cut
reference with that one overlap removed. The windows have matching
handles on either side and separate cut positions in their report.

## Compose the tools

Use the JavaScript API at `KIT.procedural.mediaGraph.sampleEdit` or graph
nodes `audio.proposeSampleSlices`, `audio.editSample`,
`audio.renderSampleEdit`, and `audio.auditionSampleEdit`. Pass the same
PCM source to the proposal, render, and audition nodes. The audition
node's `alternatives.hardCut` port value is present for join reviews.
The CLI reopens the original catalog entry by ID and checks its hash.

Run [Cut Metal](../examples/music-production/cut-metal.cjs) with
`node examples/music-production/cut-metal.cjs output-directory` to hear a
brake-drum and rim take cut into a new phrase, including both versions of
its 20 ms join.
