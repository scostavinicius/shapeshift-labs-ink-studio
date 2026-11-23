# Build a branched simulation domain

Compile an authored domain with `KIT.world.domains.compile(document)` or
`ink-studio sim domain`. The result is a portable geometry graph that a
[simulation model](simulation-models.md) can consume. Nodes carry positions and
storage volumes, tubes carry measured sections, and named ports and
observations identify the sites the model can wire up.

## Author the network

An `ink-studio/branched-domain` document has schema `version: 1`, an `id` and
a positive integer `revision`. It uses these named tables.

| Table | What to author |
| --- | --- |
| `nodes` | Give each node an `at` placement and a `kind` of `junction`, `cavity`, `reservoir` or `terminal`. Cavities and reservoirs require a positive authored `volume` in cubic world units. Add named sockets and an optional geometry ID for the node itself. |
| `paths` | Supply either complete `points`, including both endpoints, or interior `guides`. A path can pin a `revision` and an `up` direction for its section frames. |
| `geometries` | Give each asset a stable name and pin its `revision`. Optional `asset` text records its authoring identifier. For tube geometry, provide a mesh, SDF or contour `source` using the [section measurement source format](path-sections.md#choose-a-source). |
| `tubes` | Set `from` and `to` to two distinct `node/socket` addresses, and name the `path` and `geometry`. Optional `sampling` sets `samples` or `distances`, `selection`, `contours`, or `epsilon`. |
| `ports` | Name external boundaries and set each `kind` to `inlet` or `outlet`. Each port takes a `socket` address. |
| `observations` | Name a `socket`, or name a `tube` and give one of `section` (zero-based index), `t` (0–1 of arc length), or `distance` (world units along the tube). |

Node placements, socket placements and path points accept XYZ values or world
selectors such as `{"entity":"fitting","socket":"barb"}`. A socket can use
`at` for an explicit placement or `offset` relative to the node's frame.
Every node gets a `center` socket unless it defines its own. A cavity can have
an entrance, a release and a separate probe socket.

The compiler inserts the tube's socket positions around a guides-only path.
A complete path must already meet its declared sockets within `tolerance`
(default `1e-5` world units). Its endpoints then resolve to the exact socket
positions. Draw branching paths as separate tubes meeting at an authored node.
Branches join by node IDs, so crossing tubes and coincident but separately
named nodes retain their own connections.

Use `{query: run.query(), snapshot: {world, tick}}` when compiling against a
live world or checkpoint. In the CLI, use `--world` with a world, checkpoint
or recording. Add `--ticks` to advance to a particular tick before taking the
socket positions. The compiled domain stores those positions and the world and
tick used to resolve them.

## Use and trace the compiled geometry

Each tube has its endpoint sockets, the resolved polyline, its length, its
sampled minima and its measured sections. Ink estimates tube volume as
`sum(area * sectionLength)`. Node volumes are supplied by the creator. A
tube with a failed section records a null volume and marks the domain
incomplete. The failed row keeps its measurement status and origin.

Every section ID is `tube/index`. The section records the path ID and
revision, the geometry ID and revision, the asset or relative source-file
reference when supplied, and its station index, distance and span. A section
trace also returns the original path placements and the attached endpoints.
Recompiling a different station layout can change section indices. For named
observation sites that should follow an arc position, author `t` or `distance`.

The compiler lists connected components, including isolated nodes. Model
operators assign physical boundary conditions using the named ports. A model
can keep the compiled record directly in `domain` and bind values such as
`{"$model":"/domain/tubes/upper/sections/4/area"}` into any operator that uses
them. The demo binds measured geometry and storage volumes into Ink's existing
pipe-network solver and supplies the rest of the hydraulic tuning explicitly.

## Run the manifold demo

```sh
node cli/ink-studio.js sim domain examples/simulation-branched-domains/bench.domain.json \
  --world examples/simulation-branched-domains/bench.world.json --out /tmp/manifold.domain.json
node cli/ink-studio.js sim domain /tmp/manifold.domain.json --section upper/4
node examples/simulation-branched-domains/demo.cjs /tmp/ink-manifold
node cli/ink-studio.js sim run /tmp/ink-manifold/manifold.model.json --ticks 168
```

The bench connects two reservoirs, an explicit tee, a cavity and a nozzle.
It has four tubes, 35 traced sections, three named external ports and four
observation sites. The playback opens the lower branch and follows the
accepted flow through the cavity. The demo also writes the compiled domain,
the runnable model and the trace of section `upper/4`.

Use [distributed pressure and flow](distributed-waves.md) to propagate
acoustic waves through the measured sections and named probe sites.
