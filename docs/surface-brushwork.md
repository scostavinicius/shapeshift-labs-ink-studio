# Surface brushwork

Add a paint layer over an opaque sculpt or material. Ink samples the sculpt's
curvature during the bake and keeps the direction in its retained surface chart.
The strokes follow those charts through camera motion, skinning, deformation,
and instances. The layer changes surface colour while preserving coverage,
depth, picking, and material ownership.

```js
const timber = {
  r: [2, 3, 4, 5],
  engraving: {
    brushwork: { direction: 'curvature', axis: [0, 1, 0], width: .23, groupScale: 4 },
    scale: .12,
    ink: '#492a2c',
    paper: '#e5af76',
    strength: .85,
    tone: 'hybrid',
    seed: 407
  }
};
S.lathe([0, 0, 0], 2.2, .38, timber, { res: .045 });
S.bake();
```

Use `S.engraving` for a JavaScript sculpt default, or put the same record in
`finish.look.engraving` in JSON. A material's `engraving` setting overrides the
default. Set it to `false` to leave a material unpainted. `brushwork: true`
enables the default brush settings.

| Setting | Behaviour |
| --- | --- |
| `brushwork.direction` | `curvature` follows the direction of least bending. `axis` projects a grain direction onto the surface. `contour` follows slices perpendicular to the axis. |
| `brushwork.axis`, `probe` | Reference axis `[0,1,0]` and optional world-unit probe distance. The axis guides flat or isotropically curved areas. |
| `scale`, `brushwork.width` | World-unit brush spacing (default `.65`) and half-width as a fraction of spacing (default `.29`). Lower each for finer marks. |
| `brushwork.groupScale`, `groupContrast` | Size in brush spacings and strength of the broad pigment groups. Defaults to `3.5` and `.4`. |
| `brushwork.detailPixels` | Fade range for the projected stroke width in art pixels. The default `[.65,2]` suppresses individual marks below .65 pixels and restores full detail at 2 pixels. The larger pigment groups have their own projection-based fade. |
| `ink`, `paper`, `tone`, `strength` | The engraving colour endpoints, shading source, and mix with the native material. `origin` places the brush field and `seed` makes its variation repeatable. |

Brushwork uses the retained 3D chart, including the axes of an authored custom
footprint when present. The 2D tonal-map projection options are for [engraving](engraving.md).
When binding after bake through `K.engraving.bind`, rows with only a normal
can use the reference axis. Bake the material through the sculpt to sample
curvature. Re-bake to change the direction, axis, or normal probes. Use
`K.engraving.update` to edit the paint colours and scale on the existing chart.

```sh
node cli/ink-studio.js render examples/surface-brushwork.js \
  --w 360 --h 168 --px 1 --raw --out close.png
node cli/ink-studio.js render examples/surface-brushwork.js \
  --w 360 --h 168 --px 1 --raw --zoom 0.35 --out distant.png
```

Add `--brushwork off` to compare the underlying material. The Node and WebGL
frame option is `brushwork: false`. Legacy material paint stamps remain
available through [surface brush](surface-brush.md).
