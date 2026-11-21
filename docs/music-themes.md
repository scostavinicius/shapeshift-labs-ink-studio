# Themes across a production

A theme has one identity across different instruments, registers, and
harmonies. A theme plan names the appearances the score should play, and a
theme map records the performed notes that played those appearances.

Use `KIT.music.production.developThemes(source, plan, assets)`,
`music.developThemes` in a graph, or the CLI:

```sh
ink-studio music production themes cue.json theme-plan.json --out developed.json
```

The source is an ordinary [music production](music-production.md). The result
contains an editable `production`, a portable `themeMap`, and a report with
planned appearances and listening state before and after each section.
The output can itself be rendered as a production recipe.

## Develop a theme

The plan has a `themes` table and an `appearances` list. A theme names an
existing motif or supplies an inline motif of up to 64 notes. Use stable
event IDs to author named `fragments`. A fragment keeps the selected notes'
relative timing and identity. For chromatic themes, `root` supplies the tonic
for chord-relative transposition. The first explicit MIDI note is the
default tonic.

```json
{
  "themes": {
    "beacon": {
      "motif": "beacon-melody",
      "root": "F#4",
      "fragments": { "call": ["tap", "up", "reach"] }
    }
  },
  "appearances": [
    {
      "id": "machine",
      "theme": "beacon",
      "section": "quay",
      "beat": 4.25,
      "stage": "fragment",
      "fragment": "call",
      "targets": [{ "part": "metal", "pitch": "rhythm" }]
    },
    {
      "id": "bass-remembers",
      "theme": "beacon",
      "section": "channel",
      "beat": 12,
      "stage": "development",
      "fragment": "call",
      "targets": [{ "part": "bass", "pitch": "chord-tone", "stretch": 1.5 }]
    },
    {
      "id": "the-lights",
      "theme": "beacon",
      "section": "lights",
      "beat": 0.5,
      "stage": "statement",
      "targets": [{ "part": "lead", "pitch": "chord", "transpose": 12 }]
    }
  ]
}
```

An appearance starts at a beat relative to its section. A target can add a
beat `offset`, time `stretch`, note `gate`, velocity multiplier `level`,
semitone `transpose`, and the usual per-note `play` expressions. Simultaneous
targets reorchestrate one appearance. Choose existing parts that follow their
written notes. Theme windows replace the underlying material in that part
and section. Other parts and material outside those windows retain their
written pitches and timing. A held note spanning a replacement resumes
after it as a new attack. Arrangement pins apply. Use `unpin` to release
specific pins for a new take.

| Pitch mode | Behavior |
| --- | --- |
| `original` | Keep authored absolute notes and interpret degrees in the target part. |
| `rhythm` | Transfer the attacks and accents. Percussion uses its track's ordinary strike. |
| `chord` | Apply the target register and transpose the intervals or degrees against the sounding chord at each onset. |
| `chord-tone` | Apply the chord mapping and move to the nearest chord tone. Use `prefer: "up"` to choose the upper pitch in a tie. |

Use `fragment` for a hint, `development` for a transformed return, and
`statement` for a full theme. A statement uses the whole motif. The map
records theme notes even when they travel between harmony and percussion.
Use this map for decision-making and the normal production outputs for
audio and scene cues.

## Remember what played

Add `thematic: {maps, routes}` to an existing adaptive production timeline.
`maps` is keyed by source name. `routes` is keyed by the destination segment
and lists alternatives in priority order. An alternative names a source and
a `when: {theme, stage, min}` requirement. `min` defaults to one complete
appearance. Sources for a segment share its named tracks and musical grid.
The segment's ordinary source is the fallback.

The renderer checks the history at each destination entry. Heard notes and
completed appearances come from played windows and enabled layers. The
first enabled target to play every mapped onset counts once even when several
parts play it. An interrupted fragment contributes its played notes but
does not count as a complete occurrence. Playback history is reconstructed
when rendering a trimmed scene so the same transition makes the same choice.
Rerun development after changing a production's note timing or pitches to
refresh its map.

The CLI automatically reads `themeMap` from referenced source recipes.
Scene exports can provide maps inline in the existing music production
timeline. The render report records the final heard and withheld notes,
completed appearances, and the history used for each routing decision.

Run the [harbor example](../examples/music-production/harbor-theme.cjs) for
two adaptive renders based on the same source palette. The early reveal
carries a short quote. The later reveal can play the full lead statement
after the bass completes its return.

```sh
node examples/music-production/harbor-theme.cjs harbor-audition
ink-studio music production timeline harbor-audition/late-timeline.json --out replay
```
