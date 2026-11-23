# Stability and conservation diagnostics

Use [named simulation measurements](simulation-measurements.md) to gate a
specific diagnostic alongside timing, frequency, decay, tracking, or force
checks in one CI report.

Use `ink-studio sim diagnose <plan.json>` with a solver plan already used
by `sim grid-ops`, `sim waves`, `sim network`, `sim integrate`,
`sim solve`, or `sim remap`. The command writes a version 1
`ink-studio/simulation-diagnostics` report. It also accepts a saved
transfer-coupling probe, solve report, or remap report.

```sh
ink-studio sim diagnose grid.plan.json --out audit.json --fail-on error
ink-studio probe exchange.world.json --ticks 1 --field exchange/coupling --out coupling.json
ink-studio sim diagnose coupling.json
```

Use `--fail-on error` in CI to fail when a bound or tolerance is exceeded.
Use `--fail-on warning` to also fail on a step near a bound. The CLI
writes the report before setting a failing exit status. Omit the flag to
collect findings without gating the run.

## Read the report

`status` is `pass`, `warning`, or `error`. `metrics` contains the
worst measurement for each check. `findings` lists up to eight distinct
locations that need attention, ranked by severity and fraction of
tolerance. `firstFinding` is the first warning or error recorded,
including checks that happen during preparation. Each measurement has
a signed value, its threshold, a magnitude-to-threshold ratio, a
location, and a time in seconds when applicable. A nonzero value with
zero tolerance has a null ratio.

Grid transport reads stability from the same finite-volume stencil used
for the update. The limit names the compiled cell index, its centre,
and its address where available. The report can reject a step before
advancing. An accepted step checks the domain budget and each cell's
change against the oriented flux and source contribution. Set
`observed: [...]` on a transport plan to check a recorded or external
next field. Opposing local errors can cancel in the domain total.

The distributed wave solver names the tube and metre interval of the
section constraining its CFL step. The report shows the internal step or
the required substeps if the solver exceeds its 32-substep budget. The
delay solver reports travel time drift in samples, including sections
clamped to one sample. Both methods check the volume-flow balance
at solved connections, including the flow into impedance loads. The
flow check skips prescribed pressure and pressure-release nodes, where
the injected or escaped flow is implicit. Report section indices refer
to compiled sections, which can combine adjacent authored spans.

Lumped networks compare stored energy with initial energy plus source
work minus dissipated energy. The energy residual belongs to the
network's ledger. Junction residuals name the junction and its incident
elements. Network checks sample requested output times and source change
boundaries. Transfer-coupling diagnostics use the existing normalized
residual per named link and carry its units and commit status. Linear
solves name the zero-based original equation row with the largest true
residual, or the elimination column for a singular pivot. Root failures
report the bracket. State remap reports account for material that
escaped or was initialized, with the channel and source or target domain
for each balance.

For general integration, the report gives the configured step cap and
largest accepted step. The adaptive method shows the state component
with the largest accepted trial error. An integration module can
export named invariants to measure over accepted steps:

```js
module.exports = () => ({
  derivative(_time, [x, v], out) {
    out[0] = v;
    out[1] = -x;
  },
  invariants: {
    energy: {measure: (_time, [x, v]) => (x*x + v*v) / 2}
  }
});
```

An invariant uses its initial value by default. Give the probe
`expected` to specify a fixed target. Probe callbacks are read-only.
The integrator samples after event reactions. The configured cap
expresses the author's limit for general ODEs.

## Choose tolerances

Set optional top-level `diagnostics` on a plan. Absolute errors use
`max(absoluteTolerance, relativeTolerance * scale)`, with defaults
(10⁻¹²) and (10⁻⁸). A balance typically scales by the largest
accounted quantity. Override these values by metric as needed for the
model's units. Linear and coupling residuals use the tolerances selected
in their own solver settings.

```json
{
  "diagnostics": {
    "nearLimit": 0.9,
    "maxFindings": 12,
    "tolerances": {
      "network-energy-balance": {"absolute": 0.0000001, "relative": 0},
      "wave-travel-drift": {"absolute": 0.01, "relative": 0}
    }
  }
}
```

## Library and demo

- Grid use is `grid.inspectTransport(values, options, {observed, diagnostics})` on a prepared grid.
- Prepare a lumped network with `prepare(definition, {diagnostics: true})` or a wave network with `prepare(domain, settings, {diagnostics: true})`. Call `diagnostics()` on the session.
- Create an integrator with `diagnostics: true` or named `invariants` in its options, then call `diagnostics()` on the session.
- `KIT.world.diagnostics` summarizes existing evidence through `solve(result, options)`, `remap(result, options)`, or `coupling(probeValue, options)`. Custom kernels can use `create(options)` with `limit`, `error`, `residual`, and `report`.

The optional session checks produce bounded evidence and leave checkpoints
in the normal solver format. Restore or reset starts a new review window.

```sh
node examples/simulation-diagnostics/demo.cjs studio/out/simulation-diagnostics
```

The demo writes authored plans, JSON evidence, a comparison PNG, and an
animated PNG showing energy drift for two steps of a lossless oscillator.
