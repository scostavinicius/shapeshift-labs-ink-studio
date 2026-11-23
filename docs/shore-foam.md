# Hand-drawn shoreline foam

[Ink’s water bodies](procedural.md#water-bodies) expose a boundary and
a horizontal current. `KIT.shoreFoam.create(body, options)` places editable,
whole-pixel cels along that boundary. Add one effect or an array of up to
eight effects as `shoreFoam` in `B.finish()`.

```js
const body = KIT.procedural.waterBodies.create({
  id: 'rock-pool',
  bounds: { min: [-2, -1.5], max: [2, 1.5] },
  resolution: [32, 24],
  sample: (x, z) => x*x + z*z < .28 ? null :
    { bed: -.5, surface: 0, current: [.10, .22] }
});
const shoreFoam = KIT.shoreFoam.create(body, {
  spacing: .36,
  period: 1.5,
  mask: (x, z) => z > -.5 && Math.abs(x) > .20,
  swatches: { crest: '#ceebd8', spark: '#fff3cd' }
});
return B.finish({ ...scene, shoreFoam });
```

The scene supplies the visible water surface and rocks. The foam object uses
the water body for placement and animation. `effect.sites` exposes the
classified anchors, wetward directions, seed offsets, and sampled currents.
Create a new effect when a new water snapshot changes the boundary or current.

- Supply `paths` as arrays of XYZ vertices to trace a painted bank or a
  smoother edge. Walk each path with water on the left in XZ. For
  example, a path heading along +X has water on the +Z side. Repeat the first
  vertex at the end to classify the closing corner.
- Tune `spacing` between straight marks, `inset` into the water, and
  `corner`, the turn threshold in radians for choosing inside-corner and
  rock-tip cels. `mask(x,z)` limits births, drift, and individual art pixels
  so deliberate gaps stay open.
- `period` is in seconds. `phase`, `stagger`, and `release` are fractions
  of that period. A mark sticks to the bank until release, then drifts with
  its sampled current and a wetward `push`. `maxDrift` caps travel. Each
  mark stops at the first dry step, and the renderer checks the water
  footprint at the center of every drawn pixel.
- The foam is drawn at native art resolution in the headless and WebGL
  camera views. Nearby opaque scene geometry covers it. Raise `lift` in
  world units when a thick painted or splatted water surface covers its cels.
  The cels appear in the main color view. Reflection captures and lighting
  plates use the underlying scene.

## Edit the cels

The [Pixel Stamp Workshop](pixel-stamps.md) includes `foam-straight-east`,
`foam-inside-east`, and `foam-tip-east` alongside the separately painted
`-se` versions. The renderer picks a screen direction and uses whole-pixel
quarter turns for the other orientations. Each stock clip has four 9 × 9
drawings for attach, curl, break, and drift. The editable swatch names are
`wake`, `wash`, `edge`, `crest`, and `spark`. Pass replacement clips in
`clips` keyed by those six library IDs. Replacements can use odd square
grids up to 31 × 31 and up to 16 timed cels.

[Fernfall](../examples/palette-cycling.js) uses two outlined rocks and a
masked channel between them. Raymond Schlitter’s
[Water in Motion](https://www.slynyrd.com/blog/2018/10/12/pixelblog-10-water-in-motion)
illustrates the changes in the silhouette from the foot of a fall into
the surrounding ripples.

```sh
ink-studio clip examples/palette-cycling.js --params '{"foam":true}' \
  --from 0 --to 6 --fps 12 --w 216 --h 144 --px 1 --out fernfall-foam.png
ink-studio clip examples/palette-cycling.js --params '{"foam":true,"foamDetail":true}' \
  --from 0 --to 6 --fps 12 --w 304 --h 176 --px 1 --out fernfall-foam-detail.png
```

Use `--shore-foam off` to compare the same shot with its shoreline cels hidden.
