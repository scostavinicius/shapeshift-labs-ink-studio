# Reusable simulation boundaries and sources

An `ink-studio/boundary-set` asset holds named boundary and source laws.
Use the same law at several sites or in several simulations. Solvers bind
the names to their own compiled boundary regions, network nodes, or scene
systems. A change to a shared set can be published with a new revision.

```json
{
  "format": "ink-studio/boundary-set",
  "version": 1,
  "id": "pipe-bench",
  "revision": 1,
  "rules": {
    "cold": {"kind": "fixed-value", "signal": 0},
    "feed": {"kind": "flux", "basis": "total", "signal": 0.0002},
    "tap": {
      "kind": "disturbance",
      "signal": {"kind": "pulse", "at": 0.1, "duration": 0.006, "amplitude": 0.0004}
    },
    "open": {"kind": "absorbing"},
    "load": {"kind": "impedance", "value": 620000},
    "cap": {"kind": "sealed"}
  }
}
```

`signal` accepts a constant, a pulse, or strictly increasing
`keys: [{time, value}]`. Keyed signals accept `interpolation: "linear"`
(default) or `"step"`, and `outside: "hold"` (default) or `"zero"`.
A pulse defaults to a Hann envelope. Set `shape: "box"` for a rectangular
pulse. Times are in seconds on the receiving solver’s clock. Drives are
averaged over each step or sample using their time integrals, so a pulse
between samples still contributes. Use
`KIT.world.boundaryConditions.prepare(asset).level(name, time, dt)` to
sample one drive. Use `sample(time, dt)` or the CLI for all laws, including
the asset identity and measurements.

```sh
ink-studio sim boundaries pipe-bench.boundaries.json --t 0.1 --dt 0.006 --out sample.json
```

## Bind a finite-volume grid

Set `conditions` on a [grid plan](grid-operators.md) or pass the same
object to `gridOperators.prepare(domain, {conditions})`.

```json
{
  "asset": "pipe-bench.boundaries.json",
  "revision": 1,
  "boundaries": {"inlet": "feed", "east": "cold"},
  "disturbances": {
    "injection": {"rule": "tap", "target": {"min": [0, 0, 0], "max": [1, 1, 1]}}
  }
}
```

The CLI resolves the asset relative to the plan and requires the revision.
For library use, pass the parsed asset object. A plan can also embed the
asset object.

A fixed value supplies the boundary value. Sealed regions use the grid’s
closed-face policy. Flux is positive **into** the domain. Flux density
(the default basis) scales with boundary measure, while `basis: "total"`
distributes one rate over the region’s combined face measure. A
disturbance adds a signed rate across cells with centres inside its
optional XYZ bounds. It defaults to `distribution: "total"` across
selected cell measures. Choose `"density"` for a rate per cell measure.
An optional numeric `scale` defaults to 1. Omitting the bounds selects
every cell.

Supply `time` in operation settings and `dt` for a transport step. An
explicit per-call boundary overrides the asset rule at the same region.
Transport reports the integrated disturbance amount separately from
boundary inflow and outflow. An explicit per-cell or scalar `source` can
add to the authored disturbances.

## Bind a wave network

Set `settings.conditions` on a [wave run](distributed-waves.md), or pass
`conditions` to `waveNetworks.prepare` with the parsed asset object.

```json
{
  "asset": "pipe-bench.boundaries.json",
  "revision": 1,
  "ends": {"outlet": "load"},
  "drives": {"exciter": {"rule": "tap", "node": "inlet"}}
}
```

Use `port` in place of `node` to address a named port. An absorbing end
matches the characteristic impedance of the terminating passage. An
impedance load uses a real nonnegative pressure-to-volume-flow ratio
(`Pa·s/m³`). A sealed end closes the port. Fixed values set pressure in
pascals. Flux rules carry total volume flow in `m³/s`.
Disturbances default to flow and can opt into pressure with
`kind: "pressure"` in the binding. Signal rules can include
`quantity: {"unit":"Pa"}` or `{"unit":"m^3/s"}`, which the wave
binding checks against its input. Explicit source samples override
authored drive defaults. Wave checkpoints include the bound asset.

## Bind a moving wall

Give a `moving-wall` rule a `geometry` object using the existing
[seat and moving patch](moving-boundaries.md) definition. For standalone
geometry, `moving` is an array of vertex positions and optional
`motion` is a signal specifying signed displacement along the seat
normal. The library accepts this rule in place of a grid flux or a wave
flow drive. The drive is the decrease in measured pocket volume divided
by the interval length, positive during compression. Give `level` a
positive interval to measure that rate. Grid and wave bindings use
prescribed volume displacement on fixed topology.

A world `moving-boundaries` system can share a rule by embedding
`conditions: {asset, revision}` in its config and declaring
`boundaries: {valve: {rule: "piston"}}`. The rule’s geometry can select
live scene geometry from the rig or sockets. When it does, the world
system provides the positions and the rule omits `motion`.

## Reproduce the demo

```sh
node examples/simulation-boundary-conditions/demo.cjs studio/out/boundary-conditions
```

The example uses one asset for an animated tracer grid, a matched versus
impedance-loaded waveguide, and a wave driven by piston displacement.
It writes a comparison PNG, animated PNG, WAV auditions, CLI plans, and
a JSON report with conservation and reflection measurements.
