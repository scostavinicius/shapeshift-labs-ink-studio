# Carrying objects between places

`KIT.world.carry` tracks stable object IDs, place ownership, and exclusive grip
sockets. An item keeps its collider and JSON data as it moves between loose and
held states. The host supplies carrier poses, renders the posed bodies, and
integrates loose physics after a throw.

## Pick up, move, place, and throw

```js
const carry = KIT.world.carry.create({ items: [{
  id: 'oak-crate', place: 'court', pose: [0.5, 0.25, 1.4],
  collider: { kind: 'box', half: [0.25, 0.25, 0.25] },
  data: { contents: ['chisel'] }
}] });

const actor = {
  id: 'maker', position: [0, 1, 1], forward: [0, 0, -1],
  sockets: { hand: [0.5, -0.12, -0.62] }
};
const grip = carry.pickup({
  item: 'oak-crate', place: 'court', actor, socket: 'hand', reach: 2, world
});
```

Use an XYZ array for a pose with identity rotation or supply
`{position, rotation}` with a row-major rigid rotation matrix. A carrier's
explicit matrix takes precedence over `forward` and `up`. Sockets are local
to the actor and can be XYZ points or poses. Pass a synchronous
`socket(actor, name)` resolver to look up animated sockets in a rig. A pickup's
optional `grip` pose offsets the item from its socket for boots, handles, or the
corner of a large object.

`world.solids` accepts positioned box, capsule, convex, and compound bodies
with stable IDs. Use `KIT.world.carry.fromQuery(run.query(), {bodies: 'rig/bodies'})`
to read a mechanics snapshot. The registry includes its loose items from the
same place in collision checks, and substitutes the carrier's current socket
poses for its held items. Supply the posed bodies of other active carriers
when their cargo can obstruct a move.

| Method | Behavior |
| --- | --- |
| `pickup({item, place, actor, socket, world, grip?, reach?, via?})` | Checks reach, socket occupancy, and a clear path to the grip before assigning the item. A carrier can use up to 32 different sockets. |
| `move({place, from, to, world})` | Sweeps carried colliders through the proposed actor movement. Use the result alongside the character controller's own movement check. |
| `place({item, place, actor, pose, world, via?})` | Releases the item at a clear pose. Supply an authored candidate, such as a bench socket or a position found by a support query. |
| `throw({item, place, actor, velocity, angular?, world})` | Releases from the current grip. Adds the actor's current velocity to the requested throw velocity. Use the returned loose state as the input to physics. |
| `updateLoose(id, {pose?, velocity?, angular?, data?})` | Records a loose body's latest state from the host. |

Use `via` to specify intermediate pickup and placement poses. For example,
lift a crate above the bench, slide it across, then lower it onto the top.
The translation and rotation of each segment are checked. Failed checks
return a reason and an obstructing solid when available, with the current claim
still intact. `item(id)` and `itemsAt(place)` give immutable records.
`poses(place, actor)` resolves the current held bodies for rendering or for
another actor's collision queries.

## Cross a portal with the attached group

Pass the same registry to `KIT.world.portals.create({ places, links, carry })`.
Each destination can supply `carryWorld: { solids }` or a synchronous
`carryWorld(arrival, link)` on its prepared payload. This combines with the
existing `canArrive` check on the traveler. Walk and drop links check the
carried shapes against the opening along the crossing direction. Every link
checks the attached group at its destination pose. Rounded shapes use
conservative aperture bounds.

`session.checkArrival` reports proposed `cargo` bodies or a
`cargoBlocker`. The successful crossing returns the same posed bodies and
transfers every attachment to its new place before `onCross` runs. A blocked
crossing retains the original claims and place ownership. Preparation,
preview, and repeated arrival checks leave the registry untouched.

Portal checkpoints include the carry registry when supplied. Restore into a
new session with its own registry and load actor poses in the host. Place
payloads can realize their items from `carry.itemsAt(place)` after activation.
The registry can also be checkpointed and restored independently.

```sh
node examples/carry-workshop.js carry-workshop.png
```

The example carries an oak crate into a portable workshop, leaves it on a
bench, reloads, and picks up the same crate through a relocated entrance.
The optional PNG shows each stage from the actual simulation poses.
