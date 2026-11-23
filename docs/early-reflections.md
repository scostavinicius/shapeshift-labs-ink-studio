# Geometry-driven early reflections

Add `earlyReflections` to `KIT.world.spatialAudio.create(config)` or to the `spatial` block of a scene soundtrack. Ink mirrors the source across nearby planes and traces the path back from the listener. A path must hit the real wall, floor, or ceiling within its finite bounds. The path's extra length sets the delay and its last bounce sets the apparent source. The same tap plan feeds Web Audio and headless soundtrack renders.

```js
const planner = KIT.world.spatialAudio.create({
  cues: {
    strike: { asset: 'dry-strike.wav', bus: 'foley' }
  },
  earlyReflections: {
    room: {
      min: [0, 0, -4.8],
      max: [7.2, 4.7, 4.8],
      faces: {
        floor: 'concrete',
        west: 'brick',
        ceiling: false,
        east: false,
        north: false,
        south: false
      }
    },
    materials: {
      concrete: { gain: .71, cutoff: 6700 },
      brick: { gain: .94, cutoff: 4100 }
    },
    metersPerWorld: 1,
    speedOfSound: 343,
    order: 2,
    maxTaps: 6
  }
});
```

A room creates finite rectangular faces from its world XYZ bounds. West and east are min and max X. Floor and ceiling are min and max Y. North and south are min and max Z. An omitted face uses the default material. Set a face to `false` to leave that side open.

Use `panels: { id: { center, u, v, material } }` for independent walls, partial dividers, or angled surfaces. The perpendicular XYZ vectors `u` and `v` are the half-extents from the panel center. Panels can reflect sound from either side. A material's `gain` is an amplitude coefficient from zero to one and `cutoff` is its low-pass frequency in Hz. A gain of zero makes an absorbing panel that can still block reflected paths. The default material gain is .65 and its cutoff is 6500 Hz.

Ink checks each path segment against the configured panels and room faces. If the cue uses occlusion and the mixer has live `occlusion.rays` or `occlusion.segments`, those traces can also reject obstructed paths. Reflected gain includes the existing cue distance falloff at the longer path distance. The planner keeps the earliest paths above `minGain` and within `maxDelay`.

| Control | Default |
| --- | --- |
| `order` | Two bounces per path. Set to 1 for single bounces. |
| `maxTaps` | Six arrivals per cue. Accepts 1–8. |
| `maxDelay` | .09 seconds after the direct arrival. |
| `minGain` | .012 amplitude after material and distance attenuation, before the cue's source gain. |
| `gain` | .8 applied once to each reflected path. |

Reflections are evaluated at onset for positioned one-shot cues. Set a cue's `earlyReflections` to `false` to bypass them. The direct cue keeps its original gain and timing. The taps follow the cue's bus and voice admission. Portal routes retain their existing transmission estimate. The local solver models specular reflections at a single sound speed. Loop acoustics, late reverberation, and diffraction use separate treatments.

Read `voice.reflections` to inspect bounce points, surface IDs, material names, world-unit distance, relative delay, gain, and cutoff. Story audio traces also report each reflected arrival sample. `KIT.world.earlyReflections.compile(settings).trace(source, listener)` exposes the geometry solver without an audio asset.

## The Loading Bay

```sh
node examples/early-reflections/demo.cjs output/loading-bay
```

Open `output/loading-bay/index.html` to hear the same dry metal strike on an open floor, beside a wall, and under a ceiling. The diagram and waveform use the paths and samples from the saved soundtrack mix. The comparison WAV alternates open and walled takes before playing the covered bay.

The solver uses the [image-source principle described by Allen and Berkley](https://doi.org/10.1121/1.382599).
