# Program the pads

The pad sequencer turns a beat pattern or a recording of pad pulses into
an editable performance for a [sample kit](sample-kits.md). The kit still
supplies the samples, velocity layers, articulation, inserts, and return buses.

```sh
ink-studio music pads program pattern.json run.json --out performance.json
ink-studio music pads edit performance.json edits.json --out revised.json
ink-studio music samples kit library kit.json revised.json --out take
```

## Program a cycle

A pattern has an `id`, a `length` in beats, optional integer `seed`, and
`steps`. Each step has a unique short ID and a zero-based `beat`
within the cycle. Use increments such as `0.25` or an exact
`{"numerator": 1, "denominator": 12}`. Each step addresses a named `pad`
or MIDI `note`, with optional `velocity`, `articulation`, and hit controls.

```json
{
  "id": "relay",
  "length": 4,
  "seed": 61,
  "steps": [
    { "id": "down", "beat": 0, "pad": "kick", "velocity": 0.9 },
    {
      "id": "answer",
      "beat": 1.5,
      "pad": "metal",
      "velocity": 0.7,
      "offset": -0.008,
      "gate": 0.2,
      "when": { "every": 2, "phase": 1, "chance": 0.8 },
      "play": {
        "sample": "metal-alt",
        "startSample": 96,
        "tune": -400,
        "filter": { "type": "lowpass", "hz": 3400 },
        "pan": 0.55,
        "sends": { "echo": 0.6 }
      }
    }
  ],
  "fills": [
    {
      "id": "turnaround",
      "from": 3,
      "to": 4,
      "steps": [
        {
          "id": "rim-roll",
          "beat": 3.25,
          "pad": "snare",
          "articulation": "rim",
          "velocity": 0.8,
          "gate": 0.08,
          "roll": { "count": 6, "spacing": 0.125, "velocity": [0.5, 1.2], "tune": [200, -400] }
        }
      ]
    }
  ]
}
```

Run settings choose how many cycles to play, which cycles take a fill, and
how to render them. `render.map` accepts the shared tempo and swing map,
including changes within the take. `startBeat` optionally places the first
cycle later in the score. A step's signed `offset` is in seconds and
shifts both the onset and its gate endpoint.

```json
{
  "cycles": 4,
  "fills": [{ "cycle": 3, "id": "turnaround" }],
  "render": { "sampleRate": 48000, "map": { "tempo": 121, "swing": 0.56 } }
}
```

- `when.every` and `when.phase` select cycles by their zero-based index.
  `when.chance` draws from the seed, pattern ID, cycle, and step ID.
  Adding an unrelated step leaves the draw for an existing step alone.
  Use `when.fill: true` or `false` to play on cycles with or without a fill.
- A roll expands to `count` hits at the given beat `spacing`. Its
  optional `velocity` pair gives first and last multipliers. Its `tune`
  pair gives extra cents at each end. One conditional decision controls
  the whole roll.
- A named fill has a half-open `from`–`to` window on the cycle's beat
  grid. Its steps use the same beat addresses as the main pattern.
  The default `replace` mode suppresses the main hits and roll subdivisions
  inside the window. Set `mode: "add"` to layer it over the main pattern.
  Assign up to one fill per cycle.

## Set per-hit playback

The `play` record works on a step and on a direct kit event.

| Control | Behavior |
| --- | --- |
| `sample`, optional `layer` | Choose one take by its kit asset alias within the selected articulation. Use `layer` to disambiguate an alias reused across layers. The chosen take plays at the event velocity and leaves the normal alternate sequence alone. |
| `startSample` | Start at this zero-based frame in the selected take. For a looped take the point must precede the loop end. |
| `tune` | Shift the take by cents on top of its assigned tuning and any MIDI pitch. |
| `filter` | Apply one `lowpass` or `highpass` with a cutoff in `hz` to this voice. |
| `pan` | Set the hit's stereo balance from −1 to 1 before the pad's pan. |
| `sends` | Add this voice to named kit buses at linear levels from 0 to 1. These sends tap the filtered and panned voice before the shared pad inserts and include the pad's gain and pan. The pad's regular sends still follow its insert chain. |
| `gate` | Write `gate` in beats on a step. A direct kit event uses `duration` in seconds or an absolute `until`, with `play.gate: true` to gate a one-shot pad. Gated pads use their configured release behavior. |

## Capture and revise

`program` writes `{events, options}` with conditional hits, rolls, and
fills expanded. Its stable event IDs encode the cycle, authored step ID,
and roll subdivision. Ordinary kit round robins are selected at render time.
Pin a particular take with `play.sample` when it needs to survive a change
to the preceding triggers.

Use `music pads capture recording.json routes.json --out performance.json`
to convert [recorded input](headless-authoring.md) pulses from mapped
channels. A routes file has `{routes, options}`. Each route supplies a
default pad or MIDI address and optional `duration`, velocity,
articulation, and `play` controls. A pulse value of `true` uses the route
defaults, a number supplies velocity, and a record can set `note`,
`duration`, `velocity`, `articulation`, or `play`. Exact timestamps
are retained.

Pass an edit list containing `set`, `add`, and `delete` operations.
`set` merges the supplied event fields and the supplied `play` fields.
Use `null` to remove an override. Timing edits can include both `time`
and `until` when moving both ends of a gate.

```json
[
  {
    "op": "set",
    "id": "p3-rim-roll-4",
    "changes": { "play": { "pan": 0.85, "sends": { "echo": 0.7 } } }
  }
]
```

Graph tools are `music.programPads`, `music.capturePadPerformance`, and
`music.editPadPerformance`. Connect their `events` and `options`
outputs to `music.renderSampleKit`. The program node's report also
identifies each event's source step, cycle, and fill. In JavaScript use
`KIT.procedural.mediaGraph.padPattern` with `perform`, `capture`, or `edit`.
These are offline authoring and rendering tools.

Use [slice composition](slice-composition.md) to build larger phrases
from recordings with overlapping loops, additive rhythms, cut-ups, and
pitched responses. It emits the same editable pad performance.

Run [Relay Logic](../examples/music-production/pad-pattern-workshop.cjs)
with `node examples/music-production/pad-pattern-workshop.cjs output-directory`
to produce the pattern, captured performance, targeted edits, and both
mixes with individual pad and effect stems.
