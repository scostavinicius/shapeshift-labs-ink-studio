# Audition a picture and sound handoff

Use one delivered picture take to compare a sound leading a reveal,
landing together, or answering after the visual beat. The audition moves
one spotted editorial clip and uses the same stationary tracks and gain for
each version.

```sh
ink-studio take audition-handoff handoff.json --out audition
```

## Mark the handoff

```json
{
  "format": "ink-studio/attention-handoff",
  "version": 1,
  "id": "sounding-glass",
  "picture": "take/export.json",
  "editorial": "spotting.json",
  "window": {"from": 12, "to": 78},
  "reveal": {"frame": 36, "label": "Jelly lights up"},
  "clip": "glass",
  "variants": [
    {"id": "early", "label": "Sound first", "offsetMs": -420},
    {"id": "short-lead", "label": "Short lead", "offsetMs": -180},
    {"id": "together", "label": "Together", "offsetMs": 0},
    {"id": "answer", "label": "Picture first", "offsetMs": 560}
  ]
}
```

- `picture` accepts a numbered `graph clip` or `take render-av` report.
  An independent native sequence can use
  `{"fps":20,"firstFrame":0,"frames":["0000.png","0001.png"]}`.
  Take rates can be exact fractions. The review uses the original PNGs.
- `editorial` points to a fully resolved [audio editorial project](audio-editorial.md).
  Use the same picture rate and frame origin as the take. The project may
  cover more frames than the delivered excerpt. `clip` names one spotted
  clip whose active take has a source sync sample or marker.
- `window` uses absolute frame indices and excludes `to`. It defaults to
  the delivered frame range. Use an excerpt of at most 360 frames and 15
  seconds. Smaller preview PNGs make longer comparisons easier to load.
- Mark a visible `reveal.frame` within that window. Provide two to eight
  distinct `offsetMs` values relative to the reveal. A negative number
  places the sound's marked sync point before the picture. Ink projects the
  frame onto the take's sample grid and rounds the signed offset to the
  nearest sample. Include the cue and its lead-in and tail when choosing
  a window.

## Compare and apply

Open `review.html` locally in a browser with Web Audio. Select a variant
during playback to hear it at the current playhead. The player uses one
audio clock to draw the same frame sequence and transitions audio with a
short crossfade. Loop or jump back to before the reveal to hear the next
comparison from the same position.

The report records requested and sample-realized offsets, the selected sync
points, the fixed picture hash, and any cue handles cropped by the excerpt.
Each 24-bit WAV uses the absolute start sample in its Broadcast Wave
time reference. The prints use a single shared headroom factor if needed.

Each variant also writes an editable `*.edit.json`, available through
**Download selected nudge** in the player. Apply it to the original
project through the native editorial tool.

```sh
ink-studio music editorial edit spotting.json audition/answer.edit.json --out selected.json
```

The handoff player auditions deliberate choices. Use the separate
[delivered sync check](delivered-sync.md) to measure a visible contact and
the attack in the final waveform.

## Sounding Glass example

A submersible sees a lantern jelly light up. Compare the glass cue 420 ms
early, 180 ms early, together, and 560 ms after the reveal. All options use
the same pixel frames and water bed. Node generates the native frames and
procedural WAVs. FFmpeg packages one playback example.

```sh
node examples/attention-handoffs/demo.cjs /path/to/sounding-glass-review
```
