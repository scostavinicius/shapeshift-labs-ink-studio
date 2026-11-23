# Rule boards

`KIT.ruleBoard` compiles an arrangement of copper tracks and directional
glyphs into a [graph automaton](graph-automata.md). A tile can split a
signal, carry isolated routes across one cell, or rotate to connect a
different pair of neighbors. Glyphs represent sources, gates, and
receivers. The board renders the same indexed cels and orientations it
uses to match the sockets.

```js
const { variants: { b: inlay } } = K.pixelTiles.pairedArcs(12);
const board = K.ruleBoard.compile({
  width: 3, height: 3, size: 12,
  parts: {
    inlay: { paths: inlay.pairs, cel: inlay.cel },
    ember: { outputs: 'E' },
    moon: { outputs: 'W' },
    iris: { inputs: 'S' },
    bell: { inputs: 'N' }
  },
  cells: [
    null, { part: 'iris', id: 'iris' }, null,
    { part: 'ember', id: 'ember', state: 1 }, 'inlay', { part: 'moon', id: 'moon', state: 0 },
    null, { part: 'bell', id: 'bell' }, null
  ]
});

const turned = board.edit([{ op: 'turn', at: [1, 1], turns: 1 }]);
const { added, removed } = board.diff(turned);
const run = turned.create();
run.step();
run.get('bell'); // 1
const art = turned.raster(); // { w, h, rgba }
```

## Author the arrangement

- Coordinates start at the upper left. Cells are a flat row-major array.
  Use `null` for empty space, a part name for an unturned track, or a
  placement with `part` and optional `turn` from zero to three clockwise
  quarters. Every glyph placement also has a stable `id` and optional
  graph `state` and `locked` values.
- Use `paths: ['NW', 'ES']` for two isolated routes,
  `paths: ['NES']` for a fork, and `paths: ['NS', 'EW']` for an isolated
  crossing. Ports are local to the tile. A shared edge conducts when both
  cells expose their facing sockets. `board.unmatched` lists sockets
  facing an empty cell, a solid edge, or the outside of the board.
- Glyph parts declare distinct `inputs` and `outputs`, such as
  `{ inputs: 'WN', outputs: 'E', type: 'all' }`. Connections follow
  an output through tracks to one or more inputs. Inputs terminate the
  track, and any outgoing signal starts with the glyph's own state on a
  subsequent graph tick.
- The optional `cel` is a single [pixel stamp](pixel-stamps.md). Use the
  board's square `size` and paint the exact two center texels for each
  declared socket. Keep the rest of each edge transparent. Cel size is
  even, from 4 to 32 pixels. Supply `{ scenePalette, paletteRoles }` to
  `compile` for cels that reference a scene palette. Parts without art
  remain valid wiring and contribute transparent pixels.

## Edit and inspect

`edit(changes)` returns a newly compiled board. Use `turn` with a signed
number of quarter turns, `move` with `from` and an empty `to` cell, or
`set` with `at` and a replacement `cell`. All edits in a batch are
applied before compiling. A move keeps the glyph's stable ID.

`board.diff(next)` reports `added` and `removed` edges, `rerouted` edges
whose endpoints stay the same, and `moved` glyphs with their old and new
coordinates. Each connection in `board.graph.edges` has stable endpoint
IDs and local port names, plus an ordered `data.path` of physical cell
coordinates and outward-facing sides. Use that path to show the old or new
route on the art. If several passive paths connect the same pair of
sockets, Ink reports one connection using a deterministic shortest path.
The compiler follows loops without duplicating their connections.

`board.create()` uses Ink's existing graph runtime. By default, `source`
keeps its state, `any` lights from any active input, `all` needs an active
signal on every declared input, and `not` lights when all its inputs
are quiet. Glyphs with input sockets default to `any`. Output-only
glyphs default to `source`. Each edge carries state one tick later.
Use `board.create({ rule, states, seed })` to supply a graph rule such as
`K.cellular.graph.rules.pulse()` or your own gate behavior. Authored glyph
`data` is available at `node.data.authored` in the rule.

Use `board.raster()` as a nearest-filtered render layer or sprite surface.
It paints the indexed tile and glyph cels at their current placement and
orientation. The graph state and socket paths are available separately
for highlighting routes, choosing emissive swatches, or driving a scene.

## Emberlock demo

Turn the center copper inlay to swap the two lamp routes. Drag the
iris glyph or use **Move iris glyph** to seat it over the spare socket.
Select a changed connection to trace it over the copper.

```sh
node examples/rule-board.cjs ./emberlock
```

Open the generated `emberlock.html` in a browser. It runs the compiler and
graph locally and includes its own assets.
