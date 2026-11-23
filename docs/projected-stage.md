# Projected stage layers

Use `KIT.projectedStage.create` to build a painted stage with one
perspective camera. Make horizontal layers for floors, inlays and
water, upright layers for scenery and foreground cutouts, and props
whose feet are registered to a named ground layer. Distant layers
move less than near layers as the camera pans.

```js
const stamp = (rows, palette) => ({ width: rows[0].length, height: rows.length, rows, palette });
const stage = KIT.projectedStage.create({
  layers: [
    {
      id: 'slate', at: [-9, 0, -2], size: [18, 22], repeat: [2, 2],
      paint: stamp(['001', '022', '011'], ['#192c35', '#284450', '#38565c']),
      reflection: {
        strength: .65,
        mask: stamp(['.00.', '000.', '.00.', '....'], ['#ffffff']),
        tint: [.8, .95, 1],
        ripple: { amplitude: 1, frequency: .7, speed: .4 }
      }
    },
    {
      id: 'rear-screen', type: 'upright', at: [-8, 0, 9], size: [16, 4],
      paint: stamp(['.00.', '1221', '1001'], ['#33515a', '#1c3036', '#bb7e5d']),
      reflect: true
    }
  ],
  props: [{
    id: 'lantern', ground: 'slate', at: time => [Math.sin(time), 3],
    height: 1.8, paint: stamp(['.2.', '212', '.0.', '.0.', '000'],
      ['#44363a', '#f8d499', '#a86854'])
  }]
});
const settings = {
  width: 256, height: 152,
  camera: { at: [0, 2, -4], yaw: 0, horizon: 66, fov: 1.04 }
};
const frame = stage.render({ ...settings, time: 1.25 });
const anchor = stage.view(settings).project([0, 0, 3]);
```

## Place and paint layers

- `at` is the XYZ origin of a rectangular layer. Ground `size` is
  width across X and length along Z. Upright `size` is width across X
  and height along Y. Use `yaw` in radians to rotate a layer about its
  origin. Upright paint maps from the top of the rectangle downward.
  On ground paint the top row starts at the origin and V increases
  along the rectangle.
- Draw with [indexed pixel stamps](pixel-stamps.md) or use a prepared
  raster. Stamps support rows, strokes, slots and timed frames.
  Paint fills the layer once by default. Set `repeat: [uSize, vSize]`
  for repeating art in scene units. A V repeat on an upright is
  measured along its height. Alpha of at least 128 covers the pixel
  and writes depth. Transparent pixels leave the layers behind visible.
- A prop uses a world XZ anchor in `at`, a `height` in scene units,
  and optionally `elevation` above the ground. Both the anchor and
  elevation can be functions of time. Name its `ground` when more
  than one is available. The prop is screen-facing and uses nearest
  sampling. Its default `pivot` is the drawing's bottom center.
- The camera is level, with a position, optional `yaw` from +Z,
  vertical `fov` in radians, and one `horizon` measured from the top
  of the art grid. Use `at` and `yaw` for physical camera movement.
  Change `horizon` to shift the shared projection vertically.
  `near` and `far` limit forward camera depth.
- `stage.view(settings).project([x, y, z])` returns the subpixel
  screen position, depth, and projected pixels per scene unit.
  `view.ground(x, y, 'slate')` intersects the art pixel center with
  the named floor and returns the XYZ point, depth, and normalized
  layer UV. Use that point to place a prop, brush mark, or effect.

## Reflect painted scenery on the floor

Add `reflection` to a ground layer and set `reflect: true` on the
uprights that should appear in it. Props reflect by default. Reflecting
geometry shares the camera and the snap of each sprite. Each floor
pixel keeps its own depth and UVs, so a near dry layer can cover a
reflection and picking identifies the floor.

- `strength` blends reflected color into the ground from 0 to 1.
  `tint` multiplies its RGB channels by values in [0, 1].
- An optional `mask` uses its alpha as wet coverage over the whole
  ground rectangle, independently of how the paving repeats. A
  transparent spot stays dry. A prepared RGBA mask can supply graded
  coverage.
- `ripple` offsets just the reflected color horizontally, in art pixels.
  `frequency` is cycles per world Z unit and `speed` is cycles per
  second. The ripple follows the floor through a camera pan and
  stays inside the wet mask.
- Use `render({ ...settings, reflections: false })` for a dry comparison
  on the same camera. Reflecting grounds can share an elevation.

The return value implements [shared render outputs](render-outputs.md).
It has native color, depth, IDs and UVs, plus prop screen anchors in
`placements`. Use it as a camera-atlas source, route its planes into a
render graph, or pass `KIT.renderOutputs.image(frame)` to a composite layer.

## The Rain Court

[The Rain Court](../examples/projected-stage.js) pans across painted
glass arches, an iron rail, and two couriers. The lanterns and couriers
reflect in painted puddles over repeating tilework. Play it with
`--params '{"reflections":false}'` to see the same shot dry.

```sh
node cli/ink-studio.js clip examples/projected-stage.js --w 256 --h 152 --px 1 \
  --from 0 --to 8 --fps 15 --out rain-court.apng
```
