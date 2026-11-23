# Review block-size independence

An integer sample timeline is independent of the caller's block size.
A [block model](simulation-blocks.md) has one kernel and named, held input
levels. Model commands run before the sample with zero-based index
`tick - 1`. Playback splits a request at a command or capacity boundary.
Multiple writes at a sample apply in declaration order, with the last
write to each port taking effect for that sample.

## Play a model in a browser

```js
const play = KIT.world.blockReview.playback(model, {
  path: 'live',
  onBlock(start, end, outputs, buffers) {
    consume(buffers.trace, end - start);
  }
});
play.process(32);
play.process(128);
```

The live path uses the prepared processor. `process(count)` advances that
many samples from the current cursor. The callback receives each committed
range and borrowed output views. Consume a view before the next block.
A block callback can be omitted when the host needs only the final summary.
The offline path uses the ordinary kernel session's `advanceBlock`
and its portable snapshots. Both paths use the same authored sample
indices, seed, and capacity. Prepared kernels are required for the live
path. Ordinary block kernels can still be compared across offline
partitions, including their [timed event outputs](simulation-timed-events.md).

## Compare in the CLI

```sh
ink-studio sim block-check vent.model.json review.json --trace-out cli.trace.json
ink-studio sim block-check vent.model.json review.json --candidate browser.trace.json
```

A version 1 `ink-studio/block-review` plan supplies a sample count, an
optional list of prepared output buffer names, and named cases. Each case
declares a path and a repeating pattern of positive request sizes. The
first case is the reference. Supply at least two cases or an external
`ink-studio/block-trace` captured from the same model. With
`--trace-out`, the CLI writes the reference trace, including full named
sample buffers, stamped output events, and the final kernel checkpoint.
Reports separate requests from the actual blocks executed after splitting.

Comparison is exact by default. A plan can supply `tolerance` as
`{"absolute":0.000002,"relative":0.000001}`. For each floating-point
sample, numeric summary, or floating-point checkpoint element, the rule is

```text
abs(expected - actual) <= absolute + relative * max(abs(expected), abs(actual))
```

Integer buffers, Boolean and record results, event payloads and times, and
the resolved input schedule are checked exactly. The checkpoint layout is
also checked exactly. Use `compareState: false` when two backends have
deliberately different persistent layouts and the review should compare
their observable outputs and events. The default checks persistent state
as well, including the raw buffer representation in exact mode.

The report identifies `exact`, `within-tolerance`, or `diverged`, with the
first reported difference, first tolerance failure, and largest absolute
error. A CLI divergence exits with status 2. The review collects data
outside the live processing callback's allocation budget.

For a browser trace you can step incrementally,
`KIT.world.blockReview.prepareCapture(model, { samples, path, blocks, buffers })`
returns `step()` to issue one request from the pattern and `trace()` after
the capture completes. `capture` runs the same requests synchronously.
The library's `compare(reference, candidate, { tolerance })` uses the
same rules as the CLI.

## Vent network demo

```sh
cd examples/simulation-block-independence
node ../../cli/ink-studio.js sim block-check vent.model.json review.json
node demo.cjs demo-output
```

Open the generated `block-playback.html`. It compares a 512-sample
offline request with uneven live blocks and marks the control changes.
The Float32 option runs the same model with pressure rounded at every
cell update. It demonstrates a numerical match under explicitly set
tolerances and provides a trace you can send back to the CLI.
