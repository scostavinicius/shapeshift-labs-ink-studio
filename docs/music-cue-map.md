# Map the whole cue

A cue map sits on a [production](music-production.md) and plays through the
usual production renderer. Use it to mark how a cue unfolds, control how
much of each part plays, or hear several ways to stage a return.

```sh
ink-studio music production cue-map cue.json map.json --out mapped.json
ink-studio music production render mapped.json --out take
ink-studio music production inspect mapped.json --out performance.json
```

The map stays editable under `production.cueMap`. The report includes the
realized chord schedule, the first performed onset and pitch range on each
track, and the onset counts and registers within each cue group. A landmark
is an authored listening intention. Use the performed report to check
whether its named parts actually enter there.

## Groups and landmarks

Use absolute, zero-based beats on the production's tempo and swing map.
Windows include their start beat and exclude their end beat. Groups
can nest using `parent`. The child's window must fit strictly within
the parent's. A landmark names a moment such as the first clear pulse,
an exposed fragment, a gap, a held-back entry, or a return. Give it a
`kind`, optional label, and optional track names in `parts`. A report
resolves every group boundary and landmark to seconds.

```json
{
  "groups": [
    { "id": "cue", "from": 0, "to": 40 },
    { "id": "gather", "from": 0, "to": 16, "parent": "cue" },
    { "id": "return", "from": 24, "to": 40, "parent": "cue" }
  ],
  "landmarks": [
    { "id": "pulse", "beat": 4, "kind": "pulse", "parts": ["kick"] },
    { "id": "first-quote", "beat": 8.5, "kind": "fragment", "parts": ["lead"] },
    { "id": "bass-arrives", "beat": 24, "kind": "return", "parts": ["bass", "lead"] }
  ],
  "density": [
    { "from": 0, "to": 8, "parts": ["hat"], "value": 0.35, "keep": [2.5, 6.5] }
  ],
  "register": [
    { "from": 24, "to": 32, "parts": ["lead"], "semitones": 12 }
  ],
  "harmony": [
    { "from": 16, "to": 24, "chords": ["undertow", "blue", "hinge"], "every": 2 }
  ],
  "silence": [
    { "from": 0, "to": 22.5, "parts": ["bass"] },
    { "from": 22.5, "to": 23.25, "mode": "cut" }
  ],
  "room": [
    { "from": 24, "to": 36, "parts": ["lead", "pad"], "send": [0.5, 0.95] }
  ]
}
```

## Shape the performance

Omit `parts` to target all applicable production tracks. Register
targets pitched tracks. Windows on the same lane may meet or act on
different tracks at the same time. Windows targeting the same track
on one lane cannot overlap. Different lanes can act simultaneously.

| Lane | Effect |
| --- | --- |
| `density` | Retain a fraction of the existing written onset groups per track. Stronger attacks come first and the production seed breaks equal-velocity ties. `keep` preserves whole onset groups at specific beats, including co-voiced notes. A value of zero with no protected beats clears the window. A value of one keeps every group. |
| `register` | Shift pitched notes at their written onsets by an integer number of semitones. The resulting notes must stay in the MIDI range. |
| `harmony` | Step through named chords every specified number of beats. A window has its own chord sequence and speed. The underlying score resumes when it ends, unless another window starts at the same boundary. |
| `silence` | Withhold attacks for the selected tracks and shorten gates at the start of the window. The default `ring` mode lets releases and effects decay. `cut` also stops the selected tracks' sound and insert tails. When every track is cut, the shared room is cleared too. |
| `room` | Set a constant room send or ramp between two send levels across the window. The dry performance stays available on its own stem. |
| `level` | Apply a track gain in dB across a beat range, with fades at the boundaries. For example, `{"from":24,"to":28,"parts":["keys"],"gainDb":-3,"fadeSeconds":0.025}`. The default fade is 20 ms. |
| `eq` | Apply a bell EQ to the named tracks over the beat range. Choose `hz`, `q`, `gainDb` and optional `fadeSeconds`. The processor feeds the patch echo and room. |
| `tail` | Cap the released portion of a voice at `seconds` after its note-off or the start of the window, whichever comes later. `fadeSeconds` controls the fade into the new cutoff. A release that is already shorter keeps its duration. Shared room and echo decay normally. |
| `depth` | Fade toward an authored `cutoffHz`, `send`, or both. A low cutoff darkens the track before the patch echo. The send moves from the current room level to the authored value. `fadeSeconds` defaults to 60 ms. |

Use `foreground` to name who owns the attention in a beat range.
These declarations are editable score metadata used by the
[foreground mix planner](music-foreground-mix.md). They can name more
than one foreground part and protect other parts from generated moves.

Density selects existing material. To add new material, change the motif
or add a [theme appearance](music-themes.md). Apply theme development to a
mapped production to use its current harmony and report what played.
Rebuild a theme report after changing the map around those appearances.

Cue maps respect arrangement pins. Use the existing revision `unpin`
field when a new take should be allowed to change a pinned part.
Revisions can supply a replacement `cueMap`, or set it to `null` to
remove the map.

## Audition two returns

The [Night Weir example](../examples/music-production/cue-map-workshop.cjs)
plays the same theme in two cue maps. In one, the bass enters and the room
opens at the return. In the other, the same lead plays alone for a bar
before the band enters. Both begin with a partial statement and leave the
same hard gap before the pickup.

```sh
node examples/music-production/cue-map-workshop.cjs night-weir
```

Call `KIT.music.production.mapCue(source, map, assets)` from JavaScript
or use the `music.cueMap` graph operation. The graph's `value` output
feeds `music.renderProduction` and its `report` output carries the
whole-cue structure.

The design draws on Jackendoff and Lerdahl's treatment of grouping, meter,
and pitch as interacting structures, and on Lerdahl and Krumhansl's
distinction between tonal tension and other sources of tension such as
rhythm and texture. The lanes are authoring controls for those dimensions.
[Grouping and musical structure](https://doi.org/10.1016/j.cognition.2005.11.005) ·
[Modeling Tonal Tension](https://online.ucpress.edu/mp/article-abstract/24/4/329/95267/Modeling-Tonal-Tension)
