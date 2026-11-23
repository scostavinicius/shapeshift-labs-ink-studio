# Height-map flyovers

`KIT.heightmapFlyover` renders terrain from aligned elevation and paint rasters.
Each native screen column traces the map cells from front to back. A ridge
fills the rows it covers, and farther hills appear only where a nearer cell
leaves space. Raise the eye to reveal the valley behind a ridge.

```js
const terrain = KIT.heightmapFlyover.create({
  bounds: [-8, 8, 0, 48],
  heights: {
    width: 3,
    height: 4,
    data: [0, 0, 0, 6, 4, 6, 0, 0, 0, 8, 9, 7]
  },
  paint: {
    width: 3,
    height: 4,
    rows: ['000', '111', '202', '111'],
    palette: ['#6e586e', '#96565a', '#426d73']
  },
  altitude: {
    thresholds: [5],
    swatches: { '#96565a': ['#96565a', '#db9879'] }
  },
  distance: {
    thresholds: [22],
    swatches: {
      '#96565a': ['#96565a', '#b48191'],
      '#db9879': ['#db9879', '#c695a0']
    }
  }
});

const frame = terrain.render({
  width: 192,
  height: 112,
  camera: { at: [0, 3, -4], yaw: 0, horizon: 56, far: 70 },
  background: '#332c50'
});
const hit = KIT.renderOutputs.pick(frame, 96, 62);
const cell = terrain.sample(0, 17);
```

## Paint and height

- `bounds` gives `[minX, maxX, minZ, maxZ]` in world units. The terrain
  uses one elevation per texel with flat tops and height steps at cell edges.
  The map has finite edges. A texel with alpha below 128 is an opening that
  can reveal terrain farther away.
- Pass a one-channel raster as `heights` and set `heightScale` and
  `heightOffset` to convert its samples to world Y. Pass a matching raster
  of RGB or RGBA bytes or a static [pixel-stamp image](pixel-stamps.md)
  as `paint`. For a stamp, `scenePalette` and `paletteRoles` resolve slots
  the same way as other Ink stamps.
- Rows run toward positive Z by default. Use `rowDirection: 'negative'`
  when the first authored row corresponds to max Z. X increases across a
  row. UVs address that same paint grid.
- `id` names the terrain surface. To make distinct pickable areas, provide
  `regions: { names, data }` with one zero-based index into `names` per
  map cell. `sample(x, z)` returns the world point, UV, original packed RGB
  and owner, or `null` for an opening or an out-of-bounds coordinate.

## Palette bands and camera

Each ramp maps an exact source hex swatch to one output swatch per band.
Thresholds are inclusive lower bounds for the next band. The altitude ramp
looks up the original paint swatch using the cell’s world Y. The distance
ramp then looks up that result using each pixel’s forward camera depth.
Missing entries leave the current color in place. Entries can use hex
colors or packed RGB integers. `altitudeBands: false` and
`distanceBands: false` disable the respective ramps for a render.

`camera.at` is the eye position, and `yaw` is measured in radians from
positive Z toward positive X. The camera is level. Animate eye height to
clear ridges and `horizon` to move the vanishing line in art pixels.
`fov` sets the vertical field of view in radians. `near` and `far` clip
forward depth. Pass an exact `background` swatch or leave it transparent
for a separate sky layer.

The renderer returns aligned color, depth, surface IDs, UVs and camera
calibration. Use the [shared render outputs](render-outputs.md) to place
the flyover in a camera atlas, pick visible terrain, or route depth into
an effect.

## Demo

[The Salt Lantern Basin](../examples/heightmap-flyover.js) climbs over
the near escarpment to reveal a network of brine channels. The ochre
strata use the altitude ramp and the distant mesas use the distance ramp.

```sh
node cli/ink-studio.js clip examples/heightmap-flyover.js --w 256 --h 152 --px 1 \
  --raw --from 0 --to 8 --fps 15 --out salt-basin.apng
```
