# Multi-camera render atlases

Use a camera atlas to capture several views of a posed world at different
resolutions and cadences. Route the same feed to an on-screen overlay, a
render-graph layer, or a depth-tested world panel.

The [Relay Yard example](../examples/camera-atlas.js) captures three feeds and
shows the west camera both in the overlay and on a monitor inside the scene.

```sh
node cli/ink-studio.js render examples/camera-atlas.js --w 840 --h 510 --t 1.8 --out relay-yard.png
```

## Capture and schedule feeds

In WebGL, import `createCameraAtlas` from `webgl.mjs` and pass the canvas
that the main renderer uses. In Node, use `studio.createCameraAtlas(definition)`
with the same definition object.

```js
const definition = {
  width: 172, height: 60,
  maxViewsPerFrame: 1,
  maxPixelsPerFrame: 96 * 60,
  views: [
    { id: 'yard', rect: [0, 0, 96, 60], fps: 12,
      frame: { camera: { target: [0, 1, 0], dist: 8, pitch: .35 } } },
    { id: 'drone', rect: [100, 0, 72, 48], fps: 5,
      frame: ({ time }) => ({
        camera: { target: [2, 1, 0], yaw: time * .2, pitch: .1, dist: 4 }
      }) }
  ]
};

const atlas = createCameraAtlas(canvas, { toolkit, ...definition });
const result = atlas.capture(world, { time: 1.2 });
```

- `rect` is `[left, top, width, height]` in atlas pixels. Rectangles can differ
  in size and must fit without overlap. The atlas supports up to 64 views.
- `fps` caps the refresh rate of a view. Each call schedules due views in
  rotating order under both budgets. A deferred view keeps its last frame and
  gets the first opportunity at the next call. `capture` reports `updated`,
  `deferred`, `pixels` and `rewound`. Call once per host frame to apply the
  budgets per frame.
- Supply any shared native render options in `capture(world, { time, frame })`.
  The view's `frame` object or synchronous callback can override those options,
  including its orbit camera and camera shot. WebGL views can also use
  `camera.pose` or a snapshot from `captureCamera`.
- A view can use a synchronous `source({ world, time, tile, frame })`
  callback. Return [shared render outputs](render-outputs.md#schedule-a-miniature-renderer-as-a-camera-feed)
  from a miniature renderer to capture color, depth, surface IDs and UVs
  at the tile’s resolution and cadence.
- Pose or step the world before calling `capture`. Capture uses the provided
  world and fixes the render time to the supplied time.
- A feed defaults to the base scene. It can opt into composite layers, a render
  graph, inspection, or afterimages through its own `frame`. Use a separate
  afterimage history for each feed that enables it. Camera capture resets shared
  screen history between views. Use
  `spriteSurfaces: false` on a feed if it would otherwise see its own monitor.
- `lastCapture(id)` returns the last captured time. A rewind clears the atlas
  before filling it again. Call `reset()` on a scene cut, and `dispose()` when
  the atlas is no longer needed. Uncaptured pixels are transparent.

## Compose a view

```js
const inset = atlas.layer('drone', { rect: [24, 24, 144, 96], opacity: .9 });
renderer.render(world, { composite: { layers: [inset] } });

// This same layer can be positioned anywhere in a render graph.
const feedPass = { id: 'inset', type: 'composite', layer: inset };
```

Set `isolated: true` on the composite pass to give a downstream
[frame-age pass](render-graph.md#frame-age-masks) its own feed image.
Each masked region can hold, delay or replay while the other tiles keep
their normal cadence.

`layer(id, options)` selects one feed. Omit the ID to show the whole atlas,
including spacing. Options are the normal raster layer controls, including
placement, filter, opacity and blend. The WebGL renderer samples these layers
directly from the shared atlas texture when the context matches. Linear
filtering clamps inside the selected tile. Node and cross-context consumers
use the raster path. `read(id?)` returns an independent, top-down
`{ w, h, rgba }` raster.

For a custom WebGL consumer, `atlas.texture` exposes the shared texture and
`atlas.tiles` lists each tile's dimensions and top-down
`uv: [left, top, right, bottom]`. Convert top-down Y to WebGL V when
sampling it in your own shader.

## Decode a composite video feed

Set `compositeVideo` on a view to treat that feed like an analog composite
input. Use `true` for the defaults or tune the following controls.

```js
const view = { id: 'relay', rect: [0, 0, 160, 110], fps: 12,
  compositeVideo: { lumaBandwidth: .62, chromaBandwidth: .28,
    artifacts: .55, phase: 0, phaseRate: 1 } };
```

| Control | Default | Effect |
| --- | --- | --- |
| `lumaBandwidth` | `.62` | Brightness detail from 0 to 1. Lower values blend finer horizontal patterns, such as checkerboard mist. |
| `chromaBandwidth` | `.28` | Color detail from 0 to 1. Lower values spread saturated color farther across a scanline. |
| `artifacts` | `.55` | Luma and chroma interference from 0 to 1. Higher values accentuate dot crawl and false color at sharp edges. |
| `phase` | `0` | Initial carrier phase in turns. |
| `phaseRate` | `1` | Carrier turns per scene second, from −240 to 240. Use zero to hold the pattern or a negative value to reverse its motion. |

The pass runs at the feed's capture resolution using the capture time.
All routes from that tile see the same decoded frame, including an overlay,
a render-graph layer, and a world panel. Other views and the surrounding
scene keep their original pixels. WebGL decodes the feed on the GPU.
Omit the option or use `false` for an untreated feed. Bandwidths of 1
on both channels also give an exact RGB bypass.

The effect uses horizontal YIQ filters and phase-driven interference for
art direction. [Shay Green’s console filter comparisons](https://slack.net/~ant/libs/ntsc.html)

The [Breakwater Relay example](../examples/composite-video.js) shows the
same feed on adjoining RGB and composite monitors. Its calibration view
adds one-pixel checkers, color bars, and saturated text.

```sh
node cli/ink-studio.js clip examples/composite-video.js --w 376 --h 181 \
  --px 1 --raw --from 0 --to 4 --fps 12 --out breakwater.png
node cli/ink-studio.js clip examples/composite-video.js --params '{"study":"calibration"}' \
  --w 376 --h 181 --px 1 --raw --from 0 --to 4 --fps 12 --out calibration.png
node cli/ink-studio.js render examples/camera-atlas.js --params '{"compositeVideo":true}' \
  --w 840 --h 510 --t 1.8 --out relay-yard-composite.png
```

## Route a feed to the world

```js
const panels = SpriteSurface.make(256);
const screen = panels.reserve(72, 48);
panels.faceRegion([-1, 1, 0], [2, 0, 0], [0, 1.33, 0], screen);
const spriteSurfaces = panels.finish();
const syncDronePanel = atlas.bindSurface(spriteSurfaces, 'drone', screen);

// Use spriteSurfaces when finishing or rendering the world.
// After capture, synchronize the latest feed before drawing the main view.
syncDronePanel();
```

Reserve the region in the same builder as the other authored textures.
Use `meshRegion` to map the region onto an arbitrary textured mesh, or
reuse it on several faces. The binding updates the region only when the
feed changes and returns whether it copied pixels. On WebGL, this path reads
the updated feed and marks the sprite texture region dirty for its next
upload. Monitor geometry uses the normal world depth tests.
