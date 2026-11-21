# Physical work and production

An [order](agent-orders.md) can carry stock between live locations and
contribute labor to a [logistics](headless-worlds.md#built-in-systems)
recipe. A recipe can produce inventory or finish with a construction,
repair, or recruitment effect. Multiple rosters can staff the same
worksite. Attach a [reservation](job-reservations.md) to an order when
access to a workspace, tool, or job also needs to be limited.

The [workyard example](../examples/world-physical-work.json) hauls three
timber bundles to a site, uses two workers to build a wall, and trains an
apprentice with a permit produced by the build. A scout then takes the
detour computed by the navigation tiles after the wall becomes solid.

## Anchor stock to the world

A logistics container can specify an `at` position or an entity with an
optional socket. Its existing `position` also serves as a static anchor.
A `store` account can declare its own `at`. For cargo, reference a live
agent handle.

```json
{
  "at": {
    "agent": {"system": "crew", "id": "hauler", "generation": 1},
    "socket": "pack"
  },
  "stocks": {
    "timber": {"max": 3, "display": {"offset": [0, 0.1, 0], "half": [0.2, 0.18, 0.15]}}
  }
}
```

A stock display with `offset` follows its anchor. A display with an absolute
`at` keeps its authored position. Generation pins keep a cargo account
attached to one lifetime. If that carrier despawns, the ledger retains the
stock and its physical endpoint becomes unavailable.

A `transfer` step with `reach` requires the executing agent to be within
that distance of both accounts. The solver checks both live anchors again
immediately before posting. Use pickup and delivery as two moves and two
transfers, with the carried stock account between them. A stock balance
and its current location are available through `world/account`.

## Staff a recipe

Add a `work` definition to a logistics process.

```json
{
  "recipe": "build",
  "inputs": {"timber": "yard"},
  "outputs": {"permit": "yard"},
  "work": {
    "at": {"entity": "counter", "socket": "work"},
    "radius": 0.6,
    "minWorkers": 2,
    "maxWorkers": 4,
    "batches": 1,
    "effect": {"action": "wall/build"}
  }
}
```

Use `{"op":"work","site":"stock/build"}` in a task. The step approaches
the site and contributes when the agent is within its radius. `rate`
defaults to 1 worker-second per second. A step can use a parameter for
`site` to reuse the same task across many processes. `batch` defaults to
1. For a repeating site, assign later orders to the numbered batches.
Work orders observe a shared batch outcome, and the site caps how many
workers contribute in a tick.

The recipe's `duration` is in worker-seconds. Once inputs and minimum
staff are available, the recipe stages the inputs. It keeps progress and
staged materials if a worker leaves or the site goes to sleep or cohort
LOD. Worker contributions stop when an order loses its reservation or is
interrupted. At completion, output capacity and the effect must both
succeed before the batch posts. The `worksite` query lists live material
and staffing demand, staged progress, the last reported contributors, and any blocker.
The world records `work-demand` when the blocking reason changes and
`work-completed` when the batch commits.

## Publish a result

| Effect | Result |
| --- | --- |
| `construction/build` | Publishes a construction system configured with `initiallyBuilt: false`. An agent intersecting the footprint delays publication. Support, clearance, splats, and navigation see the same published geometry. |
| `mechanics/repair` | Pass `{"body":"beam"}` to repair a live structural beam, including its fatigue and bend, or `{"joint":"hinge"}` to service an attached wear-tracked joint. |
| `agents/recruit` | Pass `prefix`, `species`, and `at`. A clear spawn point publishes an agent named with the prefix and batch number, such as `apprentice.1`. |

Replace the name before the slash with the target system's ID. A recipe
can also complete with inventory outputs alone. Entry, progress, staged
inputs, and completed effects are preserved by checkpoints and replay.

## Inspect from the CLI

```sh
ink-studio sim run examples/world-physical-work.json --ticks 120 --record workyard.run.json
ink-studio probe workyard.run.json --ticks 22 --field stock/worksite --args '{"process":"wall"}' --json
ink-studio probe workyard.run.json --field stock/ledger --json
ink-studio trace workyard.run.json nav/route --at '-3.85,0.13,0' --args '{"to":[3.75,0.13,0],"radius":0.15}' --json
ink-studio sim replay workyard.run.json
```
