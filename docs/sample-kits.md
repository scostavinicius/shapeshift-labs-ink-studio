# Build and play sample kits

A kit maps catalog recordings, edit slices, or graph audio outputs to
named pads and MIDI pitches. It can combine one-shot percussion and
gated pitched instruments. The same kit definition accepts different
performances, including those generated or revised by another tool.

Use the [instrument builder](sample-instrument-builder.md) to audition and
bake pitched registers with independent pitch, duration, and formants.

```sh
ink-studio music samples kit library kit.json performance.json --out take
```

The command writes `kit.wav`, a WAV for each pad and return bus under
`stems/`, and `report.json`. The report records resolved sample times,
velocity weights, chosen takes, choke triggers, and the source catalog
hashes. All audio shares the same headroom gain, so the stems sum to
the mix up to floating-point precision.

## Make a kit from slices and recordings

The command takes a recipe with `kit` and `assets`. Name each audio
source with an alias. Use a catalog `sample` ID and an optional `asset`
hash, or an `edit` path relative to the recipe and an optional `slice`
ID. An edit without a slice plays its assembled timeline. The command
verifies catalog content and the original hash referenced by the edit.
An [audio print](audio-prints.md#reuse-a-take-in-a-kit) can also supply a
whole take or a marked slice directly from its portable folder.

```json
{
  "assets": {
    "soft": { "edit": "percussion-edit.json", "slice": "soft-center" },
    "hard-a": { "sample": "snare-center-a" },
    "hard-b": { "sample": "snare-center-b" }
  },
  "kit": {
    "id": "percussion",
    "pads": {
      "snare": {
        "notes": [38, 38],
        "inserts": [{ "type": "highpass", "hz": 95 }],
        "sends": { "echo": 0.3 },
        "articulations": {
          "default": [
            {
              "id": "soft",
              "velocity": [0, 0, 0.42, 0.78],
              "takes": [{ "asset": "soft" }]
            },
            {
              "id": "hard",
              "velocity": [0.42, 0.78, 1, 1],
              "takes": [{ "asset": "hard-a" }, { "asset": "hard-b" }]
            }
          ]
        }
      }
    },
    "buses": {
      "echo": {
        "inserts": [{ "type": "delay", "seconds": 0.19, "feedback": 0.3, "mix": 1 }]
      }
    }
  }
}
```

Each articulation contains a stack of named layers. An event fires
every layer with a positive weight. The optional `velocity` window is
`[fadeInStart, fullStart, fullEnd, fadeOutEnd]` in normalized velocity
from 0 to 1. Unequal endpoints give a linear fade. The default
`[0, 0, 1, 1]` plays the layer across the whole range. The example
crossfades between two dynamics. Add another overlapping layer to
combine a stick click or different instrument with those recordings.
Layers and takes can each have `gain` in dB.

Round robins advance independently per pad, articulation, and layer,
in playback order with input order breaking ties. A ghost hit leaves
the stick layer's sequence alone when it contributes zero weight.
Each active layer selects its `takes` index modulo its length.
Each render starts with the first take. An event without an articulation
uses `default`. Name other articulations to author separate stacks.

## Play a kit

Provide `events` and optional `options` in the performance file.
Use the [pad sequencer](pad-patterns.md) to generate those events from
conditions, fills, rolls, or recorded pad pulses and edit them by ID.

```json
{
  "options": { "sampleRate": 48000, "map": { "tempo": 108, "swing": 0.56 } },
  "events": [
    { "time": { "beat": 0.5 }, "note": 38, "velocity": 0.42 },
    { "time": { "beat": 1 }, "pad": "snare", "velocity": 0.96 }
  ]
}
```

Address a pad by ID or by a MIDI number or scientific pitch name inside
its inclusive `notes` range. Ranges cannot overlap. Provide both
`pad` and `note` to play a pitch on an explicit pad. A take with
`root: "C4"` transposes relative to that pitch. A take without a root
plays at its recorded pitch, with optional `tune` in cents. Events can
use seconds, a rational timecode, or a beat, bar, or phrase address
on the [tempo map](scene-timeline.md).

Set `gated: true` on a pitched pad. Its events need a `duration` in
seconds or an absolute `until` endpoint in seconds, rational time, or
musical time. A gated take can sustain using
`"loop": { "from": 6000, "to": 14000, "crossfade": 600 }`, on its own
zero-based source frame grid. Ink blends the last `crossfade` frames
into the beginning of the loop, then resumes after the overlap.
A layer can have a `releases` array of takes that starts at note-off
and uses the same round-robin counter. The body fades over the pad's
`release` time. A take without a loop can run out during a long note.
Pad `attack` and `release` are in seconds.

Set the same `choke` group on open and closed hats to fade previously
triggered voices over four milliseconds when the group is next played.
A choke before or on note-off suppresses the note-off take. Simultaneous
triggers can layer in a choke group. Tails already in a return bus
continue naturally.

## Mix and compose

Pad insert chains run top to bottom. Then each pad's `gain` in dB and
`pan` from −1 to 1 set its dry stem and feed its post-fader `sends`
with linear levels from 0 to 1. Shared buses have their own insert
chain, gain, and pan. Available inserts are:

| Insert | Parameters |
| --- | --- |
| `gain` | `db` |
| `highpass`, `lowpass` | `hz` |
| `drive` | `amount`, `mix` |
| `delay` | `seconds`, `feedback`, `mix` |

Omit `options.duration` to export the played voices plus estimated
insert and return tails. Set it in seconds or a rational timecode for
an exact-length take. Use `options.stems: false` to export just the mix.

For graphs, use `audio.renderSampleEdit`, `audio.warp`, or WAV assets
as takes. Collect them into a named `data.record` and connect it to
`music.renderSampleKit` as `assets`. Pass the inner kit definition
to `source`. The mix is available at `value`, and
`data.get` can pull individual WAV-ready audio values from `stems`.
Connect the `events` output of `music.inspectProduction` to
`music.routeSampleKit` as `tracks`. Each entry in `routes` selects a
production track. An empty route uses the MIDI mapping. Set `pad` or
`articulation` to override that part of the performance.

The JavaScript entry points are
`KIT.procedural.mediaGraph.sampleKit.render(kit, assets, events, options)`
and `KIT.procedural.mediaGraph.sampleKit.route(tracks, routes)`.
They render and route offline, including in a scene's soundtrack graph.

Run [Kit Workshop](../examples/music-production/kit-workshop.cjs) with
`node examples/music-production/kit-workshop.cjs output-directory`.
It builds a reusable catalog and kit recipe, plays three focused
comparisons, and renders a four-bar percussion, bass, and reed take
with separate pad and effect stems.
