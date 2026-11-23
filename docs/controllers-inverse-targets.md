# Controllers and inverse targets

Use a controller to update an output as a target changes. Use an inverse
fit to find bounded input values that produce desired measurements.
Both are dependency-free library and CLI primitives. Worlds and graph
projects use the same implementations.

## Author a controller

```json
{
  "format": "ink-studio/controller",
  "version": 1,
  "id": "flow-servo",
  "revision": 1,
  "mode": "pid",
  "initial": 0.3,
  "quantities": {
    "target": {"unit": "m^3/s", "kind": "volume-flow"},
    "output": {"unit": "1", "kind": "opening-fraction"}
  },
  "limits": {"min": 0, "max": 1, "rise": 1.8, "fall": 2.4},
  "settings": {
    "kp": 0.5,
    "ki": 3.5,
    "kd": 0.009,
    "derivativeTime": 0.04,
    "integralMin": 0,
    "integralMax": 1
  }
}
```

The target and measurement use the target quantity. The drive and
optional feed-forward use the output quantity. `type` defaults to
`number`. Use `vec3` with `follow` or `pid` for three axes in the declared
coordinate frame. Limits and gains can be shared scalars or three
values, with independent limiting per axis.

| Mode | Inputs and behavior |
| --- | --- |
| `follow` | Drives the output toward `target`. `timeConstant` in seconds smooths the response. Zero selects immediate following subject to the output limits. |
| `hysteresis` | Uses scalar `target - measurement`. The relay turns on at or above `high` and off at or below `low`. It holds its prior state between them. Set `on`, `off`, and optional initial `active`. The relay state changes at the threshold, and the output honors the same slew and range limits as other controllers. |
| `pid` | Uses `target`, `measurement`, and optional `feedForward`. Output combines `bias`, feed-forward, `kp` times error, integral contribution, and a filtered negative measurement derivative. Set `derivativeTime` in seconds. The first measurement initializes derivative history. |

`min` and `max` bound output travel. `rise` and `fall` limit output
change in output units per second. The PID limits integration at the
reachable output, including both rate and range limits. This leaves
room for an integral-only controller to move at its allowed rate.
The optional integral bounds constrain the integral's contribution in
output units and include zero.

A controller report exposes the raw command, applied value, measured
error, PID contributions, relay state, and limit flags. The checkpoint
pins the controller definition and retains the previous measurement,
derivative, integral, actuator output, and relay latch.

```js
const {KIT} = require('@shapeshift-labs/ink-studio').load();
const prepared = KIT.world.controllers.prepare(asset);
const session = prepared.open();
const report = session.step(1 / 60, {target: 0.4, measurement: 0.29});
const resumed = prepared.open(JSON.parse(JSON.stringify(session.snapshot())));
```

A native world system uses `kind: "feedback-controller"`,
`operatorRevision: 1`, and `config: {controller: asset}`. Pin
`revision: 1` in a simulation model. Connect the output `value` to an
actuator and wire its measured signal back to `measurement`. Use
`probe --field <system>/detail` to inspect the last committed step.
Use [gesture scores](gesture-scores.md) or [compiled inputs](input-compilers.md)
to schedule values for those ports.

`sim controller` reads an `ink-studio/controller-run` version 1 plan.
Set `controller` to an inline asset or relative JSON path, provide
`samples` with named input values, and set a common `dt` or a `dt`
for each sample. An optional `checkpoint` resumes that run.
The `sim.controller` graph operation accepts the same sample list
with an inline controller, a checkpoint, and `options.dt`.

## Fit bounded inputs

Use [reference parameter fitting](parameter-fitting.md) when a fit needs recorded curves, measured WAVs, or saved per-candidate errors.

An `ink-studio/inverse-target-plan` maps finite parameter bounds to named
observations. A target can be a number or a numeric vector, with a
positive absolute `tolerance` for each component. Set optional
`quantity` for physical port validation and `weight` for objective
weighting. The report includes measured values, signed residuals, the
largest tolerance ratio, and parameters that stopped at an exact bound.

```json
{
  "format": "ink-studio/inverse-target-plan",
  "version": 1,
  "id": "calibrate-flow",
  "parameters": {
    "opening": {"min": 0.06, "max": 0.9, "initial": 0.22}
  },
  "targets": {
    "flow": {"value": 0.43, "tolerance": 0.000005}
  },
  "evaluator": {
    "kind": "world",
    "world": "calibration.world.json",
    "inputs": {"opening": "pipe/valve.gate"},
    "outputs": {"flow": {"port": "pipe/flow.gate", "tick": 60}}
  }
}
```

The world evaluator resets the same initial world for every candidate,
sets unconnected scalar inputs at tick 1, and measures named scalar or
XYZ outputs at the declared ticks. Inline worlds and relative world
or model files are supported by the CLI. The report includes ordinary
`world/input` commands that replay the selected candidate. The
`sim.fit-targets` graph operation takes an inline world evaluator.

For other plants, use `KIT.world.inverseTargets.fit(plan, evaluate)`.
The callback receives immutable named parameter values and returns
named measurements, or `null` for an infeasible trial. Keep evaluations
deterministic and start each one from the same state. In a CLI plan,
`evaluator: {kind: "module", file: "evaluator.cjs", config: {...}}`
can load a trusted local factory `(kit, config) => evaluate`.

The fitter searches on normalized parameter bounds, with damped
least-squares steps and coordinate probes. It compares residuals in
units of each target's tolerance. Use `starts` to supply alternative
seed candidates for nonlinear problems. Use `settings.maxEvaluations`
to cap work, `parameterTolerance` to set the normalized search
resolution, and `history: true` to retain trial summaries.
`history: "errors"` adds per-objective RMS, bias, and worst residual.
Use `goal: "minimize"` to continue searching for lower weighted error
after the tolerances have been met.
`tolerance-met` requires all target components to meet their tolerances.
`resolution`, `evaluation-limit`, and `no-feasible-sample` describe how
an unmet fit stopped. The result describes the measured search, so a
nonlinear plant can have other solutions.

```sh
ink-studio sim controller servo.run.json --out servo.trace.json
ink-studio sim fit-targets flow.fit.json --out flow.report.json --require-tolerance
ink-studio probe calibration.world.json --ticks 60 --actions fitted-flow.commands.json \
  --field pipe/pipes --args '{"pipe":"gate"}'
```

`--require-tolerance` writes the report before returning a failing
exit status for an unmet fit.

## Demos

```sh
node examples/controller-tools/demo.cjs studio/out/controller-tools
```

The flow demo compares a fixed valve with a PID-controlled valve after
a pressure load, then shows saturation and recovery. The inverse demos
replay a fitted valve opening in a native pipe, fit a two-joint arm and
force target, and audition a modeled string before and after tuning.
