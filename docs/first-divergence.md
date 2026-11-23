# First-divergence debugging

Use [aligned simulation review](aligned-simulation-review.md) for paired native traces, sub-sample events, WAVs, and cutaways on the same take clock.

`sim diff --first` compares matching ticks from the common start through the
first observed difference. The report identifies the tick, system, solver
substep when available, and sampled inputs. Changed paths show left and
right values. Use `--limit N` to bound the change list and `--from N` or
`--ticks N` to select an absolute tick range.

```sh
ink-studio sim diff hold.run.json lower.run.json --first
ink-studio sim diff examples/world-worker-estate.js examples/world-worker-estate.js \
  --first --ticks 28 --left-workers 1 --right-workers 8
```

The comparison checks the ordered actions that actually reached a tick,
then solver scheduling, sampled signals, state, outputs, events, and
spatial writes. It also compares committed state, including transfers,
delays, and chunk clocks. A solver failure reports its attempted inputs.
Future queued actions are compared when they execute. Without `--first`,
`sim diff` compares the selected checkpoints as usual.

## Compare a saved run against the current engine

```sh
ink-studio sim run examples/world-worker-estate.js --ticks 28 \
  --record estate.run.json --trace-steps --checkpoint-store ./blocks
ink-studio sim diff estate.run.json --first
```

`--trace-steps` retains the last 256 frames by default. Supply an integer
from 1 to 4096 to set a different window. Captured frames preserve actual
substeps and can expose transient differences even when both saved end
states match. They can be large. A shared checkpoint store reuses identical
numeric pages and entity blocks across saved evidence.

Two recordings with step traces compare their captured evidence. A
recording without step evidence can be reconstructed by the current
engine for a two-input comparison. The report labels the source as
`replayed` and reports a saved endpoint mismatch if it reaches that
endpoint. Use `--left-workers N` or `--right-workers N` to explicitly
replay one side with that worker count. Use 0 for the in-process runner.

A single recording with `--first` compares its saved evidence against a
fresh replay. With a legacy log it can prove agreement or divergence at
the saved checkpoints. The report distinguishes checkpoint-only coverage
from continuous step coverage and gives the first available tick when the
retained trace starts late.

Node hosts can use `KIT.world.runtime.firstDivergence(left, right, options)`.
Pass `traceSteps` to `runtime.create` to attach step evidence to recordings.
