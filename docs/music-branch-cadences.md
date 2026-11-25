# Branch-aware cadence selection

Add `cadences` to an edge in a [live adaptive score](music-live-adaptive.md)
to choose among authored endings as the player requests an exit. Each
variant plays a named production segment once. Use short pickups for
quick departures, turnarounds for the middle of the phrase, and full
resolutions after the section has had time to develop.

```json
{
  "from": "ferry",
  "to": "harbor",
  "exit": {"beat": 3.5},
  "entry": {"beat": 0},
  "cadences": [
    {"id": "pickup", "segment": "harbor-pickup"},
    {"id": "turn", "segment": "harbor-turn",
     "when": {"phrase": "return-phrase", "phase": [0.45, 0.7], "minDwell": 2}},
    {"id": "full", "segment": "harbor-full",
     "when": {"phrase": "return-phrase", "phase": [0.08, 0.42], "minDwell": 2}}
  ]
}
```

Author up to eight variants on an edge with an explicit exit marker. The
cadence segment's `start` and `end` define how much lead time it needs.
Cadence clips overlay the outgoing cue, so arrange the endings with that
cue in mind. The edge can use `commonTone` alongside a cadence. Each edge
uses one of `cadences`, `bridge`, or `harmonicBridge` for its pickup.

| Optional condition | Meaning |
| --- | --- |
| `phase` | Beat progress through the current pass, from 0 to 1. The start is inclusive and the end is exclusive, with 1 including the end of the phrase. Defaults to the whole pass. |
| `minDwell` | Seconds spent in the outgoing section during this visit, up to 3600. Repeating the phrase keeps the dwell clock running. A new visit starts it again. |
| `phrase` | The active phrase ID from the outgoing segment's phrase routes, or the outgoing segment ID for its baseline phrase. |

At the effective request frame, Ink reads the active phrase and resolves
the next exit marker. It picks the longest eligible segment that fits
entirely before the landing. Ties use recipe order. A late arrival has
only the frames left at arrival. If no segment fits, the transition
lands at the same marker without a cadence. A reversal or superseding
request releases cadence notes already sounding and discards unplayed
notes.

`score.inspect().pending.cadence` shows a planned decision.
`join.carry.cadence` includes the chosen ID, playback and landing sample
frames, phase, dwell, and each candidate's exclusion reasons.
`started` means the clip was admitted. Its notes still follow the
standard live voice budget and layer controls. The trace retains
the original decision and any subsequent cancellation.

```sh
node examples/branch-cadences/demo.cjs night-ferry
ink-studio music live replay night-ferry/score.json night-ferry/route.json --out passage
```

Open `night-ferry/index.html` to send the ferry to either branch during
live playback. The recorded examples compare the pickup, turnaround,
full resolution, and a request that arrives too late. The replay command
uses the same causal renderer as `KIT.music.production.live.open`.
