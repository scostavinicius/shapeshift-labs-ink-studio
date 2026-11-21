# Character surface contact

An ordinary Ink Studio character can walk on a moving deck, inherit its
momentum when leaving, drift along a conveyor, slide on ice or a slope, and
rebound on landing. These responses use the character controller's support
queries and swept capsule. The scene still owns the platform's motion.

## Author surface responses

`KIT.world.characters.surfaces()` compiles a catalog keyed by support ID or
material ID. A support-specific entry takes precedence over a material entry.
Use an explicit `null` for a support that uses ordinary traction with zero drift
and no launch.

```js
const surfaceResponse = KIT.world.characters.surfaces({
  byMaterial: {
    ice: { traction: 0.08 },
    sand: { traction: 0.28, downhill: 0.75 }
  },
  bySupport: {
    conveyor: { drift: [1.6, 0, 0] },
    spring: { launch: { speed: 5.2, minImpact: 0.7 } }
  }
});
const frame = controller.step(actor, input, dt, { ...world, surfaceResponse });
```

| Setting | Behavior |
| --- | --- |
| `traction` | Scales grounded acceleration and braking. The default is 1. At 0, input and braking do not change the current walking speed. |
| `downhill` | Scales the component of gravity along a walkable support. The default is 0. The controller's existing slope limit decides which surfaces can support the character. |
| `drift` | Adds a world-space velocity in scene units per second, projected onto the contact plane. The default is zero. |
| `launch` | On landing, compare the incoming speed along the normal relative to the support with `minImpact` (0.5 by default). Launch speed is the greater of `speed` and impact speed times `restitution`. Both default to 0. Restitution ranges from 0 to 1. The default direction is the support normal. An explicit XYZ direction is normalized and must point away from the surface and above local ground. |

A custom `surfaceResponse(support)` can sample live fields at
`support.foot` or choose a profile from its `support`, `material`, and
`normal`. Use world-space directions with either fixed or local gravity.

A rebound produces a `surface-launch` event with its contact `point`,
`normal`, support and material IDs, relative impact speed, and outgoing
world velocity. Use it to bind squash, sound, or other [contact effects](contact-effects.md).
The character leaves the surface in air mode.

## Carry walking characters

A live world can implement `surfaceMotion(supportId)` and return a rigid
pose with `position` and optional `rotation` (a row-major 3×3 matrix).
The pose must use the same snapshot as the world's collision and
support queries. Give the support a stable ID. The controller stores the
grounded contact point in its local coordinates and sweeps the rider through
the resulting displacement once per world snapshot passed to `step`.
Walking within that snapshot updates the point for the next step.

Supply `velocity` and `angular` as world-space linear and angular
velocities to determine launch and departure momentum at the contact point.
When linear velocity is omitted, the controller can infer motion from two
consecutive supported poses. Grounded `actor.velocity` is the character's
own locomotion; air velocity includes inherited motion. Jumping or walking
off releases the support. The actor's JSON state retains the support anchor
and airborne momentum for checkpointing.

Implement `clearance(point, radius, excludeSupport)` so the carry sweep can
ignore the support while keeping the rest of the scene solid. The final pose
is checked with the support included. Watch for `surface-blocked` when a wall
or ceiling prevents the carry. If the support leaves no clear pose, the
controller returns the previous actor pose with `blocked: true`. The host can
then stop or roll back the platform movement. Use fixed, small pose steps
for turning carriers. Seated riders can use [boarding](boarding.md).

## Use with headless worlds

The declarative `characters` system accepts the same `surfaces` catalog and
an optional `surfaceBodies` field. Pair a mechanics body field with a support
trace that returns those body IDs and a clearance field that accepts
exclusions.

```json
{
  "kind": "characters",
  "config": {
    "gravity": "gravity/frame",
    "clearance": "rig/clearance",
    "support": "rig/ray",
    "surfaceBodies": "rig/bodies",
    "surfaces": { "bySupport": { "spring": { "launch": { "speed": 5.2 } } } },
    "characters": { "traveler": { "position": [0, 1, 0] } }
  }
}
```

`characters.fromQuery(query, options)` accepts `surfaceBodies` and
`surfaceResponse` for hosts using the same queries directly. Headless run
history includes `character-surface-launch` and `character-surface-blocked`.

Run `node examples/ferry-spring-traversal.js` to walk across a moving ferry,
jump with its momentum, and rebound off the dock spring.
