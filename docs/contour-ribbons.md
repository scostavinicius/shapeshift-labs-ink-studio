# Contour ribbons and topographic rendering

`K.contour` traces fields into connected three-dimensional paths, then renders them as native surface splats. This is geometry rather than a screen-space edge filter. Marks retain surface normals and path metadata, support normal camera/depth behavior, and can use existing bone rigs, material looks, selectors and materialisation.

Open [Lines of Matter](../examples/contour-ribbons.html): a terrain atlas with elevation bands, tide isolines and a curved waterfall; and a holographic bust whose original ribbons peel into particles and rejoin. Both have free camera controls. No dependencies are added.

## Trace a field

```js
const C = K.contour;
const plan = C.heightfield(height, {
  bounds: { min: [-3, -2], max: [3, 2] }, // X/Z domain
  levels: C.levels({ min: 0, max: 2, step: .15 }),
  cell: .06
});
const batch = C.draw(B, plan, {
  width: .018, step: .06, lift: .015,
  majorEvery: 5, majorScale: 2,
  color: m => m.major ? '#ffd795' : '#72c8bd',
  objectId: 'terrain-contours', emissive: true
});
```

`levels({min,max,step,offset})` returns up to 256 regularly spaced levels within the inclusive range. Explicit distinct level arrays also work. Major lines are based on the level's **array index**; keep a consistent array to preserve major-line identity.

| Tracer | Field and domain |
| --- | --- |
| `heightfield(height, options)` | `height(x,z)` over 2D X/Z bounds; isoheight becomes Y. Finite-difference normals follow the actual height function. |
| `slices(signedDistance, options)` | 3D bounds and `axis: 'x' \| 'y' \| 'z'` (default Y). Each level is a slicing plane; marching squares traces the zero SDF intersection. Use `S.sdf` directly for a native sculpt, including its CSG. |
| `surface(chart, options)` | A function `(u,v) => {p,n}` or existing procedural chart with `sample([u,v])`. `field(x,y,z,u,v)` supplies a scalar. UV bounds default to `[0,0]…[1,1]`. Normals can be supplied or inferred from bounded chart derivatives. |

A field or chart may return `null` for undefined regions: cells touching a gap are omitted. Provided normal vectors must be nonzero. Height and SDF normal probes need a defined neighborhood extending by `normalStep` beyond the contour. Slices need a regular nonzero gradient at their contours; singular SDF gradients are rejected. Native sculpt CSG sharp seams may need a smaller probe step. Heightfield and chart scalar lattice samples are reused across levels.

`plan` is immutable, serializable data: `{format:'ink-studio/contour-plan',version:1,paths,stats}`. Paths contain `id`, `band`, `level`, `closed`, `points` and `normals`. Shared marching crossings and the existing bilinear saddle rule preserve connected paths. Open boundaries stay open. Chart boundaries are not welded to other charts; periodic charts should supply matching endpoints. A coarse cell size can miss details smaller than the lattice; reduce it for thin features.

## Ribbons and elevation bands

`ribbons(plan, options)` prepares an immutable native mark plan without drawing. `draw(B, planOrRibbons, options)` validates geometry and colors before emission and returns `{first,end,ids,ribbons}`. Reuse `ids` for selectors, rigs or simulations.

| Option | Default / behavior |
| --- | --- |
| `width`, `step` | `.025`, `.08` world units. Width may be a callback receiving path/band/level/arc/major metadata. Segments are subdivided without spanning corners. |
| `lift` | `.003` along the interpolated surface normal. Increase slightly above an underlying surface to prevent depth fighting. |
| `majorEvery`, `majorScale` | `5`, `1.8`: emphasize every fifth level. |
| `dash`, `dashOffset` | Optional `[onLength,offLength]` and world-distance offset. Dashes follow accumulated path distance, including through lattice vertices. |
| `color` | `'#74d3ce'`, RGB bytes, or a mark callback. Receives position, normal, tangent, across, length, width and path metadata. |
| `alpha`, `emissive` | `2.5`, `false`. Standard native density and emission controls. |
| `footprint` | `'soft'`: thin anisotropic native splats, compatible with particle shape transitions. `'flat'`: crisp square footprints with retained plane depth for attached, static ribbons. |
| `objectId`, `materialId` | `'contours'`, `'contour-ink'`: native provenance used by picking, selectors and scoped looks. |

`bands({step,offset,axis,field,colors})` classifies a position into discrete scalar bands. The default scalar is height along normalized `axis:[0,1,0]`; an optional `field(x,y,z)` can instead use SDF distance, radial shells, waves or another material coordinate. `sample(position)` returns `{index,fraction,color}`; `paint(position)` returns RGB bytes. Colors wrap correctly across negative indices. `material(materials)` wraps existing sculpt materials in a `materialAt` selector, preserving their normal shading and look bindings. The materials repeat by index, so a longer ramp can cover a full terrain's elevation range.

```js
const banding = C.bands({step:.2,offset:-.4});
S.terrain(banding.material([{r:[1,2]},{r:[2,3]},{r:[3,4]}]), terrainOptions);
```

## Peel into particles

```js
const stage = K.stage(world);
const peel = stage.add(K.materialisation.bind(stage, {
  id: 'contour-peel', ids: batch.ids,
  flow: K.flow.wind([.4,.15,0]),
  width:.008, length:.025, peel:.6
}));
peel.release({fraction:.35,stagger:1,normalImpulse:.15});
peel.rejoin({duration:2.5,stagger:.3});
```

Use the default **soft** footprint for materialisation. Existing particle covariance interpolation turns the actual ribbon carriers into smaller moving fragments, then restores their original geometry. The carrier count stays fixed. Flat custom footprints retain their authored local frame and are intended for attached rendering; they do not morph their footprint frame into a flight covariance. Both renderers use the existing native splat path; there is no contour-specific per-frame marching pass. For a changing scalar field, retrace explicitly rather than rebuilding automatically during camera motion.

Extraction defaults: 240,000 total cells across levels, 100,000 path vertices, 2,000,000 field/chart evaluations and at most 8,192 paths. `maxCells` may be raised to 1,000,000 total (the reused marcher limits an individual grid to 500,000), `maxVertices` to 500,000, and `maxEvaluations` to 10,000,000. `normalStep` defaults to `.2*cell`. Ribbon preparation and drawing default to `maxMarks:50000` (maximum 500,000), with a separate `maxWork:2000000` step limit (maximum 20,000,000). Failed extraction/preparation leaves the builder untouched; callback errors are surfaced directly. Returned statistics expose the extraction cost.
