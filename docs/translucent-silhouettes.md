# Translucent silhouettes at native art size

Use `look.translucentSilhouettes` to give steam, glass rims, cloth, and foliage their own coverage in headless renders and exports. Rules select splats using existing material, object, surface, or tag IDs. The first match wins. Unmatched splats use their usual coverage.

```json
{
  "fade": [64, 128],
  "rules": [
    { "select": { "material": "steam" }, "policy": "steam" },
    { "select": { "material": "glass-edge" }, "policy": "glass", "width": 1.4 },
    { "select": { "material": "silk" }, "policy": "cloth" },
    { "select": { "material": "leaves" }, "policy": "foliage" }
  ]
}
```

| Policy | Coverage |
| --- | --- |
| `steam` | Softens and spreads thin steam splats while compensating for the extra area. |
| `glass` | Keeps thin rims visible with a tighter falloff. Give the rim a separate material or object ID to select it separately from the pane. |
| `cloth` | Gives thin hems more width on the art grid and filters their edges. |
| `foliage` | Tightens the profile to keep gaps between shapes and filters leaf tips. |
| `legacy` | Uses the original coverage. Place it first for an exception to a wider rule. |

For Gaussian splats, `width` sets the minimum full width at half maximum in art pixels from 0 to 4. The ellipse keeps its orientation. `falloff` ranges from .35 to 4. Higher values tighten the profile. `opacity` scales the contribution from 0 to 2. `preserve` ranges from 0 for full authored opacity on widened samples to 1 for Gaussian area compensation. `filter` blends 16 pixel-area samples into the center sample, from 0 to 1. Custom footprints retain their shape and use falloff, opacity, and area filtering on the authored mask.

The policies run at full strength through 64 pixels on the shorter native side and fade out by 128. Set another `fade` pair or use `false` for full strength at every size. Output upscaling keeps the same native coverage. The policies run before optical attenuation and [transparency ordering](scene-optics.md#stable-transparency-during-motion), including blended crossings and deep compositing. Independently authored fog and cloud volumes use their own sampling.

Author on `world.look` in JavaScript or `finish.look` in a JSON diorama. Pass `translucentSilhouettes` to `render(world, options)` to override the scene. The CLI accepts `--translucent-silhouettes file.json` or `--translucent-silhouettes off` for matched reviews.

```sh
ink-studio render examples/translucent-silhouettes.js --t .5 --w 48 --h 32 --px 1 --raw --out tea-32.png
ink-studio render examples/translucent-silhouettes.js --t .5 --w 96 --h 64 --px 1 --raw --out tea-64.png
ink-studio render examples/translucent-silhouettes.js --t .5 --w 48 --h 32 --px 1 --raw --translucent-silhouettes off --out tea-legacy.png
```
