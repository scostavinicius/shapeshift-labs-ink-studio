# Subject-aware shot reframing

`shot reframe` samples a scene's authored camera at the delivery frame rate and follows selected visible pixels using the native object and material passes. It fits a constant-size pan for each output aspect ratio and keeps every measured subject within that format's safe area whenever the source allows it. One shot can feed widescreen, portrait, and a handheld display with its own margins.

```sh
node cli/ink-studio.js shot reframe examples/subject-reframe/lantern-crossing.json --out /tmp/lantern-crossing
```

Open `index.html` to scrub or play the shot, switch deliverables, and compare the result against a fixed center crop of the same size. `paths.json` contains the measured bounds, solved crop keys, and frame diagnostics. Each delivery ID also names an animated PNG at the requested dimensions and frame rate.

## Author a plan

Start from [the lantern crossing plan](../examples/subject-reframe/lantern-crossing.json).

- Set `format` to `ink-studio/subject-reframe` and `version` to `1`. Set `scene` to an Ink scene ID or a path relative to the plan. Optional `seed` and `controls` are passed to the scene builder.
- Set `width` and `height` to the source art grid. `from` defaults to zero seconds. Samples run at `from + index / fps` for the specified number of `frames`. `fps` defaults to 24. Source capture uses the single-view native scene raster and its aligned ownership passes.
- Give each subject a unique `id` and a `select` with an `object`, a `material`, or both. Matching both fields is useful for a skin material on one actor. A hand or prop with its own object name can be selected independently. Optional `label` appears in the review and `weight` biases composition toward a subject inside the available safe area.
- Give each output a unique `id`, `width`, and `height`. `safeArea` is `[left, top, right, bottom]` in normalized delivery coordinates, with the origin at the top left. `scale` is a preferred fraction of the largest aspect-matched crop that fits the full source. The solver picks a nearby scale when necessary to fit more safe frames. The crop size stays fixed for that delivery throughout the shot.
- Increase `smoothing` to favor slower changes between crop positions. The default is 8. Set it to zero to follow the per-frame composition directly within the safe-area constraints.

A frame is safe when all selected subjects have visible pixels, their bounds clear the source edges, and all measured bounds fit inside the delivery safe area. Occluded subjects, subjects touching the source edge, and safe-area misses appear in the review and path report. With an infeasible layout the tool exports the best coverage it found at a single scale and marks the affected frames.

## Reuse a saved path

```js
const { sampleReframe, reframeRaster } = require('@shapeshift-labs/ink-studio');
const paths = require('./paths.json');
const portrait = paths.formats.find(format => format.id === 'portrait');
const crop = sampleReframe(portrait, 1.25); // [x, y, width, height] in source art pixels
const deliveryFrame = reframeRaster(sourceFrame, portrait, 1.25);
```

`sourceFrame` is a raster with `w`, `h`, interleaved `rgb`, and optional `alpha`, captured with the same camera and dimensions. `sampleReframe` linearly interpolates crop origins between keys and holds the first or last crop outside the sample range. Raster export snaps the origin to the art grid and uses nearest-neighbor sampling. The safety report covers the rendered sample times.
