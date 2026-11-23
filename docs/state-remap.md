# Transfer state across a grid or shape change

Use `KIT.world.stateRemap` in the library or
`ink-studio sim remap <plan.json>` to map cell state from one
[compiled discretization](discretization.md) to another. The method treats
each source cell's density as piecewise constant and integrates it over
each physical overlap. It preserves totals under a resolution change that
covers the same region. When a boundary moves, the report accounts for
every channel leaving removed space or entering newly opened space.

## Prepare the geometry

The source and target must have matching length units and dimensions.
Use coplanar XY or XZ grids in 2D. In 3D, use regular grids, sparse grids,
convex cut cells, or tetrahedral meshes in a shared coordinate system.
The method uses the compiled cell faces to intersect 3D volumes and the
physical cell extents to intersect planar grids.

A version 1 plan has format `ink-studio/state-remap-plan`. Its `source`
and `target` can be small embedded discretizations or relative references
to authored plans or compiled JSON. For example, a source with two cells
could specify the following channels.

```json
{
  "format": "ink-studio/state-remap-plan",
  "version": 1,
  "source": "before.compiled.json",
  "target": "after.compiled.json",
  "channels": {
    "mass": { "units": "kg", "values": [12, 8], "initializeDensity": 980 },
    "heat": { "units": "J", "values": [50021, 31990], "initializeDensity": 0 }
  },
  "options": { "details": true }
}
```

`values` contains extensive amounts in source cell order. Supply heat energy
in joules and mass in kilograms. To remap a temperature, convert it to
heat using the source mass, heat capacity and reference temperature.
After remapping, recover the temperature using the target mass. Channels
may be signed, for example when storing heat relative to a reference.

`initializeDensity` is an amount per square unit in 2D or per cubic unit in
3D. It defaults to zero and applies only to newly covered target measure.
Specify one uniform value or an array in target cell order. Values in removed
source space leave the active domain and appear in the ledger as escaped.
A closed-system model can use that ledger to credit a separate reservoir.

## Use the transfer and report

```js
const {stateRemap} = KIT.world;
const mapping = stateRemap.prepare(before, after);
const result = mapping.transfer({
  mass: {units: 'kg', values: mass},
  heat: {units: 'J', values: heat, initializeDensity: ambientHeatDensity}
}, {details: true});
```

Reuse a prepared mapping for different channels or snapshots on the same
geometry. The output `channels` contains extensive target values in
compiled target cell order and can serve as the source of the next remap.
Warm starts for a solver can use these values directly or convert them to
the intensive quantities it expects.

For each channel, `ledger` reports the input, amount moved into overlap,
amount escaped, amount initialized, output, and signed balance errors.
With `details: true`, it includes per-cell escape and initialization and
the covered measure of each source and target cell. `coverage.links` lists
the individual overlaps, addressed by source and target cell indices.
The main check is `input - escaped + initialized - output`.

`maxPairs` bounds broad-phase candidate pairs, including boxes that touch.
`tolerance` limits relative over-coverage accepted as roundoff. A geometric
overlap larger than that tolerance fails before transferring state. The
compiler scales minor over-coverage down and absorbs floating-point
remainders on fully covered cells. Signed numerical balance errors stay
visible in the report.

## Run the cut-cell tank demo

```sh
node examples/simulation-state-remap/demo.cjs /tmp/ink-remap
node cli/ink-studio.js sim remap /tmp/ink-remap/refine.plan.json --out /tmp/ink-refine.json
node cli/ink-studio.js sim remap /tmp/ink-remap/move.plan.json --out /tmp/ink-moving-wall.json
```

The demo refines a heated tank without a geometry change. Then it changes
the angle and position of the wall, removes part of the hot region, and
fills a newly opened wedge at the authored ambient density and heat content.
The plans, reports, and playback all use the same transfer.
