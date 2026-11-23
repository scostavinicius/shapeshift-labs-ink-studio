# Virtual instruments and sensors

A versioned `ink-studio/sensor-rig` binds named instruments to existing
solver probes, world fields, geometry, or event streams. The same rig
can be sampled from JavaScript, recorded with the CLI, or embedded in
a simulation model.

```json
{
  "format": "ink-studio/sensor-rig",
  "version": 1,
  "id": "bench",
  "revision": 1,
  "sensors": {
    "tank": {
      "kind": "pressure-tap",
      "quantity": {"unit": "kPa"},
      "source": {"kind": "field", "field": "pipe/nodes", "args": {"node": "supply"}, "path": "/pressure"}
    },
    "flow": {
      "kind": "flow-meter",
      "quantity": {"unit": "L/s"},
      "source": {"kind": "field", "field": "pipe/pipes", "args": {"pipe": "gate"}, "path": "/flow"}
    },
    "cuts": {
      "kind": "event-counter",
      "source": {"kind": "world-events"},
      "filter": {"kind": "deformable-tear"}
    }
  }
}
```

| Instrument | Canonical reading and sources |
| --- | --- |
| `microphone` | Pressure in Pa from a native wave probe, a field, or an input port. An acoustic room source instead reports the estimated linear path gain and includes the selected band's level and delay. |
| `pressure-tap` | Pressure in Pa from an existing wave probe, world field or scalar port. Pressure sign comes from the solver. |
| `displacement-probe` | Relative displacement in metres from two geometry endpoints, a field, or a scalar port. An optional axis gives signed displacement. |
| `strain-gauge` | Signed engineering strain `(L − L₀) / L₀` from geometry, or dimensionless strain from a native field or port. |
| `flow-meter` | Signed volumetric flow in m³/s from a wave probe, field, or port. It keeps forward, reverse, and net volume in m³. |
| `event-counter` | Cumulative count, count in the latest batch, and most recent occurrence time. It reads native event inputs or completed world event batches. |

## Place and calibrate a sensor

A `wave` source names an existing `probe` on the wave run. A `field`
source sets `field`, optional target `at`, `args`, and optional JSON Pointer
or path array `path` to a scalar in the returned value. Supply these scalar
values in the instrument's canonical units. An `input` source publishes a
named input socket, with default name `in.<sensor>` for numbers and
`events.<sensor>` for event batches. Override the name with `source.port`.

An acoustic microphone names an `acoustic-hearing` field such as
`acoustics/audible`, a `listener`, an `emitter`, and optionally the
`low`, `mid`, or `high` band. It uses the existing room propagation
query. The reading is path gain, with `levelDb`, `delaySeconds`, and
source-position details. A blocked path reports zero gain. For
sampled audio pressure and WAV, use native wave microphones.

Geometry endpoints `from` and `to` can be XYZ points, entity/socket
selectors, or fields returning points. For a packed native deformation
field, add a `node` index and point `path` at its XYZ array:

```json
{
  "kind": "strain-gauge",
  "quantity": {"unit": "%"},
  "source": {
    "kind": "geometry",
    "from": {"field": "fabric/motion", "args": {"shape": "rope"}, "path": "/positions", "node": 0},
    "to": {"field": "fabric/motion", "args": {"shape": "rope"}, "path": "/positions", "node": 1},
    "when": {"field": "fabric/motion", "args": {"shape": "rope"}, "path": "/broken/0", "equals": false}
  }
}
```

Geometry uses `metersPerUnit` (default 1) and either an explicit
`reference` in metres or `"initial"` to tare from the first valid
measurement. A strain reference must be positive. A displacement
axis is normalized and projects the endpoint separation before taring.
Use an optional `when` field with a boolean `equals` match to mark a
gauge unavailable when its material disconnects.

Each instrument reports `raw` in canonical units and `value` in the
declared physical quantity. Calibration applies `gain` and `offset`
to the canonical reading before unit conversion, and `min` and `max`
clamp the converted reading. `responseTime` sets a low-pass time constant
in seconds. A flow meter integrates the calibrated, clamped interval
before display smoothing. A missing measurement has `valid: false`
and `raw: null`. Its last displayed value and accumulators are retained.
For counters, `filter` can match exact `kind`, `source`, `phase`, or
`system` fields. Counts preserve original timed-event occurrences.

## Record and connect

A sensor run has format `ink-studio/sensor-run` and version 1. Supply
`rig` inline or as a path relative to the run. A wave source uses either
`{kind: "wave", run: "guide.wave.json"}` or a native `trace` reference.
Use `audio: {channels: ["near", "far"], gain: 0.8}` with `--wav`
to choose microphone order and playback scale. The report keeps
physical readings and peak/RMS data independently of WAV gain.

A world source uses `{kind: "world", world: "bench.world.json", steps: 120}`.
Optional `every` thins the report while the recorder keeps measuring
every native tick. `bindings` maps scalar sensor input names to native
output ports. The recorder checks declared physical units. Read native
world event batches with `world-events`. Supply
`includeWorldCheckpoint: true` to save the world alongside the returned
sensor checkpoint. Resume with the sensor checkpoint at the top level
and the matching world checkpoint on `source.checkpoint`.

```sh
ink-studio sim sensors wave.sensors.json --out wave.report.json --wav microphones.wav
ink-studio sim sensors bench.sensors.json --out bench.report.json
```

From JavaScript, use `KIT.world.virtualSensors.prepare(rig).open()`.
Call `sample({query})` to initialize an unobstructed geometric
reference without integrating a timestep, and `step(dt, {query, inputs,
events})` to consume a measurement interval. Use `snapshot()` and
`restore()` to preserve taring, calibration history, counts and totals.
The library also provides `virtualSensors.wave(rig, trace)` and
`virtualSensors.world(rig, run, {steps})`. The `sim.wave-sensors` graph
node reads an inline rig and a native wave trace.

In a world or model, use `kind: "virtual-sensors"` and
`config: {rig: asset}`. Connect the typed ports to ordinary model
signals or [feedback controllers](controllers-inverse-targets.md).
Each sensor publishes its name and `<name>.valid`. Flow meters also
publish `<name>.total` and events publish `<name>.delta`.
Use `probe --field <system>/readings` to inspect diagnostics.
Fields in a native sensor system read the step's query snapshot.
A native world-event counter captures the completed tick's events,
which are visible in the probe immediately and on its signal port
at the next publication. Use the completed-world recorder for
measurements aligned to committed ticks.

## Reproduce the demos

```sh
node examples/virtual-sensors/demo.cjs studio/out/virtual-sensors
```

The demos record two waveguide microphones, a kPa pressure tap and
signed wave flow. A native bench measures the rope's displacement and
strain, a cut counter, and the fluid added to a receiver. A room
microphone measures the acoustic gain change when a hatch closes.
