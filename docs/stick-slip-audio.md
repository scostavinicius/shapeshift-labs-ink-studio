# Stick-slip contact synthesis

Add `stickSlip` inside a `contactLoops.interactions` rule to synthesize release pulses from the same readings used for drag, roll, and scrape audio. A heavy gate can build tension while loaded, release with a low knock, chatter during travel, and ring briefly as it grips again.

```json
{
  "contactLoops": {
    "interactions": {
      "drag": {
        "loadForFullGain": 420,
        "stickSlip": {
          "stiffness": 12000,
          "staticFriction": 0.92,
          "kineticFriction": 0.43,
          "roughness": 0.3,
          "minInterval": 0.014,
          "body": 162,
          "decay": 0.13,
          "hardness": 0.82,
          "gain": 0.65
        }
      }
    }
  }
}
```

This recipe generates its own mono audio. Add a `cue` to the interaction to layer an existing loop and use that cue's spatial routing, distance, and occlusion for the pulses. Each pulse keeps its own level and pitch. Generated pulses use the foley bus by default. A soundtrack with only generated sounds can use `"assets": {}`. Set `stickSlip: false` to audition the original loop alone.

Feed readings as contact fields, live snapshots, or `contact-start`, `contact-update`, and `contact-end` events. Use a stable contact ID, a source location, tangential slip `speed`, and a normal `load` in consistent units. For pulses, Ink can derive the normal load by projecting a supplied `force` onto its `normal`. A measured `friction` value or `surface.friction` updates kinetic friction while retaining the profile's static-to-kinetic gap. A configured material field can also supply the local coefficient.

Set `frictionState` to `"stick"` or `"slip"` when the host reports grip explicitly. A loaded transition into slip produces a breakaway pulse. Regripping after sliding produces a lower catch pulse. With speed and load alone, Ink infers release from accumulated travel and regrip from a stop. A contact that unloads or ends lets already emitted pulses decay.

| Control | Effect |
| --- | --- |
| `stiffness` | Converts elastic travel into shear force. Higher values need less travel to reach release. Default 22000. |
| `staticFriction`, `kineticFriction`, `slipScale` | Set the force threshold, residual force, and low-speed friction transition. Defaults 0.84, 0.42, and 0.14. |
| `roughness`, `minInterval` | Add seeded variation and cap regular pulse density. Defaults 0.22 and 0.014 seconds. |
| `body`, `decay`, `hardness` | Set the modal body frequency in Hz, decay in seconds, and high-frequency excitation. Defaults 230, 0.10, and 0.65. |
| `gain`, `loadForFullGain` | Scale the generated energy against a reference normal load. Default pulse gain 0.55. |

Each release uses the stored elastic energy lost between static and kinetic friction. Higher pressure generally builds a stronger pulse and requires more travel between releases. Between observations the planner uses the last reading and resolves the threshold crossings at their fractional times. This is an audio model driven by contact telemetry, following the same idea of friction exciting modal bodies. [Avanzini, Serafin, and Rocchesso](https://air.unimi.it/handle/2434/653903)

Browser playback adds a 40 ms monitoring buffer to preserve sub-frame spacing from normal simulation updates. WAV export uses the original release time. Inspect `frame.cues[].stickSlip` for pressure, slip speed, and energy, or render a traced soundtrack and inspect `report.storyAudio.stickSlip` for release and arrival samples. Replaying the contact readings from the beginning reconstructs the same pulse train and preserves the ringing in a cropped export.

Generate the Iron Gate demo and editable contact trace with `node examples/stick-slip/demo.cjs <output-directory> <Chrome executable>`.
