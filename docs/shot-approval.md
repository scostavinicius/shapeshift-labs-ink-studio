# Shot approval

Run all configured approval checks on the same sequence of native art frames.
The command writes a JSON report and the first failing frame. When a prior
frame belongs to the same shot, it writes that image too. Named subject checks
also produce a marked image with contour and exact-swatch evidence.

```sh
ink-studio shot approve examples/motion-review.js \
  --plan examples/signal-courier-approval.json --out courier.approval.json
```

The courier example is authored with a spacing spike in the right glove.
The report gives the first failing output frame, its scene time, the affected
subject, and the motion probe evidence. It also shows the adjacent-frame change
and the results for the glove's swatch and contour and the render budget.

## Configure a shot

Pass a plan file or define `world.shotApproval` in the scene. `frames` is the
number of output frames to check. `from` is the starting time in scene
seconds. Frame indices start at zero. `fps` accepts a number or an exact rate
such as `{"numerator":30000,"denominator":1001}`. `warmup` samples preceding
frames at the same rate, stopping at scene time zero. Its frames build history
and do not enter the checks. Use `width`, `height`, and `pixelSize` for the
export size, or supply `--w`, `--h`, and `--px`. Regular render options,
including `--camera-orbit` and `--camera-pan`, apply to the shot.

| Check | Plan settings |
| --- | --- |
| Palette | Add `palette` checks with `id`, `subject`, `swatch`, and optional `minPixels` or `minShare`. Each check counts the exact resolved swatch on a visible subject. |
| Silhouette | Add `silhouette` checks with `id`, `subject`, and the [readability limits](palette-recipes.md#run-palette-checks-in-ci) used by `palette check`. These measure the subject against its immediate background at art size. |
| Motion | Uses the scene's [Motion Review](motion-review.md) probe findings. Set `motion.start` to the scene time of clip time zero. Select `kinds` or set `required: true` to require an authored review. A finding maps to the first output sample at or after the beat. A loop seam at the end uses the last output frame. Its evidence records the original clip time. |
| Transition | Compares consecutive visible export images using the [transition thresholds](transition-review.md#read-the-results) for pops, lighting jumps, and palette changes. Set `transition.thresholds` or `transition.paletteMode` to tune it. Add intended hard cuts as `cuts: [{"frame": 24, "id": "Reverse angle"}]`. An edit resets render history and skips the comparison across the cut. A cut marker at frame zero names the opening shot and keeps its warm-up. |
| Performance | Set per-frame maximums in `performance` for `frameMs`, `splatRows`, `rasterPasses`, `fragments`, `translucentFragments`, `peakDeferredFragments`, `volumeSamples`, `volumeMarchSteps`, or `cloudSamples`. With no limits, the report records measurements without applying a gate. Wall-clock time varies between runs and hosts. |

Define up to eight `subjects` with an `id` and a
[`select` rule](pixel-look.md#shared-look-selectors). Palette and silhouette
checks share the world render with its visibility IDs, before presentation
compositors such as screen overlays. Transition and performance checks include
those compositors. Set `matte` to a hex color to compare transparent frames
against the same background. The default matte is black.

An omitted palette or silhouette list and a scene without Motion Review are
reported as `not-configured`. Set `motion`, `transition`, or `performance`
to `false` to skip it. A one-frame shot with no adjacent pair reports the
transition check as `not-sampled`. Motion Review reports findings on the
authored source clip. Its curves, layers, and probe choices determine those
findings.

## Reproduce a finding

The report sorts findings in output frame order and stores the earliest one
under `firstFailure`. Copy its `reproduce.command` to rerender through that
frame and write its evidence. The command uses the original project directory,
scene, and render options with the plan embedded in the report. It rebuilds
warm-up and preceding history. The scene and any render override files need to
be available at their original paths. To inspect another frame directly, use
`--frame N`.

The CLI exits with status 2 after writing the report when checks fail. Use
`--report-only` to write the same report and evidence with a successful exit
status. Node callers can use `ink.approveShot(world, { plan, view, pose })`
to receive `{ report, evidence }`. Supply a custom pose callback when the
scene uses a host-specific animation entry point.
