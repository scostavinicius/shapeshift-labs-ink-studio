# Match-cut finder

Use `shot match-cut` to try edits between two animated shot handles. Name a shape in each shot, then compare its screen position, width and height, and direction of travel at the edit. Add more shape pairs when multiple elements need to line up.

```sh
node cli/ink-studio.js shot match-cut examples/match-cut/relay-to-moon.json --out /tmp/relay-match
```

Open `index.html` to play or scrub the ranked cuts. **Jump to cut** lands on the first incoming frame. **At the cut** shows the two seam frames with optional shape outlines and the measured differences. `cuts.json` records the original source frame numbers and preview ranges. Each shortlisted cut has its own animated PNG at the authored frame rate.

## Set up two handles

Start with [the relay and moonrise example](../examples/match-cut/relay-to-moon.json).

- Use `format: "ink-studio/match-cut"` and `version: 1`. Set a shared native `width`, `height`, and integer `fps`. The default rate is 24.
- Give the `outgoing` and `incoming` handles a scene ID or a path relative to the plan, an inclusive `fromFrame`, and an exclusive `toFrame`. A handle can start at frame zero. Optional `label`, `seed`, `controls`, and `camera` carry the shot setup. The camera can set target, yaw, pitch, distance, zoom, and orthographic projection. The two handles can point to the same scene with separate camera or control settings.
- Each row of `matches` specifies an `id` and one selector per side. Select with `object`, `material`, or both, using names from the native ownership passes. Optional `label` names the shape pair in the review. Optional `weight` gives the pair more or less influence in the ranking.
- Set `motionFrames` to the number of adjacent samples used to fit direction, including the seam frame. The default is 3. `restSpeed` sets the stationary threshold in art pixels per frame and defaults to 0.35.
- Set `previewFrames` to the maximum frames per side in a preview. The default is 0.75 seconds per side. `limit` defaults to five cuts. `separationFrames` skips a lower-ranked cut when **both** addresses are closer than the given number of frames to an already shortlisted cut. It defaults to about a quarter second. Set it to zero to include nearby pairs.

## How the ranking works

The solver measures the visible bounding box of each named shape in the native single-view raster. It compares the last outgoing frame with the first incoming frame, fitting velocity from earlier outgoing frames and later incoming frames. An occluded shape with no visible pixels or a box touching the source edge makes that motion window ineligible. When both shapes hold still, there is no direction penalty. A stop, start, or reversal is penalized.

The reported shift is the distance between the box centers. Size difference is the symmetric change across width and height using their log ratios. Heading difference is the angle between screen-space velocities when both shapes are moving. The score weights those errors across shape pairs and puts the best matches first. Use the at-speed previews to choose the cut in context.

For programmatic use, `findMatchCuts(outgoing, incoming, options)` accepts two arrays of raster frames with aligned native ownership passes. It uses the same settings and accepts `outgoingStart` and `incomingStart` for the source frame addresses. Candidate preview ranges are half-open, in source frame numbers.
