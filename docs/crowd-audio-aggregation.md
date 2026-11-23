# Crowd and debris sound aggregation

Use the spatial voice budget to keep distant crowd footsteps and small impacts
audible as a directional texture when the mix runs out of individual voices.

```json
{
  "voiceBudget": {
    "maxVoices": 12,
    "reservedVoices": 2,
    "groups": { "crowd": 4, "debris": 3 },
    "aggregation": {
      "groups": ["crowd", "debris"],
      "sectors": 4,
      "maxPriority": -10,
      "grain": 0.125,
      "gain": 0.72,
      "bus": "foley"
    }
  }
}
```

Set `aggregation.groups` to the cue groups to combine. Assign each cue in
those groups a priority at or below `maxPriority`. Eligible sounds are
positioned, unprotected one-shots with up to half a second of combined
propagation and cue delay. Ink keeps music, dialogue, unpositioned cues,
sustained sources, and protected or higher-priority cues in the ordinary
allocator.

Under pressure, Ink reserves up to `sectors` slots **inside** `maxVoices` and
mixes eligible rejected cues into those streams. Each cue contributes a short
segment from its own audio, with its onset, gain, playback rate, and acoustic
low-pass carried into the mix. A two-sector setup covers world left and right
along X. Three or more sectors divide the horizontal compass, with one
centered along negative Z. The mix pans each sector relative to the listener
and uses the scene's pinned binaural profile and room response when enabled.
An individually admitted cue keeps its full spatial processing. Foreground
winners can reclaim the slots from texture tails.

| Option | Default | Values |
| --- | --- | --- |
| `groups` | Required | 1–32 distinct cue group names |
| `sectors` | 4 | 1–8, subject to available slots |
| `maxPriority` | 0 | Integer from −100 to 0 |
| `grain` | 0.125 | Maximum source segment length in seconds, 0.025–0.3 |
| `gain` | 0.72 | Texture level, 0–1. Zero disables aggregation |
| `bus` | `effects` | `effects`, `foley`, or `ambience` |

Live Web Audio uses an AudioWorklet on a secure origin and targets a 50 ms
scheduling lead for the sector audio. The offline soundtrack places accepted
grains on the scene sample grid. `player.inspectVoices()` reports the current
sector slots and aggregated cues. Offline voice budget reports include peak
direct and texture slots, the number of streams rendered, and a sector index
for each recorded `aggregated` decision.

Run `node examples/crowd-audio/demo.cjs <output-directory>` and open the
generated `index.html`. Hear the same station scene with both allocation modes
under a five-voice cap.
