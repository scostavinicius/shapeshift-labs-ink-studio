# Whole-piece composition

Start with an empty brief or give Ink a duration, key, pace, and instrument
palette. It generates a hook and lays out competing complete pieces of
90–120 seconds. Every candidate is a native editable production. Its note
material, harmony changes, tempo map, patches, cue lanes, and theme
appearances can all be revised.

```sh
ink-studio music production compose-piece --out drafts
ink-studio music production compose-piece brief.json --out drafts --render
ink-studio music production render drafts/afterimage/production.json --out afterimage-print
```

`--render` prints a full WAV master for each form. The draft recipe defaults
to a 48 kHz master print with no stems. Use `--sample-rate` from 8000 to
48000 when generating the draft, or change the recipe's render options.
For stems, set `stems: true` and choose a shorter render window or lower
sample rate if the full-length stem buffers exceed the production budget.

## Brief

```json
{
  "title": "Signal in the Silt",
  "goal": "A metallic clue becomes a melody",
  "seed": 1850,
  "duration": 104,
  "tempo": 106,
  "key": {"root": "E", "mode": "dorian"},
  "palette": "chamber",
  "forms": ["afterimage", "withheld", "exchange"]
}
```

All fields are optional. The title and goal are saved with the score.
Use the structured fields to direct the generator. The tempo is a target
for allocating bars, and each form changes tempo and subdivision over time.
Ink adjusts the section tempi to land within a millisecond of the requested
duration. Modes are minor, major, dorian and mixolydian. The chamber palette
combines Cinder Flute, Copperline Bass, tines and prepared-metal contacts.
The electric palette uses a reed synth, analog bass and FM keys.

The seed controls the hook, sectional lengths, pacing inside sections,
and generated instrumental phrases. Pass `hook` to supply a native motif
with 3–12 audible notes over 2–8 beats. Forms may move it by octaves and
give fragments to other tracks. They share the motif's identities,
rhythmic shape and interval relationships.

| Form | How the piece develops |
| --- | --- |
| Afterimage | Expose the hook before the pulse. Let the bass recall it, leave a space, then reharmonize the return and dissolve onto the tonic. |
| Withheld | Play rhythmic hints and keep the lead out of the first four sections. Open a gap, reveal the full hook, accelerate into subdivisions, then make a coordinated cut. |
| Exchange | Start with the bass stating the hook. Hand it to the lead, leave the backbeat behind, and make a staggered return across two registers. End on a suspended dominant. |

All three realize distinct percussion pocket patterns and harmony routes
as editable notes. Harmony can change underneath the same hook. Rests,
spare bass pedals, and the final hard cut are authored in the score or
the cue map and are audible in the render.

## Audition and reuse

Each draft folder has a `production.json` with portable asset paths and a
`form.json`. The root manifest contains summaries and links to these
recipes. The form report includes performed attacks per section, which
tracks have yet to enter or drop out, the first kick, full hook and return,
and what harmony and timing the ending uses. `listen` supplies second-based
windows around those landmarks. A native `themeMap` records the played notes
for each appearance. The normal [cue editor](music-cue-map.md),
[theme tools](music-themes.md), and [production renderer](music-production.md)
consume the same recipes.

Use `KIT.music.production.composeWholePiece(brief?)` in JavaScript. It
returns `{value,assets}`, where `value` contains the candidate reports,
productions and theme maps. The graph operation `music.composeWholePiece`
also exposes `candidates`, `assets` and `report` as individual ports.

The separation of grouping, metrical organization and pitch structure
takes inspiration from [Jackendoff and Lerdahl's account of musical structure](https://www.brainmusic.org/EducationalActivities/JackendoffLerdahl06Cog.pdf).
