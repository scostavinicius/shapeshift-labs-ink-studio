# Sector-based rooms

Choose `KIT.sectorRaycaster.create` to turn a polygon floor plan into a
native-pixel view. You can also use `KIT.tileRaycaster.create({ mode: 'sectors',
...definition })` where a host already has a tile raycaster entry point.
Both modes share indexed textures, directional sprites, and the
[compositor's shared render outputs](render-outputs.md).

```js
const rooms = KIT.sectorRaycaster.create({
  palette: ['#101c26', '#34505c', '#7da79b', '#f4c591'],
  sectors: [
    { id: 'vestibule', polygon: [[-3,0], [3,0], [3,4], [-3,4]],
      floor: 0, ceiling: 3.4, wall: 1, floorPaint: 0, ceilingPaint: 0 },
    { id: 'gallery', polygon: [[-2,4], [2,4], [2.9,8], [-2.9,8]],
      floor: 0.5, ceiling: 2.6, wall: 2, floorPaint: 1, ceilingPaint: 0,
      shade: { distances: [4], ramps: { 2: [2,1] } } }
  ],
  portals: [{
    id: 'gallery-door', between: ['vestibule', 'gallery'],
    segment: [[-1.1,4], [1.1,4]], lintel: 2.45, trim: 3,
    door: { open: time => Math.min(1, Math.max(0, time / 2)), paint: 1 }
  }]
});
const frame = rooms.render({
  width: 224, height: 140, time: 1.2,
  camera: { at: [0,1.5,2], yaw: 0, fov: 1.05 }
});
```

## Lay out and paint the rooms

- A sector is a simple XZ polygon with a flat `floor` and `ceiling` in world Y.
  Either winding works, and concave outlines are allowed. Shared boundaries
  may touch. Sector interiors must be disjoint. Up to 128 rooms and 2,048
  edges can share one floor plan.
- A sector's `wall`, `floorPaint`, `ceilingPaint`, and `edgePaint` entries take
  palette slots or opaque [indexed pixel stamps](pixel-stamps.md).
  `edgePaint` maps zero-based authored edge indices to individual paintings.
  Walls fit the paint to one whole edge with U following the authored vertex
  order. Each floor and ceiling repeats its stamp in world XZ with
  `planeScale: [x, z]` specifying the repeat size in scene units.
- Set a global `shade` or give a sector its own `shade` with forward-distance
  bands and palette ramps. `lightBand` adds a fixed band offset within that
  sector. The [tile raycaster guide](tile-raycaster.md#author-the-room)
  describes the shared ramp and wall-side settings.
- A portal's `segment` lies on one edge of each adjoining sector. It may
  occupy part of those edges. Its opening runs from the higher floor to the
  lower ceiling, narrowed by optional absolute-world-Y `sill` and `lintel`
  values. Visible steps and headers use the room wall or optional `trim`
  paint. Each doorway narrows the next room's visible rows in that column.
- Add `door: { paint, open, slide }` for a sliding opaque panel.
  `open` is 0–1 or a function of time. `slide` defaults to `"positive"`
  along the authored segment. A render or cast can override an aperture
  with `doors: { 'gallery-door': 0.75 }`.
- Supply `sprites` with the same indexed directional views, world positions,
  pivots and scale as the tile raycaster. The receiving room's opening clips
  them before depth compositing.

## View and inspect

`camera.at` is XYZ between the current room's floor and ceiling. Yaw is
measured from +Z toward +X, `fov` is vertical, and optional `horizon`
shifts the view vertically in art pixels. Set `camera.sector` if the
viewpoint lies exactly on a shared edge and needs an explicit starting room.
`near` limits plane and sprite samples, while `far` limits the whole view.

The frame returns aligned RGBA, depth, surface IDs, UVs and camera
calibration. `frame.sector` is the camera's room. Walls use IDs such as
`gallery:wall:2`. Floors, ceilings, sills, lintels and doors can be picked
independently. Use the frame as a camera-atlas feed or route its depth and
masks into a render graph.

`rooms.locate([x,z])` returns a floor-plan sector or `null`. For a horizontal
visibility query at an exact height, call
`rooms.cast({ at: [x,y,z], direction: [dx,dz], time, doors })`.
It passes through available openings and reports the first wall, header,
step or panel by owner, room, ray depth, U and world position.

## Tideglass Observatory

Run `node examples/sector-raycaster.cjs ./out/tideglass-observatory`
to generate the guided walkthrough, native image frames and a standalone
interactive preview. The preview includes the authored floor plan, an
aperture slider and a picker for the surface beneath an art pixel.
