# On-the-fly harmonic bridges

Add a harmonic bridge to an edge in a [live adaptive score](music-live-adaptive.md).
Ink listens to the pitched instrument voices active on the sample clock and
plays a short pickup into the harmony at the destination's entry marker. If a
note belongs to the destination chord and is still held at the join, its
original voice can keep playing across the boundary.

```json
{
  "from": "outpost",
  "to": "station",
  "exit": { "beat": 3 },
  "entry": { "beat": 0 },
  "harmonicBridge": {
    "track": "reed",
    "lead": 0.32,
    "steps": 2,
    "range": [55, 78],
    "velocity": 0.55
  }
}
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `track` | Required | Pitched production part in the destination and each of its phrase alternatives |
| `lead` | 0.28 | Pickup time in seconds, from 0.08 to 0.8 |
| `steps` | 2 | Maximum notes in the pickup, from 1 to 3 |
| `range` | `[48, 84]` | Inclusive playable MIDI pitch range |
| `velocity` | 0.48 | Pickup note velocity, from 0.05 to 1 |

The pickup favors small moves from pitches already sounding into new chord
tones in the destination. Ink chooses those notes when the pickup can start,
using the voices that were admitted and heard. If the same chord tones are
already sounding, the pickup can be silent. Phrase routing selects the same
destination version for the pickup and landing. The generated notes use the
destination part's native patch and get spare voice slots.

An explicit exit stays fixed. Late requests get a shorter pickup if enough
time remains, and requests inside the last 45 ms can land without one. An
edge without an exit allows the configured lead on the output clock. A
superseded pickup releases the notes already sounding and discards unplayed
notes. Use either a harmonic bridge or an authored bridge and common-tone
clip on a given edge.

At the landing, common tones are pitch classes. The original register,
instrument, phase, and expression remain audible. Ink can reuse an opening
attack when the same part, patch, and nearly identical tuned pitch is
already held. A supported sustaining instrument can extend its gate to
cover that opening note. Native FM, analog, keys, subtractive synths, and
gated samples can extend when their own note or sample ends permit it.
Graph instruments, one-shots, and recorded release articulations keep their
planned gate. Authored chokes still apply.

Use `live.open` in the app and `ink-studio music live replay` for a recorded
render of the same route. The static production timeline renderer uses
authored placements. Inspect `join.carry.harmonicBridge` for the source
pitches, generated pitches and admission results, carried notes, and gate
changes on the sample grid.

Run `node examples/harmonic-bridges/demo.cjs <output-directory>` and open
`index.html`. Trigger either destination during the live cue. The generated
WAVs compare the same recorded route with and without the bridges.
