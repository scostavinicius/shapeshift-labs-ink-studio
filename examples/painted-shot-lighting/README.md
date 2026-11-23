# The night courier · painted shot lighting

Fit the direction and size of the key, intensity of the fill, and surface
exposure from three painted regions in the courier's frame.

```sh
node cli/ink-studio.js shot light-fit examples/courier-shot-lighting.js \
  --shot-lighting examples/painted-shot-lighting/starting-rig.json \
  --targets examples/painted-shot-lighting/targets.json --out courier-fit --interactive
```

Open `courier-fit/index.html`. Toggle between **Before** and **Fitted**, hide
paint to see both clean frames. Change target colors or brush new pixels, then
select **Fit paint** to compare the stored native renders. Download the changed
targets and pass them to the same command to search new rigs.
**Download fitted rig** saves an editable shot lighting JSON.

[Paint targets and fit another scene](../../docs/shot-lighting.md#fit-a-rig-from-painted-targets)
