# The night courier · shared-object grade

Match the courier's coat, slate wall, and lamp brass across two camera and
lighting setups. The source uses a deliberately cool dailies grade.

```sh
node cli/ink-studio.js shot grade-match examples/shared-object-grade/courier.json --out courier-grade
```

Open `courier-grade/index.html`. Select an object to see the sampled region
in both shots. Switch to **Lightness only** to compare the source lighting
before and after the grade. **Download grade** saves the editable stack.

[Set up another pair of shots](../../docs/pixel-look.md#match-a-grade-from-shared-objects)
