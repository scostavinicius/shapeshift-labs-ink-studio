const fs = require('node:fs');
const path = require('node:path');
const { write } = require('./asset-files.js');
const { format, maxFrames, maxPixels, maxReplayBytes, dimensions, frameIndex, mount,
  sampleReplayFrame, validateSceneReplay } = require('../src/scene-replay.js');

function readSceneReplay(file) {
  if (fs.statSync(file).size > maxReplayBytes) throw new RangeError('Scene replay exceeds the file size budget');
  return validateSceneReplay(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function sampleSceneReplay(document, seconds = 0, { loop = false } = {}) {
  const { index, time, width, height } = sampleReplayFrame(document, seconds, { loop });
  return { index, time, width, height, png: Buffer.from(document.frames[index], 'base64') };
}

function embedSettings(options = {}, title = 'Ink Studio scene') {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Invalid scene embed settings');
  const settings = { title, alt: options.title ?? title, controls: true, autoplay: false, loop: true, fit: 'contain',
    pixelated: true, background: '#17212a', color: '#edf3f3', accent: '#8addc9', ...options };
  if (Object.keys(options).some(key => !['title', 'alt', 'controls', 'autoplay', 'loop', 'fit', 'pixelated', 'background', 'color', 'accent'].includes(key)) ||
      ![settings.title, settings.alt].every(value => typeof value === 'string' && value.length <= 500) ||
      ![settings.autoplay, settings.controls, settings.loop, settings.pixelated].every(value => typeof value === 'boolean') ||
      !['contain', 'cover'].includes(settings.fit) ||
      ![settings.background, settings.color, settings.accent].every(value => typeof value === 'string' &&
        /^(?:#[0-9a-f]{6}|#[0-9a-f]{3}|transparent)$/i.test(value)))
    throw new TypeError('Invalid scene embed settings');
  return settings;
}

const escapeHTML = value => value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');

function embedPage(document, settings) {
  const { width, height, fps, frames } = document;
  const { title, alt, controls, autoplay, loop, fit, pixelated, background, color, accent } = settings;
  const player = frames.length > 1 && controls ? `<nav aria-label="Scene playback">
    <button type="button">Play</button>
    <input type="range" min="0" max="${frames.length - 1}" value="0" step="1" aria-label="Frame">
    <output aria-live="off"></output>
  </nav>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
  * { box-sizing: border-box; }
  :root { --scene-background: ${background}; --scene-color: ${color}; --scene-accent: ${accent}; }
  body { margin: 0; font: 14px system-ui, sans-serif; color: var(--scene-color); background: var(--scene-background); }
  main { display: grid; height: 100dvh; grid-template-rows: minmax(0, 1fr) auto; }
  figure { margin: 0; min-height: 0; display: grid; overflow: hidden; }
  img { display: block; width: 100%; height: 100%; min-height: 0; object-fit: ${fit}; image-rendering: ${pixelated ? 'pixelated' : 'auto'}; }
  nav { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 9px 12px; border-top: 1px solid var(--scene-accent); }
  button { color: inherit; background: transparent; border: 1px solid var(--scene-accent); border-radius: 5px; padding: 4px 11px; font: inherit; }
  input { flex: 1 1 75px; accent-color: var(--scene-accent); }
  output { font-variant-numeric: tabular-nums; white-space: nowrap; }
  :focus-visible { outline: 2px solid var(--scene-accent); outline-offset: 2px; }
</style>
</head>
<body>
<main id="ink-scene">
  <figure><img width="${width}" height="${height}" alt="${escapeHTML(alt)}" draggable="false" src="data:image/png;base64,${frames[0]}"></figure>
  ${player}
</main>
<script id="ink-scene-recording" type="application/json">${safeJSON({ fps, frames, ...(document.simulationInputs !== undefined && {
  scene: document.scene, seed: document.seed, simulationInputs: document.simulationInputs }) })}</script>
<script>
window.inkScene = (${mount})(document.getElementById('ink-scene'),
  JSON.parse(document.getElementById('ink-scene-recording').textContent), ${safeJSON({ autoplay, loop })}, ${frameIndex});
</script>
</body>
</html>
`;
}

function writeSceneEmbed(document, { out, settings } = {}) {
  if (typeof out !== 'string' || !/\.html$/i.test(out)) throw new TypeError('Choose an .html embed filename');
  const source = validateSceneReplay(document), file = path.resolve(out);
  write(file, embedPage(source, embedSettings(settings, source.title)));
  return { file };
}

module.exports = { format, maxFrames, maxPixels, maxReplayBytes, dimensions, embedSettings, embedPage,
  readSceneReplay, sampleSceneReplay, writeSceneEmbed };
