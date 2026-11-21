# Surface-aligned brush strokes

Paint SDF surfaces with marks that follow their form, contours, or an authored direction field. Each mark retains two signed world-space axes. The WebGL and software renderers project those axes to sample its paint mask, so irregular edges and bristle gaps stay attached as the camera moves. Geometry remains native SDFs and splats; brushes are optional per material or across a sculpt.

[Surface brushwork](surface-brushwork.md) uses the same curvature directions to apply retained paint over a solid surface and simplify it into broad pigment groups at distance.

Run the [Pigment Coast and Painted Koi demos](../examples/surface-brush.html). They include free orbit/pan/zoom, four brush profiles, length/width adjustments, Gaussian comparison, and a 32-section GPU-skinned koi. Generate `dist/ink-studio.browser.js` with `require('.').bundle()` and serve the repository over HTTP.

## Sculpt authoring

```js
const { makeBuilder, makeSculpt, KIT: K } = require('@shapeshift-labs/ink-studio').load();
const B = makeBuilder(71);
const S = K.sculpt(makeSculpt(B));

S.ball([0, 0, 0], [1.6, 2, 1], {
  r: [2, 3, 4, 5],
  brush: {
    style: 'gouache',
    direction: 'curvature',
    axis: [0, 1, 0],
    length: .32,
    width: .10,
    grain: .25,
    seed: 71
  }
}, { res: .12 });
S.bake();
const world = B.finish();
```

`brush` accepts a settings object, a style name, `true` for defaults, or `false` to opt out. `S.brush` supplies a sculpt-wide default; a material or its `top`/`materialAt` override can replace it. Explicit `false` retains ordinary splats. Glass keeps its existing rendering. Degenerate SDF normals fall back to the sculpt's ordinary splat path.

| Direction | Behavior |
| --- | --- |
| `curvature` | Four nearby normal queries estimate a symmetric surface shape operator. Marks follow its least bending direction. Near equal principal curvatures, smoothly favor the reference axis. Corners with discontinuous normals use that reference. |
| `contour` | Tangent to slices perpendicular to `axis`, useful for horizontal strata or rings. |
| `axis` | Project `axis` onto the tangent plane, useful for brushed metal, longitudinal fur, or painted limbs. |
| `field` | Project `field(x,y,z,normal)` or `field.sample(x,y,z,normal)` onto the surface. Supports custom vector fields and existing samplers with this signature. |

An axis parallel to the surface normal, or a missing/zero field vector, uses a deterministic tangent fallback. The field receives a copy of the normal. Surface direction and curvature queries happen while authoring, not during rendering or animation. Callback fields are runtime authoring inputs; the baked world stores only the resulting axes and paint profiles.

| Setting | Default / bounds |
| --- | --- |
| `style` | `gouache`; also `bristle`, `wash`, `ink` |
| `direction`, `axis` | `curvature`, `[0,1,0]`; axis must be nonzero |
| `length`, `width` | World units; defaults `2.8 × spacing`, `.85 × spacing`; positive through 1000 |
| `thickness` | Native covariance normal sigma; `.08 × spacing`, positive through 1000 |
| `bendLimit` | `.45` radians, `.02–1`; curvature shortens long strokes to limit bridging around bends |
| `probe` | Normal-query distance; `.8 × spacing`, positive through 1000 |
| `grain` | `.2`, `0–1`; deterministic bristle gaps and paint chips |
| `variants` | `4`, integer `1–8`; shared profiles, independent of scene random state |
| `seed` | `1`, unsigned 32-bit integer |
| `softness` | `.04`, or `.3` for wash; `0–.5` |
| `offset` | `0`, `−1–1` world units along the surface normal |

Gouache uses irregular paint edges and small chips; bristle includes longitudinal gaps; wash uses a feathered oval; ink uses a tapered polygon. The existing footprint atlas caches the profiles. Grain controls gouache/bristle masks; wash and ink keep their defined silhouettes. Density and opacity affect how much layered paint fills the gaps.

## Direct stamps and custom silhouettes

```js
const brush = K.surfaceBrush.prepare({
  style: 'bristle', direction: 'field',
  field: (x, y, z) => [1, .2 * Math.sin(x), 0],
  length: .4, width: .12, seed: 8
});
const frame = K.surfaceBrush.direction(brush, point, normal, { spacing: .1 });
K.surfaceBrush.stamp(B, frame, B.P[4], brush, { opacity: 1 });
```

`direction` returns `point`, `normal`, `tangent`, `bitangent`, `length`, `width`, `thickness`, `curvature`, `confidence` and `normalSamples`. Supply `normalAt(x,y,z)` for direct curvature queries; without it, the reference axis is used. `stamp` returns the new row index and also accepts native builder `animation` options. Colors use the builder's RGB byte triples.

For your own silhouettes, use `B.dab` for geometry and `B.describeFootprint(first,end,profile,axes)`, where `axes` is `[Ux,Uy,Uz,Vx,Vy,Vz]` in world units. U and V are physical half-length vectors for the mask's normalized square. Profiles can be any [custom footprint](splat-footprints.md), including painted masks with holes. Without axes, the original covariance-based projected footprint behavior remains available.

## Animation, copies and rendering

- Native bones pose the axes in the vertex shader alongside the existing covariance, without rebuilding the paint atlas or traversing every brush mark on the CPU. With two-bone position blending, marks use the primary bone basis, matching the native covariance convention.
- `K.deform.rest/apply` and stage rigs transform the retained axes through the same Jacobian or part matrix as the geometry. They start from rest axes, avoiding accumulated drift. Use GPU skins for large animated surfaces.
- Reconstruction rotates the axes with fragments, while afterimages snapshot them in the retained pose or receiving surface's frame.
- Provenance subsets/joins, instance flattening/placement edits, and bake cache snapshots retain the axes. Custom marks remain protected by existing native LOD/interaction thinning rules.
- CPU rendering, WebGL color/depth/ownership, and contribution-ray picking sample the same signed-distance profiles. Perfectly edge-on planes have zero projected area and disappear; they do not turn into camera-facing cards.

The layout adds an optional `Float32Array(count * 6)` called `frames` to `world.splatFootprints`. Zero rows use the existing projected-footprint mapping. GPU footprint records use two RGBA texels per splat, and reuse the existing row/parameter/atlas texture units. `K.splatFootprints.setFrames(world, frames)` validates an authored axis edit and invalidates the row upload while retaining unchanged atlas tiles. `setTransform` adjusts rotation, stretch or softness without rebuilding the distance tiles. Treat layout arrays as retained data: use the editing APIs instead of mutating them in place.

The marks remain locally planar splats, rather than geodesic ribbons or meshes. Curvature limits reduce corner bridging, and smaller sampling spacing improves strongly curved regions. Existing shader motion kinds carry the marks with their native position and covariance behavior; authored nonlinear shape changes should use the deformation or bone APIs to carry the surface axes too.
