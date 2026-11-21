# Ray fans

Draw a bundle of fine, evenly spaced straight rays with `type: "rayFan"`
in a composite layer, a render-graph drawing layer or `drawing2d.render`.

```js
{
  type: 'rayFan', origin: [180, 245],
  angles: [-1.25, .4], radii: [34, 235],
  count: 96, width: .65, color: '#b4cdff50'
}
```

`angles` gives the start and end in radians from the U axis toward the V
axis. Sweeps can run in either direction. A full turn places each ray once
around the origin. A sector includes both end rays. `radii` gives the start
and end distance of every ray in the drawing space. Set a positive inner
radius to leave the origin open. `count` is between 2 and 256.

In screen space, the default U and V axes point right and down. For a
projected fan, set `space: "world"` with an XYZ origin and optionally
provide perpendicular `u` and `v` directions. World fans inherit the
camera clipping and line width options of other [drawing primitives](drawing-primitives.md).
