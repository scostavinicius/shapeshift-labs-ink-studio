# Compile cells and tagged boundary faces

Use `KIT.world.discretization.compile(plan)` or
`ink-studio sim discretize <plan.json>` to publish solver geometry as JSON.
A version 1 plan has format `ink-studio/discretization-plan`, an `id`, a
positive integer `revision`, and a `source`. Set `units` to the unit used
by the authored coordinates. It defaults to `world`.

```json
{
  "format": "ink-studio/discretization-plan",
  "version": 1,
  "id": "tank",
  "revision": 1,
  "units": "m",
  "source": { "kind": "grid", "size": [8, 4, 2], "spacing": [0.2, 0.25, 0.3] },
  "regions": [
    { "tag": "inlet", "side": "x0" },
    { "tag": "outlet", "side": "x1" }
  ]
}
```

## Choose the source

### Regular and sparse grids

Use `source.kind: "grid"` with two or three cell counts in `size`, per-axis
or scalar `spacing`, and optional `origin` at the low corner. Counts follow
X, Y, Z for a volume. A 2D grid defaults to the XY plane and accepts
`plane: "xz"` for terrain or fluid layouts. A three-component origin fixes
the elevation of a 2D grid. Conventional `width`, `height`, and `depth`
counts are accepted. Library callers can supply `source.grid` from
`KIT.cellular.domain.image()` or `volume()` with closed boundaries. Ink
carries that grid's active-cell mask into the compiled domain. A library
`mask({id, address, position})` can further select grid cells.

A named `blocks` table declares allocated portions of a regular lattice:
each block has a low-cell `index` and a cell-count `size`. Blocks share
the lattice spacing and must be disjoint. Faces connecting adjacent blocks
share a single face record. Cells beside unallocated addresses retain their
exposed faces. The compiler bounds work by candidate cells in the blocks.

A 3D grid accepts up to 24 convex `cutPlanes`. Each plane has an `id`,
a `normal`, an `offset`, and an optional boundary `tag`. Ink keeps world
points satisfying `dot(normal, point) <= offset`. It clips each cell by
the planes and calculates the resulting volume, volume centroid, and face
polygons. The tag defaults to the plane ID. A volume cell's `fraction` is
its retained share of the full lattice cell. Cuts that leave a fraction
at or below `1e-12` are discarded.

### Carrier charts

Use `source.kind: "charts"` with `charts: [{id, width, height, carrier}]`.
Library carriers use Ink's `sample([u,v])` API. The CLI accepts native
`plane` and `cylinder` carrier definitions. Each cell uses the four
sampled UV corners and an area-weighted centroid of their two triangles.
Face measures use chord lengths. Increase chart resolution to resolve
curvature more closely.

Use optional `seams: [{a: ["floor","u1"], b: ["wall","v0"], reverse: true}]`
to join chart boundaries. Seam sides need matching cell counts and
coincident physical edges within `tolerance`. Use a seam to connect the
matching sides of a cylindrical chart. On a crease, each neighboring cell
retains its own outward in-surface normal for the shared edge.

### Triangle and tetrahedron meshes

Use `source.kind: "mesh"` with Ink's `mesh: {pos, tri}` layout, flat XYZ
`positions` with triangle `indices`, or flat `positions` and
`tetrahedra` with four vertex indices per element. An unindexed triangle
soup is welded by exact vertex position by default. Indexed connectivity
is retained unless `weld: true` is supplied. The CLI can import a
relative OBJ, glTF, or GLB `file` in its authored coordinates.
Triangles describe a surface domain. Tetrahedra describe a volume domain.
A face with more than two incident cells fails compilation.

## Tag exposed faces

Give `regions` as an ordered array of rules with a `tag` and one or more
selectors. The first matching rule supplies the exposed face's tag.
Combine selectors to refine a rule.

| Selector | What it matches |
| --- | --- |
| `side` | Outer grid sides `x0/x1`, `y0/y1`, `z0/z1`, or chart sides `u0/u1`, `v0/v1`. |
| `chart` | The named chart. |
| `cut` | The named cut plane. |
| `kind` | A face of kind `outer`, `chart`, `cut`, `mesh`, or `inactive` beside an omitted cell. |
| `bounds` | Face centres in an inclusive world-space `{min,max}` box. |
| `vertices` | Mesh faces by original vertex indices, such as `[[0,1],[3,4]]` for surface edges. |

Without a matching rule, a cut uses its plane's tag and other exposed
faces use `defaultRegion` (default `wall`). Each compiled boundary
contains its face indices and summed measure. This lets a solver select
inlet, outlet, impermeable wall, or another condition by name.

## Consume the result

The `ink-studio/compiled-discretization` record is immutable and
JSON-ready. A simulation model can store it in `domain` and bind its
cells, faces, and regions into operator settings.

- Cells publish a stable address or element ID, world-space `center`,
  `measure`, and parallel `faces`, `neighbors`, and `signs` lists.
  Measure is area for a surface cell and volume for a 3D cell.
- Faces publish an indexed vertex loop or edge, world-space `center`,
  `area`, the `owner` and optional `neighbor`, and boundary `region`.
  Face area represents physical edge length on a surface domain.
- A face's `normal` points out of its owner. A positive cell sign selects
  that orientation. A negative sign selects `neighborNormal`, which is
  also published for glued or curved surfaces. `ownerDistance` and
  `neighborDistance` give the projected normal distances from each
  cell centre to the face.
- `layout` describes the lattice, sparse blocks, cuts, charts, or mesh
  weld policy. `measure` at the top level is the sum over all cells.
  Set `maxCells`, `maxFaces`, and `tolerance` for larger or more precise
  authoring jobs within the compiler's work limits.

## Run the angled channel demo

```sh
node cli/ink-studio.js sim discretize examples/simulation-discretization/channel.plan.json --out /tmp/channel.json
node examples/simulation-discretization/demo.cjs /tmp/ink-cut-cells
```

The plan allocates three sparse blocks and cuts an angled channel through
them. The demo uses the compiled face areas and normal distances in a
two-point steady diffusion solve with inlet and outlet values and
insulating walls. It writes the compiled JSON, an annotated board, a
residual report, and an animated view of the solve.

Use [conservative state remapping](state-remap.md) to transfer extensive
state between compiled grids or tetrahedral volume meshes.

Use [grid and mesh operators](grid-operators.md) to reconstruct fields,
compute oriented fluxes, and advance conservative advection and diffusion
on the compiled cells.
