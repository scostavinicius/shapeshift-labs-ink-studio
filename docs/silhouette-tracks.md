# Silhouette tracks

Use a silhouette track to give a scarf, hat brim, sleeve, or effect its own
exposures while the body continues through its baked poses. Register the
drawings to a point on the body, such as a collar or a wrist. Draw the hold,
the release smear, and the settle with each pixel in its intended place.

```json
{
  "poses": { "lean": 1, "reach": 2 },
  "silhouettes": [{
    "id": "scarf",
    "direction": 0,
    "rect": [6, 8, 7, 3],
    "pin": [1, 1],
    "anchors": [
      { "frame": "lean", "at": [8, 10] },
      { "frame": "reach", "at": [9, 9] }
    ],
    "extensionDepth": -0.02,
    "palette": ["#42253c", "#c85b54", "#ffc483"],
    "frames": [
      {
        "duration": 0.12,
        "paint": { "rows": ["..122..", ".01110.", "...00.."] },
        "maskPaint": { "rows": [".000000", ".000000", ".000000"] }
      },
      { "duration": 0.20, "hold": 0 },
      {
        "duration": 0.06,
        "offset": [1, -1],
        "mode": "patch",
        "paint": { "rows": ["...222.", ".111111", "...00.."] }
      },
      { "duration": 0.08 }
    ]
  }]
}
```

## Timing and paint

- Put `silhouettes` in the same `cels` sidecar as atlas transitions.
  Tracks start at zero by default. Choose `start`, per-cel `duration`,
  and an optional repeat `period`. `hold` repeats an earlier drawn cel
  by zero-based index. The selected body pose and its pin keep advancing.
- A track defaults to `replace`. Clear color erases the old outline
  within the rectangle. Use `maskPaint` or a PNG `mask` to scope the
  replacement. A track or individual cel can use `mode: "patch"` to
  add painted pixels, such as a detached smear. A duration-only cel
  reveals the sprite beneath it. Silhouette tracks apply after ordinary
  transitions, in declaration order.
- The cel grid has the size of `rect`. `pin` is a zero-based art pixel
  within that grid. On each matched view, the default joint location is
  the rectangle origin plus the pin. Supply a view-local `at` to follow
  motion in individual baked poses. Anchors accept numeric or named poses
  and optional `direction` and `pitch`. Supply matching anchors for each
  directional drawing that needs its own registration.
- Use `offset` to nudge a drawing by whole pixels relative to its pin.
  A held drawing inherits its source offset and mode unless overridden.
  Rectangles can extend up to 128 pixels beyond their view.
- Indexed cels, PNG channels, stencils, emission, and auxiliary maps use
  the [transition cel format](impostor-atlases.md#authored-transition-cels).
  Paint extending past the current body alpha needs an `extensionDepth`
  or authored depth. The Node/CLI renderer supports native cards and
  directional impostors.

## Inspection and demo

Use `KIT.sprite.celPreview.create({ atlas, silhouette: 'scarf' })` to
inspect just the track. Its `origin` locates the pin in the preview.
Neighboring cels are aligned by that pin, including during motion.
**Distinct drawings** skips a held contour, and **Export frames** shows
the immediate neighbors on the export grid. Omit `silhouette` to inspect
the complete sprite on the same timeline.

[Gale Signal](../examples/silhouette-tracks.js) holds a red pennant while
the lookout’s shoulder and lantern keep moving. It then cuts to two
separately drawn smears. Use `--params '{"edited":false}'` for the baked
scarf.

```sh
node cli/ink-studio.js clip examples/silhouette-tracks.js --w 232 --h 144 --px 1 \
  --raw --from 0 --to 3.2 --fps 20 --out gale-signal.apng
node examples/sprite-cel-preview.cjs gale-signal.html --demo gale-signal
```

Open the HTML to switch between the complete sprite and the isolated
**Red pennant** track. For your own atlas, use
`node examples/sprite-cel-preview.cjs preview.html --atlas atlas.json --silhouette scarf`.
