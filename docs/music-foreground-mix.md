# Mix around the foreground

Mark whose gesture owns each moment. Ink checks the rendered stems for
competition, proposes several production edits, and plays all of them
against the same passage. The foreground map is saved in the production
and can be reused as the arrangement changes.

```sh
ink-studio music critique foreground cue.json foreground.json --out audition
ink-studio music critique apply audition/production.json audition/comparison/comparison.json decision.json --out kept
```

```json
{
  "sampleRate": 32000,
  "target": -19,
  "moments": [
    {"id":"pickup","label":"Reed call","from":8,"to":10.25,"parts":["reed"],"protect":["bass","kick"]},
    {"id":"reply","label":"Glass answer","from":10.25,"to":12.5,"parts":["keys"],"protect":["bass","kick"]}
  ],
  "context": {"beforeBeats":1,"afterBeats":1},
  "move": {"rideDb":-4,"tailSeconds":0.08,"depthHz":1250,"depthSend":0.48}
}
```

Moments are disjoint windows on the production beat clock. Name one or
more simultaneous `parts` and optionally `protect` other tracks such as
the pulse or low end. Production pins also protect tracks. Omit
`moments` to use a saved `cueMap.foreground`, and use `select` to audition
one to eight moment IDs with up to thirty seconds of shared context.
Author the whole map, then select neighboring moments to hear the handoff.

For each moment, Ink measures simultaneous band energy around each
foreground part. It proposes moves for the strongest eligible competitor
and records the track, band and beat range that led to that choice. The
`minOverlap` threshold controls how much matching acoustic energy is needed.
Quiet passages can produce a reference-only audition. The metering gives
listening clues for the authored foreground and leaves preference to the
listener.

| Take | What changes |
| --- | --- |
| `ride` | Fades down the competing track during each moment. |
| `short-tail` | Caps a voice after note-off, including releases that are already ringing when the moment begins. Attacks and held notes keep their performance. Existing shared room and echo still decay. |
| `depth` | Darkens the competing source and adjusts its shared room send with an edge fade. Both values are editable. |
| `arrangement-cut` | Withholds the competing attacks and ends gates at the entrance. Released voices and effects continue to ring. |

Each take follows the foreground from moment to moment. If a track
already has an overlapping window of the same kind, the planner reports
that conflict and skips that move at that location. Short-tail and
arrangement-cut are offered where the competing part has releases or
notes that the respective move can change.

Depth and tail limits are ordinary [cue-map lanes](music-cue-map.md).
The moves reflect common ways to make space for a foreground part,
including top-end filtering, wet/dry balance and changing the
arrangement. [Depth in a mix](https://www.soundonsound.com/techniques/creating-sense-depth-your-mix)

## Audition and keep

The output contains `production.json` with the saved foreground map,
`foreground.json` with evidence and the editable comparison request,
and a `comparison/` folder with aligned WAVs, a report and the key for
keeping a take. Auditions default to matched integrated loudness.
Use `level: "fixed"` to hear each move under the same playback gain.

Each take measures the raw foreground and rival stem power in every
selected moment, along with the shared room. The foreground-to-rival
reading combines the track energies. It can show changes in balance
even when the foreground has switched tracks.

Keep one of the auditioned takes with `critique apply` and a decision
containing `token`, `take` and `reason`. To combine moves across different
moments, copy the saved comparison request, copy the chosen edits into
one candidate for the corresponding ranges, and run
`music critique compare audition/production.json mixed-moves.json --out mixed`
before keeping the new choice.

Programmatically use `KIT.music.production.foregroundMix.plan` or
`foregroundMix.audition`. The graph nodes are `music.planForegroundMix`
and `music.auditionForegroundMix`. The latter provides the mapped
production, aligned audio and comparison key. Pass those with the
decision to `music.applyCritiqueEdit` to keep an editable production.
