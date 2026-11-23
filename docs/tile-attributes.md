# Tile color attributes

Use an indexed palette map to color a one-bit raster. A `0` pixel uses
the tile's paper swatch and a `1` pixel uses its ink swatch. Texels keep
their exact positions when you paint a tile or when a passing sprite
changes its colors. Tiles are 8×8 art pixels by default, as in the
[ZX Spectrum display file](https://worldofspectrum.org/ZXBasicManual/zxmanappc.html).

```js
const { tileAttributes } = KIT.procedural.pixelEffects;
const palette = {
  palette: ['#0c2730', '#9aeede', '#441943', '#ffb2e5', '#f2ce87'],
  roles: { glass: 0, mint: 1, plum: 2, rose: 3, honey: 4 }
};
// Supply the same one-channel 0/1 art raster at every point in the sweep.
const station = tileAttributes.compile(bitmap, palette, {
  defaults: { ink: 'mint', paper: 'glass' },
  cells: [{ cell: [2, 0], attributes: { ink: 'honey', priority: 9 } }]
});
const painted = station.paint([{ cell: [1, 0], attributes: { paper: 'plum' } }]);
const { value, inspect } = painted.frame({
  writes: [{ id: 'scanner', priority: 4, rect: [scanX, 0, 5, bitmap.height],
    attributes: { ink: 'rose', paper: 'plum' } }]
});
```

The palette accepts numeric indices and named roles. Set ink or paper
to `null` to make that part of a tile transparent. Set `tileSize` to a
square size or `[width, height]` for rectangular tiles. The final row
and column can be partial tiles. `paint` returns a new map, so the old
map can be used for undo. A paint edit with `attributes: null` restores
the default for its tile. Save `tileMap()` as the `cells` input for
reloading with the original bitmap, palette, tile size, and defaults.

Each write has exactly one footprint in layer-local coordinates.

| Footprint | Interpretation |
| --- | --- |
| `cells: [[column, row], ...]` | Explicit zero-based tile addresses within the map. |
| `rect: [x, y, width, height]` | Every tile touched by a pixel rectangle. |
| `mask: raster, at: [x, y]` | Every tile touched by a covered mask pixel. Supply a signed pixel origin to place a sprite or effect. |

Rectangles and masks clip to the layer. A mask uses alpha for two- and
four-channel rasters and luma otherwise. Set `channel` to a raster
channel and `threshold` to the minimum sample to count. The default
threshold is 1 in byte levels. A one-channel 0/1 mask also works with
that default threshold.

Painted tiles default to priority 0, and writes default to priority 1.
The highest priority controls the entire tile. At equal priority, the
later write in the array wins and can take priority over the painted
base. A winning write that sets just ink or paper reads the other
color from the painted map. Query `inspect([column, row])` on a frame
to read the painted attributes, effective attributes, and winning ID.
Each frame starts from the painted map, so you can seek the scanner
by recomputing its footprint for the desired scene time.

The result is a straight RGBA raster. Bind it to a
[render graph input](render-graph.md#connect-procedural-rasters) with
`renderGraphInputs: { station: value }` and set a composite pass's
`layer.source` to `{ slot: 'station' }`. Use nearest filtering for
hard pixel edges. The procedural graph node `fx.tileAttributes`
accepts `source`, `palette`, optional `writes`, and `options`
containing the tile configuration.

```sh
node examples/tile-attributes.cjs /tmp/north-lock
```

Open `north-lock.html` to sweep the beam across the sign, inspect a tile,
and try painting with a higher priority than the scanner. The example
also accepts `--frames` to export the native-size animation frames.
