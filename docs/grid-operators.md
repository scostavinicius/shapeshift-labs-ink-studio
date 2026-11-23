# Grid and mesh operators

Use `KIT.world.gridOperators.prepare(domain)` with a
[compiled discretization](discretization.md), or use
`ink-studio sim grid-ops <plan.json>`. The same finite-volume operators
work on regular, sparse, and cut grids, carrier charts, triangle surfaces,
and tetrahedral volumes. A 2D cell's measure is area and its face measure
is edge length. In 3D these are volume and face area. A [boundary set](boundary-conditions.md)
can supply time-varying region values, fluxes, and cell disturbances.

Scalar fields contain one number per cell or face, in compiled order.
World-space vector fields are flat XYZ values. Library operators return
new `Float64Array` fields, and CLI reports store regular JSON arrays.
Every integrated face flux is positive out of its owner and negative
into its neighbor. The two cells share that one number.

[Simulation diagnostics](simulation-diagnostics.md) can find the cell
limiting a transport step and audit local balance against a recorded field.

## Operators

| Library method | Input and output |
| --- | --- |
| `gradient(values, options)` | Cell scalars to packed cell XYZ gradients by weighted least-squares reconstruction. Surface neighbors unfold onto the current cell across a shared edge. |
| `faceGradient(values, options)` | Cell scalars to one owner-outward derivative per face using the projected cell-to-face distances. |
| `interpolate(values, options)` | Cell scalars to face values. Use `scheme: 'linear'` for distance weights or `scheme: 'reconstructed'` to extrapolate both cells to the face before blending. |
| `sample(values, sites, options)` | Reconstruct at caller-supplied `{cell, point: [x,y,z]}` sites. Use the compiled cell index. The caller supplies containment. |
| `flux(velocity, options)` | Project velocity onto oriented faces and multiply by face area. Supply one normal speed per face (default), or choose `location: 'constant'`, `'cells'`, or `'faces'` for XYZ velocities. A sampled face velocity uses its owner normal. Shared cell velocities use both cells' outward normals. |
| `divergence(faceFlux)` | Sum signed, integrated flux around each cell and divide by its measure. |
| `diffusion(values, options)` | Compute outward diffusive flux, cell rate, stable step, and boundary flux. Set `diffusivity` to a nonnegative constant (default 1) or one value per cell. |
| `advection(values, options)` | Compute first-order upwind advective flux, cell rate, stable step, and boundary flux from an integrated `carrierFlux` field, typically from `flux`. |
| `transport(values, options)` | Advance one explicit Euler step with `dt`, optional `carrierFlux`, and `diffusivity` (default 0). Returns the new values and a material balance ledger. |
| `applyBoundaries(values, options)` | Inspect each exposed face's selected condition, face value, signed normal derivative, diffusive flux density, and advective inflow value. |

The cell-rate convention is minus the divergence of the returned flux.
Boundary flux entries report `{in,out,net}`, with nonnegative gross
amounts and `net = out - in`. Entries are rates for the standalone
operators. For a transport step they are amounts integrated over `dt`.
The step reports `ledger.before`, `ledger.after`, `ledger.boundary`,
`ledger.netOut` and the signed residual `after - before + netOut`.
Rates and totals use the units of the supplied state and authored
geometry.

Diffusion uses a two-point conductance. It adds the two half-cell
resistances using each cell's diffusivity. This gives a conservative
baseline on skewed meshes. Strongly nonorthogonal faces can limit the
accuracy of this stencil even when the reconstructed gradient is accurate.
Advection uses the upstream cell value, so sharp fronts spread numerically
at coarse resolution. Interpolation can reconstruct an affine field on
skewed cells with appropriate boundary data, and its extrapolation can
form extrema.

`stableDt` uses each cell's measure divided by its total depletion
coefficient. Transport computes the **combined** diffusion and advection
bound. A null limit means there is no such depletion term. A larger
explicit step fails before changing values. Authored fluxes and other
boundary source terms can still remove more material than the model
stores, so a model that requires nonnegative quantities must set a
compatible boundary flux and step.

## Apply boundary conditions

Pass `boundary` as a table keyed by compiled region tag. Unspecified
regions are closed. Unknown tags fail validation.

| Condition | Diffusion and reconstruction | Advection |
| --- | --- | --- |
| `{kind:'closed'}` | Zero normal derivative | Impermeable |
| `{kind:'open'}` | Zero diffusive flux; cell reconstruction can extrapolate using interior data | Outflow uses the owner. Inflow requires `inflow`. |
| `{kind:'value', value:1}` | Fixed face value | Used for inflow unless `inflow` overrides it |
| `{kind:'gradient', value:0.4}` | Prescribed outward derivative | Inflow requires `inflow` |
| `{kind:'flux', value:0.2}` | Prescribed outward diffusive flux **density**, multiplied by face area | Inflow requires `inflow` |

Boundary reconstruction takes the local normal extension of the cell at
gradient and prescribed flux faces. A nonzero prescribed diffusive flux
at zero local diffusivity supplies an external flux but has no implied
gradient or face value. Boundary inspection reports null for those
values. The direct face derivative and interpolation operators require
a definable value.

## Run a plan

The CLI accepts an inline or relative compiled domain or discretization
plan. The top-level `boundary` table uses the same semantics. Put method
options in `settings`, with `sites` for `sample`. The supported operation
names are `boundaries`, `gradient`, `face-gradient`, `interpolate`, `sample`,
`flux`, `divergence`, `diffusion`, `advection`, and `transport`.
For `flux` and `divergence`, the top-level `values` are velocity and
integrated face flux respectively. For advection or transport, supply
`settings.carrierFlux` or `settings.velocity` and its `location`.

```json
{
  "format": "ink-studio/grid-operators-plan",
  "version": 1,
  "domain": "channel.compiled.json",
  "operation": "transport",
  "values": [1, 0],
  "boundary": {
    "inlet": {"kind": "value", "value": 1},
    "outlet": {"kind": "open"}
  },
  "settings": {
    "velocity": [0.5, 0, 0],
    "location": "constant",
    "diffusivity": 0.025,
    "dt": 0.1
  }
}
```

## Reproduce the demo

```sh
node examples/simulation-grid-operators/demo.cjs /tmp/ink-grid-operators
node cli/ink-studio.js sim grid-ops /tmp/ink-grid-operators/channel-grid.transport.plan.json
node cli/ink-studio.js sim grid-ops /tmp/ink-grid-operators/channel-mesh.transport.plan.json
```

One finite dye pulse enters an open channel on a regular grid and a
skewed triangle mesh. The demo writes a comparison board, an animation,
both compiled domains, replayable operator plans, and a material balance
for the complete run.
