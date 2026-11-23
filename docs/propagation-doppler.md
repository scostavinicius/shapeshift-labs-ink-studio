# Per-source propagation delay and Doppler

Use `propagation` on a positioned cue or continuous emitter for sound that travels before it arrives. In a train pass, the horn reaches the listener after the visible flash. During the pass, the train and listener velocities change the received pitch. Ink uses the subsonic sound Doppler model with separate source and listener velocities. [OpenStax Doppler effect](https://openstax.org/books/university-physics-volume-1/pages/17-7-the-doppler-effect)

```json
{
  "propagation": { "metersPerWorld": 1, "speedOfSound": 343 },
  "cues": {
    "horn": {
      "asset": "train-horn",
      "at": { "entity": "train", "socket": "horn" },
      "propagation": { "delayScale": 1, "dopplerScale": 1 }
    },
    "motor": { "asset": "train-motor", "at": { "entity": "train" } }
  },
  "emitters": {
    "train": {
      "cue": "motor",
      "propagation": { "delayScale": 1, "dopplerScale": 1.5, "maxShiftCents": 900 }
    }
  }
}
```

Put this inside the soundtrack's `spatial` block or pass it to `KIT.world.spatialAudio.create`. The top-level medium specifies meters per world unit and meters per second. Defaults are 1 and 343. A cue or emitter with `propagation: {}` enables the physical defaults. Emitters inherit their cue's setting and can override it with an object or `false`.

| Source setting | Result |
| --- | --- |
| `delayScale` | Multiplies the travel time. Default 1. Set 0 for an immediate arrival. Range 0–4. |
| `dopplerScale` | Multiplies the pitch shift in cents. Default 1. Set 0 for the original pitch. Range 0–4. |
| `maxDelay` | Caps the delay after scaling. Default 8 seconds. Range 0–30 seconds. |
| `maxShiftCents` | Caps the shift above and below the original pitch. Default 1200 cents. Range 0–2400 cents. |

Direct cues schedule their first arrival from the emission position and the listener's motion. An acoustic route supplies its own travel time through rooms and media. Doppler uses the first and last directions of that route. The existing `propagationDelay: true` option continues to apply routed delay to the rest of the scene.

Looping world emitters keep one transport clock as the pitch changes. A continuous direct source estimates its earlier position from the current velocity, which places the heard source behind the displayed source during a fast pass. The planner integrates the rate over observed frames and preserves phase through voice admission and export crops. Replaying the preceding frames gives a seek the same motion history. A fresh seek estimates the initial phase from the available pose. Authored one-shots keep their emission pitch for the length of the take. Timeline clips with editorial durations and procedural contact loops keep their authored clocks.

Rigid bodies supply linear and socket velocities. Pose-only hosts estimate motion between adjacent frames that sample the same source or listener. Feed a stable listener and committed poses to `frame()`. Use a fresh playback state for a discontinuous seek. The solver uses local constant-velocity segments and bounds velocities below the sound speed. This models subsonic sources along sampled paths.

Inspect `voice.propagation` for current travel time, scaled delay, the rate multiplier, and pitch shift. A continuous voice also reports its first arrival. The story audio trace includes one-shot propagation alongside the emission and arrival samples.

Generate the Milepost 72 demo and its scene files with `node examples/propagation-doppler/demo.cjs <output-directory> <Chrome executable>`.
