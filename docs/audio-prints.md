# Print and reuse graph audio

Print a dry tap, a wet tap, or both from one evaluation of a graph. Ink
writes ordinary 24-bit PCM WAVs alongside a portable manifest and adds
the takes to your sample library with the same decoded audio.

```sh
ink-studio music samples print library recipe.json --out prints/relay
```

Use a [resampling jam](resampling-jam.md) to branch a pinned performance
through playback and rack treatments and recover the editable source
directly from a kept print.

A recipe names the graph relative to the recipe file and selects each tap.
Use `output` for a named graph output, or `node` and an optional `port`
for an internal output. A node path such as `rack/fx` reaches inside a
group instance. Use `field` to reach a named stem in a record-valued port.
Choose the dry point before processing and the wet point after it or on
an effect return. A pair captures both from the same evaluation.

```json
{
  "graph": "relay-patch.json",
  "seed": 538,
  "taps": {
    "dry": { "node": "instrument" },
    "wet": { "node": "rack/fx", "port": "stems", "field": ["echo"] }
  },
  "sample": { "id": "relay", "label": "Relay latch", "material": "metal" },
  "range": { "firstSample": 3200, "endSample": 45440 },
  "markers": [
    { "id": "strike", "at": 6400, "kind": "attack" },
    { "id": "answer", "at": 11520, "kind": "attack", "label": "First echo" }
  ]
}
```

Set optional `time`, `seed`, and `inputs` to choose a graph evaluation.
Omitted values use the graph defaults. Source ranges are half-open and
shared across takes. Omit `range` to print the complete buffer when the
tap lengths agree. Choose an explicit common end when paired tap lengths
differ. The takes must share a sample rate. Channel counts may differ.
Author markers in the source range. The manifest and edit files store
them relative to the start of the printed WAV.

## Keep the print with its provenance

Each take has a WAV, an edit document, and a record in `print.json`. The
entry retains the graph hash, evaluation seed and time, exact source
range, tap address, upstream operation bindings, and referenced asset
hashes. Large literal bindings are recorded by hash and size. Keep the
source graph and its assets if you need to rerun the processing.

A single take uses the sample ID in the recipe. A pair appends `-dry`
and `-wet` to produce two independently reusable library entries.
The library preserves the print markers when proposing additional slices.
Use the WAVs for drag-and-drop into tools that accept PCM audio. Move
the entire print folder to keep the manifest, markers, and edit projects.

## Reuse a take in a kit

Use an existing library sample ID as usual, or reference the print
directly in a kit recipe. This direct reference resolves the WAV from
the print folder and verifies it against the manifest.

```json
{
  "assets": {
    "relay": { "print": "prints/relay/print.json", "take": "wet", "slice": "answer" }
  }
}
```

The marked slice starts at that marker and extends to the next marker
or the end of the take. Omit `slice` to load the whole take. A
single-take print can omit `take`. The included edit documents also
work with the existing sample-edit workflow and the source library.

## Place a print against picture

Declare the print directly in a scene [soundtrack](scene-audio.md).
A track can start on a frame at an exact picture rate, or line up a
named print marker with that frame. The marker can also align to a
regular `time` address.

```json
{
  "format": "ink-studio/scene-audio",
  "version": 1,
  "sampleRate": 48000,
  "assets": { "latch": { "print": "prints/relay/print.json", "take": "wet" } },
  "tracks": [
    {
      "asset": "latch",
      "frame": 47,
      "fps": { "numerator": 30000, "denominator": 1001 },
      "marker": "answer"
    }
  ]
}
```

Ink computes the clip start from the marker's source offset and the
track's playback rate. Choose a trim or a later target if the start
would fall before zero. Other track controls, including gain, duration,
offset, rate, and loop, use the regular soundtrack behavior.

## Compose it in a graph

The `audio.print` node crops a record of typed audio taps keyed by
`dry` and/or `wet`. It returns `audio`, catalog `entries`, and
`report`. Pass optional explicit provenance in `settings.traces`
when the calling graph has it. The CLI captures the project dependency
trace and publishes the files. JavaScript hosts can use
`readGraphProject(...).audioTaps(targets, options)` and
`KIT.procedural.mediaGraph.audioPrint.prepare(sources, settings)`.

Run [Relay Print](../examples/music-production/print-workshop.cjs) with
`node examples/music-production/print-workshop.cjs output-directory`.
It prints a metallic latch and its echo return, plays those prints as
slices on two pads, and places the wet take's first echo against picture.
