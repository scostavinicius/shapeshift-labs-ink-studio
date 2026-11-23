# Silhouette collision repair

Use `shot silhouette-repair` when two characters read as a single shape during a shot. Ink measures each character's projected matte independently, finds the frames where the silhouettes touch or overlap, and searches for a small camera orbit adjustment. It verifies the proposed adjustment over the entire sampled handle.

```sh
node cli/ink-studio.js shot silhouette-repair examples/silhouette-repair/lock-bridge.json --out /tmp/bridge-repair
```

Open `index.html` to play or scrub both cameras in sync. The pink marks above the scrubber identify collision intervals. **Show silhouettes** reveals both projections, including pixels hidden behind the other character. The output also includes the before and after animated PNGs for the affected interval with lead-in and tail frames.

## Set up the shot

Start with [the lock bridge plan](../examples/silhouette-repair/lock-bridge.json).

- Use `format: "ink-studio/silhouette-repair"` and `version: 1`. Supply a scene ID or path relative to the plan and the native art `width` and `height`. Optional `seed` and `controls` configure the scene.
- Give the shot an inclusive `fromFrame` and exclusive `toFrame` at the chosen `fps`. The default rate is 12. Choose two distinct entries in `subjects` by `object` name or positive ID, with optional review labels.
- `coverage` sets the matte threshold and defaults to 0.5. `gapPixels` defaults to one blank art pixel, counting diagonal contact. `minVisible` defaults to 0.85 of each projected shape. A frame with too few measured pixels, a silhouette touching the edge of the source, or reduced visibility away from a collision is unverified.
- `stepDegrees` and `maxDegrees` set the camera search grid and radius. Defaults are 4° steps and a 16° radius. The search tries the smallest angular offsets first and checks every sampled frame of the handle before accepting an offset. `contextFrames` defaults to five frames on each side of the preview.

The analysis uses native, single-view camera mattes. It checks separation at the requested frame rate and art resolution. The repair searches orbit-authored cameras and keeps actor poses and timing. If it cannot verify an offset within the budget, the report retains the detected intervals and original preview.

## Apply the camera offset

`repair.json` records the first and exclusive last frame of each collision, the peak overlap, the offsets tested, and the verification measurements. The selected `repair.offsetDegrees` is a `[yaw, pitch]` pair. Pass it to an ordinary clip at the reviewed art dimensions, rate and starting time. The lock bridge example uses a yaw offset of 0° and a pitch offset of 12°.

```sh
ink-studio clip examples/silhouette-repair/lock-bridge.js --w 184 --h 112 --px 1 \
  --from 0 --to 2.8333333333333335 --fps 12 --camera-orbit-offset 0,12 --out repaired.png
```
