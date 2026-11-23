# Position-dependent room impulse responses

Add `roomResponse` to `KIT.world.spatialAudio.create` or put it under `spatial` in a [scene soundtrack](scene-audio.md). Place probes at the listener positions where you measured or baked each room impulse. Reuse the soundtrack's named assets for mono or stereo impulse WAVs. With Web Audio, have the player’s existing asset resolver return decoded `AudioBuffer`s at the context's sample rate. Use wet-only responses with consistent levels across probes. Ink adds the direct sound separately and preserves the recorded gain of the impulses.

```json
{
  "roomResponse": {
    "wet": 0.45,
    "smoothing": 0.035,
    "rooms": {
      "vault": {
        "min": [-5, 0, -3],
        "max": [0, 4, 3],
        "probes": [
          { "at": [-3, 1.6, 0], "impulse": "vault-center" },
          { "at": [-1, 1.6, 0], "impulse": "vault-door" }
        ]
      },
      "booth": {
        "min": [0, 0, -2],
        "max": [5, 3, 2],
        "probes": [{ "at": [2, 1.6, 0], "impulse": "booth-center" }]
      }
    },
    "doorways": {
      "passage": {
        "from": "vault", "to": "booth", "axis": "x",
        "min": [-1, 0, -0.65], "max": [1, 2.4, 0.65]
      }
    }
  }
}
```

Room and doorway bounds are world-space boxes. Rooms can share a face or be separated by a gap. Place the doorway's entire lower face in `from` and its upper face in `to` along the chosen `x`, `y`, or `z` axis. The listener can cross in either direction. The blend takes effect inside the doorway box. Across its length, a smoothstep changes the share of each room. Inside each room, inverse-square distance weights the probes, with an exact match at the probe position. Outside every room and doorway, new audio's room send fades to zero.

The player and renderer smooth the input gains before convolution. `smoothing` is the exponential time constant in seconds. `0` applies the stationary weights at the next update. Each convolver keeps its history as the listener moves, including when a room stops receiving sound. Call the browser player's seek or reset methods for transport jumps that should clear that history. Headless exports replay the available earlier scene audio so a trimmed output can begin with a tail already in progress. Leave time within the export for the tail you want to hear.

Positioned voices, including their geometry-driven early taps, feed the room return. Unpositioned tracks and cues bypass it. The browser routes the return to `destinations.effects` when provided, otherwise to its default destination. Exports use the `spatial` stem, or the `effects` premix when scene post is enabled. Use `frame.roomResponse.sends` to inspect target gains or `render(sequence, {trace: true})` to inspect their sample stamps in `report.storyAudio.roomResponse`. The standalone planner is `KIT.world.roomResponse.compile(settings).sample(position)`.

A setup supports eight unique impulse assets, eight rooms with up to eight probes each, and sixteen doorways. Each mono or stereo impulse is bounded by eight seconds and 262,144 frames at the rendering rate. Use the same asset rate as the render or browser context when matching impulse levels between preview and export.

Generate the Service Passage comparison and its editable scene with `node examples/room-response/demo.cjs <output-directory>`.
