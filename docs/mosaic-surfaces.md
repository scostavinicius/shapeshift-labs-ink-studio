# Irregular mosaics and stained glass

`K.mosaic` (also `K.procedural.mosaic`) reconstructs optional surfaces as fitted colored polygons. It complements native SDF sculpting: the resulting pieces are native splats with one shared triangle footprint, not a separate mesh renderer or a postprocessing filter. Use it on selected objects, architectural panels, a curved sculpture, terrain, or a whole scene.

Open [The Tessera Collection](../examples/mosaic-surfaces.html) for a swimming lapis koi and a stained-glass pavilion. Drag to orbit, shift-drag to pan, and scroll to zoom. Compare raised bevels, grout, transmission and two pigment recipes. Material changes rebuild baked geometry only when a control is committed; animation updates retained bone matrices.

```js
const plan = K.mosaic.voronoi({
  sites: [
    { key: 'blue', point: [0.2, 0.3] },
    { key: 'amber', point: [0.8, 0.4] },
    { key: 'cyan', point: [0.4, 0.85] }
  ]
});
const surface = K.mosaic.mesh(plan, {
  palette: ['#15557b', '#e1ac50', '#34bbc6'],
  gap: 0.025,
  bevel: 0.015,
  bevelDepth: 0.01,
  thickness: 0.05,
  // Coordinates are in the cell chart; height follows the carrier's normal.
  sample: ([u, v], height) => [u * 4, v * 4, height]
});
const binding = K.mosaic.emit(B, surface, { object: 'wall' });
const world = B.finish(sceneSettings);
```

The carrier receives `(uv, height, pieceKey)` and returns an XYZ point. It must be deterministic, finite and nondegenerate. Height is a carrier parameter, not an automatic world-Y offset: for a cylinder, offset its radius; for terrain, offset elevation or its sampled normal. `gap` and `bevel` use chart units; `thickness` and `bevelDepth` use the carrier height parameter. Nonuniform carriers therefore stretch both pieces and seams intentionally.

## Layouts and adapters

`layout(input, {maxCells})` validates and snapshots any of:

- Authored `[{key, polygon: [[u,v], ...]}]` cells. Winding is normalized. Simple concave polygons are supported; holes are represented as clipped fragments.
- `{cells: [{key, fragments: [polygon, ...]}]}` from `K.procedural.surfaceCells.clip`. Each fragment gets its own fitted boundary, retaining the logical piece key.
- `{tiles: [{id, polygon, ...}]}` from the existing quasiperiodic tilings.

Keys must be unique after conversion to strings; omitted keys default to array indices. There may be up to 128 vertices per fragment, 65,536 fragments and one million total vertices. The default cell budget is 8,192, with an upper bound of 65,536.

`voronoi({sites, bounds: [u0,v0,u1,v1], maxCells, maxWork})` creates a deterministic bounded planar power diagram. Sites accept `[u,v]` or `{key, point, weight}`. Weights enlarge a site's region; cells consumed by other sites are omitted. The default domain is `[0,0,1,1]`, cell budget 2,048 and work budget four million polygon-edge tests. Positions must be distinct. No random stream or external dependency is required.

## Geometry and appearance

`mesh(layout, options)` produces immutable `triangles`, logical `pieces`, and a `locate(u,v)` query. Faces, bevel rings, side walls, optional backs and grout carry distinct `part` labels.

| Option | Default | Meaning |
| --- | --- | --- |
| `gap` | `0.018` | Full separation between adjacent pieces; half is inset on each boundary. |
| `grout` | `'#172332'` | Opaque material in the seams; `false` leaves actual openings. |
| `bevel` | `0.012` | Inward width of the sloped perimeter. |
| `bevelDepth` | `bevel` | Height lost at the perimeter, at most the thickness. Zero gives a flat rim. |
| `thickness` | `0.04` | Front face height above the carrier base. |
| `back` | `false` | Close the back. Leave off for a single optical slab so glass is not counted twice. |
| `subdivisions` | `1` | Uniform subdivisions per source triangle edge, from 1 to 32. Use 2–8 on curved carriers. |
| `maxTriangles` | `150000` | Hard geometry budget, up to one million. Checked before sampling each source triangle. |
| `palette` | cyan / amber | Hex colors, RGB integers or RGB byte triples. |
| `paint(cell)` | palette cycling | A deterministic per-piece color function. |
| `controls` | absent | Existing shared material controls, or `(cell) => controls`. |
| `material` | absent | Existing optical descriptor, or `(cell) => descriptor`. An alternative to `controls`. |

Convex insets clip against shifted edge planes, removing tiny Voronoi edges without inverted bevels. Concave pieces use validated mitered insets. Settings that consume a piece or cause self-intersection throw; reduce the gap/bevel or split a narrow concave piece. This is preferable to silently emitting folded triangles.

Subdivision counts agree along shared edges. For a curved carrier, the representation is piecewise planar; increasing subdivisions improves its geometric accuracy. `surface.locate(u,v)` returns the **actual triangulated** position, normal, piece key, part and color. It returns `null` in gaps and outside the surface. `{includeSeams:true}` also queries grout. Attachment queries describe the baked carrier; use the existing hierarchy or rig transforms when the object subsequently moves.

## Stained glass and material controls

```js
const panes = K.mosaic.mesh(windowCells, {
  sample: ([u,v], h) => [u, v, h],
  palette: ['#168fad', '#dbae62'],
  grout: '#927342',
  thickness: 0.06,
  controls: {
    transmission: 0.65,
    roughness: 0.12,
    ior: 1.52,
    thickness: 0.06,
    absorption: 0.6,
    coating: { weight: 0.3, roughness: 0.08 }
  }
});
K.mosaic.emit(B, panes, { object: 'rose-window', ambient: 0.85 });
```

These are the existing coverage-aware optical slabs and shared stylized finishes. Each pane contributes its own pigment, reflection and transmission while preserving the view behind it. Grout stays opaque. Optical thickness is explicit in `controls`/`material`; set it to match the carrier's physical scale. This does not add spectral refraction or automatically synthesize caustics. Existing water, reflection and projected-light tools remain available separately.

## Native rendering, animation and budgets

`emit(B, surface, {object, opacity, light, ambient, animation})` appends one native splat per triangle and returns `{first,end,pieces:[{key,first,end}]}`. Default opacity is 1, ambient fill 0.48 and light `[-0.4,0.8,0.5]`. Piece keys become inspection surface labels; part names become material labels. Returned ranges work with existing bone bindings, deformation, materialisation, destruction, subsets, instance flattening and afterimages. Footprint frames and optics use their existing propagation paths.

The shared footprint uses `depth:'plane'`: CPU rasterization and contribution rays intersect the retained plane; WebGL performs perspective-correct footprint mapping and per-fragment plane depth. A depth prepass contains only opaque plane footprints. Soft splats and glass preserve contribution blending, and scenes without plane footprints do not acquire this prepass. This also fixes a broad tile being incorrectly occluded by the center depth of another tile. No new texture unit is needed; all pieces share one cached silhouette rather than consuming a profile per polygon.

For software rendering, plane surfaces select per-pixel depth ordering. The existing `fragmentBudget` defaults to 500,000 retained contributions, with a two-million maximum. Exceeding it raises an error instead of silently reverting to center ordering; reduce output resolution or raise that explicit budget. WebGL uses a depth prepass for opaque planes and retains normal alpha blending for optical contributions.
