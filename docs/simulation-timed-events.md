# React to events inside a timestep

An event can retain its occurrence in simulation seconds even when a solver
publishes it at the end of a tick or block. This works with ordinary event
ports and checkpoints. An opt-in receiver can integrate to each available
event, react at that instant, and integrate the rest of its interval.

## Stamp an event

- `ctx.eventAt(fraction, payload)` creates a port event at a fraction of the
  current solver interval. `ctx.emitAt(fraction, kind, detail)` records an event
  in world history at that time. Fractions range from zero at the start to one
  at the end. `KIT.world.timedEvents.at(seconds, payload)` stamps an authored
  absolute time, including a `world/input` event entry or `world/event` detail.
- On the mechanics system, `impactEvents: "timed"` stamps swept impacts using
  the detected time of contact. The event's existing `at` fraction remains
  available. The boolean impact mode retains its existing payload.
- In a [block kernel](simulation-blocks.md), call
  `eventAt(sample, fraction, payload)` from `advanceBlock` and return those
  events on an output port of type `event`. The sample index is zero-based
  and lies in the processed range. Return events in chronological order.
  A parent module receives the whole child batch, including earlier samples.
  A standalone kernel's `advanceBlock` also returns the whole batch. The
  endpoint snapshot retains output events from its final sample.
- A stamp is `timing: { "format": "ink-studio/event-time", "time": seconds }`.
  Block stamps also retain their original `sample` and `fraction`.
  `timing.time` is the occurrence. The top-level `tick` in world history
  is still the tick that published the event.

Spatial audio export uses a stamped world's occurrence to place the onset
on the output sample clock. This keeps authored and simulation-produced cues
from moving to the end of a world tick. Untimed cues use their existing clock.

## Split a receiving solver

Declare an input `{type:'event', timing:'split'}` and implement
`react(state, ctx)` next to `step(state, ctx)`. The same input declaration is
available to registered JavaScript kernels. A prepared kernel's `react(ctx)`
updates its typed state and returns its named outputs, just like `advance`.

The scheduler groups equal timestamps and calls `react` once per boundary
with `ctx.dt === 0`, the boundary's time and only its due event entries.
It calls `step` for each positive interval and publishes the system's outputs
at the scheduled endpoint. Other level inputs are held for the receiving
step. Other event inputs are available to the first integration segment. Peer
state and spatial queries use the enclosing phase's snapshot throughout.
Simultaneous entries keep their order on each input port.

Undelayed connections into a timed receiver take published events at a shared
phase in dependency order. This can create a same-phase dependency even for
a stateful event producer. The usual cycle check applies. A whole-tick link
delay preserves the occurrence and adds `timing.deliveryTime`. Future
entries stay queued. If an event arrives after the integrated interval that
contains it, it reacts at the start of the next available receiver interval.
The scheduler leaves completed ticks intact. Untimed entries at a split
input react at that interval's start.

Split receivers use a fixed cadence and run on the host. Blocks can publish
timed output events while retaining their level-only input contract.
A world or model can route those outputs to a split receiver at its own
rate. A named module input forwards the absolute occurrence time to its
child clock. Ink limits each visit to 256 distinct reaction boundaries.

Use `sim plan` to inspect the receiving policy and dependency. Step traces
show the actual reaction times and event batches. Run evidence records
the individual integration durations. Checkpoint resume preserves queued
events and reproduces the same integration and reactions.

## Collision and note bench

```sh
cd examples/simulation-timed-events
node ../../cli/ink-studio.js sim plan bench.world.json
node ../../cli/ink-studio.js sim run bench.world.json --ticks 2 --record bench.run.json
node ../../cli/ink-studio.js sim verify bench.run.json
node demo.cjs demo-output
```

The demo feeds one swept impact and one fractional-sample note onset to
a split receiver and a receiver that reacts at its scheduled boundary.
Both receive the original times. The board shows the reaction times and
resulting motion. The JSON includes the exact event stamps and replay check.

Use [contact samples and exciters](contact-exciters.md) for swept position,
momentum transfer, tangential slip, and average force on the same clock.
