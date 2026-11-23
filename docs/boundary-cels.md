# Hand-drawn boundary cels

`KIT.boundaryCels` walks the visible native-pixel seam between two named
materials, two lighting bands, or a subject and its background. A family
supplies different indexed artwork for straight runs, inside corners,
outside corners, tapers, and deliberate gaps. The renderer places them
with whole-pixel turns and mirrored ends.

```js
const boundaryCels = {
  rules: [{
    id: 'ice-crust',
    inside: { select: { material: 'frost' } },
    outside: { select: { material: 'copper' } },
    gaps: [{ material: 'bolt' }],
    family: K.boundaryCels.preset('frost', {
      swatches: { rim: '#a9e0db', core: '#f1f6dc' }
    })
  }]
};
const world = B.finish({ ...scene, look: { ...scene.look, boundaryCels } });
```

The default family is `'frost'`. It comes with separately drawn 3×3,
5×5, and 7×7 cels. Load any of the 15 `boundary-frost-*` clips in the
[Pixel Stamp Workshop](../examples/pixel-stamp-editor.html) and edit its
indexed swatches and texels. Use cel clusters sparingly along a large
surface so the underlying shapes still read at 1×.
[Raymond Schlitter’s texture studies](https://raymond-schlitter.squarespace.com/blog/2018/2/15/pixelblog-2-texture)

## Read the seam

- Each rule requires a named `id` and an `inside` source. An `outside`
  source defaults to `{ background: true }` for silhouette edges. Use
  a [target selector](target-inspection.md) in `select` to restrict
  material, object, surface, entity or tags.
- Add `swatches` as an array of exact `#rrggbb` values, or `luma: [min,max]`
  on a 0–1 scale, to classify the resolved display colors. Reuse the same
  `select` on both sides with different swatches or luma ranges for lighting
  bands. An overlap takes the inside classification.
- Target pixels in `gaps` break the seam and remain untouched. A seam that
  ends near a gap chooses a `gap` cel. Other open ends use `taper`.
  Visible pixels outside the two sources stay out of the trace. Corner
  classification follows connected cardinal edges. `cornerRun` defaults
  to two pixels of straight edge on either side of a turn, so every one-pixel
  stair step need not become a corner.
- The pass paints the `'inside'` by default. Set `paint` to `'outside'`
  or `'both'` to admit additional texels. Each texel stays on its allowed
  side and visible subject. In transparent exports, empty pixels can define
  the contour while keeping their transparency. The pass changes native color only.
  It shares the original depth, ownership and auxiliary passes.

## Draw cels at each size

A family can contain up to eight `sizes`. Give each size an `id`, an
ascending `minPixels` threshold starting at 0, a `spacing` between
straight placements, and all five `cels`. Ink measures the seam length
in native pixel edges to choose a size. Straights make room for corners
and ends.

Draw facing east with the inside below the edge and place a `pivot` on
the intended inside-texel anchor. By default, the pivot is the center
texel, rounded down in zero-based coordinates. A cel can be a
[stamp](pixel-stamps.md), a workshop clip name, a `{ stamp, pivot }`
pair, or `null` for an intentionally empty pose. Each cel keeps its
original dimensions and optional timed frames. The shared shape and
color apply after light and color-cluster resolve in the headless and
WebGL renderers. Enable the pass when rendering styled camera views.

Use `boundaryCels: false` in the renderer or `--boundary-cels off` in the
CLI for a matched comparison. The headless frame's `boundaryCels` report
counts changed pixels and sites by kind and size. Set
`captureBoundarySites: true` to include each site’s pivot, turn, and mirror.
WebGL can return the same report through `boundaryCelsFrame(report)`.

## Rime Lock

Generate the [Rime Lock study](../examples/frost-boundaries.cjs). Scrub the
frost front, compare with the underlying seam, and inspect the protected
bolt at an integer magnification. The browser page includes the exact
authored cels for all three sizes.

```sh
node examples/frost-boundaries.cjs ./rime-lock
```
