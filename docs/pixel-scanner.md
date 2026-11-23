# Persistent pixel scans

Capture world-space hits from a moving perspective emitter. Each pulse uses
the depth and position of the first visible surface on the emitter's art-pixel
grid. Keep those positions as native splats and render them from any camera.
The current capture uses Ink's headless render passes. Browser scenes can
draw the same splats from recorded passes or from another source of aligned
world-space hit data. [Art-pixel render passes](art-passes.md)

```js
const ink = require('@shapeshift-labs/ink-studio');
const { KIT: K } = ink.load();
const scanner = K.pixelScanner.create({ spacing: .09, capacity: 6200 });

// Allocate the presentation marks before finishing displayWorld.
const marks = K.frameSplats(builder, scanner.capacity,
  (draw, _dt, time) => scanner.draw(draw, time));

// For each pulse, pose the source world and capture from the scanner head.
const at = [-2, 1.4, 3];
const passes = ink.capturePixelScan(sourceWorld, {
  at, target: [0, 1, -2], w: 40, h: 80, fov: .64, time
});
scanner.ingest(passes, { at, time });

// Install marks on the display stage. Run capture before marks each pulse.
stage.add(marks);
```

- The capture uses an eye at `at`, a vertical field of view in radians,
  and a near plane of .4 world units. The geometry can be splats, retained
  SDFs with `sdfAssist: true`, or opaque sprite surfaces with authored
  holes. The depth owner determines the return. The capture uses the
  sensor's geometry view with reflections, analytic water, atmosphere, and
  screen composites disabled.
- `ingest` uses top-down `depth` and `position` float buffers. Optional
  `normal` and `objectId` passes help keep intersecting surfaces separate.
  `pixelStep` skips samples on the emitter grid. `range` limits Euclidean
  distance from the emitter in world units.
- `spacing` merges nearby returns on the same surface. A repeat hit keeps
  the original position and refreshes its age and range color. `capacity`
  limits retained points and evicts the least recently seen return first.
  `retention` expires returns that go unseen for that many seconds. It
  defaults to infinity.
- `fresh`, `settled`, and `old` are equally sized palettes of 1 to 16
  near-to-far RGB swatches. `freshFor` and `settleAfter` set the age
  thresholds in seconds. `width` and `density` shape the displayed splats.
  `surfaceBias` offsets the display toward the captured side of the surface
  to keep points visible above it. The stored positions remain exact to
  the capture.
- `points(time)` returns copies of the visible positions, normals, range,
  timestamps, swatches, and age bands. Use `clear()` to start a fresh scan.
  Ingesting at an earlier time also clears the history. Replay earlier
  pulses to reconstruct the same scan on a seek. Points remain in world
  space if the object that was scanned later moves. To track the current pose,
  bind landmarks to a [surface probe](surface-probe.md).

## Flooded Station 09

The first sweep starts low on the near railing, then crosses the gate and
climbs the stairs. The second study moves the view around a completed scan.
[Runnable example](../examples/flooded-station-scan.js)

```sh
node cli/ink-studio.js clip examples/flooded-station-scan.js --raw \
  --w 320 --h 188 --px 1 --from 0 --to 6.4 --fps 10 --out station-sweep.png
node cli/ink-studio.js clip examples/flooded-station-scan.js --raw --params '{"study":"orbit"}' \
  --w 320 --h 188 --px 1 --from 0 --to 4 --fps 10 --out station-orbit.png
```
