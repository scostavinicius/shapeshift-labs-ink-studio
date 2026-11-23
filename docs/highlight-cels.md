# Light-driven highlight cels

Bind a set of indexed drawings to an anchor on a material. A named area
light and the camera choose a drawing from the size that fits the projected
span. The software and WebGL renderers place each covered texel on one
native art pixel. Both depth-test the cel against opaque foreground geometry.

```js
const brass = K.highlightCels.preset('brass', {
  swatches: { spark: '#ffe8ac', core: '#fff7d8' }
});
const highlightCels = [{
  id: 'medallion-rim', family: brass, light: 'swing-lamp',
  at: [-2.6, 2.27, .464], normal: [0, 0, 1], tangent: [1, 0, 0],
  span: 1.02, bias: .018
}];
const world = B.finish({ ...scene, areaLights, highlightCels });
```

- Assign each anchor a unique `id` and the `id` of a rectangular, disc, or
  line light. An anchor can use a named family such as `family: 'enamel'`.
  Reuse the same family on several surfaces. In JSON, put the anchors in
  `finish.highlightCels`. JavaScript anchors can use a time function for
  `at`, `normal`, or `tangent`.
- Ink measures `span` along the surface tangent after projection, in native
  pixels. This includes foreshortening on an oblique view. The stock
  families switch from pin to hook at 15 pixels and from hook to arc at
  30 pixels. Each pose has its own authored raster. The renderer snaps the
  anchor to the art grid and places the cel at its original dimensions.
- The anchor faces the light and camera. The light's range, intensity,
  projected cookie, and shadows from retained SDFs and painted cutouts
  affect activation. The stock families use `minFacing: .08` and
  `minLight: .02`. `bias` lifts the cel's depth along its normal by the
  specified world distance.
- Each pixel is depth-tested at its point on the anchor's tangent plane.
  Display colors land
  after palette resolve and retain their authored swatches. The cel is a
  camera-view highlight. Reflective and refractive captures use the
  underlying scene lighting.

## Draw a family

A custom family has one or more `sizes` with ascending `minPixels`
thresholds starting at zero. Each size has a named list of `cels` with
their own reference directions.

```js
const ceramic = {
  sizes: [{
    id: 'pin', minPixels: 0, cels: [{
      id: 'cool-dot',
      light: [-.4, .2, 1], view: [0, 0, 1],
      stamp: { width: 1, height: 1, rows: ['0'], palette: ['#acf0dc'] }
    }]
  }, {
    id: 'chip', minPixels: 19, cels: [{
      id: 'left-hook',
      light: [-.5, .2, 1], view: [0, 0, 1],
      stamp: { width: 3, height: 3, rows: ['.1.', '01.', '...'],
        palette: ['#6ac8b7', '#acf0dc'] }
    }]
  }]
};
```

Light and view directions are expressed in the anchor's frame. Positive X
is along the tangent, positive Y is along the normal crossed with the
tangent, and positive Z points out of the surface. Ink selects the closest
pair of directions. Both default to `[0, 0, 1]`. Use `pivot: [column, row]`
to pin a particular pixel. `offset: [x, y]` moves the drawing by whole art
pixels, right and down. Each cel can contain a static indexed drawing, an
animated stamp driven by scene time, or a library clip name.

The [Pixel Stamp Workshop](../examples/pixel-stamp-editor.html) has all
24 brass, enamel, and glass clips under **Library clips**. For example,
edit `highlight-brass-arc-front` and place the saved stamp in the matching
family pose. [Indexed pixel drawing](pixel-stamps.md)

## The Jeweler’s Bench

Run the [bench example](../examples/highlight-cel-bench.js) to see brass,
enamel, and cut glass respond to a swinging lamp. The `scale` study
travels from the brass pin to the hook, arc, and grazing pose.

```sh
node cli/ink-studio.js clip examples/highlight-cel-bench.js --raw \
  --w 360 --h 206 --px 1 --from 0 --to 4.8 --fps 10 --out bench.png
node cli/ink-studio.js clip examples/highlight-cel-bench.js --raw --params '{"study":"scale"}' \
  --w 360 --h 206 --px 1 --from 0 --to 4.8 --fps 10 --out brass-scale.png
```

Use `--highlight-cels off` in the CLI or `highlightCels: false` in renderer
options to compare against the underlying lighting.
