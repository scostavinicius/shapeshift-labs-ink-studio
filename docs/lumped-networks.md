# Lumped effort/flow networks

Use `KIT.world.lumpedNetworks.prepare(network)` to simulate a reusable
network of storage, resistors, inertance, springs, dampers, sources, and
junctions. Use `sim network <run.json>` for a portable trace or embed the
same network in a versioned Ink simulation model.

A network is an `ink-studio/lumped-network` document with `version: 1`,
an `id`, an optional positive integer `revision` (default 1), named
`nodes` and `elements`, and optional `units`, `inputs`, `outputs`,
and `numerics`. Elements point from their `from` node to their `to`
node. A positive element flow follows that direction. Node flow measures
net outgoing flow.

Use a consistent effort/flow pair. Examples include pressure and volume
flow, voltage and current, or velocity and force. The product of effort
and flow is power in the authored unit system for a power-conjugate
pair. `units: {effort,flow}` labels port values with Ink's existing
[physical quantities](physical-ports.md). Network coefficients and source
values use the same authored scale.

[Simulation diagnostics](simulation-diagnostics.md) summarize the energy
ledger and locate the largest flow residual at a named junction.

## Reusable elements

| Where | Kind | Fields and equation |
| --- | --- | --- |
| Node | `reference` | `effort` (default 0) fixes the node's effort and can act as an effort source. |
| Node | `storage` | Positive `capacity` and optional `initialEffort` (default 0). Stored quantity is capacity times effort. Incoming net flow increases that stored quantity. |
| Node | `junction` | No state. Its effort is chosen so signed net flow is zero. |
| Branch | `resistor` | Positive `resistance`. Flow equals the effective effort drop divided by resistance. |
| Branch | `damper` | Positive `damping`. Flow equals damping times the effective effort drop. In the mechanical analogy, this is damping force from relative velocity. |
| Branch | `inertance` | Positive `inertance`, optional nonnegative `resistance` and `initialFlow` (both default 0). Flow derivative equals effective drop minus resistive loss, divided by inertance. |
| Branch | `spring` | Positive `stiffness` and optional `initialDisplacement` (default 0). Flow equals stiffness times displacement. Displacement derivative is the effort drop. |
| Branch | `flow-source` | `flow` prescribes signed flow regardless of the effort drop. |

A resistor, damper, or inertance can include a series `head`, added to
the effort drop in its positive direction. A reference's `effort`, a
source's `flow`, or a branch's `head` can be constant or use
`{input:'channel', scale:1, offset:0}`. Declare that channel in
`inputs`, with a finite `default` (default 0) and optional `quantity`.

For example, this network models a mass attached to a spring and a damper.
The mass stores momentum, and the node effort is velocity.

```json
{
  "format": "ink-studio/lumped-network",
  "version": 1,
  "id": "oscillator",
  "units": {"effort": "m/s", "flow": "N"},
  "nodes": {
    "anchor": {"kind": "reference"},
    "cart": {"kind": "storage", "capacity": 1.4}
  },
  "elements": {
    "spring": {"kind": "spring", "from": "cart", "to": "anchor", "stiffness": 12, "initialDisplacement": 0.76},
    "damper": {"kind": "damper", "from": "cart", "to": "anchor", "damping": 2.8}
  },
  "outputs": {
    "position": {"element": "spring", "measure": "displacement", "quantity": {"unit": "m"}},
    "speed": {"node": "cart"},
    "springForce": {"element": "spring"},
    "dissipated": {"ledger": "dissipated"}
  }
}
```

## Run and inspect

A prepared network provides `advance(time, inputs?)` to advance to
absolute seconds, `view()` to inspect the committed state, and
`snapshot()`, `restore(checkpoint)`, and `reset()` for replay.
With no inputs argument, the previously applied levels hold. An explicit
inputs record fills omitted values from the authored defaults. The
selected levels hold throughout that advance.

The report includes effort and signed flow at every terminal, storage
quantity at each storage node, and flow, effort drop, and applicable
displacement at each branch. `outputs` selects named scalar ports.
Node measures are `effort` (default), `flow`, and `stored`. Branch
measures are `flow` (default), `drop`, and `displacement`. Ledger
selections include `energy`, `supplied`, `dissipated`, `balance`,
`sourcePower`, `lossPower`, and `junctionResidual`.

The ledger checks stored energy against initial energy plus net source
work minus dissipation. It reports the signed residual and the largest
absolute junction flow imbalance. That residual includes numerical
integration error. A network can use RK4 (default step 1/240 s) or
adaptive RK4 through the [state integrator](state-integrators.md).
The `numerics` table can set the `method`, `step`, `minStep`,
`maxStep`, `absoluteTolerance`, `relativeTolerance`, and `maxSteps`.

The junction solver factors its resistive conductance once. Each
algebraic junction needs a conductive path through resistors or dampers
to a storage or reference node. Purely ideal constrained junctions
require a different differential-algebraic formulation. Networks are
bounded to 256 nodes, 64 junctions, and 512 branches. The topology and
passive coefficients stay fixed during a run. Source levels can change
at authored time boundaries.

## Embed or run from the CLI

Set a native world system's `kind` to `lumped-network` and place the
definition at `config.network`. In a [versioned model](simulation-models.md),
pin the operator's `revision` to 1. Declared inputs and outputs are
ordinary numeric world ports. The system checkpoints its network and
exposes a `network` query field for the full report.

A CLI run uses `ink-studio/lumped-network-run` version 1. Supply
`network` as an inline definition or a relative JSON path and `samples`
as increasing absolute times. Optional `inputs` set the initial levels.
Each optional `commands` entry contains `time` and an `inputs` patch.
The runner integrates up to that exact time under the prior levels.
At a sample that coincides with a command, it reports the new levels
and the continuous state reached at the boundary. To resume, set
`checkpoint` to a saved checkpoint record or its relative JSON file.

```sh
node examples/simulation-lumped-networks/demo.cjs /tmp/ink-lumped
node cli/ink-studio.js sim network /tmp/ink-lumped/hydraulic-circuit.run.json --out /tmp/hydraulics.json
node cli/ink-studio.js sim network /tmp/ink-lumped/heavy-damper.run.json --out /tmp/damping.json
```

The demo drives a circuit with a supply step and a flow source, then
lowers supply effort until line flow reverses. Alongside it, two masses
oscillate on the same spring with different damping. The generator
writes the network definitions, run plans, traces, comparison board, and
animation.
