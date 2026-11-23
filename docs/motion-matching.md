# Motion matching for procedural foot rigs

Enable `motionMatching` on `K.gait` for an input-driven rig with two to eight feet. The gait indexes procedural entry poses when it is created. At liftoff or a steering change, it searches for an entry that fits the current stance, swing phase, and velocity as well as the requested velocity and heading. An active swing keeps its phase and remaining time. Its landing changes from its current world position and velocity while planted contact points stay fixed.

```js
const gait = K.gait({
  feet: [{ home: [-.22, 0] }, { home: [.22, 0] }],
  time: .29,
  reach: .235,
  lift: .245,
  ground: (x, z) => terrainHeight(x, z),
  motionMatching: { speeds: [0, .9, 1.8, 2.7] }
});

// Advance the controller first, then solve the legs toward feet[i].p.
const feet = gait.update(dt, {
  p: rootPosition,
  yaw: rootHeading,
  v: actualVelocity,
  intent: { v: requestedVelocity, yaw: requestedHeading }
});
```

The root position and foot targets are world XYZ. Velocities are world XZ, and yaw is in radians around +Y with +Z facing forward. Use the latest input for `intent` and the controller's actual velocity for `v`. If omitted, the gait uses actual velocity as intent and derives the intended heading from that vector. The host owns root movement, collision, leg IK, and foot orientation. Call at the rig's fixed update rate.

The indexed gait uses a single lifted foot. It returns the same `p`, `u`, and `lift` values and calls the same `lifted` and `planted` hooks as the basic gait. Aim the legs at these targets with `K.ik2` or your existing limb solver. If the foot is close to contact when the input changes, it completes the step and the next step uses the latest intent.

- Use `motionMatching: true` for the default index. The options `speeds`, `headings`, and `phaseSamples` set its sampling. Heading entries are degrees of change relative to the body, with 30-degree increments by default. Provide speed bands starting at zero and spanning the rig's normal speeds.
- `intentAngle` and `intentSpeed` set the thresholds for a mid-swing search. They default to 24 degrees and 0.45 world units per second.
- `gait.match` reports the chosen foot, entry phase, heading change in radians, selection score, and world-space entry and landing. `gait.index.size` reports the number of poses.
- `K.motionMatching.bake(options)` exposes the same index for tools. Its `search` takes `phase`, body-relative XYZ `feet` offsets above the support, the `eligible` foot indices, body-relative XZ `velocity` and `goal`, and the intended relative `heading` in radians. It returns the selected row's local XZ landing and score.

## Switchback Courier

Build the development bundle and serve the repository to play the [live comparison](../examples/motion-matching/index.html).

```sh
npm run build -- development
python3 -m http.server 8080
```

Scrub the replay or steer both procedural splat rigs with the arrow keys. Each rig receives the same root position, velocity, and heading. Foot guides show planted contacts and each active landing target. The turn readout measures how far the first foot that was in the air at the turn landed along the new input direction.

Render the same [scene](../examples/motion-matching/scene.js) headless.

```sh
node cli/ink-studio.js render examples/motion-matching/scene.js --t 2.58 \
  --w 236 --h 168 --px 1 --ortho --raw --out switchback.png
```
