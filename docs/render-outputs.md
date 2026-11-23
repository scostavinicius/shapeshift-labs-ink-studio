# Shared render outputs

Use `KIT.renderOutputs` to send the same miniature render to a camera
atlas, a world monitor, an inspection tool, and a render graph.
[Projected routes](projected-routes.md), [projected stages](projected-stage.md),
the [tilemap raycaster](tile-raycaster.md) and [height-map flyovers](heightmap-flyover.md)
return the shared format directly. Renderers with their own
rasterizer can publish it with `renderOutputs.create(fields)`.

All planes use the same top-down native pixel grid and dimensions.

| Field | Meaning |
| --- | --- |
| `data` | Straight RGBA bytes, four channels per pixel. Backdrop art can have color without a surface. |
| `depth` | Float32 or Float64 forward camera depth in scene units. Uncovered pixels use positive infinity. |
| `ids` | Uint16 or Uint32 surface indices. ID 0 means no surface. |
| `owners` | One `{ id: string, kind?: string }` entry per ID, with `null` at index 0. Use stable names across captures. |
| `uv` | Float32 or Float64 U and V per pixel. They address the winning surface’s paint and can be unwrapped for repeated textures. |
| `camera` | Optional calibration for reconstructing 3D positions from screen pixels and depth. |

The frame structure and owner table are immutable. Treat the typed
buffers as read-only while a frame is in use. Use `snapshot(frame)` for
an independent copy of the shared planes. Each frame can contain up to
1,048,576 art pixels.

## Pick and route channels

```js
const outputs = KIT.renderOutputs;
const frame = route.render({ width: 240, height: 144, time, camera });
const hit = outputs.pick(frame, 132, 80);
// If covered: pixel coordinates, owner, RGBA, camera depth, UV and position.

const sceneOptions = {
  renderGraphInputs: {
    roadColor: outputs.raster(frame),
    roadDepth: outputs.raster(frame, 'depth'),
    roadAddress: outputs.raster(frame, 'uv'),
    ridgeLamp: outputs.mask(frame, 'ridge-lamp')
  }
};
const inset = outputs.layer(frame, { rect: [8, 8, 120, 72] });
```

- `pick(frame, x, y)` reads the visible surface under that top-left art
  pixel. `pickUV(frame, u, v)` reads the same information from normalized
  top-left display coordinates. Both return `null` outside the image
  or over the backdrop.
- `raster(frame, 'depth', { miss: 0 })` supplies a finite scalar plane
  for [raster nodes and graph inputs](render-graph.md#connect-procedural-rasters).
  `'ids'` returns the integer owner indices. `'uv'` returns U, V and
  binary coverage for [texture addressing](render-graph.md#bind-a-programmable-texture-address-field).
  `mask(frame, name)` creates a byte matte for a named owner. Omit the
  name for all visible surfaces.
- `image(frame)` adapts the color to `{ w, h, rgba }` and
  `layer(frame, settings)` makes a [composite layer](mixed-resolution.md).
- Calibrated frames expose a hit’s `position` and a three-channel
  `'position'` raster for light falloff, world-coordinate masks, or a
  survey grid. A producer supplies `camera: { projection, origin, right,
  up, forward, center, scale }`. The axes are unit vectors and `center`
  is the principal point in art pixels. `scale` is the XY focal length
  in pixels for perspective or pixels per scene unit for orthographic.

## Schedule a miniature renderer as a camera feed

```js
const atlas = studio.createCameraAtlas({
  width: 240, height: 144,
  views: [{
    id: 'ridge', rect: [0, 0, 240, 144], fps: 12,
    source: ({ time, tile }) => route.render({
      time, width: tile.width, height: tile.height,
      camera: { distance: time * 5 }
    })
  }]
});
atlas.capture(world, { time });
const feed = atlas.outputs('ridge');
const hit = atlas.pick('ridge', .55, .6);
```

The same `source` callback works with the WebGL camera atlas. It runs
only when its tile is due and returns a frame the size of the tile. The
capture takes a snapshot of all shared planes. `outputs(id)` returns
the last captured planes, or `null` before capture, after reset, or for
a regular color-only camera tile. `pick(id, u, v)` reads the retained
frame without copying it. If composite video is enabled, `read(id)`
shows the decoded color and `outputs(id)` keeps the clean source planes.

Use the existing [atlas layer or world-surface binding](camera-atlas.md#route-a-feed-to-the-world)
for display. For a hit on a `SpriteSurface.faceRegion` monitor, pass the
face-local UV with `atlas.pick(id, u, v, { surface: true })`. This uses the
face’s texel-center mapping. The room tests the monitor against room
geometry. Feed depth is local to the miniature camera and can drive
effects inside the feed.

## Ridge Dispatch

[Ridge Dispatch](../examples/shared-render-outputs.js) shows the Aster Ridge
route on a world monitor behind a physical desk lamp. The panel on the
right reads that same capture, false-colors depth, and highlights the
picked signal using its owner ID. It reports the depth and texture
coordinates under the crosshair.

```sh
node cli/ink-studio.js clip examples/shared-render-outputs.js --w 342 --h 202 \
  --px 1 --raw --from 2 --to 8 --fps 12 --out ridge-dispatch.apng
```

Generate a standalone [interactive inspector](../examples/shared-render-inspector.cjs)
to scrub six captures and pick pixels in the color, depth, ID, or UV view.
The browser reads the recorded planes directly.

```sh
node examples/shared-render-inspector.cjs ridge-inspector.html
```
