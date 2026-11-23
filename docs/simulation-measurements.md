# Named simulation measurements and assertions

A measurement plan names the physical quantities a take or model must
meet. The runner can open saved evidence or execute native solver plans.
The JSON report records each measurement, its units, the evidence behind
it, and the outcome of every assertion.

```sh
ink-studio sim measure bench.json --out report.json
```

The CLI writes the report before returning exit code 2 for a failed
assertion. Exit code 0 means all declared assertions passed. Invalid
settings and unreadable sources are command errors. A valid signal
window without enough evidence returns an unavailable measurement.
An assertion on that measurement fails with its reason.

The [reference experiments](reference-experiments.md) demonstrate measurements against known solutions for waves, mechanics, and transport.

## Author a run

```json
{
  "format": "ink-studio/simulation-measurement-run",
  "version": 1,
  "sources": {
    "pipe": { "file": "pipe.wave.json" },
    "ledger": { "file": "oscillator.network.json", "mode": "diagnostics" }
  },
  "plan": {
    "format": "ink-studio/simulation-measurement-plan",
    "version": 1,
    "id": "instrument",
    "measurements": {
      "transit": {
        "kind": "arrival",
        "source": "pipe",
        "channel": "far",
        "threshold": 0.05,
        "referenceSample": 960,
        "window": { "from": 960, "to": 1920 }
      },
      "energy": {
        "kind": "conservation",
        "source": "ledger",
        "metric": "network-energy-balance"
      }
    },
    "assertions": {
      "arrival-budget": {
        "measurement": "transit",
        "expected": 0.015,
        "absolute": 0.0001,
        "unit": "s"
      },
      "conservation-budget": {
        "measurement": "energy",
        "max": 0.0000001,
        "unit": "J"
      }
    }
  }
}
```

Reference a plan by relative filename or inline it as above. Each source
declares a relative `file` or inline `value`. The default
`mode: "auto"` executes recognized native run definitions and reads
saved traces directly. Use `native` to require a native plan,
`saved` to read a document without executing it, or `diagnostics` to
produce the existing solver diagnostics report. A native plan can
also declare `diagnostics` where the solver supports it. Select
`path: "/diagnostics"` on a measurement to read an attached report.
Repeated file references in the same mode share their resolved result.

Assertions can use inclusive `min` and `max` or an `expected` value
with optional nonnegative `absolute` and `relative` tolerances.
The expected-value tolerance is the greater of `absolute` and
`relative × abs(expected)`. Both default to zero. An assertion's
optional `unit` must match the measured unit. Omit `assertions` to
publish evidence without gating the run.

## Measurement kinds

Arrival, frequency, and decay read a named channel from a
[typed sample trace](simulation-output-adapters.md) or from a native
wave, modal, or wave-sensor report. Supply `channel` when the source
has several channels. The optional `trace` record accepts the same
settings as `sim.outputTrace`, such as `measure: "flow"` for a wave
run. All sample windows are absolute, half-open `{from, to}` ranges
on the native clock. With no window, the full trace is measured.

| Kind | Definition and evidence |
| --- | --- |
| `arrival` | The first sample of a sustained threshold crossing, in seconds relative to `referenceSample` (default 0). Set a positive `threshold`, optional `baseline`, `direction` of `absolute`, `rising`, or `falling`, and `holdSamples` (default 1). The report keeps the crossing amplitude, crossing sample, and confirmation sample. |
| `frequency` | Dominant AC peak in Hz over optional `band: [low, high]`. Ink subtracts the mean, applies a Hann window, and interpolates the strongest FFT bin when both neighbors lie in the band. Set `minRms` to reject weak signals. The report includes the FFT size, bin width, and AC RMS in the input unit. Use a sufficiently long, isolated window for the mode under test. |
| `decay` | Fit the slope of log-RMS across successive `blockSamples` windows. Set optional `baseline`, `minRms`, and `minFit` for minimum R². At least three usable blocks and a falling fitted envelope are required. The default `output: "rate"` is the exponential amplitude coefficient in 1/s. Use `"t60"` for seconds to a 60 dB amplitude drop. The report retains the fit, usable block count, and first and last RMS observations. |
| `signal-compare` | Compare independent time-domain and frequency-domain estimates of a [resonant frequency, bandwidth, or pitch](simulation-signal-comparison.md). Both estimates and their evidence appear in the report. An optional assertion gates the absolute difference in Hz. |
| `steady-state` | Error from a numeric `target`, measured over the authored steady window. Use `mode` of `rms` (default), `bias`, `mean-absolute`, or absolute `peak`. The report identifies the worst signed error. |
| `conservation` | Read a `metric` from the native diagnostics report. Set `mode` of absolute error (default `"absolute"`), `signed`, or `ratio` of absolute error to the solver's tolerance. An optional `unit` labels the residual when needed. The report keeps the original signed residual, threshold, time, and location. |
| `contact-force` | Read the dense force samples of a named native contact `track`. Use absolute `peak` (default), `rms`, or signed `mean`. Force defaults to vector magnitude in N. To project it, supply a component index or axis vector in `project`. Idle samples are excluded. The report identifies the worst sample and its XYZ vector. |

For steady-state controller or network results, use
`rows: "/results"`, optional `valuePath` (default `"/value"`) and
`timePath` (default `"/time"`), explicit `fromTime` and exclusive
`toTime` in seconds, and a `unit`. Row statistics give each sample
equal weight. Omit `rows` to use a sampled trace and its native sample
window and units.

## Library and graph

Call `KIT.world.simulationMeasurements.run(plan, sources)` with already
loaded simulation outputs. The `sim.measure` node takes the same inputs
and exposes the full report as `value`, its named `measurements` and
`assertions` records, and a typed boolean `passed`.

To gate `graph run`, expose `sim.measure.passed` as a named output and
require it through the graph's existing assertions.

```json
{
  "outputs": { "benchPassed": { "node": "measure", "port": "passed" } },
  "assertions": [{ "id": "simulation-bench", "output": "benchPassed", "op": "eq", "value": true }]
}
```

## Calibration bench

```sh
node examples/simulation-measurements/demo.cjs studio/out/simulation-measurements
```

The demo applies the same six assertions to two sets of native solver plans.
It verifies CLI exit codes 0 and 2 and saves both reports, the authored
sources, a comparison board, and an A/B resonator audition.
