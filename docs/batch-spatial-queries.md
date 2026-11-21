# Batch spatial queries and occupancy

Use `query.spatialBatch({queries})` from a committed run snapshot or a
solver's `ctx.query`. It returns `{tick, time, results}` in request order.
Proximity, occupancy, and socket tests share an index of the live agents
and collision bodies. Solver indexes are reused while their source state
is unchanged. Older query snapshots keep their own view of the world.

```sh
ink-studio probe examples/world-spatial-yard.json --field world/spatial-batch --spec examples/spatial-yard-queries.json --json
```

The example finds the porter near the foreman, identifies the crate as a
blocker, verifies a clear spot, and returns the left bench socket. The
crate blocks the right socket.

Every request takes an `op`, an `at` origin, and a nonnegative `radius`
in world units. An origin can be an XYZ array, `{"entity":"bench","socket":"left"}`,
or `{"agent":{"system":"crew","id":"foreman","generation":1}}`.
The generation is optional and pins the lookup to one lifetime when
given. A missing origin gets an individual `missing` result. Give any
request an `id` to carry through to its result.

| Operation | Result |
| --- | --- |
| `nearby` | Centers within the search radius, nearest first. Defaults to agents. Set `kinds` to include `body`, `entity`, or `socket`. |
| `occupancy` | Tests a sphere centered at `at` against live agent shapes, mechanics colliders, and terrain clearance. Returns `free`, `occupied`, or `unknown`, plus blocker records and unavailable sources. |
| `interactions` | Posed authored sockets within reach. Add `fitRadius` to test free space at each socket, or `require` to evaluate scene query conditions there. Reports counts for blocked, unknown, and ineligible sockets. |

## Selection and clearance

- `limit` controls the returned rows, with a default of 32 and a maximum
  of 256. `matched` counts all matching rows. Distance ties use stable
  identifiers. Provenance includes the kind, system, and ID.
- `exclude` accepts IDs, entity names, or handles with `kind`, `system`,
  `id`, and optional `generation`. Use it for self-exclusion in crowd
  and sensing queries. `systems` filters providers. For `interactions`,
  it selects the providers used for the fit test.
- `where` uses the standard world condition language for nearby rows
  or sockets. An interaction can require
  `{"field":"door/unlocked","when":{"value":true}}` at each socket.
  Socket-owner colliders are ignored during fit by default. Set
  `ignoreOwner:false` to include them.
- Walking agents occupy upright capsules measured from their feet.
  Flying and swimming agents occupy spheres. Cohort positions use the
  same reconstruction as individual agent queries. Dormant agents do
  not occupy space. Body checks use the mechanics collider distance.
- Touching counts as occupied. Editable solids supply their clearance
  field and mechanics supplies its ground height clearance. Use
  `clearance` at batch or query level to choose other signed distance
  fields as `[{ "field": "terrain/clearance", "args": {} }]`. An explicit
  empty list selects only the indexed bodies and agents. A known
  blocker takes precedence over an unavailable source.

Custom solver providers can publish an `occupancy` descriptor with
`kind`, `rows(state)`, and optionally `distance(shape, point)` for
solid occupancy. Each row supplies a unique `id`, a world `position`,
optional `entity`, and conservative `min` and `max` bounds for its
shape. Extra fields are exposed for filtering. An immutable
`key(state)` can identify reusable geometry across solver steps.
