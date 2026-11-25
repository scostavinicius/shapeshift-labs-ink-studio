# Search for hard-to-stage routes

Give the search the controls a player can use and the staging constraints that matter. Ink steps the native simulation one tick at a time and saves the earliest reproducible failure for each check. You can start at a fresh world, a checkpoint, or the verified end of a run.

```sh
node scripts/build.js node
node cli/ink-studio.js sim search-staging examples/staging-route-search/world.json \
  examples/staging-route-search/plan.json --out ./breakwater-findings
```

Open `report.json` for the failing ticks, control inputs and evidence. Each found check names a native `.run.json` with the starting checkpoint and every command needed to replay through the failure. Run `ink-studio sim verify <recording>` to verify it again. If you rerun the search in the same directory, use the filenames in the current report.

## Author the search

Use format `ink-studio/staging-search`, version `1`, an absolute `until` tick within 600 ticks of the starting checkpoint, and a list of `checks`. The optional `actions` list contains up to 32 player decisions. The simulation can wait or use one decision per tick. A decision can carry up to 16 commands to model simultaneous inputs. Each command uses its normal runtime `action` and `args`, with the search supplying the tick.

An action has a unique `id`, `commands`, optional inclusive `fromTick` and `toTick`, and an optional `gate`. Gates sample a native query `field` on the previous committed tick, with optional `at` and `args`. The field must return `ok` and satisfy the gate's query condition in `when`. For example, this button can only be pressed while the listener is on the deck.

```json
{
  "id": "arm-warning",
  "gate": {
    "field": "world/position",
    "at": {"entity": "watcher"},
    "when": {"value": [-1.6, 1, 0]}
  },
  "commands": [
    {"action": "world/input", "args": {"port": "warning/pressed", "value": true}}
  ]
}
```

Actions and checks use lowercase IDs made of letters, digits and hyphens, beginning with a letter. Search keeps native pending commands and the scenario's action restrictions. It stops extending a route after a terminal scenario outcome.

## Pick the checks

| Check | Fields and evidence |
| --- | --- |
| `reveal-during-dialogue` | `start`, `end` and `reveal` select committed events for the line being protected. A reveal counts between the start and end in committed event order, including events on the same tick. The evidence includes both the dialogue start and reveal. Scope each check to one line or dialogue channel. |
| `occluded-contact` | `event` selects the contact, `camera` and `point` locate the camera and contact, and `trace` names a qualified native occlusion ray such as `walls/ray`. Supply participating bodies in `exclude` when they should be transparent to this test. The camera entity itself is excluded. The evidence identifies the first blocker between the camera and contact, using geometry from the committed contact tick. |
| `cue-out-of-range` | `event` selects the cue as it is queued. The check captures its `emitter` location and samples the `listener` on that tick and again after `delayTicks`. It reports a failure when the listener starts inside `maxDistance` and is beyond it at the arrival tick. Set the delay and range to the authored cue policy. The replay shows the world-space range test, which runs on the simulation clock. |

Event selectors take a `kind`, optional `system`, and optional query condition `where` on the native event payload, for example `{"path":"/to","value":"revealed"}`. Positions can be XYZ vectors or entity selectors with an optional socket. A contact point or cue emitter can also use `{"eventPath":"/at"}` to read either position form from its event payload. Seed the search before the dialogue or cue begins so it can observe the start and queue events.

## Read coverage

The search checks earlier ticks first. At the same tick it uses the order in which routes were reached, trying wait followed by the actions in plan order. It can reuse a state when the complete saved simulation and the check state agree. `maxStates` limits attempted steps across all branches and defaults to 1,000. Its upper limit is 5,000. `completeThrough` records the last tick fully searched across the available decisions. The command exits successfully when the report and any witnesses are written.

- `found` includes a verified replay to the earliest failing tick.
- `not-found` means the enumerated controls and tick window produced no witness.
- `inconclusive` means at least one measurement was unavailable, for example because a socket was missing when a contact occurred.
- `budget-exhausted` means the search ended before it could resolve this check. Found cases in the same report still have their earliest witness.

## Open the demo

```sh
node examples/staging-route-search/demo.cjs ./breakwater-findings
```

Open `breakwater-watch.html` and select a replay. The stage view draws entity positions from the verified replays. You can scrub the keeper's line and shutter reveal, inspect the blocked latch ray, or follow the watcher's path away from the warning bell. Each replay and the report can be saved from the demo.
