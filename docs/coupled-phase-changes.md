# Coupled phase changes

`KIT.procedural.motion.phaseChange(options)` runs authored reactions on
a masked XZ grid. Each cell can hold several amounts, such as liquid,
ice, dissolved pigment, or heat. A reaction can read those amounts and
nearby cells, consume several channels, and produce new phases together.

```js
const frost = KIT.procedural.motion.phaseChange({
  width: 120, height: 80, cell: .06, origin: [-3.6, -2.4], dt: .05,
  channels: {
    liquid: { initial: .8, diffusion: .0004 },
    ice: {},
    chill: { diffusion: .04 }
  },
  rules: [{
    id: 'freeze',
    consume: { liquid: 1, chill: .12 },
    produce: { ice: 1 },
    rate: ({ fields, nearby }) =>
      Math.max(0, fields.chill - .18 + .25 * nearby.ice) * fields.liquid * 3,
    emitEvery: .16
  }],
  finish: ({ fields: { ice } }) => ({
    color: [.08 + .72 * ice, .14 + .78 * ice, .22 + .74 * ice],
    roughness: .16 + .74 * ice,
    relief: .09 * ice
  })
});
const frame = frost.step(12, {
  drive: ({ at: [x, z], fields }) => ({
    sources: { chill: (Math.exp(-((x + 2) ** 2 + z ** 2) * 3) - fields.chill) * 3 }
  })
});
const relief = frame.source('relief');
const flecks = frame.events;
```

## Author a phase recipe

- Supply `width`, `height`, `cell`, `origin`, and an optional
  `mask(x,z,index)` using the cell-centered motion grid. Spacing can
  be a scalar or an XZ pair. `initial(x,z,index)` optionally sets
  per-cell values.
- Each of up to twelve named `channels` has an `initial` value
  (default zero), a `capacity` (default one), and `diffusion`
  (default zero). Diffusion shares amounts across open cardinal faces
  and automatically subdivides when needed for numerical stability.
- Each rule names an `id`, a `rate`, and one or both of `consume`
  and `produce`. The maps hold positive coefficients per unit of
  conversion. A rule can represent a loss such as venting or a gain
  such as deposition. Rate is conversion per scene second and can be
  constant or a function of
  `{ cell, at, time, fields, nearby, inputs }`. `nearby` holds the
  cardinal-neighbor mean for each channel.
- `step(count, { drive })` advances whole ticks of length `dt`.
  For each tick, cells diffuse, then all rates read that shared state.
  The optional `drive` receives the cell context and returns
  `{ inputs, sources }`. Supply signed scalar input values for recipes
  to read and signed source rates to add to channels. Sources apply
  first, then rules claim available reactants and remaining product
  capacity in authored order.
- `emitEvery` generates one event per fixed amount of completed
  conversion. Fractional amounts carry across ticks. Events include
  `id`, `rule`, `cell`, `at`, `time`, and `amount`. The time marks
  the tick when conversion crossed the threshold. Apply a seeded
  lifetime or velocity when drawing them as splats.

## Finish and replay

An optional `finish` function derives normalized RGB `color`,
`roughness` from zero to one, and signed `relief` in scene units.
It reads the completed tick's cell state with the same fields and
neighbor means used by the solver. Keep it deterministic so retained
frames produce the same finish whenever sampled.

Use `frame.data(name)` for a copy of the row-major buffers. Color uses
three numbers per cell. `frame.sample(name,x,z)` interpolates inside
open cells. `frame.source(name,{ bounds,project,units })` adapts a
channel to `KIT.fieldViews`, with an optional projection from XYZ
world coordinates to the chart. Scalar channels can drive contour
plots, material masks, or a displaced mesh.

`step` frames contain the events for that step call. `frame()` reads
current values without replaying emissions. `checkpoint()`,
`restore(token)`, and `reset()` retain fields, emission remainders,
and the next event ID. Repeat the same timed drivers on replay. Steps
that exceed the work or event budget roll back the whole batch.

Use `solve(fields, { time, drive })` when another runtime owns the grid.
Supply one row-major buffer per state channel. The method runs one
reaction tick and returns the resulting buffers. It leaves the retained
clock, fields, and emission counters available for the ordinary `step`
and checkpoint methods.

## Freeze liquid into rigid pieces

Add `phase` to a [material-cells system](material-conversion.md). The
phase field occupies the same XZ lattice. Each open column holds liquid,
ice forming in place, and sensible heat. A full parcel of ice occupies
one rigid cell at the chosen Y layer. Then you can lift the patch as a
compound and let it collide or fracture through the ordinary solver.

```js
const configuration = {
  size: [16, 5, 3], cell: .5,
  materials: { ice: { density: 1000, specificHeat: 4.18 } },
  phase: {
    material: 'ice',
    layer: 1,
    waterline: .46,
    latentHeat: 334,
    meltingPoint: 0,
    current: [.12, 0],
    leveling: .2,
    initial: [
      { at: [2, 1], liquid: 1.8, temperature: 2 },
      { at: [3, 1], liquid: 1.8, temperature: 2 },
      { at: [4, 1], liquid: 1.8, temperature: 2 }
    ],
    climate: [
      { min: [1, .5], max: [2.5, 1], temperature: -32, rate: 4 },
      { min: [3, 0], max: [8, 1.5], temperature: 32, rate: 2.5 }
    ]
  }
};
```

Initial `at` addresses are zero-based `[column, row]` in XZ. Liquid and
optional `ice` are measured in parcel equivalents. A parcel has mass
`density × cell³`. Liquid can hold up to `liquidCapacity` equivalents
per column, with a default of 3. The field can accumulate up to one
equivalent of ice per column. Use `closed` for blocked column addresses.
Leveling shares liquid over open cardinal faces and `current` adds an
XZ drift in scene units per second. Liquid transports its share of the
heat as it moves.

Use the same energy unit for the material's `specificHeat` and the
phase's `latentHeat`. With the settings above, energy is in kJ.
`climate` supplies world-space XZ rectangles, target temperatures in
Celsius, and exchange rates per second. The last rectangle containing
the sample wins. The field samples climate at column centers and moving
parcels sample it at their current, rotated positions. Freezing releases
latent heat. Melting requires the same amount back, and the temperature
holds at the melting point while a rigid parcel absorbs it.

Use `material-freeze` events to identify which cells are ready to lift.
For an authored breakaway, pass the frozen cells to the ordinary
`spill/lift` command with a launch velocity. Use the optional bond
settings when the detached piece should fracture on a later impact. An
existing body can melt one parcel at a time. The remaining cells keep
their positions and motion. If the loss cuts a compound into separate
components, `material-melt-split` reports the new bodies.

Each `material-melt` event names the original parcel, its last world
position, and the receiving lattice cell. If the local column is full,
the solver searches nearby open columns up to `depositSpread` cells
away, with a default of 2. Heat and mass stay with the piece until a
column can receive the parcel. Wet trails can follow the retained field
or use melt events for fresh glints.

Probe `spill/phases` for per-column liquid and ice mass, temperature,
and energy. The `balance` probe includes liquid, field ice, rigid parcels,
latent energy, and net `phaseEnergy` exchanged by the climate. Total
energy equals parcel energy plus field sensible and liquid latent energy.
The balance error accounts for initial energy, explicit heat commands,
ambient exchange, and phase climate exchange. The field and the rigid
pieces share the world checkpoint and replay.

[Winter Spillway](../examples/spillway-phase.cjs) stages a release once
the lip has frozen, then lets the current carry the meltwater away. The
demo uses a neutral-gravity rigid glide and draws the ice and trail from
the recorded simulation.

```sh
node examples/spillway-phase.cjs ./winter-spillway
```

Open `winter-spillway.html` to scrub the run and inspect the ledger.
The generator also exports the world manifest and its replayable run.

## Render the studies

[Frost Circuit and Evaporation Plate](../examples/phase-change-studies.js)
use phase color in a native texture, roughness to shade the finish,
relief to displace actual mesh vertices, and conversion events to
emit short-lived splats. The dish starts with more dissolved pigment
at the wet perimeter, where drying first leaves a raised deposit.

```sh
node cli/ink-studio.js clip examples/phase-change-studies.js --w 900 --h 560 --px 2 --to 6.4 --fps 10 --out frost-circuit.png
node cli/ink-studio.js clip examples/phase-change-studies.js --params '{"study":"drying"}' --w 900 --h 560 --px 2 --to 6.4 --fps 10 --out evaporation-plate.png
```
