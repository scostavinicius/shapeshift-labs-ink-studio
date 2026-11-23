# Persistent performers and adaptive phrases

Use these settings on an ordinary [adaptive production timeline](music-production.md#assemble-adaptive-transitions).
The adaptive score clock still decides when the scene changes. The timeline
renderer lets selected instruments continue across that change and chooses
the next phrase from the path taken and the phrases that have played.

## Keep a performer in the room

```json
{
  "performers": {
    "tracks": ["reed", "hull"],
    "roomSource": "shore",
    "endFade": 0.12
  }
}
```

Use a stable track name, patch and desk settings for each performer across
the sources where they play. A scene can omit the track or set its layer
level to zero to give it a rest. Already playing notes keep their performed
gates. Release, resonator and tape echo state continue on the same sample
clock. Each new phrase contributes its own attacks, including repeated
pitches if the score calls for them. Write the incoming phrase with space
where a held note should be heard on its own.

The persistent performers share one room from `roomSource`. By default
Ink takes it from the entry segment's source. Placement gain, layer levels
and fade-in shape newly admitted notes. The outgoing clip tail setting
continues to apply to the other tracks. Source cue-map level, room, EQ,
depth, tail, and hard-cut windows follow the selected phrase, as does its
gesture automation. A hard cut can still clear a performer and, when every
performer is cut, the shared room. A persistent ducking key should be another
persistent track so its performance is on the same sample clock.

Bridges, stingers, and common-tone overlays continue to play as their own
clips. The other section tracks use the existing clip renderer. The
`room` stem includes both room contributions. The `performers` report
lists each lane's note count and the gates still held at each transition.

For registered [CLAP instruments](clap-instruments-and-handoff.md), the
timeline submits one continuous job per persistent track, including the
original note-off times. The host uses native volume expression for
placement gain and fades where needed. Pass `--clap-host manifest.json`
on `music production timeline` or `music rehearsal run`. In JavaScript pass the host as the sixth argument to
`KIT.music.production.renderTimeline`. Optional `performers.tempoMap`
sets the continuous instrument transport and beat-authored plug-in
automation. It defaults to the entry source's clock.

## Choose what plays next

```json
{
  "phrasing": {
    "listen": {"tunnel": ["reed"], "observatory": ["reed"]},
    "routes": {
      "observatory": [
        {
          "id": "recall",
          "source": "familiar",
          "when": {
            "via": ["shore", "tunnel"],
            "rule": "service-door",
            "heard": [{"phrase": "tunnel", "min": 1}]
          }
        },
        {
          "id": "greeting",
          "source": "opening-call",
          "when": {"heard": [{"phrase": "greeting", "max": 0}]}
        },
        {
          "id": "answer",
          "source": "wide-answer",
          "when": {"heard": [{"phrase": "greeting", "min": 1}]}
        }
      ]
    }
  }
}
```

- Each choice has a stable phrase ID and a source on the destination's
  score grid. IDs for the base phrases are the segment names. Each
  alternative ID is unique across the timeline.
- Ink tries choices in order on entry and at each complete repeat. Use
  `via` for the suffix of the route before the current scene and `rule`
  for the transition that entered it. An empty `when` is a catch-all.
  The segment source, or its existing thematic alternative, is the fallback.
- `heard` tests completed phrase plays. A phrase counts once its full
  segment window has elapsed and an unmuted listening track had a sounding
  attack. `listen` lets you name those tracks, and defaults to all score
  tracks. Phrase completion is determined from performed events and
  authored levels before downstream world ducking. A skipped exit,
  interrupted phrase, or muted listening track can't establish that memory.
- The `phrasing` report records completed plays and the evidence for
  each decision, including its previous scenes, rule and relevant counts.

The same settings work for the CLI timeline, the `music.renderTransitions`
graph node, and native world soundtrack replays. A trimmed render
replays performer state and phrase history from the start of the score
before returning the requested samples.

## Rehearse the join

Use [adaptive rehearsal](music-adaptive-rehearsal.md) to compare the same
route with a different set of persistent tracks or choices. A rehearsal
revision can replace either `performers` or `phrasing`. Setting the
field to `null` removes it for that comparison. The report includes
the held gates at the join and the phrase decisions for each trace.

[Signal Observatory](../examples/music-production/persistent-performers.cjs)
builds three world recordings with different routes and dwell times. It
renders a baseline and a continuous performance of the same transition,
then shows how the same observatory can recall, introduce or answer a phrase.

```sh
node examples/music-production/persistent-performers.cjs observatory
ink-studio music production timeline observatory/project/waited.json --out playback
```
