# Signal crossing · color-vision palette repair

Two route symbols use red swatches against mossy enamel plates. Compare
how their outlines read in three color-vision simulations and inspect the
smallest repair found within the example's candidate set.

```sh
node cli/ink-studio.js palette cvd-repair examples/color-vision-palette-repair/crossing.js \
  examples/color-vision-palette-repair/crossing.json --out crossing-repair
```

Open `crossing-repair/index.html`, select a simulation, and click a signal
to outline its measured edge. **Download repair** saves the editable exact
swatch replacements. The overhead lamp's aqua swatch is locked.

[Set up a repair for another scene](../../docs/palette-recipes.md#repair-palette-separation-for-color-vision-deficiencies)
