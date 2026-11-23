# Motion and render data into authored sound

Use measurements from a world run or a picture pass to author sound automation.
A wheel's screen speed can open a motor fader, brake slip can bring in a scrape,
and camera-axis depth can change the cutoff of a low-pass filter. The result is a
versioned asset with ordinary editable mixer lanes and evidence for each mapped
observation.

```sh
ink-studio sim sound-controls take.json --out controls.json
ink-studio sim sound-controls controls.json --at 0.75
ink-studio sim sound-controls controls.json --sample 36000
```

The inspector returns the actual interpolated lane value and the observations
on either side. Each observation records its audio sample, timestamp, raw
measurement, mapped target, smoothed value, and any source evidence such as a
solver tick, valid pixel count, or active contact window. A raw value of
`null` identifies an unavailable observation.

## A take with picture and contact controls

```json
{
  "format": "ink-studio/motion-sound-run",
  "version": 1,
  "plan": {
    "format": "ink-studio/motion-sound-plan",
    "version": 1,
    "id": "dial",
    "sampleRate": 48000,
    "lanes": {
      "motor": {
        "source": "wheelSpeed",
        "input": [0, 35],
        "output": [0, 0.82],
        "unit": "linear gain",
        "shape": "smoothstep",
        "attack": 0.02,
        "release": 0.08
      },
      "brake": {
        "source": "brakeSlip",
        "input": [0.03, 0.85],
        "output": [0, 0.76],
        "unit": "linear gain",
        "shape": "power",
        "exponent": 0.8
      }
    }
  },
  "sources": {
    "picture": {
      "kind": "render",
      "scene": "dial.js",
      "clock": { "fps": 24, "cuts": [{ "frame": 24, "id": "reverse-angle" }] },
      "frames": 48,
      "options": { "width": 144, "height": 88 },
      "measures": {
        "wheelSpeed": {
          "channel": "partMotion",
          "part": "servo-wheel",
          "perSecond": true,
          "reduce": "rms"
        }
      }
    },
    "contact": {
      "kind": "contacts",
      "file": "brake.contact.json",
      "measures": { "brakeSlip": { "track": "shoe", "windowSamples": 480 } }
    }
  }
}
```

Use asset paths relative to the run file. `plan` can also reference its own
JSON file. Measurement names are unique across groups.

| Source kind | File or input | Measurements |
| --- | --- | --- |
| `render` | Headless scene in `scene`, shared take `clock`, number of `frames`, optional `firstFrame`, `camera`, and graph render `options` | Named pass reductions, described below |
| `world` | World JSON in `file` or a runtime `checkpoint`, plus `steps` and optional `every` | Select a published `signal` such as `controls/speed`, or a query `field` with optional `at` and `args`. Use a JSON Pointer `path` to read a field value such as `/wheel/angular`. Supply a `unit` or use the signal port's declared unit. |
| `sensors` | World sensor run recipe or report | Map each output name to a sensor name. Use a strain gauge for calibrated strain. The report's tick duration supplies exact sample placement. |
| `contacts` | Native contact excitation run recipe or trace | Select `track` and `field` of `slip` (default), `point`, `force`, or `impulse`. Each trailing `windowSamples` block reduces its active samples by `rms` (default), `mean`, or absolute `peak`. The observation is dated at the window's end. |
| `rows` | JSON array of rows with `at` and `value` or additional named fields | Each measurement declares `unit` and can select a `path` relative to the row. |
| `tracks` | JSON record of saved `ink-studio/sound-measurements` tracks | Map each output name to one saved track name. |

World signals, contact vectors, and authored telemetry support
`project: "magnitude"`, a zero-based component index, or an axis vector for a
signed projection. A scalar value needs no projection. For authored or world
position and rotation, use `rate: true` to differentiate along the recorded
clock. Add `wrap: 360` for a degree angle or `wrap: 6.283185307179586` for a
radian angle. The shortest signed angular change is used modulo that period.
A cut or a gap clears the derivative's history.

## Reduce native art passes

Pass `channel` as `motion`, `partMotion`, `emissionMotion`, `depth`,
`previousDepth`, `emissionDepth`, `coverage`, `mask`, `protected`,
`normal`, `position`, `objectPosition`, or `emission`. Vector channels
default to magnitude and accept the same projections as telemetry.

Use `object`, `material`, or `part` labels or IDs to scope the measurement.
A `region` sets a top-down native art-pixel rectangle `[x, y, width, height]`.
Use `reduce` of `mean` (default), `rms`, `peak`, `min`, `max`, or
`fraction`. The fraction divides pixels at or above `above` (default 0.5)
by the region area. A matching-part coverage fraction can drive sound based
on the visible area of that part. Set `weight` to `coverage` or `mask` to
weight means, RMS values, and fractions. Zero-weight pixels are excluded.

Motion passes report art pixels per frame by default. With `perSecond: true`,
the capture divides by the elapsed picture time. Native correspondence masks
exclude invalid vectors and prior depth, including the first frame and a cut.
Depth uses camera-axis scene units and excludes empty pixels. The same camera
and lower-resolution picture can produce different screen-space measurements,
so use the intended export view and art grid.

## Map, edit and route

A lane clamps its `input` range to 0–1, applies `linear`, `smoothstep`, or
`power` shaping, and maps the result to `output`. Output endpoints can
descend. Input endpoints use the source track's units. The optional lane
`unit` labels the output in the report. Choose ranges that the destination
accepts, such as [0, 1] linear fader gain, [-1, 1] balance, or cutoff in hertz.

Attack and release use exponential time constants in seconds on the observation
grid. `missing: "fallback"` (the default) moves toward `fallback`, which
defaults to the first output endpoint. `missing: "hold"` keeps the current
value between valid observations. A cut starts with the new observation or
fallback. The compiler writes an adjacent guard point before a cut, so a
linear lane preserves the change on the cut sample. Use `curve: "hold"` for
steps and `"linear"` for ordinary mixer interpolation. The final level
holds until another automation point. Add a terminal observation if a take
needs a release to silence.

The plan's audio rate is 8–96 kHz and should match the destination mixer.
Seconds and rational timestamps round down to sample addresses on that
rate. Each lane supports up to 2,048 points including cut guards. Reduce the
capture cadence or split the take for a longer lane.

Copy any `controls.lanes.<name>` to a mixer's fader, balance, send, or
automatable processor setting. These lane points use the standard
`{unit:"samples",curve,points}` form. For a clip-relative lane, capture on its
local clock or offset the points at edit time. The inspector reads current
lane points and retains the source observation report from compilation.
[Ink mixer automation](audio-mixer.md)

## Library and graph

```js
const { KIT } = require('@shapeshift-labs/ink-studio').load();
const { soundMeasurements, motionSound } = KIT.world;
const speed = soundMeasurements.rows(
  [{ at: 0, value: [0, 0, 0] }, { at: 0.25, value: [0.5, 0, 0] }],
  { unit: 'm/s', project: 'magnitude' }
);
const controls = motionSound.compile(plan, { speed });
const review = motionSound.sample(controls, { sample: 12000 });
```

- `audio.soundMeasurements` projects an array of dated rows into a track.
- `audio.measureRender` consumes `scene.render.frame` and returns a dated
  observation and unit. Supply the elapsed picture time in `timing.interval`
  for per-second motion. The graph's take frame supplies the timestamp and cut
  unless overridden.
- `audio.motionControls` compiles a named measurement record and outputs
  `value`, `lanes`, and `report`.
- `audio.sampleMotionControls` samples a compiled control asset from the
  graph clock, the take frame, or an explicit sample address.

For a capture across picture frames, use the CLI or accumulate observations
over calls in a graph host and pass them through `audio.soundMeasurements`.
Use [Physical audio](physical-audio.md) when the input is itself a sound
pressure, vibration, or radiation waveform.

## Demo

```sh
node examples/motion-sound/demo.cjs studio/out/motion-sound
```

The tide dial demo uses native part motion, camera depth, and visible coverage
alongside simulated brake slip and cable strain. The same authored sound beds
are available with static controls and measured automation. The output includes
a reusable take, editable mixer recipe, the motion-driven WAV and separate
stems, an automation chart, and an inspection of the picture cut.
