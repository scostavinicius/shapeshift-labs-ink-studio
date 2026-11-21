# Registration grids

Use `type: "registrationGrid"` in a composite or render-graph drawing layer,
or in `drawing2d.render`. This grid draws the guides and crosses you specify.

```js
{
  type: 'registrationGrid', origin: [40.5, 40.5], step: [90, 65],
  color: '#72818e70', width: 1, markColor: '#dae2ec', markWidth: 1,
  guides: [
    { axis: 'u', index: 0, span: [0, 5] },
    { axis: 'u', index: 1, span: [0, 5], dash: [.045, .035] },
    { axis: 'v', index: 2, span: [0, 3.5] }
  ],
  crosses: [{ at: [0, 0], size: 11 }, { at: [2, 1], size: 8 }],
  omit: [[2.25, .6, 2, 1.2]]
}
```

Each guide runs parallel to its declared axis at the perpendicular
`index`. Its `span` positions and optional `dash: [on,off]` lengths use
cell units. Coordinates can be fractional or negative. Cutout rectangles
`[u,v,width,height]` remove the interiors they overlap, keeping outlines
along their boundaries and preserving the dash phase across each gap.

Crosses use cell coordinates for placement. Both arms have the same
declared length in screen pixels or world units, depending on the
drawing space. Crosses have their own width and color. Cutouts affect
the guides, so a chosen mark can stay visible inside a cutout.

As with other [drawing primitives](drawing-primitives.md), world-space
grids use an XYZ origin and optional perpendicular U and V directions.
