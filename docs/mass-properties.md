# Measure physical properties of assemblies

Measure an `ink-studio/mass-properties-plan` with
`KIT.world.massProperties.measure(plan)` or
`ink-studio sim mass-properties <plan.json>`. Each part can combine geometry
with a versioned physical material and an optional rigid pose. The JSON report
includes part and assembly measurements for model inputs and review.

## Choose geometry and material

A plan has schema `version: 1`, an `id`, a positive integer `revision`, and
a named `parts` table. Each part has a `source` and can choose a `material`
asset ID and `wetness` fraction. An optional `density` overrides that
material's resolved density in kg/m³. Supply `assetPacks` inline, pass an
existing `catalog` to the library, or install a pack with `--asset-pack`.

```json
{
  "format": "ink-studio/mass-properties-plan",
  "version": 1,
  "id": "sleeve",
  "revision": 1,
  "metersPerUnit": 1,
  "about": [0, 0, 0],
  "parts": {
    "bushing": {
      "source": { "kind": "cylinder", "radius": 0.063, "innerRadius": 0.054, "height": 0.08 },
      "material": "balance/brass",
      "probes": [{ "id": "wall", "from": [-0.1, 0, 0], "to": [0.1, 0, 0] }]
    }
  }
}
```

| Source | Measurements |
| --- | --- |
| `box`, `sphere`, `cylinder` | Analytic solid moments. Use box `half` extents, sphere `radius`, or cylinder `radius` and `height`. An optional `center` offsets the primitive. Cylinders run along local Y and accept `innerRadius` for a through-bore. |
| `mesh` | Signed volume and exact moments for a closed, consistently wound triangle mesh. Set `mesh` to Ink's indexed `pos/tri` layout or a model's `points/faces`. Faces may be triangles or convex polygons. Use `file` for a relative OBJ, glTF, or GLB in the CLI. |
| `sdf` | Integrates the closed surface extracted from the signed field. Use a function of XYZ or an Ink sculpt, a closed sampling `bounds` box and a `resolution` in world units. The CLI accepts a native JSON `sculpt`, a relative JSON sculpt file, or a trusted local JS/CJS field factory. |
| `discretization` | Integrates the exterior faces of a [compiled 3D discretization](discretization.md), including cut cells. Use an embedded `domain` or a relative compiled JSON `file` in the CLI. |

Closed meshes should have coherent winding and a non-self-intersecting
boundary. Winding on an internal void runs opposite to the exterior.
Coincident vertices are welded exactly by default. Use `weld: false`
to preserve separate vertex indices. A mesh with an unclosed boundary
reports area. Supply an authored `shellThickness` in world units to
integrate a uniform layer along each face's normal. That thin-shell model
uses area times thickness for volume and includes inertia through the layer.

A part can supply `pose: {translate, rotation}` with a world translation
and a right-handed, row-major 3×3 rotation. Probes are in world coordinates.
The assembly adds every component's measured volume and mass. Use disjoint
parts for a multi-material assembly or use a single carved solid for a void.

## Read and use the report

`metersPerUnit` declares the physical scale of the geometry, defaulting to
one. Volume, area, mass, inertia and thickness are in SI units. Centres and
pivot points remain world-space XYZ so they can bind into scene geometry.

Each part reports its measurement method, volume, surface area,
volume centroid, density, mass, centre of mass, and a full symmetric
row-major `inertia` tensor about its centre of mass. An optional plan
`about` gives an additional tensor about the chosen world point. Ink
combines assemblies using the measured masses and the parallel-axis theorem.
The assembly's area sums part areas, including surfaces at joins.
A missing density leaves that part's mass and mass-weighted values unknown.
The assembly lists such parts in `missingMass`.

Thickness probes report each intact material span crossed along a finite
segment, the total material length and the shortest measured span. A probe
reports `clipped` when an endpoint is inside the material, `miss` when it
passes through empty space, and `unavailable` when the input supplies a
surface alone. The part's `thickness` is the minimum of its complete probe
measurements and any authored shell thickness. SDF moments and thickness
use the extracted surface at the selected resolution.

A simulation model can store the report in `domain` and bind values with
`$model`, such as `{"$model":"/domain/mass"}`. The tensor and resolved
material profile are ordinary JSON inputs for a solver. A rigid-body model
can bind `mass` directly. A hinge model can use the component of
`about.tensor` along its axis.

## Run the balance bench

```sh
node cli/ink-studio.js sim mass-properties examples/simulation-mass-properties/balance.plan.json \
  --asset-pack examples/simulation-mass-properties/balance.pack.json --out /tmp/balance.json
node examples/simulation-mass-properties/demo.cjs /tmp/ink-balance
```

The demo combines a mesh arm, an analytic collar, and a ceramic casing
measured from a sculpt. It compares oak, brass, and brass with a wider bore.
Its spring hinge uses the measured mass, centre, pivot inertia, and the
oak arm's damping ratio. The output includes the three plans and reports,
a comparison board, and an animated release from level.
