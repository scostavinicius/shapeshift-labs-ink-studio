# Fit parameters against reference data

`sim fit-parameters` reruns native simulation plans within authored parameter bounds. A fit can compare sampled curves, scalar simulation measurements, or a mix of both. The selected parameters, replayable edits, and error history are saved as JSON.

```sh
ink-studio sim fit-parameters fit.json --out fit-report.json --require-tolerance
```

```json
{
  "format": "ink-studio/parameter-fit-run",
  "version": 1,
  "candidate": { "mode": "resonator.run.json" },
  "reference": { "recording": { "file": "ring.wav" } },
  "bindings": {
    "frequency": [{ "source": "mode", "path": "/asset/modes/0/hz" }]
  },
  "plan": {
    "format": "ink-studio/parameter-fit-plan",
    "version": 1,
    "id": "tune-ring",
    "parameters": {
      "frequency": { "min": 380, "max": 520, "initial": 420 }
    },
    "objectives": {
      "peak": {
        "kind": "measurement",
        "candidate": { "source": "mode", "kind": "frequency", "band": [370, 530] },
        "reference": { "source": "recording", "kind": "frequency", "band": [370, 530] },
        "tolerance": 0.05,
        "weight": 1
      }
    },
    "settings": { "maxEvaluations": 80 }
  }
}
```

Each `candidate` is an inline native run or a path relative to the fit run. The candidate runner supports the same native plans as [simulation measurements](simulation-measurements.md). It starts from the template state each time and applies only the authored bindings. Bind a parameter to one or more existing numeric fields using JSON Pointers or path arrays. Inline a nested asset in the template when the binding needs to reach one of its fields. Reference sources use the measurement runner's file or inline value descriptors, including saved JSON and normalized WAV. The plan itself can also be a relative file.

## Objectives and weights

- `measurement` uses the existing named measurement kinds. Write a measurement descriptor for each side, or supply an explicit `reference: { "value": 437, "unit": "Hz" }`.
- `series` compares the two sources at a shared, strictly increasing `times` array in seconds. A source can specify a sampled trace `channel` and optional `trace` adapter settings. For timestamped rows, provide a `rows` pointer, a `unit`, and optional `timePath` and `valuePath` pointers that default to `/time` and `/value`. Either type supports a source `path`. Ink linearly interpolates each source on its own clock and requires both to cover the requested times.

Units must match. Set each tolerance in its objective's native units. The weighted loss is the square root of the weighted mean of the objectives' mean squared errors after dividing each residual by its tolerance. An objective's weight is independent of its sample count. For example, doubling `weight` doubles its contribution to the squared loss relative to an objective whose weight stays the same.

The optimizer searches normalized parameter bounds with damped least-squares steps and coordinate probes. It keeps the lowest weighted loss it observed, even when objectives compete. `metTolerance` checks every residual against its own tolerance independently of the optimization weights. Supply `starts` for alternate seeds and `settings.maxEvaluations` to cap work. The search also stops at an exact zero or when its step radius reaches the parameter resolution. A fit can use up to 12 parameters, 32 objectives, and 512 total residual components. Each curve can contribute up to 256 times. The residual count times the evaluation budget is capped at 524,288, and the CLI caps the budget at 4,096 native candidate runs.

## Reports and replay

The report identifies the selected evaluation and records each candidate's parameter values, weighted RMS, and per-objective RMS, signed bias, and worst tolerance-relative error. Unavailable candidate observations carry their reason. The selected result includes the reference and fitted values and signed residuals, including their times for curves. Apply the named `edits` to the original templates to replay the result.

`--require-tolerance` writes the report and returns exit code 2 when the selected candidate falls outside tolerance. Missing source files, invalid bindings, and incompatible units are command errors.

```js
const { KIT } = require('@shapeshift-labs/ink-studio').load();
const report = KIT.world.parameterFit.fit(plan, referenceSources, parameters => {
  return runFromInitialState(parameters);
});
```

The library evaluator returns named source outputs or `null` for an infeasible candidate. Evaluate every candidate from the same initial state for reproducible fits.

```sh
node examples/parameter-fitting/demo.cjs ./studio/out/parameter-fitting
```

The demos calibrate a spring and damper against displacement and velocity curves, tune a resonant mode against a reference WAV, and show how different weights resolve two competing pitch targets.
