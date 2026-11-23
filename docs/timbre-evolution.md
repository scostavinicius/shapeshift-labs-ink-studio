# Evolving orchestration

Give the attack, body and decay of one recording to playable production
tracks. Ink maps the source trajectory into a placement and crossfades
the players on the production clock. Each part receives ordinary editable
[notes and expression curves](music-instrument-performance.md).

```sh
ink-studio music timbre evolve recipe.json --out handoff
ink-studio music production render handoff/production.json --out reprint
```

The recipe accepts a WAV, WAV slice, sample library take, edit or print.
Use a named production recipe or an inline production. Keep the
handoff parts available in the production, with the patches you want
them to play. Generated clips layer over existing notes. A percussion
track can take the attack using an additive note clip.

```json
{
  "source": "breathy-call.wav",
  "production": "score.json",
  "analysis": {"id": "call", "pitch": {"lowHz": 150, "highHz": 1200}},
  "settings": {
    "id": "call-handoff",
    "tonic": "A4",
    "handoffs": {"bodySample": 3900, "decaySample": 18900, "overlap": [0.15, 0.21]},
    "placements": [
      {"id": "question", "section": "opening", "beat": 0.5, "length": 2.75},
      {"id": "reply", "section": "return", "beat": 1, "length": 3.5, "transpose": -5}
    ],
    "routes": {
      "attack": {"part": "metal", "carry": {"pitch": 1, "roughness": 0, "envelope": 1}},
      "body": {"part": "reed", "carry": {"pitch": 1, "roughness": 0.2, "envelope": 1}},
      "decay": {
        "part": "air",
        "carry": {"pitch": 0, "roughness": 1, "envelope": 1},
        "pitchAnchor": "entry",
        "roughnessTarget": "breath",
        "levelDb": -2
      }
    }
  },
  "options": {"sampleRate": 32000}
}
```

`bodySample` and `decaySample` refer to sample indices within the loaded
slice. Both can be inferred from the measured attack and tail. Each
`overlap` is the full width around its marker, as a fraction of the
placement's elapsed time. The two fade windows must fit inside the sound
and stay disjoint. The default `equal-power` curve shares power at the
handoff. Choose `linear` for a linear amplitude blend. A zero-width
handoff uses a short outgoing de-click fade. The gain curves reach zero
at outgoing handoffs even if the patch has its own release.

The placement range is expressed in beats. Inside that range, the
source advances in elapsed seconds, including through tempo changes.
A route can choose any existing playable part, including one used
by another phase. Placements on a shared track follow the normal
additive clip overlap rules. Existing score and performance processing
continues to apply, including groove offsets, patch attack compensation
and cue cuts. Set `options.stems` to write isolated track WAVs alongside
the mix.

| Transfer | Meaning |
| --- | --- |
| `pitch` | Scales measured pitch motion toward the tonic or the stage's entry pitch. Use the same full transfer and transpose across stages to follow one trajectory. Set strength to zero with `pitchAnchor: "entry"` to hold the pitch at the start of that stage's overlap. Unvoiced sources use the tonic and still provide the other trajectories. |
| `roughness` | Transfers a broadband texture estimate from spectral flatness and voiced confidence. The default adds rapid level fluctuations to a voice. Route it to `breath`, `damping`, `contact` or `pressure` when a patch has an expressive response to that control. |
| `envelope` | Retains the measured level shape at strength 1, including the decay. At strength 0, the patch keeps its native dynamics under the crossfade. |

All three transfers default to full strength. Pitch and note ranges
are bounded by the production engine. The placement report identifies
notes whose pitch trajectory needed clamping. The measurement stores
pitch and texture estimates, which can differ from how a listener
hears the source. The time-varying target borrows the idea of
describing orchestration as a sequence of timbral states.
[Orchidea research](https://www.tandfonline.com/doi/full/10.1080/09298215.2022.2150650)

In the graph, connect `music.measureTimbreEvolution` to
`music.planTimbreEvolution` and pass the planned production to
`music.renderProduction` with its assets. The planner also returns an
ordinary production revision and a report with note IDs, source
markers and beat-addressed handoffs. Use the same profile with
several routes to audition alternatives. JavaScript exposes
`KIT.procedural.mediaGraph.timbreEvolution.analyze` and `plan`.
