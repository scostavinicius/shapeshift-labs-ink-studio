# Inspect simulation execution

Run `ink-studio sim plan <world|model|checkpoint|recording>` to inspect a
compiled simulation without advancing it. The library returns the same
report from `run.composition()`. The existing top-level system contracts,
connections, dependencies, and order remain available. The versioned
`execution` section adds the schedule and resource estimates. A world or
model plan samples the initial state. A checkpoint or recording plan
samples the saved endpoint.

## Read the schedule

- `clock` gives the base tick and the phase grid. `phases` lists candidate
  systems in execution order at each boundary. The candidate runs if its
  cadence is due. A fixed `every: 4` runs on multiples of four base ticks.
  A fixed `substeps: 2` runs at the half-tick and end-of-tick boundaries.
- `systems` gives each system's cadence, rate in Hz, hooks and worker
  eligibility for the configured host. Chunk-managed systems list the
  clocks for their active detail levels and show the current level,
  including sleep. Their due times depend on their local active clocks and
  wake conditions.
- `postStep` lists observers and transfer producers that run through their
  dedicated passes. The runtime calls post-step observers each base tick
  and passes a sampling flag according to the observer's cadence.
- A reusable module has a `child.plan` with its own schedule, memory, and
  signal loops. The bridge lists the ratio of model ticks to host ticks,
  the model catch-up limit per visit, held input levels, queued input events,
  and accumulated output events. A visit advances the model to the last
  completed model tick at that host boundary.
- `blocks` shows the maximum range and publication boundary of a
  [sample-rate model](simulation-blocks.md). Its clock still reports the
  logical sample cadence. [Prepared processing](simulation-prepared-processing.md)
  adds the effective block size, typed buffer layout and capacity counters.

## Follow a signal

Each entry in `signals` identifies the exact ports, type, sampling policy,
and publication boundary. `crossRate` marks edges between different
cadences or independently scheduled chunks. A held combinational value can
publish in the same phase when both systems are due. An ordinary stateful
output becomes available after its source phase. Delays count whole base
ticks. Average, sum, and events keep a window or queue for the receiving
system. The plan reports pending averaged phase quanta and queued event
counts at the inspected tick. A delayed sum or event wire also retains
its per-tick batches. [Explicit rate crossings](simulation-rate-crossings.md)
add the signal semantics, filter settings, effective latency, and
retained source history. [Timed event inputs](simulation-timed-events.md)
show the reaction policy and any same-phase event ordering dependency.

`feedback` identifies strongly connected groups of signal wires and
declared state reads, including a stateful self-wire. Within a group,
`boundaries` identifies the delayed, phase-buffered, interval-averaged,
or phase-start edges that keep the loop schedulable. Arbitrary reads from
JavaScript or spatial queries are outside this declared dependency graph.

## Interpret the estimates

`assets` lists embedded pack revisions and baked environment images,
resolved datasets, and pinned model definitions in the inspected world.
Asset-family variants expose their recipe type. Those recipes can still
generate geometry at runtime. See nested plans for a module's own assets.

Memory reports the UTF-8 JSON size of the inspected system state and current
queue contents, the configured delay slots and event limits, and the size
of the embedded assets. The typed state count represents the raw kernel
buffers, including instantiated children. State JSON counts already include
the serialized buffers. A module's state JSON contains its child checkpoint,
so adding the child report's state JSON again would double-count it.

Work reports the nominal visits per tick of fixed step and output systems
and a conservative upper bound for visits at that level of the model.
Use the child reports to inspect work inside module visits. Transfer,
query, rendering, and JavaScript allocation costs are outside those
counts. Use `sim run --profile` to measure elapsed time.

A native system provider can return
`estimate({state, world, id}) => ({workspaceBytes, workPerStep})`.
A [registered kernel](simulation-kernels.md) can declare the same result
through `estimate(config, {id, seed, dt})`. Either field can be omitted.
`workspaceBytes` covers solver scratch storage. `workPerStep` maps a named
unit to a nonnegative count, such as `{pressureCellUpdates: 1024}`. The
report multiplies this count by each cadence to show nominal work per base
tick. Reported payload and scratch sizes are planning figures. Runtime heap
use depends on the implementation and live inputs.

## Spring feedback bench

```sh
cd examples/simulation-execution-plan
node ../../cli/ink-studio.js sim plan bench.world.json --out plan.json
node ../../cli/ink-studio.js sim run bench.world.json --ticks 16 --profile
node demo.cjs demo-output
```

The 25 Hz drive samples a CSV force curve and receives spring displacement
through a one-tick feedback delay. The spring module publishes at 50 Hz and
integrates at 100 Hz internally. A 6.25 Hz meter averages displacement
through four host ticks. The demo exports the plan, a checkpoint plan,
and a visual walkthrough that compares the planned cadence with the
runtime's observed visit counts.

[Transfer coupling groups](simulation-transfer-coupling.md) also list their
exchange links, account participants, trial budget and latest residual.
