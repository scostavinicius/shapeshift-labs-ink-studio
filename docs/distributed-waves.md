# Distributed pressure and flow

Use `KIT.world.waveNetworks.prepare(domain, settings)` or
`ink-studio sim waves <run.json>`. Both wave solvers accept the same
variable-area tubes, branches, sources, named pressure/flow probes,
losses, and passive terminations. They model linear, one-dimensional
waves about rest. Positive tube flow follows the tube's authored
`from` to `to` direction. A [boundary set](boundary-conditions.md) can supply
time-varying drives and name reusable terminations.

Supply a complete [compiled branched domain](branched-domains.md) or a
compact `ink-studio/wave-network` document, version 1. The compact form
uses named node records, tubes with `from`, `to`, and ordered
`sections: [{length,area}]`, optional `ports: {portName: nodeName}`,
and `observations`. Adjacent equal-area, equal-loss sections join into
one uniform piece. Both methods scatter at each area change and at
branched junctions. Node placements and volumes from a compiled domain
serve as geometry metadata. Wave junctions themselves have zero volume.
Model a cavity as an explicit acoustic passage when it needs distributed
propagation. Use separated tubes with sealed ends to represent a closure.

```json
{
  "format": "ink-studio/wave-network",
  "version": 1,
  "id": "side-chamber",
  "nodes": {"inlet": {}, "tee": {}, "outlet": {}, "cap": {}},
  "tubes": {
    "stem": {"from":"inlet", "to":"tee", "sections":[{"length":0.4,"area":0.002}]},
    "flare": {"from":"tee", "to":"outlet", "sections":[{"length":0.2,"area":0.003},{"length":0.2,"area":0.005}]},
    "stub": {"from":"tee", "to":"cap", "sections":[{"length":0.3,"area":0.001}]}
  },
  "observations": {"bell":{"node":"outlet"}, "throat":{"tube":"flare","t":0.3}}
}
```

[Simulation diagnostics](simulation-diagnostics.md) report CFL limits,
section travel-time drift, and volume-flow balance at connections.

## Choose the solver and boundary behavior

| Setting | Behavior |
| --- | --- |
| `method:'distributed'` (default) | Staggered finite-volume pressures and face volume flows. Uses fluid compressibility in each cell and inertance between pressures. The CFL limit automatically subdivides each audio sample. Finer cells improve high-frequency accuracy and increase work. |
| `method:'delay'` | Bidirectional pressure waves. The travel time sets the ring-buffer length and optional first-order all-pass fractional delay. Each traversal uses exponential amplitude loss. Scattering enforces common pressure and signed volume balance at joins. |

`sampleRate` defaults to 48,000 Hz (range 1,000–192,000),
`soundSpeed` to 343 m/s, and `density` to 1.2 kg/m³.
`metersPerUnit` scales authored lengths, and its square scales areas.
Use `loss` in amplitude nepers per metre, optionally overridden by
`losses: {tubeName: value}` or a compact section's `loss`. The distributed
solver applies corresponding pressure and flow damping. It uses
`cellLength` in metres as an upper bound on cell length, defaulting to
one acoustic sample of travel. `cfl` defaults to 0.95. Plans that would
require more than 32 substeps per audio sample fail preparation.

The delay solver uses a minimum of one sample of travel on each
uniform piece. It reports short pieces affected by that minimum, the
nominal travel error, and the ring memory used. The fractional delay
targets low-frequency timing. High frequencies and interpolated interior
probes can differ from the distributed result. The distributed solver's
face flows and cell pressures use staggered time levels.

Set `terminations` by node or port name. Unspecified boundaries
and unforced junctions have zero external flow.

| Termination | Pressure behavior |
| --- | --- |
| `{kind:'sealed'}` | Zero exterior volume flow. Positive pressure reflection at a capped tube. |
| `{kind:'open'}` | Pressure release to zero gauge pressure. Inverted pressure reflection. |
| `{kind:'matched'}` | Resistive load matched to the sum of the incident characteristic admittances. |
| `{kind:'reflect', coefficient:0.35}` | Passive real pressure reflection coefficient from −1 to +1, relative to that match. |
| `{kind:'impedance', impedance:100000}` | A prescribed real, nonnegative load in Pa per m³/s. Zero gives pressure release. |

At a branch termination the effective match uses the sum of its
endpoint admittances. The pressure reflection table describes a single
uniform incident tube. The distributed solver's discrete match can
still reflect high frequencies. These loads are real and
frequency-independent.

Define `sources: {drive: {kind:'flow', node:'inlet'}}` to inject volume
flow in m³/s, or use `kind:'pressure'` to hold the node at the specified
pressure in Pa. A pressure source replaces a sealed or open boundary
condition. Use a `port` instead of `node` to bind through a named port.
Each node accepts one source. Flow injection works with sealed or
resistively loaded nodes.

`probes` can add or replace named observations by `node`, `port`,
or `{tube, t}` with a normalized position. `{tube, distance}` uses
authored length units. Node probes report total flow **away from**
the node into its tubes, which is near zero at an unforced junction
and negative at an absorbing outlet. A tube probe reports flow in
the tube's oriented direction.

[Virtual microphones, pressure taps and flow meters](virtual-sensors.md)
record these probes with calibrated units and resumable sensor state.

## Blocks, checkpoints, and CLI

```js
const {KIT} = require('@shapeshift-labs/ink-studio').load();
const wave = KIT.world.waveNetworks.prepare(domain, {
  method:'delay',
  sources:{drive:{kind:'flow', node:'inlet'}},
  terminations:{inlet:{kind:'matched'}, outlet:{kind:'matched'}}
});
const hit = new Float64Array(2400);
hit[0] = 0.0001;
const block = wave.process(hit.length, {inputs:{drive:hit}});
const saved = wave.snapshot();
```

`process(count, {inputs, collect})` accepts a scalar or a sample array
per source. Unspecified sources receive zero. It returns per-probe
`pressure` and `flow` Float64Arrays and the processed sample range.
With `collect:false`, use `view()` for the final probes. Work is bounded
by a per-block `maxWork` estimate, reported with `info.workPerSample`.
The estimate counts stencil or scattering passes and excludes copying
and output serialization. Split a large request into smaller blocks.
A compatible JSON snapshot preserves pressure, flow, propagation
history, and the sample cursor.

The registered `acoustic-wave-network` kernel (revision 1) works with
[versioned fast block models](simulation-blocks.md). Its config has
`domain`, `settings`, one selected `source`, and one `probe`. It uses
the model's fixed integer sample-rate clock. Connect its numeric
`drive` level and read the probe's `pressure` and `flow` outputs.
Library and CLI runs can collect several sources and probes at once.

A version 1 `ink-studio/wave-run` has `network` (inline or a relative
JSON path), `settings`, `samples`, and optional `inputs`.
A source can use a constant level, a sample array matching the run
length, or `{value:0, impulses:[{sample:0,value:0.0001}]}`.
Impulse positions are absolute sample indices and sum into the supplied
level. An optional `checkpoint` resumes a compatible saved state.
The CLI reports the two signals per probe and the final checkpoint.
Its optional `maxTotalWork` budget defaults to 400 million estimated
work units, with a maximum of two billion.
With `--wav`, the plan's `audio: {probe,gain}` selects and scales a
pressure channel. Choose a gain that stays within PCM range.

```sh
node examples/simulation-wave-networks/demo.cjs /tmp/ink-waves
node cli/ink-studio.js sim waves /tmp/ink-waves/branch-distributed.run.json --out /tmp/waves.json --wav /tmp/bell.wav
```

The demo includes matched-gain listening samples for both solvers in
a variable-bore horn with a sealed side branch, and a second comparison
of sealed, open, and matched terminations on the same straight tube.
