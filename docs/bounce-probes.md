# Local bounce probes

Use sparse probes to bring local color into diffuse fill. An opaque red
awning warms produce, a pale wall fills the shade beside it, and a sheltered
opening sees more sky in the directions that are clear.

Set `bounceProbes` on a finished JavaScript world or `finish.bounceProbes`
in a JSON diorama. Authored sites bake when the scene is built. A probe stores
the bounced color from the scene's baked splats and a separate directional
visibility table. The renderer uses the active sky and ground colors to update
the open directions each frame. Static surface color and sky visibility stay
in the bake.

```json
{
  "samples": 128,
  "reach": 6,
  "strength": 1,
  "bounceStrength": 1.2,
  "skyStrength": 0.4,
  "cast": { "exclude": [{ "tag": "moving-prop" }] },
  "receive": { "include": [{ "object": "produce" }] },
  "probes": [
    {
      "id": "market-table",
      "at": [-2.3, 1, 0],
      "radius": 2.5,
      "bounds": { "min": [-4, 0, -2], "max": [0, 2, 2], "feather": 0.2 }
    }
  ]
}
```

- `at` and `radius` are in world units. The probe fades out over the outer
  half of its radius. Nearby probes interpolate where their ranges overlap.
  Bounds keep the probe inside its room, and feather softens the boundary.
- `reach` is the static ray distance in world units. A ray that leaves the bake
  range can carry sky light. Choose a reach that includes walls and roofs
  between the probe and the outside. `samples` sets the number of directions
  per site. The defaults are 8 world units and 96 directions.
- `strength` controls blending into the existing fill. `bounceStrength` scales
  the baked surface color and `skyStrength` scales the open sky and ground
  directions. The defaults are 1, 0.9, and 0.4.
- Cast and receive masks use the same include and exclude selectors as shadow
  art. Place probes in open space and exclude props that will move after the
  bake. Rebuild the probes after significant edits to their casters.

The Node renderer and CLI apply probes before the palette resolve. With live
sun, the probes blend into its existing sky and ground fill. The sun and its
direct shadows still use the current lighting settings. Without live sun,
probes add diffuse light over the baked surface color. When there is no
active sky profile, the probes use the authored live sun sky and ground colors.

Both parts of the diffuse fill use nine real spherical harmonics with a
cosine convolution. The low-order representation follows the diffuse
irradiance method in [Ramamoorthi and Hanrahan](https://graphics.stanford.edu/papers/envmap/).

## Bake and reuse

```sh
node cli/ink-studio.js bounce-probes bake examples/bounce-probes.js --out market-probes.json
node cli/ink-studio.js render examples/bounce-probes.js \
  --w 208 --h 142 --px 1 --t 4 --bounce-probes market-probes.json --out market-amber.png
```

Use `--bounce-probes off` to compare the original fill. Pass `--bounce-probes`
a settings JSON to bake different sites, or a versioned bake JSON to reuse its
coefficients and visibility. The library exposes `bakeBounceProbes(world, settings)`
and `render(world, { bounceProbes })`. A shot recipe records the override file
as an input.
