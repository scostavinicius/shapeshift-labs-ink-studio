# In-scene simulation forecasts

A forecast starts two copies of the same committed simulation. The baseline
carries on with its existing queue. The proposal adds pending commands to
its own queue. Both advance at the world's fixed tick rate. The original
world, current tick, and queued commands stay intact.

```js
const { forecast } = KIT.world;
const result = forecast.run(liveRun, {
  steps: 48,
  every: 6,
  actions: [{ action: 'canal/gate', args: { gate: 'sluice', opening: 1 } }],
  tracks: [{ id: 'float', at: { entity: 'marker-buoy' } }],
  flows: [{ id: 'outlet', field: 'canal/flow', at: [0.6, 0, 0],
    heightField: 'canal/surface-height', seconds: 0.35, maxLength: 0.8 }]
});

const composite = { layers: [forecast.layer(result, { ghosts: 6 })] };
studio.render(currentScene, { w: 480, h: 270, composite });
```

Pass a live runtime, a saved world checkpoint, or a world manifest. For a
checkpoint with custom implementations, provide them in `runtime`. The
`forecast.runAsync` equivalent also supports runtimes with asynchronous
simulation workers. A [checkpoint branch session](simulation-checkpoints.md#interactive-checkpoint-branching)
offers `session.forecast(options, { branch })` and `forecastAsync`, with the
active branch as the default.

`steps` sets a relative horizon of 1 to 600 ticks. `every` controls how often
to retain ghost and flow samples. The start and end are always retained.
Proposal `actions` and optional `baseline` commands use the normal
simulation command format. Omit a command's `tick` to apply it on the next
tick. Explicit ticks are absolute.

## Watch positions and fields

- **Tracks** follow an entity or socket in `at`, or read an XYZ result from a
  named `field`. A track can supply a world-space `offset`. A missing sample
  breaks the trail at that point.
- **Flows** read XY planar vectors as XZ, or read XYZ vectors directly.
  They use a point or entity/socket in `at`. `heightField` can place arrows
  on a moving water surface, and `lift` offsets that height in Y.
  `seconds` scales the vector, `maxLength` caps the arrow in world units,
  and `minSpeed` hides nearly still arrows.
- **Watch** entries read named query fields. Use `path` to select a numeric
  member of a record and `args` for field-specific arguments. Tracks,
  flows, and watches use `tolerance` to suppress small changes in their
  own units. The first observation that changes beyond its tolerance
  is returned as `firstObserved`, along with its sampled values and site.
  A watched value becoming available or unavailable also counts.

## Locate the first visible change

Supply `compareView` to compare actual rendered pixels at every tick until the
first difference appears. Its synchronous `render({ view, query, tick, time,
branch })` callback returns an RGB or RGBA byte frame for each branch on the
same art grid. Hold the view and camera consistent between the two renders.

```js
const result = KIT.world.forecast.run(liveRun, {
  steps: 42,
  actions: pendingCommands,
  compareView: {
    render: ({ view, query }) => renderFromSnapshot(view, query, fixedCamera),
    threshold: 12,
    minPixels: 4
  }
});
```

`threshold` is the maximum allowed byte difference in premultiplied color
or alpha. `minPixels` sets the smallest changed area worth tagging. A
visible change records the earliest tick, bounding rectangle, pixel count,
and the strongest changed pixel. The exact comparison runs independently
of the ghost sample interval.

A [shared render frame](render-outputs.md) can supply a world position for
the marker. Other frame sources can give `compareView.anchor({ x, y, baseline,
proposal, tick, time })` to reconstruct an XYZ point. For an uncalibrated
capture, pass `screenMarker: [width, height]` to `forecast.layer` or
`forecast.commands` when drawing over that same view and art grid.
With pixel comparison enabled, the marker follows `firstVisible`. A
trajectory-only forecast uses `firstObserved`.

The layer works in the mixed-resolution compositor and as the `layer` on
a render graph composite pass. Set `tick` to scrub the overlay,
`branches` to choose traces, and `ghosts` to limit history shown.

## Wicker Sluice

Run `node examples/simulation-forecast.cjs ./out/wicker-sluice` to generate
the animated walkthrough and standalone preview. The current checkpoint
keeps the gate closed while the overlay shows the pending release, compares
the two drifter paths, and marks the first changed water pixels.
