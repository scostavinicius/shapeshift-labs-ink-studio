# Contact samples and exciters

Use `KIT.world.contactSamples` for shared contact measurements and
`KIT.world.contactExciters.prepare(excitation)` for sample-rate forces.
The same data can drive a physical receiver, an acoustic model, or a
visual effect. A contact measurement uses format
`ink-studio/contact-sample` version 1 and records these quantities.

| Field | Convention |
| --- | --- |
| `point` | XYZ contact position in the authored length units |
| `normal` | Unit vector from the exciter toward the surface receiving the impulse |
| `slip` | Tangential velocity of the exciter relative to the receiver |
| `impulse` | Vector impulse on the receiver |
| `force` | Vector impulse divided by `interval`, or the supplied average force over that interval |
| `timing` | Ink's existing exact [event occurrence time](simulation-timed-events.md), with sample and fraction when known |

Use `contactSamples.sample(row, {time})` to normalize and stamp authored
or external measurements. Supply impulse or force and a positive
`interval`. With both vectors present, they must agree. The normal
is normalized, and the normal component is projected out of slip.
`pointBasis` and `forceBasis` distinguish measurement conventions.

## Capture from mechanics

Set `contactSamples: true` on a mechanics system to publish
`contact-samples` from swept collisions. This enables continuous
collision checking by default and emits one sample per measured pair.
The existing `impacts` port retains its payload and options.

The position comes from the ground or deformable surface when
available. For a swept rigid-body pair it is estimated from the
contacting shapes' overlap bounds. Slip is sampled before the
reaction and includes rotational surface motion. Impulse comes from
the solver's change in linear momentum, including ground friction
applied during the hit. Published force is a **step average** from
that impulse and the enclosing solver interval. The measurement
retains the substep impact time. Initial overlap cleanup and resting
contacts stay outside this swept-impact stream.

Use `contactSamples.impactTrack(row, {duration})` to turn a measured
hit into an authored exciter. Its pulse preserves the measured
impulse. A positive duration sets the exciter's contact-pulse width.

## Author exciters

An excitation uses format `ink-studio/contact-excitation`, version 1,
an `id`, and a `tracks` table of up to 64 named entries. Optionally
set `revision`, `sampleRate` (default 48,000 Hz), and `seed`.
Each track accepts `point`, `normal`, and `slip`. The default
normal is +Y. Supply values in consistent physical units.

| Kind | Timing and controls |
| --- | --- |
| `impact` | At `at`, apply the authored `impulse` as an area-normalized half-sine. A zero or omitted `duration` deposits the impulse in its containing sample. |
| `pluck` | At `at`, release `stiffness × deflection` along a `tangent` using a half-cosine force from peak to zero. The default `duration` is 0.012 s. |
| `bow` | Over `start` to `end`, build tangential bristle force from slip. Crossing the static limit releases to kinetic friction. Control `stiffness`, `staticFriction`, `kineticFriction`, and `slipScale`. |
| `scrape` | Over `start` to `end`, move through deterministic seeded texture using accumulated tangential travel. Control `friction`, `grain` spacing, and `roughness`. |
| `chatter` | Over `start` to `end`, engage successive teeth spaced along traveled distance. Set `spacing` and a `duty` fraction. Dwell averaging preserves the pulse area for constant load and slip. |

For bow, scrape, and chatter, set a scalar normal `load` or animate
`point`, `slip`, and `load` with ascending `keys` using absolute
`time` in seconds. Keys inherit omitted values from the prior key
and interpolate linearly. Slip and load used by the sustained model
are sampled over the active part of each audio sample. Chatter stamps
each tooth crossing using that sample's slip. Pass `controls: {trackName: {point, slip, load}}` to `process`
for live levels held over that block. A coupled model can supply
point, slip, and load from its receiving body without resetting the
bow bristles or accumulated travel.

```js
const {KIT} = require('@shapeshift-labs/ink-studio').load();
const E = KIT.world.contactExciters;
const run = E.prepare({
  format:E.format, version:1, id:'release', sampleRate:48000,
  tracks:{string:{
    kind:'pluck', at:.0123, duration:.02,
    point:[.1,0,0], tangent:[1,0,0], stiffness:30, deflection:.08
  }}
});
const block = run.process(2048);
console.log(block.events[0]);
```

`process(count)` returns the processed range and each track's packed
XYZ `point`, `slip`, `impulse`, and `force` Float64Arrays, with one
`active` flag per sample. The dense force is averaged over the full
audio sample so multiplying it by the sample interval recovers the
dense impulse. The event list contains onset and tooth annotations.
Each event describes the associated force window. Use the dense
signal or a separate event-driven playback path to avoid applying
those impulses twice.

Use `view()` for the latest samples and `snapshot()` / `restore()`
to resume. The clock, bow bristles, travel, and current measurements
round-trip across different block sizes. Contact rendering bounds
sample count, collection size, and per-block event count. You can
disable collection and event output independently.

## Run a model or render a trace

The `contact-exciter` kernel (revision 1) runs on Ink's
[sample-block model clock](simulation-blocks.md). Its configuration
contains an `excitation` and one named `track`. Its `contact` input
accepts held point, slip, and load overrides. The kernel publishes
`point`, `slip`, `impulse`, `force`, and the timed `contacts`
event output. It also supplies a runnable graph example.

`sim excite` takes an `ink-studio/contact-excitation-run` version 1
with `excitation` (inline or relative JSON), `samples`, and optional
`checkpoint`. It writes an `ink-studio/contact-excitation-trace`
with dense signals, events, and a checkpoint. Use `--wav` to audition
an explicitly scaled raw force projection. Set `audio: {track,axis,gain}`
on the plan. The output requires normalized PCM range.

```sh
node examples/simulation-contact-exciters/demo.cjs /tmp/ink-contact
node cli/ink-studio.js sim excite /tmp/ink-contact/five-contacts.run.json --out /tmp/contact.json
```

The demo captures a real swept strike and authors one pluck, bow,
scrape, and chatter track. It routes all five through the same
[delay-line acoustic receiver](distributed-waves.md). A high-pass
filter removes static force, and the listening clips use independent
peak normalization. The force plots and JSON retain the physical
drives with the stated units and gains.
