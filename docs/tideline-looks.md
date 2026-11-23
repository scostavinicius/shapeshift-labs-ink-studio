# Tideline Signal

Four authored looks share the same 3D lighthouse relief, moving ferry, beacon sweep, and 2.4-second camera move. The comparison uses the native 232 × 140 art grid at 20 output frames per second. At one second, all four pose clocks land on the same sample for the still comparison.

| Look | Edges | Texture scale in world units | Light | Pose cadence |
| --- | --- | --- | --- | --- |
| Ink wash | Pigment pools at the silhouette and feathers across a .052-unit edge. | .29-unit pigment clouds, with finer .045-unit grit on a .021 texel grid. | Broad value washes on parchment. | Continuous |
| Cut paper | Actual .060-unit sheets with cream cut walls and open apertures. | .045-unit front-paint texels with stock grain and fibers. | Baked soft shadows from the depth-separated sheets. | 8 per second |
| Enamel signage | Hard raised faces and a slim gold rim. | .075-unit pinholes and a broad clearcoat normal pattern. | An anisotropic specular layer catches the fixed key as the camera turns. | 12 per second |
| Stained glass | Lead seams run between the fitted sky, sea, and lens panes. | Roughly .55-unit cells on the broad panels, with smaller pieces in the lens. | A visible backlight shines through the optical panes. | 6 per second |

The `mixed` treatment uses ink wash for the sky and distant shore, cut paper for the cliff and tower, enamel for the bezel and ferry, and glass for the sea and lens. The same camera passes over the combined relief.

Edit [the four profiles](../examples/tideline-looks.json) to change the palette roles, texture scale, and pose rate. The [scene](../examples/tideline-looks.js) contains the common contours, depths, camera path, and motion. Each treatment uses existing Ink primitives including [cut sheets](paper-relief.md), [fitted optical panes](mosaic-surfaces.md), [surface finishes](surface-materials.md), and [motion cadence](art-direction.md). The comparison renders raw color to retain the material shading and fine texture.

```sh
node cli/ink-studio.js render examples/tideline-looks.js \
  --params '{"look":"stained-glass"}' --w 232 --h 140 --px 1 --raw --t 1 --out glass.png

node cli/ink-studio.js clip examples/tideline-looks.js \
  --params '{"look":"mixed"}' --w 232 --h 140 --px 1 --raw --fps 20 --out mixed.png

node examples/render-tideline-looks.cjs /tmp/tideline-review
```

The review script saves synchronized APNGs and stills, a mixed-material still, and a JSON report. The report records the shared camera at each frame and each look's sampled pose time and ferry position.
