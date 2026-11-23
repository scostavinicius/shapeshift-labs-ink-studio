# Pose-following surface probes

`KIT.surfaceProbe.create` evaluates named points on the current pose. A
probe lights up samples in range and links a bounded set of landmarks to
the cursor. Samples can share the same color palette as the scene or use
hand-drawn pixel cels for their marks.

```js
const probe = K.surfaceProbe.create({
  space: 'screen',
  at: ({ world }) => world.pointerPixel ?? null,
  radius: 28,
  hold: .2,
  maxLeaders: 5,
  samples: [
    { id: 'fin-tip', label: 'FIN TIP', at: { splat: 417 }, mark: 'cross' },
    { id: 'gill', at: { part: 'head', point: [.2, .4, 0] }, mark: ['##', '.#'] },
    { id: 'skin-08', at: ({ world, sceneTime }) => skinPoint(world, 8, sceneTime),
      color: '#466e88', leader: false }
  ]
});

world.look.composite = { layers: [probe.layer()] };
// In a render graph use { id: 'probe', type: 'composite', layer: probe.layer() }.
```

- For `space: 'screen'`, set the probe center to top-left layer-pixel XY
  and set the radius in those pixels. The default `space: 'world'` uses
  an XYZ center and a world-unit radius. Sample points always use world
  anchors.
- Each sample has a distinct `id` and an `at` anchor. Use XYZ, a
  [posed splat, rig part or bone](target-inspection.md#anchors-and-activation),
  a live hierarchy node or socket, or an [annotation binding](view-annotations.md).
  A callback can return a position, a binding, or `null` to hide the point.
- Jitter at the edge of the radius leaves a sample in a separate `held`
  state for `hold` seconds. Held points retain their IDs and use their
  **current** projected positions. A linked point keeps its slot until
  its hold expires or its anchor disappears. Open slots prefer nearby
  live hits. The default is six links and a .18-second hold.
  `maxLeaders` accepts zero through 16. Use `leader: false` on dense
  rows of visual marks and leave leaders enabled on selected landmarks.
- `mark` accepts `dot`, `dash`, `cross`, `ring`, or a rectangular
  array of `#` and `.` rows up to 9×9 pixels. Marks snap to the
  raster grid. Colors may be RGB or RGBA hex swatches. Set `style.idle`,
  `hit`, `held`, `leader`, `bracket`, and `cursor` to match the
  scene. A point's `color` overrides its idle swatch. A probe can hold
  up to 4,096 samples and 8,000 drawn mark pixels.
- The layer is a screen overlay with camera clipping. Use an anchor
  callback returning `null` to suppress marks for parts hidden by the
  subject. See [target inspection](target-inspection.md#shared-visibility)
  for depth-tested bounds and magnifiers.

For a custom readout, call `probe.sample({ world, camera, width, height, time,
sceneTime })` to get the cursor, visible samples, and linked landmarks.
A sample reports its world `position`, projected pixel `at`, `label`, probe
`distance`, and `state` (`idle`, `hit`, or `held`). Pass this frame to
`probe.commands(frame)` to get hard-edge drawing commands for the pixel
marks, leaders, and brackets. Callbacks receive the same clocks and
`project(xyz)`, which projects a position into layer pixels.

Keep one probe instance per independently sampled view. The hold uses the
presentation clock `time`; posed splats and anchor callbacks can use the
animation clock `sceneTime`. Seeking backward or calling `probe.reset()`
clears the hold. Sample earlier frames in order to reconstruct it for an
export. For returns that should stay where they were captured in the world,
use a [persistent pixel scan](pixel-scanner.md).

## Hadal Survey

[The runnable example](../examples/hadal-surface-probe.js) sweeps a
cursor across a ray as its wings flex and its tail bends. A dense layer of
pixel cels responds to the cursor, and the side panel lists the current
linked landmarks along with the live and held counts. The ray art and the
probe marks use the same deformation.

```sh
node cli/ink-studio.js clip examples/hadal-surface-probe.js --w 378 --h 228 --px 1 \
  --raw --from 0 --to 7.2 --fps 15 --out hadal-survey.apng
```
