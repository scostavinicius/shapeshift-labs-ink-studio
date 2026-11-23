# Sprite scanline budgets

Use a scanline budget to recreate the way a crowded retro sprite layer loses
individual rows. The cap applies at native art resolution. Each sprite can
survive on one row and drop out on the next. The background and independently
budgeted layers can use their own settings.

Each sprite occupies one slot on every row spanned by its visible screen
rectangle, including transparent rows. Fully offscreen or hidden placements
take no slots. Evaluation happens before paint, masks, and depth testing.
Higher numeric priority wins first. Ties start in the authored array order.
With `rotate: true`, each priority group shifts its starting position by one
sprite every `holdFrames`. The shift keeps the same order across rows and is
deterministic when seeking. The surviving pixels keep their ordinary draw order.

## A raster layer

```js
const { value, report } = KIT.procedural.raster.spriteLayer({
  width: 240, height: 144,
  sprites: [
    { id: 'courier', source: courierRGBA, x: 20, y: 48, priority: 10 },
    { id: 'spark', source: sparkRGBA, x: 44, y: 46 }
  ],
  budget: { limit: 8, rotate: true, holdFrames: 2, fps: 24 },
  time: 0.5
});
```

Supply a top-left raster `source` per sprite. The layer supports the regular
raster stack's `x`, `y`, `opacity`, `tint`, `mask`, and `mode` controls.
The transparent RGBA `value` fits into a raster stack or as an image source.
Omit `budget` or set it to `false` for an unlimited layer. A budget defaults to
eight sprites, fixed tie order, a one-frame hold, and 60 fps. Use `limit: 0` to
drop every eligible sprite row. Pass an integer `frame` to address a particular
frame directly or let `time` and `fps` select it.

The `raster.spriteLayer` graph node exposes both `value` and `report`. Set
`width`, `height`, `sprites`, and `options.budget`. It uses the graph clock
unless you pass `options.frame` or `options.time`.

## An atlas placement layer

Use the same budget settings on a headless scene's camera-facing cards,
directional impostors, or painted scenery. Define named budgets when you finish
the world and assign each participating placement to one of those names.

```js
const sprite = KIT.sprite.placeAtlas({
  atlas, at: [0, 1.2, 0], mode: 'card', nativePixels: true,
  budgetLayer: 'effects', budgetId: 'courier', budgetPriority: 10
});
const world = B.finish({
  ...sceneSettings,
  spriteAtlases: [sprite],
  spriteAtlasBudgets: { effects: { limit: 8, rotate: true, holdFrames: 2, fps: 24 } }
});

studio.render(world, {
  w: 240, h: 144, px: 1, t: 0.5,
  spriteAtlasBudgetFrame(report) { console.log(report.layer, report.sprites); }
});
```

Placements without a matching budget layer are unlimited. Set
`spriteAtlasBudgets: false` in the render options to compare a shot with its
budgets disabled. Atlas budget rotation follows the render's interface clock
when supplied and the scene clock otherwise. Inspection reports use native
art rows even in a supersampled look. Dropped atlas rows are removed before
depth and emission passes.

## Inspect dropped rows

`report.used[y]` counts the accepted sprites on top-left row `y`, and
`report.droppedCounts[y]` counts the rejected sprites. Each entry in
`report.sprites` carries its `id`, `priority`, clipped `top` and `bottom`,
and a list of `dropped` runs as `[start, end)` row intervals. Omitted IDs
default to their position in the authored list. Reports include the sample
`frame` and rotation `phase`.

Custom renderers can use
`KIT.sprite.scanlineBudget.evaluate([{ id, priority, top, bottom }], { height, budget, frame })`
to obtain the same report and query `allows(spriteIndex, y)` before drawing
a projected sprite row.

Run `node examples/sprite-scanline-budget.cjs ./out/moth-signal` to render
the Moth Signal comparison and row inspection.
