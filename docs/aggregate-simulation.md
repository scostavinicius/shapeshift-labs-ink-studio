# Aggregate simulation levels

A [simulation chunk](simulation-chunks.md) can switch a solver's working
representation at a detail boundary. Cadence and representation are
independent. A distant level can still step every tick while updating a
block grid, cohorts or an inventory ledger. Levels with the same model
configuration share its working state when switching cadence.

```json
{
  "id": "distant",
  "within": 60,
  "every": 1,
  "systems": {
    "water": { "aggregate": { "model": "blocks", "factor": 4, "preserve": ["volume", "momentum"] } },
    "agents": { "aggregate": { "model": "cohorts", "cell": 16 } },
    "logistics": { "aggregate": { "model": "ledger", "preserve": ["grain", "flour"] } }
  },
  "instances": {
    "small-pond": { "aggregate": { "model": "blocks", "factor": 2 } },
    "tidal-gates": { "aggregate": false }
  }
}
```

`systems` keys are solver kinds. `instances` keys are system IDs and
override settings for that instance. `preserve` selects the model's
quantity names to audit at a transition. Omit it to audit every declared
quantity. Physical updates during a run can change quantities according to
the solver's rules. A transition that changes an audited amount fails the
tick transaction. The previous state, clock and command queue stay intact.

## Native models

| Model | Aggregate update | Reconstruction |
| --- | --- | --- |
| Water `blocks` | Advances a smaller conservative grid. A factor of 4 uses one solver cell per 16 original cells. `volume` measures water volume. `momentum` measures the two integrated depth–velocity components. | Retains the original bed. On return, fills each block from its lowest cells and redistributes momentum with the water. Coarse probes read block depth and velocity. |
| Agents `cohorts` | Groups individuals by species, position cell and destination cell. Moves and tests one representative per cohort. Audits the total `population` and `species` counts in alphabetical order for species present in the population. | Retains stable IDs, offsets, goals, and individual metadata. Reconstructs positions within the agent bounds and replans detailed routes and placement as needed. |
| Logistics `ledger` | Advances stocks, recipes, reserved inputs and shipments. Checked routes reuse their last observed eligibility. Each resource is an auditable quantity covering stored, reserved and in-transit amounts. | Rebuilds the detailed inventory view. Path eligibility and detailed production events resume on detailed steps. |

The water block factor divides both grid dimensions. The native block
model supports closed shallow-water grids with rain, drainage and sensors.
Grids with gates, pumps, exchanges, sediment, thermal or material
coupling, or obstacle fields can keep their detailed representation at a
coarser cadence. Cohort travel estimates positions and goal progress.
Individual navigation, activity choices and foot-contact generation
resume in detail. A ledger route with no observed successful dispatch is
conservatively held until it gets a detailed check.

## Inspect, save and replay

`world/representation` reports current models, work counts and audited
quantities. Select an individual solver with `{ "system": "lagoon" }`.
`simulation-representation` events record conversions. Checkpoints store
the current working representation, including the archive needed to
reconstruct it. Sleeping chunks retain whichever representation was
active. Read-only compatibility fields expand detail lazily when needed.

The [estuary example](../examples/world-aggregate-estuary.json) moves six
shorebirds, a lagoon and a mill in and out of aggregate operation at the
same cadence. It then sleeps the chunk and reconstructs the local
simulation on return.

```sh
ink-studio probe examples/world-aggregate-estuary.json --field world/representation --ticks 17
ink-studio sim run examples/world-aggregate-estuary.json --ticks 21 --checkpoint estuary.checkpoint.json
ink-studio sim resume estuary.checkpoint.json --ticks 31 --record estuary.run.json
ink-studio sim replay estuary.run.json
node scripts/benchmark-aggregate-lod.js
```

## Custom solvers

A system can implement `simulationAggregate(settings)`. The factory
returns `quantities`, `reduce(detail)`, `expand(data)`,
`step(data, ctx)`, `validate(data)` and `measure(state, isAggregate)`.
A quantity declares `units`, optionally `exact: true` or a relative
`tolerance` (default 1e-9 with unit-scale absolute tolerance). Measurements
can be finite scalars or fixed-order vectors. `output(data, ctx)` is
required if the detailed solver has signal outputs. `describe(data)` can
supply inexpensive work counts.

Optional `fields`, `traces`, `pose`, `poseEntities` and `accounts`
implement coarse-native reads. Legacy reads project the detailed state
once per immutable snapshot. Detail actions reconstruct before applying
the action. The scheduled tier can aggregate the updated state again.
Reducers and expanders are deterministic and side-effect free, including
when called to satisfy a read. Solvers with automatic transfer-request
hooks currently use the existing scheduled detail mode.
