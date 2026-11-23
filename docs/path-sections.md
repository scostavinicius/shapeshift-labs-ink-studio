# Measure sections along a path

Use `KIT.procedural.pathSections.measure(options)` in the library or
`ink-studio sim sections <plan.json>` in the CLI. This gives ducts, nozzles,
throats, vents, and channels a common arc-length profile in authored world units.

## Choose the path and sampling

Supply a 3D polyline as `path`. The library also accepts a prepared
[arc-length route](route-followers.md) with `length` and `sample(t)`. Planes
are perpendicular to the tangent. Polylines use a transported up direction,
starting with `up: [0,1,0]` unless specified. At an exact interior polyline
corner the incoming segment defines the plane.

`samples` places 1 to 512 equally spaced planes at the centers of their spans.
It defaults to 32. Alternatively, supply explicit increasing `distances`,
including endpoints if needed. `range: [start, end]` restricts the arc under
measurement. With explicit distances, span boundaries fall halfway between
adjacent stations. The outer boundaries are the ends of the measured range.

## Choose a source

Each source describes the region whose dimensions you want. For a pipe
interior, use the airflow volume or a closed contour of the bore.

| Source | Library input | CLI input |
| --- | --- | --- |
| Triangle mesh | `{kind: 'mesh', mesh}`. Use Ink's indexed `pos/tri` layout or flat `positions` with optional `indices`. | Embed the same mesh as arrays or set `file` to a relative OBJ, glTF, or GLB file. The CLI uses the mesh's authored coordinates. |
| Signed-distance field | `{kind: 'sdf', field, bounds, cell, iso}`. `field` is a function of XYZ or an Ink sculpt exposing `sdf`. Negative relative to `iso` is inside. | Supply an inline Ink `sculpt`, a relative JSON sculpt `file`, or a trusted local JS/CJS module that exports a function of the Ink kit and returns the field or sculpt. |
| Matched contours | `{kind: 'contours', profiles}`. Each profile has `at` in normalized arc length and `loops` of local XY points. | Same JSON layout. |
| Paired channel banks | `{kind: 'contours', banks: {left, right, depth}}`. Each bank lists `[normalized arc, lateral offset]` from 0 to 1. | Same JSON layout. |

Mesh sections cut triangles directly and weld intersections using `epsilon`
(default `1e-7` world units). Cap triangulation contributes its perimeter
when a plane coincides with a mesh cap. SDF sections use marching squares
inside the supplied local-plane `bounds: {min: [u0,v0], max: [u1,v1]}`.
`cell` defaults to `0.04` and `iso` to zero. Use bounds that leave room
outside the region, and choose a cell size that resolves details you need.

For contour profiles, span normalized positions 0 to 1, or supply one constant
profile at 0. Match loop order, starting vertices, vertex count and traversal
direction across keys. Corresponding vertices interpolate between profiles.
Repeated closing vertices are optional. Nested loops alternate between filled
regions and holes based on containment. For banks, the sampler interpolates
their lateral offsets and measures a rectangular section of the supplied
depth centered vertically on the route.

## Read the report

Every row gives its world-space point, tangent and `u/v` frame, arc distance
and the following measurements.

| Measurement | Meaning |
| --- | --- |
| `area` | Filled section area with holes subtracted, in square world units. |
| `perimeter` | Length of the selected outer boundaries and hole boundaries. |
| `minimumOpening` | Minimum caliper width of the selected component's outer outline. For multiple components it is the smallest such width. |
| `centerClearance` | Diameter of the largest circle centered at the path station that fits in the region. Obstructions and holes count as walls. |
| `sectionLength` | Arc length covered by the row's `span`. All spans cover the measured range once. |

The default `selection: 'center'` measures the connected region containing the
path point. A point outside that region or on its boundary yields an empty
section. Use `selection: 'all'` for every disconnected region on the plane.
Set `contours: true` to include the planar loops, their component IDs, and
selection flags. Map a loop point `[u0, v0]` into world space with
`point + u0*u + v0*v`.

The report gives the minimum sampled area, opening, and center clearance with
their arc locations. Increase sampling around a suspected bottleneck using
`range` or add explicit distances. Empty stations return zero. Open or
ambiguous intersections and clipped or undefined SDF samples return null
dimensions. They set `complete: false` and are excluded from the minima.
`maxWork` controls the aggregate sampling and intersection-test budget.

## Run the duct demo

A small paired-bank plan can be measured immediately.

```sh
node cli/ink-studio.js sim sections examples/simulation-path-sections/channel.plan.json --out /tmp/channel.json
```

The curved duct demo measures the same 31 positions as a triangle mesh, an
analytic field, and matched authored contours. It writes a comparison board,
an animated sweep, portable plans and the full numerical reports.

```sh
node examples/simulation-path-sections/demo.cjs /tmp/ink-duct
node cli/ink-studio.js sim sections /tmp/ink-duct/duct-sdf.plan.json --out /tmp/duct-measurements.json
```

Use [branched domains](branched-domains.md) to join measured tubes at sockets and
retain their path and geometry provenance in a simulation model.
