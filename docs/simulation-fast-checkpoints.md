# Checkpoint fast simulation state

Kernel checkpoints retain the sample cursor, named outputs, and the
persistent typed buffers the solver declared. Put filter histories,
delay samples and write heads, oscillator phases, and any advancing
noise or pseudo-random state in those buffers. An indexed random
stream depends on the pinned seed and sample cursor. Scratch tables
can be rebuilt during preparation. Prepared processors checkpoint
buffers allocated with the `state` role.

A native world checkpoint includes embedded model checkpoints, pending
commands, event queues, rate-crossing histories, and delayed signals.
Those data restore together. A world can be checkpointed after a fast
child emitted a note and before a slower receiver consumes it. Restore
the world checkpoint to keep that note pending.

## Resume a fast block player

```js
const play = KIT.world.blockReview.playback(model, { path: 'offline', retainEvents: true });
play.process(891);
const saved = JSON.parse(JSON.stringify(play.checkpoint()));
const resumed = KIT.world.blockReview.playback(model, { path: 'offline', checkpoint: saved });
resumed.process(449);
const notes = resumed.drainEvents();
```

A portable fast playback checkpoint includes the pinned sample-indexed
control timeline, the kernel snapshot, and unread output events if
retention is enabled. The player reconstructs held controls and finds
the next command on restore. A resumed player may use different request
sizes or a different block cap. Prepared models can resume in the
`live` path. `snapshot()` reads the kernel state alone. Use
`checkpoint()` to save the transport and unread event batches with it.

- `process(count)` delivers blocks normally. Output event retention is
  optional. Drain the queue periodically in a host that enables it.
- `seek(sample)` advances silently from the current state or rebuilds from
  the beginning for a backward seek. Pass `{checkpoint}` to seek from
  a saved address at or before the target. State evolves through the
  interval, and skipped output events and callbacks are suppressed.
  Unread events already in the base checkpoint stay queued.
- `reset()` clears the player to sample zero and clears its unread queue.
  Saving and restoring belong outside a browser's realtime process callback.

The command-line version accepts standalone JSON and shared checkpoint
store references.

```sh
ink-studio sim block-play voice.model.json --samples 891 --checkpoint voice.checkpoint.json
ink-studio sim block-play voice.model.json --samples 1340 --resume voice.checkpoint.json
ink-studio sim block-play voice.model.json --samples 500 --resume voice.checkpoint.json --seek
```

`--samples` is the absolute cursor after processing. Use `--seek` for
silent reconstruction. A backward request performs a silent seek. Use
`--path live` for a prepared block model and `--checkpoint-store DIR`
to share persistent checkpoints with other runs.

## Set a take's native simulation policy

Add an optional `simulation` record to an Ink take. Its policy controls
the native world and its fast child models in `createTake` and
`take sample`. Picture frames and graph sampling keep their authored
take clock. The report includes a separate local simulation tick.

```json
{
  "warmup": 1,
  "cuts": {
    "carry-cut": { "state": "carry" },
    "reset-cut": { "state": "reset", "warmup": 2 }
  },
  "loop": { "from": 6, "to": 10, "state": "restore" }
}
```

| Boundary | Policy |
| --- | --- |
| First frame | Run the top-level `warmup` world ticks from the initial world. The first visible frame sees the warmed world. Preroll events participate in simulation and stay out of the presentation event list. |
| Carry cut | Continue the world's current simulation clock and all state. This is the default for cuts. |
| Reset cut | Reinitialize the native world and all fast child models. Start at local tick zero and run the cut's warm-up ticks. Authored world commands then follow that local clock. |
| Restore loop | Restore the loop-in checkpoint at the wrap. Ink reconstructs it on the first visit if needed. Pending events and the local timeline repeat. |
| Carry loop | Advance by the last picture interval and keep the fast state through the wrap. Interior reset cuts still run on later iterations. A reset on the loop-in frame applies when entering normally, and the carry policy wins at the loop seam. Carried simulation commands continue on the local world clock. |
| Seek | Resolve the requested frame and loop iteration from the authored cut and warm-up rules. Rebuild from the relevant origin if the current checkpoint is incompatible with that address. |

The loop range is half-open and uses picture frame indices. A carry loop
advances by the exact difference between the loop-out and loop-in
simulation tick addresses per cycle. In the library, `take.next()`
plays forward and wraps an authored loop. `take.seek(frame, {iteration})`
addresses a frame directly, with iteration zero by default. The matching
CLI flag is `--iteration N`. A take checkpoint preserves the iteration
and the resolved simulation position as well as the native world.

## Voice demo

```sh
cd examples/simulation-fast-checkpoints
node ../../cli/ink-studio.js take sample bench.take.json --frame 1 --checkpoint take.checkpoint.json
node ../../cli/ink-studio.js take sample bench.take.json --frame 3 --resume take.checkpoint.json
node ../../cli/ink-studio.js take sample bench.take.json --frame 6 --iteration 1
node demo.cjs demo-output
```

The demo runs an oscillator at 48 kHz inside a 60 Hz world. A save keeps
the phase, filter, delay line, write head and noise state. The world save
also holds two notes for a slow meter and a two-tick level delay. The
board compares resumed and uninterrupted samples and shows the local
sample position through carry, reset, and loop boundaries.

[Controlled model changes](simulation-model-changes.md) also checkpoint parameter
ramps and both prepared kernels during a topology crossfade.
