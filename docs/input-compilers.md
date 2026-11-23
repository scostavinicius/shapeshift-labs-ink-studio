# Compile inputs into editable events

`sim input-compile` combines text, IPA, MIDI, controller recordings, and
cues into an `ink-studio/input-score` document. Edit the same event IDs
after import, then replay the changes through an Ink recording, timed
world ports, or a [gesture score](gesture-scores.md). Source parsing and
compilation use the dependency-free library.

```json
{
  "format": "ink-studio/input-compile-plan",
  "version": 1,
  "id": "inspection",
  "sources": {
    "script": {
      "kind": "text",
      "text": "Ink moves.",
      "lexicon": {"ink": "ɪŋk", "moves": "muːvz"},
      "targets": {"ɪ": {"jaw": 0.7}, "u": {"jaw": 0.4}}
    },
    "voice": {"kind": "ipa", "text": "/t͡ʃəˈmaɪ/", "offset": 0.8, "symbols": ["aɪ"]},
    "music": {"kind": "midi", "file": "chime.mid", "offset": 0.18},
    "desk": {"kind": "controller", "file": "desk.inputs.json"},
    "stage": {
      "kind": "cues",
      "items": [
        {"id": "inspection", "time": 1.28, "end": 1.61, "controls": {"desk:valve": 0.08}}
      ]
    }
  },
  "lanes": {"jaw": {"initial": 0.15, "interpolation": "linear"}}
}
```

A source offset is nonnegative seconds or an exact
`{numerator, denominator}` timecode. The CLI resolves `file` references
relative to the plan. The library and graph accept inline sources.
Set `duration` on the plan to retain extra timeline space at the end.

## Supported sources

| Kind | Inputs and emitted data |
| --- | --- |
| `text` | Inline text or a UTF-8 file. Words and pauses retain source spans. Supply a lowercase word-to-IPA `lexicon` for pronunciation. Unknown words retain a timed word event and produce a warning. Opt into `fallback: "english"` for an approximate grapheme fallback on simple ASCII words. Guessed pronunciations are marked. |
| `ipa` | Inline IPA or UTF-8 file. Emits phone and pause spans with stress, duration and source spans. The tokenizer groups tied symbols and combining marks. Use `symbols` to group multigraphs such as `aɪ`. |
| `midi` | Standard MIDI File format 0 or 1 with PPQ timing, as a file or inline byte array. Tempo changes are applied at original ticks. Note spans keep track, channel, pitch, velocity and original ticks. Channel messages produce editable controller values for CC, bend, program, and pressure. Optional `tracks` are zero-based and `channels` are 1–16. |
| `controller` | An Ink `input-recording`, inline as `recording` or from a JSON file. Equal-time capture order is retained. Optional `channels` select captured channels. Numbers and booleans make curves, and numeric XY or XYZ arrays make `.x`, `.y`, and `.z` curves. All set values and pulses remain editable events. |
| `cues` | Inline `items`, a musical event `track`, or a JSON file containing either. An item has `id`, `time`, optional `end`, `label`, `value`, `channel`, and `controls`. Use an existing [musical tempo map](procedural-score.md) to accept `{beat}`, `{bar, beat}`, or phrase addresses for cue times. |

Speech sources default to 90 ms per phone, 220 ms per unresolved
word, a 35 ms gap, and a 140 ms pause. Set `phoneSeconds`, `wordSeconds`,
`gap`, and `pause` to change those values. Stress and length marks adjust
the default phone duration. The optional `durations` map supplies explicit
symbol timings. The `targets` map binds a symbol to numbers on named
control lanes, and the score also exports word and phone activity gates
where applicable. Text can be used for timing on its own. Pronunciation
and target shapes can be authored independently of a particular voice
model.

MIDI notes pair attacks and releases in order on each track, channel and
pitch. A missing release uses the track end when a positive span is
available and adds a warning. Keys are gated by velocity. The MIDI
compiler preserves note and controller timing, with performance
decisions such as sustain interpretation available to the receiving model.

## Edit events and curves

The result holds editable `events`, curve settings in `lanes`,
materialized `curves`, and compile warnings. An event uses a stable ID,
source, channel, kind, payload, start time, and optional end time.
The source name prefixes imported event IDs. Exact fractions retain a
`timecode` or `endTimecode` alongside the displayed seconds when needed.
A curve key records its winning event and the edges that caused the key.

A point control sets a held value. A span temporarily overrides it.
When spans overlap, the most recently started span takes priority and
ending it restores any span or held value underneath. Same-time starts
keep source and event order at import. Edits use the stored event order. Curves hold by default. Choose
`interpolation: "linear"` to interpolate between keys, starting at the
initial value at zero. The last value holds at the end.

```json
[
  {"op": "move", "id": "stage.inspection", "time": 0.74},
  {"op": "set", "id": "stage.inspection", "patch": {"controls": {"desk:valve": 0.12}}}
]
```

`move` keeps a span's duration. `set` can edit times, kind, channel,
payload, or controls. Use `end: null` to turn a span into a point.
`add` takes a canonical `event` and a new ID, and `delete` addresses
an existing ID. Editing a numeric controller value or note velocity
updates its inferred curve. Explicit `controls` override inference.
`input-edit` publishes a new revision and regenerates curves. Edits made
directly to materialized curve keys are used during playback until the
curves are regenerated.

## CLI, library, and graphs

```sh
ink-studio sim input-compile compile.plan.json --out original.score.json
ink-studio sim input-edit original.score.json inspection.edits.json --out edited.score.json
ink-studio sim input-export edited.score.json --kind recording --out edited.inputs.json
ink-studio sim input-export edited.score.json --kind events --out timed-events.json
ink-studio sim input-export edited.score.json valve.bindings.json --kind gesture --out valve.gesture.json
```

```js
const {KIT} = require('@shapeshift-labs/ink-studio').load();
const I = KIT.world.inputCompilers;
const original = I.compile(plan);
const edited = I.edit(original, [
  {op: 'move', id: 'stage.inspection', time: 0.74}
]);
const take = I.prepare(edited);
const values = take.sample(1);
const edges = take.events({after: 0.7, through: 1.1});
```

Use `I.decodeMIDI(bytes)` to inspect the portable MIDI decode. Use
`take.recording()` for the same recording consumed by `input.replay`.
Controller sets retain their values. Other events become native pulses
with `point`, `start`, or `end` phase. A world or model can register the
stock `input-score` system with `config: {score, bindings}`. Its
`events` port publishes native [timed events](simulation-timed-events.md)
and each binding `{curve, quantity?}` publishes a named scalar output.
State checkpoints keep the consumed edge cursor.

The `input.compile` graph node returns the compiled asset and native
recording from an inline plan. For gesture export, use
`{rate: 120, bindings: {valve: {curve: "desk:valve", limits: {min: 0, max: 1, maxSpeed: 5}}}}`.
Set `until` to extend the exported hold. The gesture samples times on
its own score clock and applies optional range and motion limits.

## Reproduce the demo

```sh
node examples/input-compilers/demo.cjs studio/out/input-compilers
```

The demo compiles five real source files, then moves one inspection cue
from 1.28 to 0.74 seconds. Both revisions drive an Ink pipe valve.
The animation compares executed aperture, and the audition uses the
same valve response to modulate tones timed by the imported MIDI notes.
