# Reduced simulation models

Use `KIT.world.reduction.bake(plan)` or `ink-studio sim reduce <plan.json>` to
bake a detailed measurement into an `ink-studio/reduced-model` asset. The
asset records its own ID and revision, the source identity where available,
the reduction settings, the fitted range, and measured error. A baked asset
contains the data it needs for later use.

| Kind | Input to the library | Baked data |
| --- | --- | --- |
| `profile` | Complete [path section report](path-sections.md) | Piecewise cross sections along the original arc length |
| `network` | Complete [compiled branched domain](branched-domains.md) | Nodes and reduced section links with named ports and observations |
| `response` | One sampled source-to-probe response | Sample-aligned taps with an optional tail fade |
| `modes` | One sampled source-to-probe response | Damped sine/cosine coefficients, frequencies, and decay rates |

A plan is an `ink-studio/reduction-plan`, version 1, with an `id`, `kind`,
`source`, and optional `revision` (default 1), `settings`, and JSON
`reference` metadata. For example, save the following next to a measured
impulse:

```json
{
  "format": "ink-studio/reduction-plan",
  "version": 1,
  "id": "chamber-resonances",
  "kind": "modes",
  "source": "chamber.wav",
  "settings": {
    "fit": [0, 3600],
    "validation": [3600, 6000],
    "band": [10, 450],
    "decay": [7, 9],
    "maxModes": 10
  }
}
```

## Geometry

The CLI accepts a path section report or measurement plan for a profile.
Use `sim domain` to compile a branched-domain definition for a network. CLI
paths are relative to the plan that references them.

Geometry settings are `segments` (default 8, at most 256 per path or tube)
and `areaPower` (default 1, from 0.5 to 3). Spans join adjacent measured
sections and split where the area fit improves most. Each span carries
its measured volume, length-weighted mean area and perimeter, smallest
measured opening if available, area extrema, and original section range.
A uniform tube can use a single link.

For applications that need a series flow approximation, each link stores
the original sum of section length divided by area raised to `areaPower`.
A measured seal yields `resistance: null` and `conductance: 0` even if
the link has volume on either side. This geometric factor takes its units
from the authored measurements. The consuming solver supplies the physical
flow law and material constants. The report records area RMSE weighted by
arc length, maximum area error, volume error, and the error that would
result from using uniform areas for the geometric resistance. The network
also records these measurements by tube, with socket positions and the
source path and geometry revisions.

## Sampled responses

Library input is `{sampleRate, samples, origin?}`, with one finite signal
and up to 65,536 samples. In the CLI, pass this input inline, load it from
a relative JSON or WAV path, or select a zero-based WAV channel with
`"source": {"wav": "chamber.wav", "channel": 1}`.

To measure a versioned world model directly, pass a source like
`{"model":"model.json","input":"drive","output":"probe","samples":1200}`
or call `KIT.world.reduction.capture(model, options)`. Input and output
can be aliases or `system/port` names. Capture uses two runs on the same
world tick grid, with the same seed and initial state. It sets an optional
`baseline` (default 0), applies an `amplitude` offset for one tick
(default 1), subtracts the quiet run, and divides by the amplitude. Sample
zero is the first completed tick. Capture is bounded to 16,384 ticks. To
fit a higher-rate signal from a substep solver, supply its sampled output
directly. Treat the fitted result as a local linear approximation around
the recorded source, probe, baseline, and excitation.

The `fit` interval is half-open and uses zero-based sample indices. An
optional `validation` interval follows the fit and is held out. Both
ranges are reported in samples and seconds.

- `response` copies the fit interval, with an optional `fadeSamples`
  tail, and emits zeros outside that interval.
- `modes` fits up to 12 damped sinusoids (default 6) within a frequency
  `band` in Hz and a `decay` range in inverse seconds. It supports fit
  windows from 32 to 16,384 samples. Playback starts at the first fit
  sample and continues the oscillators into the tail. Use the validation
  error to judge extrapolation on the captured signal.

`KIT.world.reduction.render(asset, {samples})` returns a mono
`Float64Array` on the asset's sample grid. By default it uses the source
length. The report measures fit and full range RMSE and peak absolute
error, plus the same metrics for validation when supplied. Relative
RMSE is normalized by the reference signal's RMS in the reported range.
On a silent range it is `null`; absolute error still applies.

## Reproduce the demo

```sh
node examples/simulation-reduction/demo.cjs /tmp/ink-reduction
node cli/ink-studio.js sim reduce /tmp/ink-reduction/network.plan.json --out /tmp/network.json
node cli/ink-studio.js sim reduce /tmp/ink-reduction/modes.plan.json --out /tmp/modes.json
```

The demo reduces the existing branched manifold and its outlet throat.
It also runs a scalar wave across a masked twin chamber and compares
the full pressure response against shortened taps and a modal bank at
the same listening gain. It writes the full and reduced WAVs, repeatable
plans, measurement reports, and an animated view of the detailed grid.

For positioned excitation and pickup sites, see
[resonant mode assets](resonant-modes.md).
