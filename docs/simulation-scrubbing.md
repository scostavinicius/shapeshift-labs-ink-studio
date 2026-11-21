# Simulation scrubbing and takes

Use `KIT.world.scrub.create(source, options)` to open a fixed-tick world manifest, simulation checkpoint, or run recording. The session advances its own solver. A checkpoint starts at its saved tick and retains pending commands. A recording exposes its original tick range and checks the replay against the recorded end when reached.

## Seek

- `seek(tick)` selects an absolute tick in any order. `seekTime(seconds)` selects the committed tick at or before that time using the run's timestep.
- `view()`, `query()`, `checkpoint()`, and `events()` read the selected tick. Pass the current view and query to the existing world renderer for a preview.
- `status()` reports the available range, cached ticks, starting checkpoint for the last seek, and number of ticks replayed.
- `checkpointEvery` sets the checkpoint spacing in ticks and defaults to 60. `checkpointCache` retains up to 16 additional snapshots by default. The origin remains available. Long jumps space retained snapshots across the replay span when the cache fills. Set the cache to zero to use the origin and current tick.
- `commands` accepts scheduled actions when starting from a world or checkpoint. Pass custom solver implementations or a worker pool through `runtime` options. The same solver inputs and tick order are used after each seek.

In the CLI, use `sim scrub <world|checkpoint|run> --ticks N,N,...` or `--t S,S,...` to seek in the given order. The report lists the committed tick and any events for each seek. Add `--entity ID` and optionally `--socket ID` for poses, or `--field NAME` with a query target for field samples. Set the cache with `--checkpoint-every N` and `--checkpoint-cache N`. Use `--checkpoint FILE` to save the last selection, including to an existing shared checkpoint store. Use `sim render <run> --ticks N --out FILE` to render an earlier tick from a recording.

## Record a take

`recordTake({ from, to, every, tracks })` records an inclusive tick range and leaves the playhead in place. `from` defaults to the current tick. `every` defaults to one tick. The first and last ticks are always sampled. Pose and numeric keys use linear interpolation by default. Boolean, string, and record keys hold until the next key. A missing capture source reports its target and tick.

| Capture track fields | Output |
| --- | --- |
| `target`, `entity`, `channel`, optional `socket` and `reference` | `translation` or rigid `orientation` relative to the first sample. An optional `reference` entity and socket measures the motion in a moving local frame. |
| `target`, `field`, optional `at`, `args`, `path`, and `mode` | The value of the world query, or a selected member of its result. |

Each `target` is a JSON Pointer or path array for the destination timeline. `KIT.world.scrub.motionTracks(entity, part)` generates translation and orientation targets for a diorama part. If `part` is omitted, the destination uses the entity's ID. Use the first sampled pose as the part's rest pose.

Use `sim take <world|checkpoint|run> --from N --ticks N --entity ID --part ID --out take.json` to record rigid motion. `--tracks FILE` reads an array of custom capture tracks in place of the entity selection. Choose a larger stride with `--every N` to fit more source time within the timeline's key budget. For a recording, the CLI defaults to its original range.

## Edit and use a take

The take stores source metadata and a JSON `sequence` with ordinary timeline tracks. Edit their times, values, or easing in a copy of the take, or use that sequence as a nested clip to trim and retime it. Assign it directly to a scene's `timeline` when it should drive the whole scene. Use `KIT.world.scrub.openTake(take)` or `ink-studio timeline <take.json> --at SECONDS` to inspect sampled keys. A take is playback data. The original run and its checkpoints remain available for exact solver state and events.
