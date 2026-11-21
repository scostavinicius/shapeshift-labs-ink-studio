# Shared ecology and renderer bindings

`K.ecology` is a renderer-independent simulation of named material channels on
world-space XZ patches. Fire is an adapter around the existing `K.play.eco`
solver. Diffusion, recovery, wear, growth, or an application-defined process
use the same process contract. Rendering never advances the simulation.

The [remembering garden](../examples/ecology.html) combines textured ground,
splat foliage, material firebreaks, local lighting, water contacts and a custom
regrowth process. Its [scene source](../examples/ecology.js) shares one habitat
sampler between terrain authoring and simulation. Build the browser bundle
with `require('fs').writeFileSync('dist/ink-studio.browser.js', require('.').bundle())`
and serve the repository over HTTP to open the example.

```js
const E = K.ecology;
const sim = E.create({
  width: 64, height: 48, cellSize: 0.5, origin: [-16, -12],
  heightAt: terrain.height,
  materials: {
    meadow: { fuel: 0.65 },
    wood: { fuel: 1 },
    stone: { fuel: 0 },
    water: { fuel: 0, moisture: 1 }
  },
  materialAt: (x, z) => habitat.materialAt(x, z),
  environment: { rain: 0, wx: 0.4, wz: 0.1 },
  processes: [
    E.processes.fire({ seed: 31 }),
    E.processes.diffusion({ id: 'soil-water', field: 'moisture', rate: 0.3 }),
    recoveryProcess
  ]
});
const stage = K.stage(world);
stage.add(sim);
stage.add(E.bind(stage, sim, {
  style: [{ field: 'char', color: [0.04, 0.055, 0.05] }],
  splats: [{ selector: { material: 'bark' } }, {
    ids: leafIds,
    style: [{ field: 'char', color: [0.04, 0.055, 0.05], opacity: 0.08 }]
  }],
  textures: [{ atlas: world.spriteSurfaces }],
  lights: { field: 'heat', max: 6, radius: 3 }
}));
sim.contact({ type: 'ignite', p: [2, 0, 3], radius: 0.7 });
sim.contact({ type: 'water', p: [2, 0, 3], radius: 2,
  values: { moisture: 1, heat: 0 } });
```

## Material state, independent of rendering detail

Choose the domain patch size as a simulation scale. A patch stores a material
name, authored ground height, and finite scalar channels. Domain bounds are
half-open. Positions use XYZ; patch lookup uses XZ. The domain has one authored
height per patch. Use separate domains for vertically stacked habitats.

`materials` supplies initial channel values, while `materialAt(x, z)` selects
those values from authored habitat geometry. Reuse the same roads, water,
plant footprints and ground masks used to build the scene. This makes fuel
explicit; the simulation does not infer it from green pixels or splat counts.
Changing the renderer, splat detail budget, or atlas resolution leaves the
simulation unchanged.

A channel schema is `{ min: 0, max: 1, default: 0 }` unless specified otherwise.
Declare additional channels in `channels` or on a process. Multiple processes
can share a channel if their schemas agree. Material values must fit its schema.
Numeric channels can have other ranges, such as temperature or nutrient stores.

Read state with `sample(worldPoint)`, `read(channel, cell)` or
`initial(channel, cell)`. A sample outside the domain is `null`.
`point(cell)` gives its authored world center. `cellsInDisc(point, radius)`
returns overlapping patch centers using a conservative patch-size margin.
`processes` lists process IDs in evaluation order; `stats` reports time, tick,
version and queue sizes. `changes(version)` returns patches changed since an
observer's version, without consuming another observer's updates.

## Extending the simulation

Stateless processes declare an ID, optional channels, and a `step` or `contact`
function. No fire-specific interface is required:

```js
const recoveryProcess = {
  id: 'new-growth',
  channels: { growth: {} },
  step(ctx, dt) {
    for (let i = 0; i < ctx.count; i++) {
      if (ctx.initial('fuel', i) <= 0 || ctx.read('burning', i) > 0.1) continue;
      if (ctx.read('moisture', i) < 0.4) continue;
      ctx.add('growth', i, dt * 0.06);
      ctx.add('char', i, -dt * 0.05);
      ctx.set('fuel', i, Math.min(ctx.initial('fuel', i),
        ctx.read('fuel', i) + dt * 0.025));
    }
  }
};
```

This recipe uses fire's channels, but a standalone process can instead declare
only `water`, `moss`, `wear`, `spores`, or other material-specific channels.
A contact-only process is also supported.

The context provides:

- `read`, `initial`, `set` and `add`. Reads are frozen for one process call;
  writes become visible to the next process. `add` clamps to the channel range.
  An out-of-range `set` rejects the tick.
- `transfer(channel, from, to, amount)`. Moves at most the available quantity
  and target capacity, using pending transfers to prevent overdraw. Equal-area
  cells conserve this quantity to floating-point precision.
- `eachEdge(callback)`, `point`, `cell` and `cellsInDisc`. Edge traversal visits
  each horizontal or vertical neighbour pair once. Built-in diffusion uses a
  bounded exchange fraction rather than an unstable unrestricted step.
- `environment`, `dt`, `time`, `tick` and a seeded `random()` stream.
- `emit(kind, data)`. Queues application events after a successful tick. Source,
  kind and tick metadata cannot be overwritten by payload fields.

Process order is explicit in the supplied array. For private persistent state,
provide `create(domain)`, returning `step`, optional `contact`, plus `save`,
`restore` and `reset`. `save()` must return an independent checkpoint;
`restore()` should validate it. A public snapshot must be serializable.
The domain passed to `create` provides initial and committed-state reads;
use the step context for in-progress process reads.

A failed callback rolls back field writes, process checkpoints and random
streams for that tick. Its contacts remain pending. The accumulator retains
one bounded failed tick so `update(0)` can retry after the fault is fixed.
Already completed ticks remain committed. Keep external side effects out of
callbacks; consume committed events instead.

## Fire and other environmental inputs

`E.processes.fire({ id: 'fire', seed })` adapts the existing spread simulation
with these shared channels:

| Channel | Meaning |
| --- | --- |
| `fuel` | Remaining combustible material, initialized by the habitat. |
| `heat` | Normalized heat, including cooling after flames end. |
| `burning` | Active combustion, separate from residual warmth. |
| `char` | Persistent visible damage, normalized by material fuel capacity. |
| `moisture` | Shared wetness that inhibits ignition and spread. |

Consumption cannot exceed remaining fuel. Stone and water patches with zero
fuel cannot ignite. Saturated material resists combustion. Fire contributes
heat and damage; a separate recovery process decides when new fuel and cover
return. Existing solver recovery does not silently erase the shared scar.
Adding new fuel permits another combustion cycle. Deposits can also introduce
combustible material to an initially bare patch without changing neighbouring
materials. The adapter checkpoints this local fuel capacity alongside its solver.

Fire reads finite `rain`, `winter`, `wx` and `wz` environment values. Rain and
winter are clamped to [0,1]. The directional wind biases `wx` and `wz` are
clamped to [-1,1]; wind cannot create negative heat. Other processes
can use their own environment fields. `setEnvironment(patch)` updates these
inputs independently of presentation.

The legacy `K.play.eco()` API remains available with its original grid defaults.
It also accepts optional grid dimensions, origin, patch size and a random
function. `capture`, `restore`, `sampleCell` and checked `setCell` support the
adapter without replacing existing scene integrations. A standalone legacy
random function remains caller-owned; the shared adapter checkpoints its own
isolated random stream.

## Contacts and simulation events

`contact({ type, p, radius: 0, values?, id?, time? })` schedules an application
interaction for a tick. `values` sets named channels in its footprint; process
contact handlers can interpret any `type`. IDs deduplicate repeated delivery
within a bounded 4,096-ID history. Future contacts apply at tick boundaries, ordered by their timestamps; equal
timestamps preserve submission order.

`E.contacts(sim, { read, map, max: 1024 })` creates a stage system that maps
another simulation's event batch into these inputs. Register it before the
shared simulation when same-frame delivery matters. The application decides
which contacts are hot, wet, damaging or biological:

```js
stage.add(E.contacts(sim, {
  read: () => destruction.drainEvents(),
  map: event => event.kind === 'piece-hit' && hotGroups.has(event.group)
    ? { type: 'ignite', p: event.p, radius: 0.5 }
    : null
}));
```

Cold impacts need not ignite anything. Material contact events can instead
wet a surface, stamp wear or spread an inoculum. The mapper can use their
`point`, material, temperature, speed and stable event ID. A drain source is
consumed by this binding; use an application event router for multiple listeners.

`drainEvents()` returns committed contacts and process events, including fire's
`fuel-exhausted` events. Use them for sound, plant collapse or other systems.
No callback is invoked by a renderer.

## Rendering one state on different surfaces

`E.bind(stage, sim, options)` is a stage painter and texture updater. Add it
once, after the simulation. Splat bindings select stable IDs or shared named
selectors. Each binding may override the default style. A style is a list of
`{ field, range: [0,1], weight: 1, color?, opacity: 1 }` rules. They blend color
and multiply opacity in order. An opaque ground can retain its coverage while
leaves use the same damage value to disappear.

Texture bindings accept the standard `{ width, height, pixels, vertices }`
atlas. UV triangles determine the world location of each texel, including
curved heightfields and sweeps. A custom `point(u, v, x, y)` mapper can replace
this correspondence; returning `null` leaves a texel unbound. Reused UV tiles
with different world positions are rejected so damage cannot jump between
unrelated objects. Give those surfaces independent atlas tiles.

Both paths use one color/opacity function, `E.appearance`, and the same patch
samples. Styles are cached per patch. Lighting operates on actual world
positions. The binding tracks changed cells and local light footprints, while
textures retain the original authored pixel detail. Transparent cutouts keep
their alpha. No geometry is rebaked.

`lights: true` or a settings record adds local illumination to the selected
splat and texture contributions. `E.lights(sim, settings)` and `binding.lights`
expose bounded `{ id, p, radius, intensity, color }` records for host effects
or volumetric lighting. Set `field` to any suitable scalar channel, such as
heat or bioluminescence. Default selection is at most eight sources. Flames,
smoke and other visuals remain optional host effects.

`SpriteSurface.markDirty(atlas, rectangle?)` increments its revision and retains
32 update rectangles. GPU consumers query `updatesSince` independently. Missing
history falls back to a full texture upload. Updated texels use sub-image
uploads; unchanged geometry stays resident. Replace the vertex array when
changing geometry itself. Manually incremented revisions remain supported,
with a safe full-texture fallback.

Static bindings cache patch ownership. Set `dynamic: true` on moving splat
bindings. Their current positions are sampled each frame. Bind after asset
painting is complete; recreate a texture binding after reauthoring its base
pixels or UV correspondence. Two ecology bindings cannot independently own
the same splat appearance or atlas. Other stage painters still compose normally.
`dispose()` removes only this binding and restores its texture base; splat
appearance is recomputed through the remaining painters.

## Stepping, snapshots and budgets

The default simulation step is 0.1 seconds. `update(dt)` accepts 0–0.25 seconds
and retains fractional time. Render rates do not change the fixed-step result.
When using a stage, subdivide accelerated playback into at most 0.05-second
calls because the stage clamps its own frame delta.

`snapshot()` returns serializable fields, private process states, environment,
random state, time and pending events/contacts. `restore()` checks habitat and
channel compatibility before committing state. `reset()` restores initial
material fields, processes and environment. It also clears pending inputs and
events. All existing observers receive a new revision after reset or restore.
Renderer state is derived again from that shared snapshot.

Budgets are 65,536 patches, 24 channels, 32 processes and 256 material types.
Defaults allow 256 pending contacts and 1,024 output events; override with
`maxContacts` and `maxEvents`. The event queue retains the newest records.
Texture binding defaults to 262,144 texels and four million triangle visits.
Snapshots also have a four-million-value serialization budget.
These are allocation/work limits, not performance guarantees for every domain
size or authored process. Keep simulation patch scale independent of render LOD.
