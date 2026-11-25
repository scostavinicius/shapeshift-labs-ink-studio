# Shared focus track

A focus track names what the audience should notice on each beat. A subject
can carry a picture treatment, mix offsets, or both. The native picture
renderer and mixer evaluate the same track against elapsed take time.

```json
{
  "id": "gate",
  "map": {"tempo": 120},
  "subjects": {
    "hand": {
      "picture": {"select": {"object": "glove"}, "contrast": 2, "pivot": 0.34},
      "mix": {"cloth": 3, "harbor": -5}
    },
    "latch": {
      "picture": {"select": {"object": "bolt"}, "contrast": 1.8},
      "mix": {"metal": 5, "harbor": -10}
    }
  },
  "cues": [
    {"beat": 1, "subject": "hand", "fade": 0.5},
    {"beat": 4, "subject": "latch", "fade": 0.75},
    {"beat": 7, "subject": null, "fade": 1}
  ]
}
```

- `map` uses Ink's musical tempo map and defaults to 120 BPM. It resolves
  cue beats and fade ends, including tempo and swing changes. The picture
  time and mixer score position use seconds from the same take origin.
  A clip export starting partway into a take still evaluates that take's cues.
- `beat` is zero-based and can be fractional. Cues must be in strictly
  increasing order. Each `fade` is in beats and must end by the next cue.
  The handoff interpolates in elapsed time between the resolved endpoints.
  Use a short fade for audio continuity. A zero or omitted fade takes effect
  instantly, and audio first observes it at the next available sample.
- A `null` subject fades to the base picture and mix. Before the first cue,
  both use their base settings. The last cue holds until the end of the take.
- `picture.select` uses native object, part, material, and other scene
  target selectors. Contrast runs from 0 to 4 with 1 at unity, around a
  luminance pivot from 0 to 1 that defaults to 0.5. When both sides of a
  handoff select the same surface, their weighted contrast changes are
  combined. Static silhouette protection and scene grading can also apply.
- `mix` maps mixer strip IDs to offsets from −60 to +12 dB. Unlisted strips
  receive 0 dB. Offsets ride the existing fader after inserts, including post
  sends, and interpolate in dB during handoffs. Input and pre-fader sends
  still carry their existing signal. Use the mixer's peak policy to manage
  headroom when boosting a strip.

## Render and compare

```sh
ink-studio render ./scene.js --t 1.2 --focus-track focus.json --out still.png
ink-studio clip ./scene.js --from 0 --to 6 --focus-track focus.json --out clip.png
ink-studio music mix render mixer.json --focus-track focus.json --out mix
```

Use `--focus-track off` to audition the same picture or mix without cue
treatments. In JavaScript, pass the track as a native render option,
`world.look.focusTrack`, or `mixer.focusTrack` on a mixer recipe or music
edit session. The native renderer returns `frame.focusTrack` with the active
target, outgoing target, and handoff weight. Session preview follows the
current score position when looping or jumping to another range.

## Harbor Latch example

The [example](../examples/shared-focus-track) lifts the reaching glove, gives
the brass bolt and its click the foreground, then brings back the harbor bed
and the distant beacon. From the Ink checkout, generate both takes, a browser
comparison, stems, and editable recipes with Node and FFmpeg.

```sh
node examples/shared-focus-track/demo.cjs /path/to/harbor-latch-review
```
