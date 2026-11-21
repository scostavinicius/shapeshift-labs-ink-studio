# Voxel and relief-pixel surfaces

`K.voxelSurface` samples a signed-distance field on a regular grid. Use it for selected objects alongside the usual sculpt representation. It draws planar faces as native splats, and can also export them as a mesh.

Open [Solid Signals](../examples/voxel-surface.html) after running `npm run build` and serving the repository over HTTP. The canal district has a breakable tower, the automaton turns from a smooth sculpt into scattering blocks, and Four Readings shows the same field in all four modes.

```js
const { KIT: K, makeBuilder } = require('@shapeshift-labs/ink-studio').load();
const B = makeBuilder(1);
const sphere = (x, y, z) => Math.hypot(x, y, z) - 0.9;
const plan = K.voxelSurface.fromSdf(sphere, {
  bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  mode: 'cubes',
  size: 0.16,
  closed: true
});
const batch = K.voxelSurface.draw(B, plan, { color: '#68b9bd', object: 'statue' });
const world = B.finish();
```

| Mode | How it samples the field |
| --- | --- |
| `cubes` | Keeps one block per occupied cell. A three-component `size` can stretch the cells. |
| `columns` | Joins consecutive occupied cells along `axis`, retaining gaps between runs. |
| `slabs` | Merges occupied cells into rectangles in each layer perpendicular to `axis`. |
| `relief` | Takes the first occupied cell on each ray and extrudes that pixel inward. `side` chooses the viewing side, and `thickness` rounds up to whole cells. |

`fromSdf` accepts a function or an object exposing `sd(x, y, z)`. Bounds are world-space. `origin` anchors the lattice, and `orientation` sets its XYZ rotation in radians. A cell is occupied when its center is inside the bounds and the signed sample is at or below `iso`. The cell itself may extend past the sampling bounds. Cell, sample, block and face limits are configurable.

Static plans cull shared faces by default. Set `closed: true` to keep every face for animation or destruction, or set `gap` to shrink each block by a fraction of a cell and reveal seams. `draw` returns the splat IDs for each block. Pass `color` as a hex color, RGB bytes or a callback receiving `(block, face)`. Use `grouping: 'normal'` to group palette variations by the direction a face points.

- `K.voxelSurface.bind(world, batch, { pose })` binds independent blocks to the splat rig. The callback receives `(block, time, index)` and returns optional `translation`, uniform `scale` and a row-major 3×3 `rotation` about the block center.
- `K.voxelSurface.groups(batch, { prefix, ...options })` returns one structural group per block for `K.destruction`. See [Destruction](destruction.md) for release, impact and reset.
- `K.voxelSurface.toMesh(plan, appearance)` exports the faces as triangles. `K.voxelSurface.world(plan, { appearance, camera })` builds a standalone world.

The scene graph exposes `sdf.voxels`, `voxels.world` and `voxels.mesh`. Run the [example graph](../examples/voxel-surface.json) to render a block torus.

```sh
node cli/ink-studio.js graph run examples/voxel-surface.json --out /tmp/ink-voxel-study
```
