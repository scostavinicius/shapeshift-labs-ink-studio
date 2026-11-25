# Joint picture and sound priorities under load

Use a single take-time interval to keep an important object's draw rows
and give its sound a direct spatial voice. During that interval Ink thins
particles and reduces background voice admissions. The usual policies
apply again at the end of the interval.

```json
{
  "id": "last-ferry",
  "windows": [
    {
      "id": "bell-strike",
      "from": 1.55,
      "to": 2.3,
      "picture": {
        "subjects": [{"object": "bell"}],
        "particleRetain": 0.22
      },
      "sound": {
        "cues": ["bell"],
        "backgroundVoices": 1,
        "groups": {"rain": 0, "crowd": 1}
      }
    }
  ]
}
```

- Each window is a half-open interval in absolute take seconds. Use
  increasing windows with distinct IDs and no overlap. Cropping an export
  retains the original take clock.
- Picture subjects use the native object, part, material, or other surface
  selectors. Their rows bypass draw-row decimation. Existing occlusion and
  compositing still determine which pixels are visible.
- `particleRetain` is a ceiling on the stable draw fraction from 0 to 1.
  The headless renderer also skips splash and runoff contact work for
  omitted rain rows. The source rain pool still advances.
- A spatial soundtrack needs a configured `voiceBudget`. The active
  window temporarily marks the named cue as protected and gives it
  priority 100. A named cue bypasses its ordinary group cap during the
  window. The total voice ceiling still applies when several protected
  sounds compete.
- `backgroundVoices` limits unprotected direct voices, and optional
  `groups` caps unprotected voices within a named group. These limits can
  tighten the ordinary budget. Crowd texture allocation pauses during the
  window. The allocator uses the existing steal fade, so brief release
  tails can remain. Dropped one-shots follow the normal admission rules.

## Connect the track

Pass the same JSON to the picture pass and the spatial soundtrack.

```sh
ink-studio render ./scene.js --t 1.85 --joint-priority priority.json --out storm.png
ink-studio export-scene ./scene.js --audio soundtrack.json --joint-priority priority.json --out export
```

Set `world.look.jointPriority` or use the per-frame `jointPriority` render
option for headless and WebGL hosts. In a soundtrack recipe, set
`spatial.jointPriority` inline or to a JSON path relative to the
soundtrack. Passing the track inline to `KIT.world.spatialAudio.create`
also supplies the active priority to the Web Audio player at each host
update. Recorded soundtracks split the allocator at the exact sample
boundaries and evaluate delayed arrivals against those boundaries.
Choose a window that covers the cue's arrival and let the host update
through both boundaries in live playback.

Use `--joint-priority off` when comparing with normal budget settings.
The headless render returns the active window and omitted particle rows.
The soundtrack report lists priority intervals on the sample grid and
marks voice decisions made inside them.

## Last Ferry example

A harbor bell swings in a downpour while rain hits and footsteps compete
under a four-voice cap. With joint priority, the renderer keeps the
brass shape and thins the rain for that interval. The allocator spends
one background voice and keeps the bell as a direct voice.

```sh
node examples/joint-load-priorities/demo.cjs /path/to/last-ferry-review
```

The example needs Node and FFmpeg. It renders both takes from the same
scene and soundtrack sources and creates a comparison player.
