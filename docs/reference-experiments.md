# Reference experiments

Ink ships seven editable physics experiments. Each runs a native solver and compares the output with a known physical or numerical solution. The report records each measured value, its expected value, unit, absolute tolerance, and pass status.

```sh
ink-studio sim reference --out report.json
ink-studio sim reference closed-tube
ink-studio sim reference --suite ./recipes/suite.json --out report.json
```

The command returns exit code 2 for a failed comparison after writing its report. A valid suite with all checks passing returns 0. Copy the [recipes directory](../examples/reference-experiments/recipes) as a unit. Each source path resolves relative to the JSON file that owns it. The recipes are ordinary wave, network, mesh, transport, and world assets. The version 1 suite supplies the reference dimensions and capture schedules where the solver assets alone do not describe them.

| Experiment | Setup and reference checks |
| --- | --- |
| `open-tube` | A short pressure pulse travels through a 1.372 m air column with two pressure-release ends at rest. Sound at 343 m/s gives a 125 Hz fundamental. The outgoing opening flips the pressure reflection and holds pressure at zero. |
| `closed-tube` | The same tube has a pressure-release inlet at rest and a sealed outlet. The pressure reflection keeps its sign, outlet flow stays zero, and the fundamental is 62.5 Hz. Both tube experiments check arrival time at the same pickup. |
| `damped-oscillator` | Release a mass on a spring and damper from rest. Compare position and velocity with the underdamped closed-form solution and compare energy lost with energy dissipated by the damper. |
| `membrane` | Bake modes from a triangulated 0.90 × 0.70 m rectangle and strike its centre. The fixed-edge solution predicts about 271.47 Hz. The mesh and rendered pickup resolve about 270.48 Hz, and the edge stays still. |
| `tank-drain` | Drain water through a linear outlet driven by water height. Compare remaining volume to both the continuous exponential and the discrete substep solution. Check that discharge accounts for the water lost and that flow stays outward. |
| `heat-slab` | Start with a cosine temperature profile and insulate every edge. Compare finite-volume diffusion against the discrete cosine decay and the continuum solution. Convert the area-weighted temperature change to joules using the authored areal heat capacity. |
| `two-body-impact` | Two free bodies close along X with zero restitution. Check sub-tick contact time, common post-impact speed, impulse, momentum, kinetic energy loss, and force averaged over the world step. |

The Node entry returns the same JSON report and native captures for plotting, analysis, or audio.

```js
const ink = require('@shapeshift-labs/ink-studio');
const { report, captures } = ink.runReferenceExperiments({ id: 'open-tube' });
const pressure = captures['open-tube'].trace.pressure.inside;
```

Supply `suite` to run a copied suite or omit `id` to run them all. The reference formulas assume the setups in the table. For example, adding a flow cap to the tank can leave water balance intact while failing the uncapped drain comparisons.

## Rebuild the demos

```sh
node examples/reference-experiments/demo.cjs ./studio/out/reference-experiments
```

The demo writes animated and still PNGs, the check report, and WAV auditions in open tube, sealed tube, membrane, and impact order. The tubes use the pressure traces, the membrane uses its centre pickup, and the impact uses an authored 8 ms excitation driven by the measured impulse. The force reported for the contact is the world-step average. Pressure travel and membrane motion are slowed in the animation for inspection.
