# Motif memory across branches

Use a [theme map](music-themes.md) for each cue that can introduce a version of
the same motif. Give the versions the same theme and note IDs. Their performed
rhythms, pitches, and instruments can differ. A later segment can generate a
recall from the version that played on the player's route.

```json
{
  "thematic": {
    "recalls": {
      "overlook": {
        "theme": "beacon",
        "part": "cello",
        "preserve": "both",
        "offset": 0.25,
        "length": 3,
        "anchor": "G3",
        "minNotes": 3,
        "level": 0.9
      }
    }
  }
}
```

Add the recall beside the existing `thematic.maps`. Use the mapped appearances
produced by `developThemes` or supplied with each source recipe. At recall, reserve space on a note-driven part in every version
of the destination cue. Ink adds the notes at the configured position in the
entry, through the part's patch, mix, and room. A percussion destination can
recall rhythm. A pitched destination can recall intervals as well.

| Setting | Default | Meaning |
| --- | --- | --- |
| `theme` | Required | ID shared by the source theme maps |
| `part` | Required | Destination part that plays the recall |
| `preserve` | `both` | `rhythm`, `intervals`, or `both` |
| `offset` | 0 | Beats after entry, from 0 to 64 |
| `length` | 4 | Maximum recall length in beats, from 0.125 to 16 |
| `spacing` | 0.5 | New attack spacing in beats for `intervals`, from 0.125 to 4 |
| `anchor` | Destination root or drum note | First MIDI pitch or note name |
| `minNotes` | 3 | Minimum number of distinct notes heard in one mapped part and visit, from 2 to 64 |
| `level` | 0.8 | Multiplier for the original note velocities, from 0.05 to 1 |

In live playback, a note enters version memory when an admitted voice produces
signal on an enabled layer. If some of the motif was cut off, a recall can use
the partial version once it reaches `minNotes`. Ink selects the latest
qualifying version and takes its notes from one mapped part in one visit.
Muted or unadmitted attacks leave gaps. Generated recalls do not seed the
memory.

`both` keeps relative attacks and signed semitone steps. `rhythm` plays the
remembered attacks on one anchor pitch. `intervals` carries the pitch steps onto
a new, evenly spaced rhythm. Ink transposes to the anchor and can scale the
timing uniformly to fit the destination window. Each entry can generate one
recall. If the player has heard too little of the motif, the part is muted, or
the recall would collide with authored notes or a cut, the destination plays
its written material.

Use `live.open` for interactive routes and `music live replay` to print their
recorded arrival times. In the live report, `themeVersions` shows the most
recent heard version, while `joins[].entry.recall` shows the specific version
the destination used. Those can differ if the latest version is too short.
`renderTimeline` and scene soundtrack exports also support the recall, using
the placed source notes and enabled layers. They reconstruct memory when
printing a trimmed interval. Their reports use `themes.versions` and
`themes.recalls`.

Run `node examples/motif-branch-memory/demo.cjs <output-directory>` and open
the generated `index.html`. Compare the Waterline and Clock tower versions
at the same Overlook. Both use the destination's cello.
