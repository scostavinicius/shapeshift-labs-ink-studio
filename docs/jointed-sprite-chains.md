# Jointed sprite chains

`KIT.spriteChains` couples Ink’s XPBD springs to hand-drawn pixel stamps.
Use it for a hose riding a guide wheel, a spring compressing on a rail,
or a tail or vine trailing from a moving attachment.

```js
const cable = KIT.spriteChains.style({
  palette: ['#392d37', '#b06651', '#ffc68a'],
  straight: [{
    sockets: [[0, 1], [4, 1]],
    stamp: { width: 5, height: 3, rows: ['.020.', '12221', '.010.'] }
  }],
  compressed: [{
    sockets: [[0, 1], [2, 1]],
    stamp: { width: 3, height: 3, rows: ['020', '121', '010'] }
  }],
  compressAt: .75
});

const chain = KIT.spriteChains.create({
  points: [[20, 14, 0], [24, 14, 0], [28, 14, 0], [32, 14, 0]],
  pins: [0, { index: 3, at: time => [30 + 2 * Math.cos(time * 3), 15, 0] }],
  style: cable,
  radius: 1,
  sdf: (x, y) => 18 - y
});

const layer = chain.layer({ resolution: [64, 40] });
const frame = chain.render({ width: 64, height: 40, time: 1 });
```

## Draw link poses

Draw each link as a static [pixel stamp](pixel-stamps.md), with two painted
socket texels marking where its joints attach. Socket coordinates are
zero-based `[x, y]` texel centers. The renderer snaps both placements that
share a joint to the same pixel. Authors can supply one or several drawings
per pose, each with its own grid, socket span, and direction.

The required `straight` family is joined by optional `contact`,
`compressed`, and `bent` families, in that order of priority.
Compression compares the solved 3D length to the rest length using
`compressAt`. Bends compare the sharpest adjacent projected joint turn
to `bendAt` in radians. A bent drawing can be mirrored across its
socket axis for the opposite turn. Set `mirrorBent: false` to keep
asymmetrical paint on the original side.

The renderer picks the closest authored socket length and direction,
allowing quarter turns. When the length and direction match, only a
translation or quarter turn is needed. In between, nearest-neighbor
sampling fits the drawing between the two sockets and preserves its
swatches. Use `linkStyles` with one prepared style or `null` per link
to give the root, middle, and tip different artwork. A style can use a
shared `palette` or a stamp-specific palette. The optional second
argument to `style` carries `scenePalette` and `paletteRoles`.

## Drive and inspect

- `points` are ordered rest XYZ positions. A numeric pin holds its
  joint at rest. Use `{ index, at }` with a position or a function of
  scene time for a moving attachment. Use `pins: []` for a free chain.
- `stretch` and `bend` are XPBD compliance. Higher values give softer
  constraints. Set `bend: 0` to omit the second-neighbor springs. Use
  `gravity` and `damp` to control how the links settle.
- `sdf(x, y, z, time)` gives signed distance to a collider. Negative
  distances are inside the collider. Each free joint collides with its
  own `radius`, with configurable `friction` and `contactTolerance`.
  Place joints close enough to follow detailed contact surfaces.
- `sample(time)` exposes the simulated joint positions and contact
  points and normals. It uses a fixed clock at `hz` steps per second
  with `substeps` XPBD passes each step. The same time gives the same pose
  when pin and collider functions are deterministic. Seek or export
  frames in any order within the first 600 seconds.
- `render` adds RGBA and the selected state and cel index per link.
  By default XY are native pixel coordinates, with positive Y downward.
  Supply `project(point, time)` for a custom projection. Returning
  `null` skips links attached to that point.
- Add `layer()` to the scene’s [mixed-resolution composite](mixed-resolution.md).
  The layer follows scene time through holds and retiming. With
  `layer({ space: 'world' })`, the scene camera projects the XYZ joints and
  the chain draws in its own overlay.

## Tidegate Pump

[The demo](../examples/jointed-sprite-chains.js) uses two chains.
The upper hose sags into a guide wheel and turns teal on contact.
The lower accordion switches to a shorter, separately painted cel
as the piston closes.

```sh
node cli/ink-studio.js clip examples/jointed-sprite-chains.js --w 272 --h 160 --px 1 \
  --raw --from 0 --to 8 --fps 18 --out tidegate-pump.apng
```
