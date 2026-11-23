# Projected routes

Use `KIT.procedural.routes.projected.create` to turn a sampled path into
painted ribbons with attached sprite cels. The renderer projects the
elevation and curvature of the path onto an independent native pixel grid.
Strips and props share camera depth, so a crest can hide a prop or reveal
it a pixel at a time from the top down.

```js
const route = KIT.procedural.routes.projected.create({
  path: [[0, 0, 0], [0, 3, 16], [4, 5, 28], [10, 0, 45]],
  width: [[0, 7], [19, 9]],
  strips: [{
    id: 'track',
    paint: { width: 4, height: 2, palette: ['#172934', '#a98770'],
      rows: ['0110', '0100'] },
    repeat: 2
  }],
  props: [{
    id: 'ridge-lamp', distance: 32, offset: 3, height: 3,
    sizes: [
      { native: true, paint: { width: 1, height: 3,
        palette: ['#ffc377', '#46606a'], rows: ['0', '1', '1'] } },
      { minPixels: 7, native: true, paint: { width: 3, height: 7,
        palette: ['#ffc377', '#46606a', '#69364c'],
        rows: ['.2.', '202', '.2.', '.1.', '.1.', '.1.', '111'] } }
    ]
  }]
});
const frame = route.render({
  width: 240, height: 144, time: 1.5,
  camera: { distance: 10, elevation: 2.4, lookAhead: 15, lookElevation: 1.8 }
});
```

## Author strips and attach props

- `path` accepts XYZ points, a [sampled route](procedural.md),
  or a [sampled curve](curve-families.md). Distances are in world units
  along the path, including elevation. Each segment needs a horizontal
  heading. The optional `step` limits station spacing while retaining
  existing polyline knots. Width is a positive constant or increasing
  `[distance, width]` keys. A closed path joins at matching endpoint
  widths. Wrap camera distance outside the renderer if you want laps.
  Choose a repeat distance that divides the path length to align the
  paint at the seam.
- Each strip has an `id` and a `paint` source. Use indexed stamp rows,
  slots or strokes, or pass prepared RGB/RGBA raster bytes. `across`
  selects a span from `-1` at the left edge to `1` at the right edge.
  `lift: [left, right]` raises or lowers the edges in world units. This
  lets a grade carry shoulders, banks, gutters or sloping sides.
  `repeat` sets the world-unit length of one copy of the texture.
  `scroll` is world units per second along the path. A stationary camera
  can watch a painted river or belt flow through it.
- Props use `distance`, lateral `offset`, optional `elevation` above
  the centerline, and a nominal world `height`. Use
  `route.sample(distance, { offset, elevation })` to query the same
  attachment positions for other tools. A prop’s `sizes` are sorted in
  ascending `minPixels`. Its largest eligible cel wins, using the
  projected height before clipping. `native: true` draws that cel
  pixel-for-pixel. Otherwise it scales by nearest neighbor to the
  projected height. An optional `pivot: [x, y]` uses top-left art pixel
  coordinates. The default pivot is bottom center.
- Strips and prop cels use hard coverage. Source alpha of at least 128
  writes one opaque art pixel and claims depth. Smaller alpha leaves a
  hole. Props are screen-facing cards at their attachment depth.
- The camera accepts an explicit `at` and `target` in XYZ, or can
  look along the path from a `distance`, `offset` and `elevation`.
  `fov` is the vertical field of view in radians. `near` and `far`
  are forward camera depths. Keep the look direction nonvertical.

## Use the rendered view

The frame is a straight RGBA raster `{ width, height, channels: 4, data }`
that also returns top-down `depth`, `ids`, and `uv` arrays. Empty pixels
have zero alpha, ID 0, and infinite depth. Look up each nonzero ID
in `owners` for its strip or prop name. UVs belong to the winning image.
For strips, U spans one strip and V is in unwrapped texture repeats.
`placements` lists visible or occluded on-screen prop rectangles, cel
indices, and visible pixel counts after depth testing.

The frame implements [shared render outputs](render-outputs.md).
Pass it to a camera atlas source, use `KIT.renderOutputs.image(frame)`
in a mixed-resolution layer callback, or bind its color, depth, IDs, and
UVs to a render graph. The route camera includes calibration for picking
3D positions.

## Signal at Aster Ridge

The [example](../examples/projected-routes.js) uses five painted strips
for rails, shoulders and rock. Five independently drawn lamp sizes keep
each light legible. Around 3.75 seconds the lower signal’s light clears
the ridge while the post is still hidden. Continue through the gantry
to see nearby cutout sprites and distant terrain on the same art grid.

```sh
node cli/ink-studio.js clip examples/projected-routes.js --w 240 --h 144 --px 1 \
  --from 0 --to 8 --fps 15 --out aster-ridge.apng
```
