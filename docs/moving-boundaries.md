# Measure a moving boundary

A `moving-boundaries` system measures a lift valve, compliant seal, diaphragm,
or other boundary with a moving surface registered to a planar seat. Connect
its measured opening to an existing pipe valve, ventilation opening, or
custom model. The geometry and telemetry use normal Ink world and simulation
model entry points. A [boundary set](boundary-conditions.md) can share
geometry and prescribed displacement with other solvers.

## Author a seat and moving patch

Give each entry in `config.boundaries` a triangulated planar seat and one
moving position per seat vertex. Seat triangles use zero-based indices.
Author the seat normal to point toward the open side.

```json
{
  "kind": "moving-boundaries",
  "config": {
    "boundaries": {
      "valve": {
        "seat": {
          "points": [[0,0,0], [1,0,0], [1,0,1], [0,0,1]],
          "triangles": [[0,2,1], [0,3,2]],
          "normal": [0,1,0]
        },
        "moving": [
          {"entity":"plug","socket":"a"},
          {"entity":"plug","socket":"b"},
          {"entity":"plug","socket":"c"},
          {"entity":"plug","socket":"d"}
        ],
        "mode": "curtain",
        "sealGap": 0
      }
    }
  }
}
```

Use XYZ points or world entity/socket selectors in the `moving` list. A
selector can include an `offset` in the entity's local frame. The world query
resolves each socket against its current provider pose, including mechanics
bodies. If the seat moves with an entity as well, add a
`seat.frame: {entity, socket}` selector and author seat geometry in that frame.

For a cloth patch, set `moving` to
`{field: "fabric/surfaces", shape: "diaphragm", nodes: [0,1,3,2]}`.
The list maps each seat vertex to its live deformable vertex. Seat triangles
must correspond to intact triangles of that cloth shape. A missing or torn
patch reports `unavailable`. Match the mapping to the cloth triangulation
and its rest pose.

Use this model where paired vertices track clearance along the seat normal.
Author `maxSlip` to reject a sample when lateral movement exceeds the
correspondence limit. For a rig driven outside the world runtime, prepare
the same spec with `KIT.world.movingBoundaries.prepare(spec)` and call
`evaluate(positions, {seatOrigin, seatRotation, reference})` with posed
vertices. `sample(query, reference)` uses a normal Ink world query.
Seat triangle interiors should be disjoint.

## Interpret the measurements

The default `curtain` mode integrates clearance along the exposed rim,
capped at seat area. It measures the flow passage around a lifted seal.
The `projected` mode measures the area of seat triangles with positive
clearance, useful for a patch progressively meeting its seat. The available
area uses a piecewise-linear gap within each triangle or rim edge.

A clearance is the measured signed distance along the seat normal minus
`sealGap`. The default zero clearance threshold preserves every positive
opening at the input's resolution. Set a positive `sealGap` to model an
authored gasket reach. A curtain is sealed when its whole rim has no
positive clearance. A projected patch is sealed when its whole seat has
no positive clearance. The seal produces exact zero aperture.

`pocketVolume` integrates positive geometric gap over the seat triangles,
before applying gasket reach. `displacedVolume` is reference pocket volume
minus the current pocket volume. Positive `volumeChange` means the boundary
moved inward since the previous sample. Set `referenceVolume` explicitly
or let the world system use the first available sample. Measurement alone
leaves the solver's volume ledger untouched. A receiving model can use the
volume change to drive its own boundary condition or conservative exchange.

Probe `<system>/boundaries` with `{boundary: "valve"}` to read the status,
seat area, projected open area, aperture, normalized opening, gap extrema,
maximum penetration, and volume values. Connect ordinary scalar outputs
`opening.<name>`, `aperture.<name>`, `min-gap.<name>`, `max-gap.<name>`,
`displaced-volume.<name>`, and `volume-change.<name>`. Length, area and volume
are in world units and their powers. Boolean `available.<name>` and
`sealed.<name>` distinguish an unavailable sample from a valid seal.
Unavailable samples publish zero on numeric ports. They carry a reason
in the probe and end the previous volume-delta interval.

World sampling uses the phase-start pose, including any pose updated by
a command before the phase. Geometry advanced by another solver is visible
on the next phase snapshot. The sampled value feeds downstream zero-delay
scalar connections in the current phase. Changes between valid open and
sealed samples emit `boundary-opened` and `boundary-sealed`. Checkpoints
retain the reference and previous measurement.

## Run the valve bench

```sh
node cli/ink-studio.js probe examples/simulation-moving-boundaries/bench.world.json \
  --ticks 64 --field gauge/boundaries --args '{"boundary":"seat"}'
node cli/ink-studio.js sim run examples/simulation-moving-boundaries/bench.world.json \
  --ticks 180 --record /tmp/ink-valve.run.json
node examples/simulation-moving-boundaries/demo.cjs /tmp/ink-valve
```

A mechanics slider drives a poppet valve through an open gap, a
quarter-millimetre clearance, a seal, and a reopening. The measured aperture
controls the native pipe solver. The demo writes an animated section view,
a measurement board, and the numerical trace.
