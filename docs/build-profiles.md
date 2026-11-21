# Authoring and playback builds

Run `npm run build` in a checkout to produce three dependency-free files.

| Build | File | Contents |
| --- | --- | --- |
| Browser authoring | `dist/ink-studio.browser.js` | Full toolkit as a classic script. Serve it with `webgl.mjs` and its imports for live 3D editing or rendering. |
| Node authoring | `dist/ink-studio.node.cjs` | Precompiled toolkit and built-in dioramas. The package's `load()` and simulation workers use this file when installed. |
| Baked playback | `dist/ink-studio.player.mjs` | Self-contained module for playing published `scene.replay.json` frames in a browser. |

Build just one artifact with `npm run build -- playback`, `npm run build -- node`,
or `npm run build -- development`. The build prints raw and gzip-compressed
byte counts. `npm pack` and installs from Git run the build during preparation.
Install the packed tarball to deploy to a read-only runtime without running
the build there.

## Load the prebuilt toolkit in Node

```js
const studio = require('@shapeshift-labs/ink-studio');
const { KIT, makeBuilder, makeSculpt, SCENES } = studio.load();
```

The installed entry loads the compiled file directly, without scanning the
toolkit sources or writing a runtime cache. Existing headless rendering and
authoring entry points remain available through the package. To use the
compiled toolkit alone, require
`@shapeshift-labs/ink-studio/dist/ink-studio.node.cjs`.

A source checkout without that build still compiles and caches
`dist/standalone.js`. After editing local sources, rebuild the Node
artifact or set `INK_STUDIO_DEVELOPMENT=1` for the CLI and Node processes
that should pick up source changes.

## Play baked frames

Export the recording with the same scene, camera path, and rendering options
as the take under review.

```sh
ink-studio export-scene my-scene.js --formats replay --out publication
```

Serve the replay file identified by `export.json` and copy the playback
module alongside the host page. An `img` is sufficient. A button, range
input, and output element inside the host are optional.

```html
<figure id="take">
  <img alt="Baked take">
  <button type="button">Play</button>
  <input type="range" aria-label="Frame">
  <output></output>
</figure>
<script type="module">
  import { mountSceneReplay } from './ink-studio.player.mjs';
  const response = await fetch('./scene.replay.json');
  if (!response.ok) throw new Error('Could not open the take');
  const player = mountSceneReplay(document.querySelector('#take'), await response.json());
</script>
```

Call `play()`, `pause()`, `seek(seconds)`, or `dispose()`. The controller
reports elapsed `currentTime`, `duration`, and `paused`. Use
`{ autoplay: true, loop: false }` to opt into autoplay and stop at the end.
The module also exports `validateSceneReplay(recording)` and
`sampleReplayFrame(recording, seconds, { loop })`. Sampling returns the
frame index, source time, dimensions, and its PNG data URL.

The playback module renders captured images, including alpha, at their
published rate. Live camera changes, simulations, and editable native takes
use the authoring toolkit. For one file that opens offline, choose the
[self-contained scene embed](scene-publishing.md#replay-and-embed).

`studio.bundle()` still returns the classic authoring bundle. The
`bundle({profile: 'playback', format: 'module'})` option returns the same
standalone playback JavaScript as the built module. Use `format: 'script'`
to expose an `InkScenePlayer` binding in a classic script.
