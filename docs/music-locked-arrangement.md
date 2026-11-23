# Phrase and arrangement search with locks

Search an existing production for alternatives inside an editable range.
Keep outer voices, hold an ending, or reserve a smaller passage inside an
edit. Ink keeps one eligible candidate per kind of musical move and includes
the unchanged reference at the same playback level.

```sh
ink-studio music production search-locked cue.json brief.json --out review --render
ink-studio music production keep-locked review/search.json pick.json --out kept.json
ink-studio music production render kept.json --out print
```

Omit `--render` to generate score recipes and reports first. With it, the
review folder includes context previews before and after the change. Use
`--sample-rate` to set the preview and saved print rate. The default is
48000 Hz. The generated recipes point to a shared copy of the source WAVs.

## Choose the boundaries

Numeric positions are absolute beats. Musical addresses such as
`{"bar": 12}` are zero-based. Choose the extent where the composer may edit.
Add named protected regions to leave parts of that extent intact. Protected
regions can overlap. Notes outside the editable windows keep their original
attacks, pitches and expression. The underlying tempo and section clock
stays fixed.

```json
{
  "range": {"from":{"bar":16},"to":{"bar":46}},
  "locks": {
    "tracks": {"lead":"all","bass":"all"},
    "regions": [{"id":"return-and-ending","from":{"bar":24},"to":{"bar":46}}]
  },
  "kinds": ["counterline","harmony","orchestration","silence"],
  "register": ["D3","G5"],
  "seed": 40,
  "fade": 0.035
}
```

Use `all` to fix a track's performed notes, instrument and dry mix. A move
that changes a sidechain driving such a track is blocked. Use `pitch` on a
pitched track to fix its note addresses, written onsets and MIDI pitches
while allowing expression edits. Existing arrangement pins still apply.
The tool infers melody, bass, inner and pulse roles, or you can assign them
in `tracks`.

| Move | What the search tries |
| --- | --- |
| Counterline | Place short or longer responses in openings in the melody, near the active chord and clear of the outer lines. |
| Harmony | Try suspended and seventh-chord colors under the melody and bass. Where a chord-grid rewrite would disturb a lock, voice the new harmonies on the inner track over the original grid. |
| Orchestration | Move the inner texture to layered breathy dyads or metallic accents, using a spare production track. |
| Silence | Withhold unlocked tracks at the opening, or take the pulse away later and let it return. Existing tails can decay inside the edit. |

Read `manifest.json` for the selected candidates, rejected alternatives,
edit boundaries and protected regions. A `pick.json` can contain
`{"take":"orchestration"}`. Each candidate also has a ready-to-render
`production.json`.

## Keep and refine the edit

The saved recipe contains `lockedArrangement.source` for the reference and
`lockedArrangement.production` for the editable take. Work on the latter
to refine notes, articulations and cue lanes. Rendering checks the locks
again. For example, a selected counterline is an ordinary polyphonic note
clip layered over the existing material.

The renderer uses the reference PCM in the protected regions and outside
the search window. It mixes in the alternate production only inside the
editable windows, with fades confined to that side of each join. A protected
ending keeps its original notes, effect history and master samples. When
exporting stems, fully locked tracks retain their reference samples
throughout. The room in the editable window follows the selected mixture.

For hand editing, `mode: "layer"` adds a polyphonic clip over existing
material. `mode: "attacks"` replaces base attacks that start in the clip
window and lets earlier attacks continue. Give each new line its own voice
ID. Regular note clips still replace their entire window.

Use `KIT.music.production.searchLockedArrangement(source, brief, assets?)`,
`keepLockedArrangement(search, take)`, and
`renderLockedArrangement(selection, assets?, options?)` from JavaScript.
Their graph equivalents are `music.searchLockedArrangement`,
`music.keepLockedArrangement`, and `music.renderLockedArrangement`.
