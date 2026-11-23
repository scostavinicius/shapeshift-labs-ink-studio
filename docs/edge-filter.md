# Selective edge filtering

Set `look.edgeFilter` in JavaScript or `finish.look.edgeFilter` in a JSON diorama.
The headless renderer takes 16 coverage samples per native art pixel for eligible
splats. The filter blends coverage before palette resolve, so the final appearance
depends on the colors available in the scene palette as well as the edge geometry.
Give the palette intermediate values if a thin edge has too few tonal steps.

Use ordered rules to filter railings, ropes, or a diagonal, and keep character
silhouettes on the regular center-sampled path.

```json
{
  "rules": [
    { "select": { "tag": "character" }, "strength": 0 },
    { "select": { "object": "rear-guardrail" }, "strength": 0.75 },
    { "select": { "material": "hemp" } }
  ]
}
```

Rules use the normal scene selectors, including object, entity, material, surface,
prefab, and tag. The first match wins. A rule defaults to full strength. Set
`strength` from 0 to 1 to blend between regular coverage and area coverage.
With rules present, unmatched geometry uses strength 0 unless you set a
top-level `strength` as a fallback. Set the option to `true` to filter all
eligible geometry or `false` to disable it. Node callers can override
`world.look.edgeFilter` with `render(world, { edgeFilter })`.

The filter applies to ordinary geometry, static strokes, and
[finite curve splats](curve-splats.md#filter-subpixel-coverage-by-material)
in the Node and CLI renderer. Glass, emitted particles, pixel-snapped effects, and raster sprites
keep their authored sampling. The original sculpt still owns coverage where
SDF assist is enabled. Filtered silhouettes use more coverage samples, so use
scoped rules for selective filtering and to limit the work.

## Compare raw and palette-resolved exports

```sh
node cli/ink-studio.js render examples/selective-edge-filter.js \
  --w 184 --h 112 --px 1 --edge-filter off --out hard-palette.png
node cli/ink-studio.js render examples/selective-edge-filter.js \
  --w 184 --h 112 --px 1 --out selective-palette.png
node cli/ink-studio.js render examples/selective-edge-filter.js \
  --w 184 --h 112 --px 1 --raw --edge-filter off --out hard-raw.png
node cli/ink-studio.js render examples/selective-edge-filter.js \
  --w 184 --h 112 --px 1 --raw --out selective-raw.png
```

The scene filters the signal rope and rear guardrail. The watchkeeper keeps its
hard edges. Use `--edge-filter on` to preview all eligible geometry or
`--edge-filter file.json` to try a specific rule set. Shot recipes record
the settings file as an input.
