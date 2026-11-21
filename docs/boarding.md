# Boarding and shared traversal

`KIT.world.boarding` is a headless primitive for boarding mounts, carts,
ferries, and other carriers. It owns exclusive seat occupancy. The host
supplies steering or vehicle motion and applies the returned poses to its
own actors and animation rigs. Actor identity and state such as inventory
stay with the host.

## Define carriers and seats

```js
const { boarding } = KIT.world;
const seats = boarding.create({ carriers: {
  ferry: {
    collider: { kind: 'box', half: [1.2, 0.3, 2] },
    seats: {
      bow: {
        at: [0, 1.15, -1],
        exits: [[1.65, -0.3, -1], [-1.65, -0.3, -1]],
        reach: 2.5, rise: 0.35, drop: 0.6
      }
    }
  }
} });
```

The hull accepts a Studio box, capsule, convex, or compound collider. Each
occupied seat adds an upright capsule. The hull parts and authored seats
share a limit of twelve collider parts per carrier. Use `at` for the seated
capsule's center and `exits` for candidate foot positions in priority order.
Both are in the carrier's local coordinates. Define the seat center so that
the rider's capsule fits above its support and clears the hull. Optional
`maxRadius` and `maxHeight` limit which bodies fit a particular seat.

A carrier pose has a world-space `position` and optional `yaw` in radians.
The primitive supports Y-up motion, including vertical translation and turns
about Y. A rider supplies an `id`, capsule-center `position`, `radius` and
overall `height` in world units. Carrier and actor IDs should match the IDs
or entity names used by the host's collision geometry.

## Board, move, and dismount

Use a fresh [mechanics](headless-worlds.md#built-in-systems) query when the
world's colliders or supports change.

```js
const world = boarding.fromQuery(run.query(), { bodies: 'rig/bodies', support: 'rig/support' });
const boarded = seats.board({ carrier: 'ferry', seat: 'bow', actor, pose, world });
if (boarded.status === 'boarded') actor = { ...actor, ...boarded.pose };

const movement = seats.move({ carrier: 'ferry', from: pose, to: proposedPose, world });
pose = movement.pose;
for (const { rider, pose: passengerPose } of movement.occupants) applyPose(rider, passengerPose);

const exit = seats.dismount({ rider: actor.id, pose, world });
if (exit.status === 'dismounted') actor = { ...actor, ...exit.pose };
```

A custom world can supply `solids` and `supports(x, z, low, high)`.
`solids` contains nearby collider records with an `id`, `position`, optional
rotation matrix, and a `collider` or box `half` extents. Include scene walls,
rails, ceilings, and any other actors that can obstruct travel. For a
proposal, the primitive substitutes the current hull and its seated capsules
for geometry reported under their IDs. `supports` returns column hits with
`y`, `normal`, and optional `id` and `material`.
`allowSupport(hit, { rider, point })` can reject unsafe landings, such as a
submerged dock.

- `board` checks reach, free capacity, full capsule fit, and a swept
  transfer path before reserving the seat.
- `move` sweeps the full occupied hull along the proposed translation and
  shortest yaw turn. A block returns the original pose and the obstacle,
  impact fraction, and rider ID when a rider caused it. Turns use a bounded
  conservative sweep and may stop early near contact. A host can try a
  shorter step or a different route.
- `dismount` tries the authored exits with the configured rise and drop
  limits. An exit needs supported footing, room for the full rider, and a
  clear transfer. A failed dismount keeps the rider seated.
- `poses(carrier, pose)` gives the seated positions for rigs or cameras.
  `body(carrier, pose)` gives the posed collider for another system's queries.
  `release(rider)` clears occupancy when the host removes a rider and
  leaves placement to the host.

`checkpoint()` records occupancy and rider dimensions as JSON.
`restore(checkpoint)` checks the entire set of claims before replacing it.
Save the host's carrier and actor poses alongside this checkpoint.

## Compare a ride with walking

`plan` takes an actor, a goal, a walking speed, a synchronous path function
`walk(from, to)`, and up to 32 offers. Supply a walk result with
`{ status: 'ok', points, length? }` for reachable legs. Each offer has an
`id`, `carrier`, `seat`, `boardAt` and `leaveAt` walking endpoints, and
`rideSeconds` from the host's carrier route or schedule. Use `null` for an
unavailable ride. Optional `waitSeconds`, `boardSeconds`, and
`leaveSeconds` account for the transfer. An offer needs an available seat
and reachable walking legs on both sides. When direct walking is possible,
the ride must beat it by at least `minimumSavings`, which defaults to
0.25 seconds.

The result exposes the selected `choice`, alternatives with their times,
and rejected offers with reasons. Feed its walking legs to an existing
mover and use the same `board`, `move`, and `dismount` calls to execute it
against the current world. Planning reserves no seats.

Run `node examples/boarding-traversal.js` to choose a cart ride, detect a
beam that blocks its passenger, take a detour, and dismount on supported ground.
