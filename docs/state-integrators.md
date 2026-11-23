# General state integrators

Use `KIT.world.integrators.create(options)` to advance a finite vector of
continuous state in seconds. A session runs alone or inside a
[creator-authored simulation kernel](simulation-kernels.md).
`advance(targetTime, input)` returns the reached time, state, event log,
terminal event ID (or `null`), and work counts.

| Method | Callback and state | Stepping |
| --- | --- | --- |
| `rk4` (default) | `derivative(time, state, out, input)` writes all state derivatives | Classical fixed-step fourth-order Runge–Kutta |
| `semi-implicit` | `acceleration(time, position, velocity, out, input)` writes every acceleration; state is `[...position, ...velocity]` | Kick velocities first, then drift positions with the new velocities |
| `adaptive` | Same derivative contract as RK4 | Compares one RK4 step against two half-steps, accepts the two-half-step result, and adjusts the next proposal |

For example, this model uses metres and seconds. It finds an impact and
changes velocity at that time, then advances to the requested endpoint.

```js
const {KIT} = require('@shapeshift-labs/ink-studio').load();
const ball = KIT.world.integrators.create({
  method:'rk4',
  initial:[1.55, 0],
  step:.24,
  eventStep:.08,
  derivative(_time, [y, vy], out) {
    out[0] = vy;
    out[1] = -9.81;
  },
  events:[{
    id:'floor-impact',
    direction:'falling',
    value:(_time, [y]) => y,
    react(_time, state) {
      state[0] = 0;
      state[1] *= -.73;
    }
  }]
});
const visit = ball.advance(.72);
console.log(visit.events[0].time); // about 0.562 s
```

Callbacks run synchronously. Treat derivative, acceleration and event
value arguments as read-only except for the supplied `out` buffer.
A reaction can edit its supplied state in place. The solver may evaluate
and discard a trial or replay part of it to locate an event. Keep callbacks
deterministic, avoid external side effects, and keep all advancing state
in the state vector. Callback arrays are temporary working storage.

[Simulation diagnostics](simulation-diagnostics.md) can measure named
invariants and locate adaptive error by state component.

## Step sizes and error control

`time` defaults to zero, and `step` defaults to 1/60 s. The initial state
can be an array or numerical typed array and can have up to 4,096
components. Fixed methods use `step` except where a requested output
time or event splits it. When events are present, `eventStep` further
caps the interval used to bracket a crossing.

For adaptive stepping, `step` sets the initial proposal, `maxStep` caps
proposals (default `step`), and `minStep` defaults to one millionth of
`step`. A shorter final segment may reach the requested time. Each
component's local error estimate uses the RK4 step-doubling difference
divided by 15. The solver scales it by the component's absolute tolerance
plus the relative tolerance times the larger magnitude at either endpoint.
Use a scalar `absoluteTolerance` (default 1e-8) or an array with one
positive tolerance per component. `relativeTolerance` defaults to 1e-6.
An attempt is accepted if the largest scaled error is at most one. These
are local error controls for explicit methods. Choose a step cap suitable
for the fastest relevant dynamics.

The result counts accepted and rejected steps, equation evaluations, event
evaluations, and bisection iterations. `maxSteps` (default 10,000) bounds
trial attempts per call, and `maxEvents` (default 64) bounds records per
call. On failure, the committed time, state, and next step proposal remain
available. The caller controls the outer clock and any separate state.

## Events and checkpoints

An event definition supplies a unique `id` and a scalar
`value(time, state, input)`. Choose `rising`, `falling`, or `either`
(default). A crossing begins on a strict side of zero. Starting a segment
at zero alone leaves the event untriggered. Set `eventStep` small enough
to separate crossings. The solver finds bracketed sign changes and exact
zero endpoints. Tangential touches and several crossings hidden within
one bracket can require separate event predicates or finer steps.

The solver bisects the bracket to `eventTolerance` seconds (default 1e-9)
or the representable time resolution. Events localized within that
tolerance are processed as one boundary in declaration order. Every
record has its occurrence time and the state immediately before and after
its optional reaction. Setting `terminal:true` stops that advance at the
boundary after processing the simultaneous group. A later call can
continue. To publish occurrences from a world kernel, stamp the returned
times with Ink's existing [timed events](simulation-timed-events.md).

Use `snapshot()` and `restore(snapshot)` for JSON round trips. Snapshots
preserve the state, time, method settings, event declarations, and next
adaptive proposal. Restore with the same equation and reaction code.
`reset()` restores construction settings and the initial state. Given the
same inputs and output boundaries, a restored session follows the same
integration decisions.

## CLI and demo

`sim integrate` reads an `ink-studio/integration-plan` version 1 document.
Set `module` to a trusted local JavaScript module relative to the plan.
It exports a function `(kit, config) => ({derivative, acceleration, events})`.
Supply the method and numerical options in `settings`, a list of ascending
`times`, and an optional constant JSON `input`. The CLI outputs an
`ink-studio/integration-trace` with one result per requested time up to a
terminal event. It includes both initial and final checkpoints.

```sh
node cli/ink-studio.js sim integrate examples/simulation-integrators/bounce.plan.json --out /tmp/bounce.json
node examples/simulation-integrators/demo.cjs /tmp/ink-integrators
```

The bounce demo compares a located impact to reacting at the end of the
host interval. The oscillator runs the same lossless dynamics under all
three methods and reports sampled energy and equation evaluations. The
script writes a PNG comparison, an animated PNG, and the numeric traces.
