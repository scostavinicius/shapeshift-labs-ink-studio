# Native-resolution lighting approval

Use `shot light-approve` to fit one shot lighting rig to native-size contour and palette checks. Ink renders the posed scene separately at each art grid, with its palette enabled. Each candidate uses the same key, fill and exposure settings across all grids.

```sh
ink-studio shot light-approve examples/native-lighting-approval/signal-box.json --out signal-box
```

Open `index.html` to select an art grid and compare the starting rig with the fitted rig. **Show check evidence** marks contour samples and exact swatch pixels. **Review unresolved** opens a grid that missed a check. The output includes the fitted `rig.json`, the full `approval.json` report, and native PNGs of both rigs at each size.

## Author an approval plan

Start with [the signal box plan](../examples/native-lighting-approval/signal-box.json).

- Use `format: "ink-studio/native-lighting-approval"` and `version: 1`. Set `scene` to a scene ID or a path relative to the plan. Set `rig` to a relative path to a static shot lighting JSON file with a key and fill, or use the scene's authored rig. Optional `time`, `seed`, and `controls` choose the scene pose.
- Add two to six distinct `grids`, each with an `id`, `width`, `height`, and optional `label`. Sizes are native art pixels. Each view uses the authored camera and lighting at the chosen time.
- Define `subjects` with an `id` and a [look selector](pixel-look.md#shared-look-selectors). Define `checks` with the same `swatch` or `readability` settings used by [palette checks](palette-recipes.md#run-palette-checks-in-ci). A check can name its `grids`, or apply to every grid by default. Optional `label` appears in the review and `weight` scales the penalty for a missed limit.
- A visor check might use `minSamples`, `minPixels`, and `minLightnessP10` on the 96-pixel grid. The lightness P10 is the 10th percentile of the absolute OKLab lightness difference between the visible contour and adjacent background. A lever check can set an exact `swatch` and the minimum `minShare` of visible lever pixels that must resolve to it.
- Set `evaluations` to the number of candidate rigs to search. The default is 40. Each candidate renders every grid once. Optional `aim` sets the XYZ pivot used when orbiting the key.

The search adjusts the same light controls as the [painted target fit](shot-lighting.md#fit-a-rig-from-painted-targets). It ranks the sampled rigs by the number of grid checks passed, then by their weighted shortfalls. Visible pixels, contour edges and exact colors are measured at the native single-view raster before presentation compositing.

## Read a missed constraint

The report records each threshold and its measured value with the starting and fitted rigs. When a different sampled rig passed an unresolved check, the report lists which approved checks it lost and includes the alternate rig. This demonstrates a trade-off among the tested rigs. Equal subject selectors that claim more than 100% of the same grid's pixels in distinct exact colors have a direct conflict. Other misses show the best measured result in the search. A missed check with no visible evidence is reported separately.

```sh
ink-studio render examples/native-lighting-approval/signal-box.js \
  --shot-lighting signal-box/rig.json --w 96 --h 64 --px 1 --out signal-box.png
```

For Node, call `ink.fitNativeLighting(world, { plan, rig, view })` with the world already posed at the plan time. It returns `{ rig, report, before, after }`.
