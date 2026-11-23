# Tilemap raycaster

`KIT.tileRaycaster.create` turns a top-down tile grid into a native-pixel
view. One ray per art column finds the first wall or sliding door.
Directional sprites share the view’s depth buffer, so an open sliver of
a door can reveal just a few sprite columns.

Use [sector-based rooms](sector-raycaster.md) for a polygon floor plan with
separate floor and ceiling heights and linked doorways.

```js
const stamp = (...rows) => ({ width: rows[0].length, height: rows.length, rows });
const hall = KIT.tileRaycaster.create({
  map: ['#####', '#...#', '##.##', '#...#', '#####'],
  palette: ['#101c26', '#34505c', '#7da79b', '#f4c591'],
  tiles: { '#': { paint: stamp('1221', '1111'), faces: { north: stamp('1112', '1111') } } },
  wallHeight: 1.6,
  floor: stamp('01', '10'),
  ceiling: stamp('00'),
  doors: [{
    id: 'archive-shutter', at: [2, 2], axis: 'z', slide: 'positive',
    paint: stamp('1331', '1221'), open: time => Math.min(1, Math.max(0, time / 2))
  }],
  sprites: [{
    id: 'paper-owl', at: [2.5, .15, 1.5], height: .9,
    views: [
      { yaw: 0, paint: stamp('.3.','232','.2.') },
      { yaw: Math.PI / 2, paint: stamp('3..','232','.2.') }
    ]
  }],
  shade: { distances: [1.8, 3.5], ramps: { 2: [2, 1, 0] }, sideBias: { x: 1 } }
});
const frame = hall.render({
  width: 216, height: 136, time: 1.25,
  camera: { at: [2.5, .8, 3.5], yaw: Math.PI, fov: 1.1 }
});
const hit = KIT.renderOutputs.pick(frame, 108, 64);
```

## Author the room

- Each map string is one row. Columns increase along world X and rows
  increase along world Z. Each cell is one scene unit wide. A dot marks
  empty space. Every other character must name a wall tile. Map edges
  open onto the backdrop. Use wall tiles around the perimeter to close it.
- A wall tile supplies `paint` and optional `faces` to replace
  individual `north` (−Z), `east` (+X), `south` (+Z), and `west`
  (−X) faces. All walls span Y=0 to `wallHeight`. The optional floor
  and ceiling stamps repeat once per cell. Use a palette slot in
  `background` for a solid sky behind open edges, or leave it transparent.
- Textures use [indexed pixel stamps](pixel-stamps.md) with rows, slots,
  strokes, or timed frames. Palette slots refer to the raycaster’s shared
  palette by default. A stamp can provide a local palette whose entries
  reference shared indices or matching hex swatches. Wall, door, floor,
  and ceiling paint is opaque. Sprite dots leave holes.
- Each door sits in an empty cell. Its `axis` is the normal to its
  centered panel. A Z-axis door slides along X and an X-axis door slides
  along Z. `slide` moves the slab and its paint toward positive or
  negative coordinates. Openness goes from 0 (closed) to 1 (hidden).
  Supply a number or a function of view time. A render can override it
  with `doors: { 'archive-shutter': .5 }`.
- A sprite can use a fixed anchor and yaw or supply functions of time.
  Each view is its own drawing or animation. Its relative `yaw` is in
  radians from +Z. The viewer selects the closest angle. `height` sets
  projected scale and each cel can provide a top-left pixel `pivot`.
  It defaults to bottom-center. Sprite sampling uses nearest neighbor.
- `shade.distances` sets forward-depth band boundaries. Each ramp
  maps one original palette slot to another slot in each band. Omitted
  colors keep their swatches, which lets a candle core stay bright.
  `sideBias` can move walls and doors on one axis into a darker band.

## View and inspect

`camera.at` is XYZ inside an empty or door cell, with eye height
between floor and ceiling. `yaw` is measured from +Z toward +X. `fov`
is vertical. The camera stays level. Change the optional `horizon`
in art pixels to shift the view up or down. Set the near range for plane
samples and sprites, and the far range for the whole view, in forward
scene units. A wall stays opaque right up to its face.

The [shared render outputs](render-outputs.md) contain color, depth,
surface IDs, UVs, and camera calibration. Walls are named `wall-X-Z`.
Doors and sprites keep their authored IDs. `placements` reports each
on-screen sprite’s selected yaw, destination rectangle, and visible
pixel count. Use the frame as a camera-atlas source to put this world on
a monitor, or route its depth and masks into a render graph.

`hall.cast({ at: [x,z], direction: [dx,dz], far, time, doors })` returns
the first wall or panel in the horizontal grid, including its owner,
cell, face, intersection point, and U coordinate. `cast` normalizes
its direction and reports distance along that ray. Frame depth is
forward camera depth.

## The Lantern Archive

[The Lantern Archive](../examples/tile-raycaster.js) uses illustrated
limestone, bookcases, copper jambs, and an animated paper moth. As the
shutter opens, watch the first wing appear before the rest of the sprite.
The camera then passes through the doorway and reveals a separate side
drawing. The standalone preview shows the original tilemap beside the
view. Scrub the camera, slide the shutter manually, or pick an art pixel.

```sh
node examples/tile-raycaster-preview.cjs lantern-archive.html
node cli/ink-studio.js clip examples/tile-raycaster.js --w 216 --h 136 --px 1 \
  --from 0 --to 7.4 --fps 15 --out lantern-archive.apng
```
