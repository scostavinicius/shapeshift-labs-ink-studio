# Two-way transfer coupling

A `transfer-coupling` system solves feedback between continuous transfer
accounts at a world tick boundary. A pressure change can move a reed, for
example, and the resulting opening can change the airflow and pressure used by
the same solve. Coupling uses Ink's [transfer accounts](headless-worlds.md#conservative-transfers-between-systems)
for all capacity checks, debits, credits and final receipts.

## Connect accounts

This group controls the exchange of energy between two stores. The built-in
`proportional` law evaluates `gain * (from.balance - to.balance) * dt` for each
scalar link. With compatible accounts measured in joules, the gain has units of
inverse seconds.

```json
{
  "kind": "transfer-coupling",
  "config": {
    "law": "proportional",
    "revision": 1,
    "parameters": { "gain": 2 },
    "links": {
      "heat": {
        "from": "panel/heat",
        "to": "room/heat",
        "mode": "partial",
        "tolerance": 0.00001,
        "relativeTolerance": 0.0001
      }
    },
    "iteration": {
      "maxIterations": 16,
      "relaxation": 0.65,
      "onLimit": "reject"
    }
  }
}
```

Each link connects accounts with the same resource, unit string and continuous
type (`number`, `vec2` or `vec3`). Positive scalar amounts go from `from` to
`to`. A negative scalar reverses the endpoints in the ledger. Signed vectors
keep the declared endpoints and use the existing directional clipping rule.
A group can mix compatible pairs for mass, momentum or energy. The
`enabled` Boolean input starts true unless the configuration sets it to false.

Groups run once per world tick after the ordinary scheduled and producer
transfers and their confirmations, before the participating systems step.
Groups and participants use the fixed world clock. Groups run in ID order
and their links use ID order when competing for an account limit. Put mutually
dependent links in the same group to solve them together. A group sees the
balances posted by preceding groups. Links retain the ledger's owner-only and
precision rules.

## Choose the iteration policy

Ink makes an initial estimate from the start-of-boundary balances. For each
iteration it evaluates the law on the balances projected by that estimate
and computes a new estimate. Every projection starts from the **same**
boundary state. Only the selected estimate posts transfers and emits transfer
events. Account reads, writes, observation hooks and the coupling law should be
pure and deterministic because Ink can evaluate them multiple times.

The residual is the difference between the current capacity-limited transfer
estimate and a fresh capacity-limited evaluation at that estimate. For each
component Ink divides the absolute difference by
`tolerance + relativeTolerance * max(abs(estimate), abs(fresh))`. The largest
ratio across the links is the group residual ratio. A ratio of **1 or less**
meets tolerance. Default absolute tolerance is `1e-8` in the link's transfer
units, and default relative tolerance is zero. If capacity constrains a
solution, the link report shows the limiting endpoint or ledger rule.

Set `maxIterations` from 1 through 64 and `relaxation` in (0, 1]. The
relaxation blends the last estimate with the fresh estimate before the next
iteration. If the solve exhausts its budget, choose `reject` to skip that
group's transfers while completing the tick, `accept` to post the last
capacity-checked estimate, or `error` to abort the full tick. A one-pass baseline
uses `maxIterations: 1` and `onLimit: "accept"`. It posts the initial estimate
and still evaluates one residual.

`sim plan` lists each group, its participants, a bound on trial settlements
and its latest report. The `<group>/coupling` probe gives the absolute residual
in each link's units, the normalized residual ratio, the trial estimate and
what posted. `converged`, `iterations`, `residualRatio` and `committed` are
ordinary output ports. Checkpoints preserve the latest report and the existing
transfer receipts.

Use [simulation diagnostics](simulation-diagnostics.md) to rank a saved
probe by link residual and gate a run on tolerance.

## Register a law for a model

Register a named and revisioned law in the same project loader as the account
providers. The factory receives immutable parameters and the link metadata.
The returned synchronous function receives the boundary `tick`, `time`, `dt`
and a `link(name)` accessor. It returns one amount per link in the declared
direction, including zero for an idle link.

```js
KIT.world.transferCoupling.registerLaw('valve-flow', ({conductance}) => ({dt, link}) => {
  const {from, to} = link('air');
  return {air: conductance * (from.values.pressure - to.values.pressure) * dt};
}, {revision: 1});
```

Each endpoint observation includes its ordinary balance, limits and unit
metadata. A provider can add an account-level
`observe(state, {tick, time, dt})` hook to expose derived data under `values`.
It receives the projected state after the current trial's transfers. For
example, a chamber can derive pressure from trial mass and a reed can predict
its opening from trial momentum.

A library host that already holds a transfer binding can also prepare a solve
using `KIT.world.transferCoupling.create(config, transfers)`. Its
`solve(states, {tick, dt, requester, root, enabled})` takes immutable base
states and a state-owning callback as used by the ledger. It returns the
selected `requests` and `report`. The host posts those requests once through
its transfer binding. The built-in world system does this automatically.

## Try the reed bench

The example runs two air chambers and a spring reed at a 12 kHz fixed tick.
A drive injects air into the mouth chamber and air bleeds out of the bore.
The coupling accounts track the mass moved between chambers and the impulse
paired between the air and reed. The rendered voice is the bore pressure with
its DC component removed.

```sh
cd examples/simulation-transfer-coupling
node ../../cli/ink-studio.js sim plan reed.world.json
node ../../cli/ink-studio.js probe reed.world.json --ticks 173 --field feedback/coupling
node ../../cli/ink-studio.js probe reed.world.json --ticks 173 --field world/transfers
node demo.cjs /tmp/ink-transfer-coupling
```

The demo writes matched WAVs, a pressure and opening plot, and a JSON report
with residuals, iteration counts and the observed exchange balance drift.

The design follows the separation of scheduling from model calculations
described by [FMI Scheduled Execution](https://fmi-standard.org/docs/3.0/#fmi-for-scheduled-execution)
and uses paired ledger entries for quantities that must sum to zero across
an exchange, analogous to [Modelica flow connectors](https://doc.modelica.org/Modelica%204.0.0/Resources/helpWSM/ModelicaReference/ModelicaReference.%27flow%27.html).
