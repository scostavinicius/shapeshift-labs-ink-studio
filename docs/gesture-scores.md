# Generalized gesture scores

A gesture score drives named scalar and XYZ controls on one integer
clock. Use it to coordinate a valve, a rig target, a force input, or any
solver port with the same type and physical quantity. A score is a
versioned JSON asset. The same asset can run through the library, CLI,
native worlds and simulation models, or the graph and take clocks.

```json
{
  "format": "ink-studio/gesture-score",
  "version": 1,
  "id": "shutter",
  "revision": 1,
  "rate": 240,
  "channels": {
    "opening": {
      "type": "number",
      "base": 0.08,
      "quantity": {"unit": "1", "kind": "opening-fraction"},
      "limits": {"min": 0, "max": 1, "maxSpeed": 2, "maxAcceleration": 12}
    },
    "aim": {"type": "vec3", "base": [0, 0, 0], "quantity": {"unit": "m", "frame": "rig"}}
  },
  "gestures": [
    {
      "id": "open",
      "channel": "opening",
      "start": 0.5,
      "end": 1.5,
      "leadIn": 0.3,
      "release": 0.4,
      "target": 0.9
    },
    {
      "id": "inspect",
      "start": 1.15,
      "end": 1.35,
      "leadIn": 0.1,
      "release": 0.15,
      "priority": 10,
      "targets": {"opening": 0, "aim": [0.3, 0.2, 0]}
    }
  ]
}
```

## Schedule and blend

Author `start` and `end` in seconds on the score clock. The lead-in rises
to full weight at `start`. The release begins at `end` and falls to zero
over its duration. Both default to zero seconds. Use `curve: "linear"`
for linear envelopes. The default `"smooth"` uses smoothstep. A lead-in
that starts before zero is already partway through its envelope at the
score origin. With no release, a gesture stops at its end boundary.

Choose `channel` and `target` for one channel, or `targets` for several
channels with the same timing and blend settings. A target can be a scalar,
an XYZ array, or `{keys: [{at, value}], interpolation: "linear"}`.
`at` is the fraction of the hold interval from 0 to 1. Supply strictly
increasing keys. The first and last values extend into the lead-in and
release. Set `interpolation: "step"` for deliberate changes inside the hold.

Evaluation starts at each channel's `base`. Tiers apply in ascending
`priority` (default 0). Within a tier, `"replace"` targets share a
normalized weighted mean. Their weights add up to the tier's coverage,
capped at one. After the replacements, `blend: "add"` adds weighted
offsets in the channel's units. A full-weight replacement at a higher
priority covers the lower tiers. A partial envelope blends through to
them. `weight` defaults to 1. Same-tier accumulation follows stable
gesture IDs.

## Limit motion and inspect results

The score reports the mixed `requested` value, the range-clamped
`target`, and the executed `value`. Each contributor includes the gesture
ID, blend mode, priority, target, effective weight, and current phase.
Range, speed, and acceleration flags identify which stages are active on
each channel or vector axis.

`min` and `max` restrict travel. `maxSpeed` is in channel units per
second. `maxAcceleration` requires `maxSpeed` and is in channel units
per second squared. Supply vector limits per axis or one number for the
same limit on all axes. A speed-limited channel begins at its base.
The player moves a waypoint at the speed limit and, when acceleration
is set, smooths the executed position toward it. The bounds apply to
finite differences between score ticks, up to floating-point precision.
A setpoint can still be in flight after a hold or release, so budget
lead-in time if an actuator must reach it by a deadline. Acceleration
smoothing approaches a settled setpoint gradually.

## Run and connect

```sh
ink-studio sim gesture-score shutter.json --t 1.2
ink-studio sim gesture-score shutter.json --from-tick 0 --to-tick 480 --every 10 --out trace.json
ink-studio sim gesture-score shutter.json --tick 240 --checkpoint shutter.checkpoint.json
ink-studio sim gesture-score shutter.json --resume shutter.checkpoint.json --tick 360
```

Timed queries select the last completed score tick. The trace includes the
end tick, even when the stride leaves a shorter last interval.

```js
const {KIT: K} = require('@shapeshift-labs/ink-studio').load();
const score = K.world.gestureScores.prepare(asset);
const player = score.open();
player.advance(288);
const frame = player.view();
const controls = player.values();
const resumed = score.open(JSON.parse(JSON.stringify(player.snapshot())));
resumed.advance(360);
```

Use `score.requested(seconds)` to inspect the blend at arbitrary seconds
before smoothing. Use `score.trace({fromTick, toTick, every, checkpoint})`
for the same sampled format as the CLI. The player advances forward from
zero or a compatible checkpoint. Reopen the score to seek backward or
restore an earlier checkpoint. The checkpoint pins the score revision,
content signature, tick, and limiter histories.

In a world, set a system to `{kind: "gesture-score", operatorRevision: 1,
config: {score: asset}}`. In a simulation model use the same kind and
`revision: 1`. Connect channels using the ordinary named outputs. The
provider advances the score's internal clock to the host time and
publishes at the host system's cadence. Quantity units and frames carry
to those outputs. Use `probe --field <system>/score` for execution detail.

Use the `sim.gesture-score` graph node with an inline score or a
`jsonAsset`. It returns the inspected frame as `value`, the named
controls as `outputs`, and a `checkpoint`. Use `data.get` to extract a
named control. By default it follows the graph or exact take frame
clock. Set `options.tick` to sample a specific score tick. An optional
checkpoint sets the earliest tick the node can visit.

Use [input compilers](input-compilers.md) to turn imported control
curves into named gesture-score channels.

Use [controllers](controllers-inverse-targets.md) when a gesture target
needs measured feedback or the receiving actuator has limits.

## Demos

```sh
node examples/gesture-scores/demo.cjs studio/out/gesture-scores
```

The demo drives an actual pipe valve, a vector nozzle target, and a
resonator's excitation envelope from one asset. One inspection gesture
commands a valve closure and reduces the chime force together. The board
and animation show the blend and the valve's motion-limited response.
