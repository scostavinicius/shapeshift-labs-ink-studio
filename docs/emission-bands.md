# Traveling emission bands

`KIT.emissionBands.create()` paints repeating wavefronts from a distance
field. Each wave has a hard crest, a stepped body ramp, and a transparent
gap. The crest has its own emission raster so the nearby halo can spread
while the drawn swatches stay sharp.

```js
const waves = KIT.emissionBands.create({
  palette: 'prism',
  origin: [160, 98],
  scale: [1.26, .87],
  jagged: { amount: 18, spokes: 21, twist: .035, seed: 92 },
  start: 24,
  crest: 1, body: 13, gap: 10,
  speed: 16,
  halo: { radius: 4, strength: 1.3 }
});

world.look.renderGraph = { passes: [
  { id: 'waves', type: 'composite', layer: waves.layer({ resolution: [320, 214] }) }
] };
```

- `origin` is top-left pixel XY and defaults to the center of the art
  grid. `scale` stretches the default radial field on each axis.
  `jagged.amount` controls the offset in field units, `spokes` sets
  the number of angular teeth, and `twist` bends them as they move
  outward from the center. Set `jagged: false` for smooth fronts.
- `crest`, `body`, and `gap` are widths in field units. On a
  smooth radial field at 1:1 scale, `crest: 1` is one art pixel wide
  measured outward along the radius. Fields with steep slopes compress
  the spacing. `phase` offsets the pattern in field units and
  `speed` moves it in field units per second. Negative speed leads
  with the crest toward decreasing distance. Zero holds the pattern.
- Use `palette: 'prism'` or `'ember'`, or pass an array of up to 16
  wave palettes. Each entry has one `crest` swatch and 1–16 `body`
  swatches in front-to-tail order. A short ramp can make broad color
  blocks with a distinct outline. The default field and fixed masks
  loop at `waves.period` seconds when speed is nonzero.
- `start` and `end` bound the distance range, including the halo.
  The built-in radial field leaves its first 16 units clear by default.
  To protect a silhouette or clip waves to a window, use `mask` as
  an aligned one-channel byte coverage raster (0–255), or return
  coverage from zero to one in a callback. The mask gates both the
  emission source and the final halo. You can also composite a
  foreground sprite over the waves.
- `field` can be an aligned one-channel raster of signed distances or
  a function `(x, y, context) => distance`. Mask functions receive
  the same pixel centers and context including time. When using a
  compositor layer, set `needsCamera: true` to receive its renderer
  camera. A custom distance field can drive traveling contours around
  lettering, a cutout, or the edge of a larger field.
- `halo` blurs the colored crest with a radius of 1–16 art pixels.
  Set its `sigma` and `strength` for the falloff, or use
  `halo: false` for hard palette-only ink.

`waves.frame({ width, height, time })` returns aligned rasters for hard
color (`value`), colored `crest`, byte crest `mask`, and soft
`halo`. `waves.layer()` paints the halo behind the hard colors and
scales with nearest-neighbor filtering. Use
`waves.layer({ part: 'value' | 'crest' | 'halo' })` for individual
layers when composing a custom effect.

In the procedural graph, use `fx.emissionBands` with the same settings
in `options`. Supply an optional scalar distance raster on `source`
and a byte coverage raster on `mask`. Give `options` a `width`
and `height` for the built-in radial field unless an input raster
provides the dimensions. The graph's time drives the effect, and its
output ports are `value`, `crest`, `mask`, and `halo`.

## The Tuning Gate

The [runnable demo](../examples/tuning-gate.js) sends jagged color fronts
through a ruined arch behind a lantern keeper. Use `study: 'ember'`
for a warm palette, `study: 'reverse'` to pull the fronts inward, or
`glow: false` to see the hard palette ramps.

```sh
node cli/ink-studio.js clip examples/tuning-gate.js --w 320 --h 214 --px 1 \
  --raw --from 0 --to 6 --fps 15 --out tuning-gate.apng
```
