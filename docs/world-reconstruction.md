# World-space reveal and reconstruction

Set `look.reconstruction` on the baked world or pass `reconstruction` as a frame override. The value can be one track or an ordered list of up to 16 tracks. A track targets native splats using scene metadata. The first matching track owns a row. Each track partitions its rows into world-space cells within an object or entity and moves each cell as a rigid fragment.

| Track field | Meaning |
| --- | --- |
| `select` | Target selector using an object, entity, material, surface, prefab, or tag. |
| `cell` | Cell size in world units. Defaults to 0.35. |
| `distance` | Maximum travel in world units at full spread. Defaults to 1. |
| `spin` | Maximum fragment rotation in radians at full spread. Defaults to π/3. |
| `seed` | Signed 32-bit integer that sets fragment variation and the withdrawal sequence. Defaults to 0. |
| `origin` | Optional XYZ position for the grid origin and outward motion. By default, the grid starts at the world origin and fragments move outward from the selected splats' center. |
| `keys` | Between 1 and 256 keys in strictly increasing order by `time`, measured in scene seconds. |

Each key can specify a `state`, a `spread`, or a `withdrawal`. `solid` and `reassembled` set both controls to zero. `fragmented` uses full spread and keeps every splat. `sparse` uses full spread and withdraws approximately 80 percent of splats. Explicit `spread` and `withdrawal` values in [0, 1] override those defaults. A key without a named state defaults its unspecified controls to zero. The outgoing segment uses the key's `ease` setting. Use `smooth` (the default), `linear`, or `hold`. The first and last keys hold outside the timeline.

The animation is independent of viewing angle and can be evaluated directly at any time. Splat indices, IDs, and ownership stay intact. Fine texture tiles, edge marks, and paint decals follow their fragments. View-dependent paint corrections rotate their captured directions with the surface. Withdrawal hides paint and edge marks along with their parent splat. World-space material patterns still sample the scene coordinates. At full reconstruction the original packed rows are drawn directly.

Use `K.reconstruction.frame(world, time, definition)` to resolve a frame for direct use, or let the headless and WebGL renderers resolve it automatically. The Node `createSplatPicker` and WebGL `pick` use the same time and reconstruction settings as their renderer. The CLI accepts `--reconstruction file.json` and `--reconstruction off`. Pass `reconstruction: false` to disable the effect for a frame.

Tracks apply to baked native splats and placed splat instances. Splat rows with bone, rig, or shader-driven position changes require a baked pose before fragmentation. Reconstruction is a visual animation and leaves simulation geometry intact.
