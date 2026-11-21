# Cloud assets and distance transitions

A bounded [cloud recipe or field](cloud-recipes.md) can serve as one asset for all three camera distances. Author its coverage, thickness, drift, and lighting once. Ink creates the card and the impostor views from that density.

- **Card.** A single baked projection on a camera-facing plane. Use it for faraway clouds whose apparent silhouette changes slowly.
- **Impostor.** Projections from several headings and five elevations. Ink blends adjacent views as the camera changes angle.
- **Volume.** The renderer samples the bounded density along the ray. Geometry in front stays clear, while objects in and behind the cloud receive scattering. The camera can fly through the density.

```js
const cloudField = K.clouds.asset({
  recipe: 'cumulus',
  seed: 42,
  bounds: { min: [-12, -13], max: [11, 8] },
  height: 8,
  thickness: 7,
  velocity: [0.12, 0.04],
  shape: { scale: 8, center: [0, -2] }
}, {
  volume: [1.35, 2.4],
  card: [4.6, 6.8],
  resolution: 64,
  directions: 8
});
return B.finish({ ...sceneSettings, cloudField });
```

A [bounded 3D density](geometry-shaped-atmosphere.md) can directly supply the asset field. Coverage-based assets use finite XZ bounds, positive thickness, and `repeat: false`. Fit the bounds to the cloud so the baked views use the available texture resolution. A hand-authored coverage function or grid works with the same settings. In JSON, put a `lod` object beside the recipe or coverage inside `finish.cloudField`. Use `lod: true` for the defaults.

The `volume` and `card` pairs set blend ranges in multiples of the cloud's bounding sphere radius. The camera uses the volume at and below the first near threshold, blends to the impostor across the near range, and blends to the card across the far range. The volume remains active when the camera is inside the bounds. Selection is deterministic when scrubbing forwards or backwards. `resolution` sets the width and height of each baked projection from 16 to 128 pixels and `directions` sets 4 to 16 headings. `cardYaw` is the fixed viewing angle for the distant texture in radians, measured from +Z towards +X. The renderer bakes views as needed and reuses them as the asset drifts or its light changes.

Shadows still use the shared cloud field. Scene-sky reflections sample the same density along the reflected ray. The card and impostor store front and back depth per texel so they can also respect foreground geometry. Their depth interpolation approximates the density between those endpoints.

Use `cloudRepresentation` in render options or `--cloud-representation auto|card|impostor|volume|off` on the CLI. `off` uses the regular cloud field backdrop path. `--cloud-field off` hides the cloud entirely. Force the exterior representations to inspect them from outside the cloud.

## Internal shadows for hero clouds

Enable `selfShadows` on a bounded, nonrepeating cloud with positive thickness. Ink samples toward the cloud's light direction at each occupied step of the volume march. Extinction along those rays softens the transition from lit edges to shadowed interiors. The samples use the same moving density and clear pockets as the view ray. The effect attenuates direct and rim lighting while preserving the cloud's extinction, ambient term, and lightning. The light follows the active scene sun unless the asset specifies `lighting.direction`. Projected [cloud shadows](cloud-shadows.md) on the scene have their own controls.

```js
const cloudField = K.clouds.asset({
  recipe: 'storm-front',
  bounds: { min: [-18, -24], max: [16, -2] },
  selfShadows: { strength: 0.85, distance: 14, steps: 8 }
});
```

`selfShadows: true` uses the defaults. `strength` ranges from 0 to 1 and defaults to 1. `distance` caps each light ray in world units, with the cloud bounds as the default cap. `steps` budgets 1–16 midpoint density samples per light ray and defaults to 6. A cloud with no authored lighting uses the default directional lighting for its self-shadowed volume. A bounded cloud with self-shadows and no LOD uses the volume by default.

Headless renders apply self-shadows to the volume portion of `auto` blends and to the reflected volume in `auto` or `volume`. The card and directional impostor keep their baked optical depth and approximate shading. Pass `cloudSelfShadows: false` to `render`, or `--cloud-self-shadows off` on the CLI, to compare the same volume with no shadow rays. The `on` override enables defaults on a bounded field or uses its authored settings. The WebGL cloud path supports the card.

The [beacon storm shot](../examples/beacon-cloud-self-shadows.js) uses the same moving field and camera for all three representations.

```sh
ink-studio render examples/beacon-cloud-self-shadows.js --t 2.4 --w 384 --h 216 --px 1 --raw --out beacon-volume.png
ink-studio render examples/beacon-cloud-self-shadows.js --t 2.4 --w 384 --h 216 --px 1 --raw --cloud-self-shadows off --out beacon-volume-unshadowed.png
ink-studio render examples/beacon-cloud-self-shadows.js --t 2.4 --w 384 --h 216 --px 1 --raw --cloud-representation card --out beacon-card.png
ink-studio render examples/beacon-cloud-self-shadows.js --t 2.4 --w 384 --h 216 --px 1 --raw --cloud-representation impostor --out beacon-impostor.png
```

## From distant sky to fly-through

The [fly-through](../examples/cloud-flythrough.js) starts at the distant card, goes through the directional impostor and both blends, then follows the survey lights into and out of the volume.

```sh
ink-studio sheet examples/cloud-flythrough.js --t 0,1.05,1.8,2.5,3.55,5.8 --raw --out fly-through.png
ink-studio render examples/cloud-flythrough.js --t 1.8 --cloud-representation impostor --raw --out impostor.png
```

Guerrilla's [*Nubis³* presentation](https://www.guerrilla-games.com/read/nubis-cubed) describes cloud assets that work as distant sky and as environments a camera can explore. Ink's asset uses the same bounded density for the near view and both baked projections.
