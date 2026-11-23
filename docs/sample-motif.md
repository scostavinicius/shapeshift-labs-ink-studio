# Sample-to-motif audition

Use one recording in four roles over a common excerpt of an existing score.
The audition keeps one playback gain across every role, including the optional
score-only control. Each take starts at the same sample in the score.

| Role | What plays | What you can edit |
| --- | --- | --- |
| `raw` | One unpitched cue at the original playback pitch | Start beat, gain, pan |
| `lead` | The recording mapped across pitches and played as a note phrase | Notes, gates, velocities, root pitch, optional pitch/duration/formant shaping |
| `accent` | Short rhythmic hits from the recording | Beat and gate, velocity, per-hit sampler controls such as tune, filter, offset and pan |
| `texture` | A slow granular scan of the recording | Start and end beats, grain size and density, pitch, spray, spread, reverse probability and jitter |

Make `recipe.json` with a score and one mono or stereo slice up to 15 seconds
at 8–96 kHz. Both inputs accept relative WAV paths, WAV sample ranges, and
the same catalog sample, edit and print references used by the sampler.
Supply `library` relative to the recipe when using catalog or edit references.

```json
{
  "source": {"wav": "field.wav", "fromSample": 10800, "toSample": 28400},
  "score": "mix.wav",
  "settings": {
    "map": {"tempo": 108, "swing": 0.52},
    "range": {"from": {"beat": 16}, "to": {"beat": 24}},
    "seed": 508,
    "tonic": "D4",
    "raw": {"at": 0.75, "gainDb": -7},
    "lead": {"notes": [
      {"beat": 0.75, "duration": 0.5, "note": "D4", "velocity": 0.82},
      {"beat": 2, "duration": 0.75, "note": "F4", "velocity": 0.68},
      {"beat": 4.5, "duration": 1, "note": "A4", "velocity": 0.88}
    ]},
    "accent": {"hits": [
      {"beat": 0.75, "duration": 0.18, "play": {"tune": 200}},
      {"beat": 1.5, "duration": 0.12, "velocity": 0.45}
    ]},
    "texture": {"at": 1, "until": 7.75, "grains": {"semitones": -12, "density": 36}}
  }
}
```

The score range is half-open, up to 15 seconds, and accepts sample, second
and musical addresses from the mixer. Role placements and gates are beats
relative to the start of that range, following its tempo and swing changes.
Omit role settings for a first pass. The lead can use an authored MIDI root
or note name, a confident pitch estimate, or a reference pitch for an
unvoiced recording. The plan and report label the source of the root.

```sh
ink-studio music motif plan recipe.json --out draft.json
ink-studio music motif audition recipe.json comparison.json --out audition
```

The comparison file is optional. Set `roles` to choose playback order or
include the score-only control and `levels` to adjust playback.

```json
{"roles":["score","raw","lead","accent","texture"],"levels":{"targetRmsDb":-23,"gapSeconds":0.4}}
```

The audition writes a WAV, sample offsets for each comparison clip, and an
editable `plan.json`. Keep a role with a selection such as
`{"role":"lead","plan":"audition/plan.json","note":"The phrase answers the bass."}`.
An optional `sample` object supplies catalog metadata including ID, tags and
license. Edit a copy of the plan to compare an alternate performance.

```sh
ink-studio music motif keep recipe.json selection.json --out chosen
ink-studio music motif render chosen/project.json chosen/selection.json --out replay
ink-studio music samples kit chosen/library chosen/kit.json chosen/performance.json --out reuse
```

The kept project includes hash-checked copies of the recording and score,
the exact edit plan, a mix and role stem, and an ordinary sampler kit and
performance. Play the material with a new pattern, or rerender the role
through the original plan to revise its source shaping.

Use `KIT.procedural.mediaGraph.sampleMotif.plan(source, score, settings)`,
`render(plan, source, score, role)` and
`audition(plan, source, score, settings)` in JavaScript. The corresponding
graph nodes are `music.planSampleMotif`, `music.renderSampleMotif` and
`music.auditionSampleMotif`. Use `ink-studio graph describe <node> --example`
for a runnable graph.

To derive the lead's contour, accent timing and texture slice from the
recording, add `settings.derive`. See [Compose from a recorded
gesture](timbre-composition.md) for projection, palettes and full-cue
orchestration.
