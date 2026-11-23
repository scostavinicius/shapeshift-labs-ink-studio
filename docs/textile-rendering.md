# Thread, stitch and woven rendering

`K.textile` makes raised yarn on a surface chart. Each yarn has a capped cross section and native depth, so changing the camera reveals relief, gaps and actual crossings. Use it alongside sculpts and other native surfaces. Open [Thread Studies](../examples/thread-studies.html) after running `npm run build` and serving the repository over HTTP.

| Study | What to look for |
| --- | --- |
| Moon Garden | Raised directional stitches follow the river, moon and stems on a draped cloth. |
| Ember Moth | Alternating loop crossings form continuous knit rows, with colour worked into the moth motif. |
| Signal Harbor | Flat warp and weft strips exchange depth and carry a skyline woven into the cloth. |

## Build a textile plan

```js
const { KIT: K, makeBuilder } = require('@shapeshift-labs/ink-studio').load();
const B = makeBuilder(7);
const plan = K.textile.stitch({
  size: [4, 3],
  columns: 32,
  rows: 21,
  radius: .025,
  chart: (u, v) => [4 * (u - .5), 3 * (v - .5), .2 * Math.sin(Math.PI * u)],
  direction: (u, v) => [1, Math.cos(6 * v)],
  mask: (u, v) => Math.hypot(u - .5, v - .5) - .43
});
K.textile.draw(B, plan, {
  object: 'embroidered-panel',
  material: 'silk',
  color: ({ uv: [u] }) => u < .5 ? '#eda578' : '#589fa2'
});
const world = B.finish();
```

The default chart is a centered XY plane of the requested `size`. A JavaScript `chart(u, v)` takes normalized coordinates and returns a world point or `{p, n}` with an outward normal. Provide normals directly or let the tool estimate them from the chart. The chart should map without folds or singularities across the patch. Keep its scale close to the reference `size` to retain spacing on bends. All three modes accept `columns`, `rows`, yarn `radius` in world units, `lift` along the chart normal, and bounded `samples`.

- `stitch(options)` lays one raised, tapered yarn mark per cell. Set `direction` to a two-component vector in chart-grid units or a function of the stitch centre. `length` is measured in grid cells. `arch` controls height relative to yarn radius. A signed `mask(u, v)` keeps marks whose sampled stations all fall at or below zero.
- `knit(options)` maps one continuous yarn course per row. Each course has repeated loops with opposing depths where adjacent courses cross. Choose a radius comfortably below the reference pitch for a legible open knit. This is a chart-based representation suited to static yarn relief.
- `weave(options)` builds warp and weft through the existing [loom](weaving-braiding.md). Repeat equal-width binary `pattern` rows. One puts warp over weft, and zero puts weft over warp. `flatness` is thickness divided by width. `clearance` adds reference separation before thickness scaling. The loom checks that the chosen strand width and crossing allowance fit the reference pitch. Plans include crossing IDs, UV coordinates and the scaled normal gap at each crossing.

Use separate plans and draws to apply textile styles to individual objects or layers. Plans are immutable JSON records containing sampled yarn stations and stable IDs. Chart and mask callbacks run while building the plan.

## Render the yarn

`draw(builder, plan, appearance)` returns native splat ranges per strand and writes object, material and surface identities. Yarn colour accepts hex, RGB bytes, or a callback receiving `{id, family, index, uv, point, distance}` at each segment. Use `ambient`, `light`, `sheen`, `twist` and `threadPitch` to control the baked shading and colour variation along the strands. Light, colours and yarn geometry are authored at bake time. Use ordinary renderer camera options to orbit.

`sides` controls cross-section segments and defaults to six. `maxPoints` bounds a plan at 60,000 stations by default. `maxMarks` bounds a draw at 180,000 native marks by default, with a maximum of 500,000. Increase resolution by using more chart samples or cross-section sides within those budgets.

`K.textile.world(plan, {appearance, camera})` builds a standalone world. Use graph nodes `textile.pattern` and `textile.world` for the built-in planar chart and JSON controls. The [example graph](../examples/thread-studies.json) writes a woven swatch and serializable plan.

```sh
node cli/ink-studio.js graph run examples/thread-studies.json --out /tmp/thread-studies
```
