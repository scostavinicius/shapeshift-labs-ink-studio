# Resonant modes as assets

Use `KIT.world.resonantModes` to bake and play versioned resonator assets.
An asset stores each mode's frequency and amplitude decay, named excitation
and pickup positions, and its shape representation. Moving a strike or
pickup changes the weighted modal response. The same asset can serve
several simultaneous excitation and pickup sites.

## Bake a resonator

A version 1 `ink-studio/resonant-mode-plan` has an `id`, optional positive
`revision` (default 1), a `source`, and named `excitations` and `pickups`.
Positioned sites use world XYZ coordinates in the authored geometry.

| Source kind | Source settings and site behavior |
| --- | --- |
| `authored` | Supply `modes: [{id,hz,decay}]` and per-site `{point,gains}` with one signed gain per mode. The gains are editable. |
| `string` | Pinned string with `length`, `speed`, optional `origin` and `axis`. Sites use `{point}` and derive their gains from sine mode shapes. |
| `rectangle` | Pinned rectangular membrane with `size: [width,height]`, `speed`, optional `origin` and orthogonal `axes`. Sites derive gains from the product of the two axis modes. |
| `mesh` | Inline simplex `mesh` or a compiled triangle or tetrahedral `domain`. Supply `speed`. Sites use barycentric interpolation of the stored vertex shapes. |

Analytic and mesh sources accept `count` (default 12, maximum 64),
`density` (default 1), `decay` (default 4), and `decayPerHz` (default
0). The amplitude envelope is `exp(-decay × seconds)`. Density and shape
measures set mass normalization. Mode frequencies use the supplied wave
speed and geometry. Set density, wave speed, and positions in a consistent
unit system. The mesh uses specified exponential losses alongside the
computed mode frequencies.

```json
{
  "format":"ink-studio/resonant-mode-plan",
  "version":1,
  "id":"string-bench",
  "source":{"kind":"string","length":1,"speed":420,"count":8,"decay":6},
  "excitations":{"strike":{"point":[0.21,0,0]}},
  "pickups":{"center":{"point":[0.5,0,0]},"offCenter":{"point":[0.2,0,0]}}
}
```

`bake(plan)` returns an immutable, JSON-ready `ink-studio/resonant-modes`
asset. Analytic and mesh positions are resolved on the geometry. For an
analytic or mesh asset, `shape(asset, point)` returns the mode gains at
that position. With authored assets, enter gains explicitly at each site.

## Mesh verification

Use [Ink's compiled mesh discretization](discretization.md) to retain tags
and pinned regions, or supply an inline triangular or tetrahedral mesh.
A triangle mesh models a scalar membrane. Tetrahedra model a scalar wave
field inside a volume. The operator assembles linear simplex stiffness and
lumped mass, then solves the symmetric mass-normalized eigenproblem with a
bounded Jacobi eigensolver.

`fixed` defaults to `"boundary"` for a pinned exterior. Supply an array
of boundary tags to pin those regions, or an empty array for a free
exterior. Optional `fixedVertices` adds individual pins. Zero-frequency
modes, including the constant mode of a free cavity, are skipped.

The baker checks each retained eigenpair on the original normalized
operator and checks mass orthonormality. It records per-mode relative
residuals, the maximum residual, maximum orthonormality error, work,
and pinned and free vertex counts. It fails if the configured limits
are exceeded. Optional controls are `maxSweeps` (default 32), eigensolve
`tolerance` (default 2e-14 after normalization), `residualTolerance`
(default 1e-7), and `maxWork` (default 240,000,000 estimated eigensolver
work units). The solver supports up to 384 free vertices and 4,096
simplices. Residuals measure agreement with the discrete equation.
Compare several resolutions or an analytic reference to measure
geometry discretization error.

## Excite and audition

`prepare(asset, settings)` binds site gains and returns a checkpointable
sample-rate resonator. The settings accept `sampleRate` (default 48,000
Hz), `maxWork`, and optional named `excitations` or `pickups` to overlay
or add at playback. Bindings are also available from `bind(asset, settings)`.
Each mode frequency must be below half the playback sample rate.

`process(count, {forces, impulses, collect})` returns a Float64Array per
pickup. Name a receiving excitation in `forces` and supply either a
held scalar level or one force per sample. Impulses use
`{excitation, sample, fraction, value}` with an absolute sample index
and an optional fractional offset in `[0,1)`. The resonator integrates
held force and fractional impulses within each sample. Readouts are
taken at each sample's starting boundary. Use `view()` for the current
endpoint and `snapshot()` / `restore()` with the same asset, site
bindings, and sample rate. Set `collect:false` when only an endpoint is
needed.

The `modal-resonator` kernel at revision 1 works with Ink's
[sample-block models](simulation-blocks.md) and graph runner. Supply an
`asset`, selected `excitation`, selected `pickup`, and optional playback
`settings`. It takes scalar `force` and publishes pickup `position`.

Use `sim resonator bake` to build an asset and `sim resonator render` to
audition an `ink-studio/resonant-mode-run` version 1 plan. Bake plans can
load a relative compiled `source.domain` or triangle `source.file`.
Run plans take an `asset` (inline or relative JSON), `samples`,
`settings`, optional `forces`, `impulses`, and `checkpoint`. Set
`audio: {pickup,gain}` and use `--wav` for an explicitly scaled pickup
audition. The trace retains all pickup signals and the final checkpoint.

```sh
node examples/simulation-resonant-modes/demo.cjs /tmp/ink-modes
node cli/ink-studio.js sim resonator bake /tmp/ink-modes/plate-refined.bake.json --out /tmp/plate.json
node cli/ink-studio.js sim resonator render /tmp/ink-modes/pinned-string.run.json --out /tmp/take.json --wav /tmp/center.wav
```

The demo drives the same pinned string while listening at its center and
off-center pickups, using a shared listening gain. The center is a node
of the second harmonic. It also auditions an authored bank and a
mesh-derived membrane and checks the first five membrane frequencies
against the analytic pinned rectangle at two mesh resolutions.
