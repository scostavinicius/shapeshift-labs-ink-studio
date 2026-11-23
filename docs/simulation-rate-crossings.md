# Declare simulation rate crossings

A world or model connection can declare its signal semantics separately
from the sampling policy. Set `signal` on the connection alongside
`from`, `to`, and `sample`.

| Signal | Meaning | Sampling |
| --- | --- | --- |
| `instantaneous` | A level or observation at a time, such as position or pressure. | `hold` by default. Numeric and XYZ vector ports can also use `average`, `interpolate`, `decimate`, and `fractional-delay`. |
| `accumulated` | Each publication is a new increment, such as energy delivered this step. | `sum` delivers each number or XYZ vector increment once. Publish increments in the receiving units. |
| `event` | Ordered discrete entries, such as contacts or triggered cues. | `events` queues each entry for the next receiver step. Requires event ports. |

Existing links infer their semantics from their port types and policy.
[Timed event inputs](simulation-timed-events.md) can consume these queues
at individual boundaries inside a receiver's interval.
The physical port checks still apply. If a physical level crosses different
rates, give it an explicit `sample` policy. A sum combines published increments
in their declared units. For an input in units per second, integrate the
rate over time in the source before publishing quantities to sum.

## Reconstruct or delay a level

```json
{ "from": "slow/position", "to": "fast/target",
  "signal": "instantaneous", "sample": "interpolate" }
```

`interpolate` reconstructs a linear value between source publications.
It samples one source interval behind the receiver clock, plus any optional
whole-world-tick `delay`. The interval of latency makes both samples
available to the receiver even when the source publishes after the phase.

```json
{ "from": "wave/value", "to": "scope/delayed",
  "signal": "instantaneous", "sample": "fractional-delay", "delay": 0.375 }
```

`fractional-delay` uses the requested positive delay in **world ticks**.
In a 60 Hz world with a 240 Hz source, 0.375 ticks is 1.5 source intervals
or 6.25 ms. For a stateful source, allow at least one source interval.
An aligned combinational source can support a shorter delay and creates a
same-phase dependency. Ink rejects a delay if it would need a source
sample that has yet to be published. Reconstruction is linear between the
bracketing samples. Startup extends the source's actual initial output
backward in time.

## Filter before slowing a signal

```json
{ "from": "wave/value", "to": "meter/filtered", "signal": "instantaneous",
  "sample": "decimate", "filter": { "taps": 193, "cutoff": 0.8 } }
```

`decimate` filters the fixed-rate source with a normalized, Hann-windowed
sinc FIR and then samples the result at the slower receiver's boundaries.
If the clocks land between source samples, the receiver interpolates the
adjacent filtered values. The optional cutoff is a fraction of the
receiving Nyquist frequency and defaults to 0.8. The default odd tap count
is `2 * ceil(8 * sourceRate / receiverRate) + 1`. An override needs at least
seven taps and four taps per rate ratio, up to 1,025 taps. For larger ratios,
use intermediate rates. The total latency is `(taps + 1) / 2` source
intervals plus any optional whole-world-tick `delay`. Use `sim plan` to
choose and inspect the filter and latency.

These three policies use fixed schedules at both ends. Chunk-managed
cadences can still use the existing hold, average, sum, and event policies.
Ink shares bounded history for connections from the same source port.
Checkpoints retain that history and, when enabled, the causal references
used by each reconstructed input. The execution plan reports effective
latency and retained and allocated sample counts.

## Signal bench

```sh
cd examples/simulation-rate-crossings
node ../../cli/ink-studio.js sim plan bench.world.json
node ../../cli/ink-studio.js sim run bench.world.json --ticks 144 --record bench.run.json
node ../../cli/ink-studio.js sim verify bench.run.json
node demo.cjs demo-output
```

The bench samples a 240 Hz signal containing 3 Hz and 44 Hz tones at
20 Hz. The 44 Hz component aliases to 4 Hz with hold sampling. The board
aligns source times to account for filter latency and compares both runs
against the 3 Hz reference. The same bench reconstructs a 60 Hz ramp at
240 Hz and delays the wave by 1.5 source samples. The demo exports the
board, measurements, plan, and checkpoint.
