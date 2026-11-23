# Local bounce probes

Use sparse probes to bring local color into diffuse fill. An opaque red
awning warms produce, a pale wall fills the shade beside it, and a sheltered
opening sees more sky in the directions that are clear.

Set `bounceProbes` on a finished JavaScript world or `finish.bounceProbes`
in a JSON diorama. Authored sites bake when the scene is built. A probe stores
the bounced color from the scene's baked splats and a separate directional
visibility table. The renderer uses the active sky and ground colors to update
the open directions each frame. The bake supplies surface color and sky visibility for sites without live sources.

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
  art. Place probes in open space. Add props that should reflect as they move
  to the dynamic list. Rebuild the probes after significant edits to stationary casters.

The Node renderer and CLI apply probes before the palette resolve. With live
sun, the probes blend into its existing sky and ground fill. The sun and its
direct shadows still use the current lighting settings. Without live sun,
probes add diffuse light over the baked surface color. When there is no
active sky profile, the probes use the authored live sun sky and ground colors.

Both parts of the diffuse fill use nine real spherical harmonics with a
cosine convolution. The low-order representation follows the diffuse
irradiance method in [Ramamoorthi and Hanrahan](https://graphics.stanford.edu/papers/envmap/).

## Follow moving color and light

Add `dynamic` to a probe definition in JavaScript or JSON. It is optional
and survives the normal version 1 bake. A sample re-traces sites that can
reach a selected posed splat, or can see surfaces within reach of a selected
area light. The ray gather includes the stationary scene and current moving
sources, so a pivoting panel can redirect color and change the accessible sky.
As a source leaves, the old site falls back to its baked transport.

```json
{
  "dynamic": {
    "reflect": [{ "object": "painted-shutter" }],
    "emit": [{ "select": { "object": "moth" }, "gain": 12 }],
    "lights": ["walking-lantern"]
  }
}
```

- `reflect` selects opaque, diffuse splats with the standard look selectors.
  Selected moving reflectors are left out of the static bake. The cast mask
  still scopes reflectors and other opaque ray hits.
- `emit` selects emissive splats. The current geometry, packed color, and
  emissive opacity feed the probes. `gain` scales emitted radiance and defaults
  to 1.
- `lights` names area lights by ID. At each diffuse ray hit, their current
  color and strength light the hit's albedo. This carries light reflected
  from a surface into the probe. A shaded hit can use the same retained SDF
  shadow casters as ordinary area lighting. The renderer applies probe fill
  with the existing receive mask.

World-space source reach determines which sites need rays. Updates use the
current pose and scene clock so seeking a shot is deterministic. The software
renderer projects the sampled color and sky visibility into the existing
spherical harmonics before palette resolution. `renderStats.bounceProbes`
reports updated site IDs and ray counts.

```sh
node cli/ink-studio.js bounce-probes review examples/dynamic-bounce/lantern-archive.js \
  --out lantern-archive --w 208 --h 104 --fps 10 --raw
```

Open `index.html` to compare the same animated scene with baked and live
probes. The review includes an affected-pixel overlay, the site update trace
and both animated PNGs. Use `--dynamic-bounce off` on a regular render or
clip (or `dynamicBounce: false` in Node) to use the baked probe fill.

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
