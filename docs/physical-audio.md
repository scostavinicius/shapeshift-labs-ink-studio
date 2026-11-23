# Physical signals into the audio graph

Route a waveguide pressure tap, a resonator pickup, or a radiation signal into an
ordinary Ink audio graph. The dry source bus, propagation bus and final mix use
the same sample rate, channel layout and half-open sample range. Each named
source and path also has its own stem.

## Run from the CLI

```sh
node cli/ink-studio.js sim physical-audio take.json --out report.json --stems stems
```

A version 1 run pairs a routing plan with named inputs. Paths here are relative
to the run file. A native run still resolves its own assets relative to itself.

```json
{
  "format": "ink-studio/physical-audio-run",
  "version": 1,
  "plan": {
    "format": "ink-studio/physical-audio-plan",
    "version": 1,
    "id": "bench",
    "sampleRate": 48000,
    "startSample": 4800,
    "frames": 48000,
    "sources": {
      "pipe": { "signal": "tap", "pcmPerUnit": 0.12, "pan": -0.25 },
      "metal": { "signal": "body", "pickup": "velocity", "pcmPerUnit": 0.4 },
      "mouth": { "signal": "air", "pickup": "flow-derivative", "pcmPerUnit": 0.02 }
    },
    "paths": {
      "pipe-direct": { "source": "pipe", "delaySeconds": 0.0125 },
      "pipe-wall": { "source": "pipe", "delaySamples": 2112.5, "gain": 0.32, "pan": 0.8 },
      "metal-direct": { "source": "metal", "delaySeconds": 0.009 },
      "mouth-direct": { "source": "mouth", "delaySeconds": 0.016 }
    },
    "mix": { "dry": 0.25, "wet": 0.8 },
    "monitorGain": 0.75
  },
  "inputs": {
    "tap": { "trace": "pipe.wave.json", "selection": { "name": "bore" } },
    "air": { "trace": "pipe.wave.json", "selection": { "name": "outlet", "channel": "flow" } },
    "body": { "trace": "bell.run.json", "selection": { "name": "rim", "metersPerUnit": 1 } }
  }
}
```

Use `trace` with a saved wave, modal, or wave sensor trace or its native run
recipe. A wave channel defaults to pressure. A wave sensor selection uses the
named reading and its calibrated unit. A modal selection takes an explicit
metres-per-model-unit scale. Use `signal` with an inline physical signal or a
file containing one. Omit `--stems` to get just the report. The WAVs use 24-bit
PCM and carry the same Broadcast Wave time reference, including for a crop
with a nonzero start. The report lists the input ranges, applied calibration,
path delay and gain, and peaks.

## Build an audio graph

Use `audio.physicalSignal` to adapt a native trace, then collect the resulting
signals with `data.record` using the input names in the plan. Connect that record
to `audio.physical.signals`. The `source`, `propagation`, and `mix` ports are
typed audio buffers. `value` is an alias for `mix`. Use `data.get` and a
`data.typed` node specialized to `audio` to pick a named buffer from `sources`
or `paths`. The stems can feed FFT analysis, racks, or a mixer. Use
`report.startSample` when placing the buffers in a larger take. The CLI's
Broadcast Wave export embeds this placement directly.

```js
const { KIT } = require('@shapeshift-labs/ink-studio').load();
const { physicalAudio, physicalSignals } = KIT.world;
const tap = physicalSignals.fromTrace(waveTrace, { name: 'bore' });
const { source, propagation, mix, report } = physicalAudio.render(plan, { tap });
```

## Sample clock and calibration

A custom solver can publish a track directly.

```json
{
  "format": "ink-studio/physical-signal",
  "version": 1,
  "kind": "radiated-pressure",
  "quantity": { "unit": "Pa" },
  "sampleRate": 24000,
  "startSample": 6010,
  "samples": [0, 0.02, 0.11, -0.14, 0]
}
```

Library signals accept ordinary arrays and Float32/Float64 buffers. The clock is
relative to the take, so sample 6010 at 24 kHz lands at sample 12020 at 48 kHz
before any offset or propagation. `offsetSamples` moves the source on the
output clock. Rate conversion reuses Ink's windowed sinc reader and supports
downsampling by up to 16:1. Reads outside the source range are silent.
Rendering an output crop from the same input traces matches slicing a longer
render, including fractional arrival delays.

| Pickup | Accepted signal kinds | Calibration applies to |
| --- | --- | --- |
| `direct` | `pressure`, `radiated-pressure`, `displacement`, `velocity`, `acceleration`, `volume-flow` | Pa, m, m/s, m/s², or m³/s according to the input |
| `velocity` | `displacement`, `velocity` | m/s |
| `acceleration` | `displacement`, `velocity`, `acceleration` | m/s² |
| `flow-derivative` | `volume-flow` | m³/s² |

Differentiation uses backward differences on the native clock. Supply the
preceding sample as `previous` and the second preceding sample as
`beforePrevious` when adapting a trace sliced at a solver checkpoint. These
values use the input units, or the original model units for a modal selection.
Without them the initial sample is held for the missing history. Match native
resampling at a trace boundary by keeping the full input trace in the render.

`flow-derivative` is a source proxy for radiation. Use `pcmPerUnit` for an
authored pickup coefficient or supply actual radiated pressure from a model.
Pressure and radiation keep their physical units until the source calibration,
and `monitorGain` applies equally to all stems. Lower it if any stem would
exceed normalized PCM. Final mix values follow `mix.dry * source + mix.wet *
propagation` before WAV quantization. The default mix uses propagation
when paths exist and the dry bus otherwise.

Each propagation path applies static gain, fractional delay, and optional
stereo balance. Several paths from one source can represent direct arrivals and
reflections. A path may also carry a sampled `acoustics/audible` result under
`acoustic`. Its gain multiplies the path gain, its delay adds to the authored
delay, and an obstructed result with `audible: false` silences the path. These
static paths are suitable for a fixed listener or a captured path estimate.
Use the stock mixer for convolution or additional processing.

## Demo

```sh
node examples/physical-audio/demo.cjs studio/out/physical-audio
```

The demo renders a 24 kHz waveguide and a 32 kHz modal resonator into a
48 kHz take. It exports an aligned dry, propagation, and mix audition,
individual wave and modal pickups, and an overview of the arrivals.
