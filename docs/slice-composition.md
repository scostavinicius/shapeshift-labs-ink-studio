# Compose with recorded slices

Write a gesture once as named audio slices in musical time. Turn it
into a phrase, play two copies on drifting clocks, cut and reorder the
hits, or send the same gesture to a pitched pad. Every resulting hit
keeps a reference to the authored phrase and its kit take.

The pattern model draws on tape phasing and on composing and scheduling
event patterns independently of their sound sources. [Steve Reich on tape loops and canons](https://stevereich.com/jonathan-cott/)
 · [SuperCollider pattern composition](https://docs.supercollider.online/Tutorials/A-Practical-Guide/PG_060_Filter_Patterns.html)
 · [Strudel sample patterns](https://strudel.cc/learn/samples/)

## Prepare and bind a phrase

Use one or more sources from the [sample library](sample-capture.md).
[Mark or edit slices](sample-edit.md), map them to named takes in a
[sample kit](sample-kits.md), then bind those takes to logical slice
names in the score. A take can refer to a catalog sample, a slice of a
sample edit, or a printed sound. For a pitched voice, set a root note
on the sample kit take. The score can use that same source in several
voices with different pads, samples, notes, or articulations.

```json
{
  "id": "metal-canon",
  "output": "form",
  "tail": 0.8,
  "render": {"sampleRate": 32000, "map": {"tempo": 116}},
  "slices": {
    "knock": {"pad": "strike", "play": {"sample": "knock"}},
    "ring": {"pad": "strike", "play": {"sample": "ring"}},
    "pitched": {"pad": "bell", "play": {"sample": "ring-body"}}
  },
  "patterns": {
    "gesture": {
      "op": "phrase", "length": 2, "hits": [
        {"id": "first", "slice": "knock", "beat": 0, "velocity": 0.83},
        {"id": "middle", "slice": "ring", "beat": 0.625},
        {"id": "last", "slice": "knock", "beat": 1.375, "velocity": 0.7}
      ]
    },
    "steady": {"op": "loop", "source": "gesture", "length": 8},
    "drifting": {"op": "loop", "source": "gesture", "length": 8, "period": {"numerator": 67, "denominator": 32}},
    "phase": {"op": "stack", "layers": {"left": {"source": "steady"}, "right": {"source": "drifting"}}},
    "build": {"op": "additive", "source": "gesture", "counts": [1, 2, 3]},
    "splice": {"op": "cut", "source": "gesture", "length": 2, "slots": [
      {"id": "last-first", "pick": "last", "beat": 0},
      {"id": "repeat-ring", "pick": "middle", "beat": 0.5, "gate": 0.2},
      {"id": "ring-again", "pick": "middle", "beat": 0.875, "gate": 0.3}
    ]},
    "reply": {"op": "voice", "source": "gesture",
      "slices": {"knock": "pitched", "ring": "pitched"},
      "notes": ["Eb4", "G4", "D4"], "gate": 0.5, "play": {"pan": 0.35}},
    "form": {"op": "sequence", "sources": ["phase", "build", "splice", "reply"], "gap": 0.25}
  }
}
```

## Shape the rhythm and the sound

| Pattern | Controls |
| --- | --- |
| `phrase` | `length` and named `hits` with a `slice` and a zero-based `beat`. A hit can set velocity, MIDI note, beat gate, and per-hit playback controls. An empty phrase is a rest. |
| `loop` | Repeat a `source` through the requested `length`. `period` defaults to the source length and controls the beat distance between launches. Nearby periods gradually drift apart. Unequal periods such as 2 and 3 realign every 6 beats. `phase` offsets the first launch and can be negative to start partway through the pattern. |
| `additive` | In each successive copy of `source`, keep the first N attacks in beat order. Supply those counts explicitly, including 0 for a rest. |
| `cut` | Make a phrase of the given `length` from `slots`. Each slot names itself, picks a zero-based hit index or a unique source hit ID, and sets a new beat with an optional gate. A selection can appear more than once. |
| `voice` | Keep the rhythm of `source` and optionally substitute slices, cycle through MIDI notes, override the gate in beats, multiply velocity with `gain`, or set per-hit controls such as pan, tuning, filter, and sends. |
| `sequence` | Play `sources` in order with an optional beat `gap`. Useful for calls, answers, and larger sections. |
| `stack` | Play named `layers` together. Each names a `source` and can start at a later beat with `at`. |

A period change moves successive launches while retaining the timing
inside each copy. Beat positions can be integers, decimals or exact
`{numerator, denominator}` fractions. The same tempo and swing map
converts each onset and gate to the sampler's clock. The arrangement
lasts through the output pattern length plus any `tail` in seconds.
Use `render.duration` to set the exact output span. A gate triggers the
kit's release envelope, and the kit controls sample sustain loops and
effect tails.

For a continuous texture, trim a ringing decay with `audio.renderSampleEdit`,
stretch it with [`audio.warp`](audio-warp.md), and bind the result as a
slice in a `voice` pattern. Route a different branch of the same phrase
to the original attack or a pitched body. Each branch can use its own
kit inserts and sends. For a graph render, connect the prepared audio
to the kit's assets.

## Render, inspect, and revise

```sh
ink-studio music pads compose score.json --out performance.json --report trace.json
ink-studio music pads edit performance.json edits.json --out revised.json
ink-studio music samples kit library kit.json revised.json --out take
```

The trace identifies the phrase and hit reused by each event, its
branch through the composition, beat, sample alias, pad, and any
pitch or gate. Use the usual pad editor to revise only a particular
event. In a graph, connect the `events` and `options` outputs of
`music.composeSlices` to `music.renderSampleKit`. The JavaScript
entry point is `KIT.procedural.mediaGraph.sliceComposition.compose`.

Run [Split Ring](../examples/music-production/slice-composition-workshop.cjs)
with `node examples/music-production/slice-composition-workshop.cjs output`.
The workshop builds a gesture from three [recorded brake-drum strikes](../examples/music-production/samples/CREDITS.md)
and exports the source, score, trace, editable performance, kit and
stems. The final texture uses the reversed and stretched decay of the
third strike.
