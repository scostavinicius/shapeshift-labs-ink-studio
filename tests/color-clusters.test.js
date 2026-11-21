const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const ink = require('..');
const { KIT, makeBuilder, makeSculpt } = ink.load();
const api = KIT.colorClusters;

const rule = (options = {}) => ({
  targets: [{ select: { material: 'paving' }, minPixels: 4, protect: { boundaries: false }, ...options }]
});
const at = (rgb, i) => (rgb[3 * i] << 16) | (rgb[3 * i + 1] << 8) | rgb[3 * i + 2];
const bytes = palette => Uint8Array.from(palette.flatMap(color => [color >> 16, color >> 8 & 255, color & 255]));

function cross() {
  const w = 7, h = 7, rgb = new Uint8Array(w * h * 3), splatId = new Uint32Array(w * h);
  const [horizontal, vertical, center] = [0x707070, 0x909090, 0x808080];
  for (let i = 0; i < 7; i++) for (const [p, color] of [[i + 3 * w, horizontal], [3 + w * i, vertical]]) {
    splatId[p] = 1;
    rgb.set(bytes([color]), 3 * p);
  }
  rgb.set(bytes([center]), 3 * 24);
  const world = { count: 2, data: new Float32Array(32),
    renderMetadata: { objects: [null, 'stonework', 'inlay'], materials: [null, 'paving', 'mosaic'],
      objectIds: Uint32Array.of(1, 2), materialIds: Uint32Array.of(1, 2) } };
  return { frame: { w, h, rgb }, passes: { splatId }, world, horizontal, vertical, center };
}

test('edge-connected size and grain choose a donor from the same visible material', () => {
  const { frame, passes, world, horizontal, vertical, center } = cross();
  for (const [angle, color] of [[0, horizontal], [90, vertical]]) {
    const settings = api.prepare(rule({ minPixels: 2, grain: { angle, strength: 1 } }));
    const result = api.apply(frame, passes, settings, world);
    assert.equal(result.changedPixels, 1);
    assert.equal(at(result.rgb, 24), color);
    assert.equal(at(frame.rgb, 24), center);
  }
  const settings = api.prepare(rule({ minPixels: 2 }));
  passes.splatId[23] = passes.splatId[25] = passes.splatId[17] = passes.splatId[31] = 2;
  assert.equal(api.apply(frame, passes, settings, world).changedPixels, 0);
  assert.throws(() => api.prepare(rule({ grain: { strength: 2 } })), /grain/);
});

test('swatches, named details, boundaries, and palette ownership protect exact pixels', () => {
  const { frame, passes, world } = cross();
  const unchanged = options => assert.equal(api.apply(frame, passes, api.prepare(rule(options)), world).changedPixels, 0);
  unchanged({ minPixels: 2, protect: { swatches: ['#808080'], boundaries: false } });
  unchanged({ minPixels: 2, protect: { targets: [{ object: 'stonework' }], boundaries: false } });
  unchanged({ minPixels: 2, protect: {} });
  passes.protected = new Uint8Array(49);
  passes.protected[24] = 1;
  unchanged({ minPixels: 2 });
  unchanged({ minPixels: 2, protect: { boundaries: false } });
  delete passes.protected;
  passes.paletteOwner = new Uint32Array(49);
  passes.paletteOwner[24] = 1;
  passes.paletteOwners = [null, { name: 'different palette policy' }];
  unchanged({ minPixels: 2 });
});

function plates(makeBuilder, makeSculpt) {
  const b = makeBuilder(11, [0, 0x505050, 0xc0c0c0]), s = makeSculpt(b);
  Object.assign(s, { amb: .5, sky: 0, sunK: 0, aoK: 0 });
  for (const [x, material] of [[-1.15, 'paving'], [1.15, 'tile']])
    s.box([x, 0, 0], [.66, .61, .19], { r: [1, 2], materialId: material, pixelStyle: { dither: 'checker' } },
      { res: .15, objectId: material });
  s.bake();
  return b.finish({ cam: { target: [0, 0, 0], dist: 7, pitch: 0, yaw: 0 }, radius: 7, detail: 12, dither: 0 });
}

test('headless render applies authored and override profiles after palette resolve', () => {
  const world = plates(makeBuilder, makeSculpt);
  const view = { w: 96, h: 64, px: 1, dither: 0, passes: ['materialId', 'splatId'], captureQuantization: true };
  const settings = rule({ minPixels: 6, grain: { angle: 15, strength: .8 } });
  world.look = { colorClusters: settings };
  const plain = ink.render(world, { ...view, colorClusters: false });
  const changed = ink.render(world, view);
  assert(changed.colorClusters.changedPixels > 100);
  assert.deepEqual(changed.rgb, changed.quantization.resolved);
  assert.deepEqual(changed.passes.splatId, plain.passes.splatId);
  let x, y;
  for (let p = 0; p < changed.w * changed.h; p++) if (at(plain.rgb, p) !== at(changed.rgb, p)) {
    assert.equal(changed.passes.materials[changed.passes.materialId[p]], 'paving');
    x = p % changed.w;
    y = Math.floor(p / changed.w);
  }
  const traced = ink.inspectPalettePixel(world, { ...view, at: [x, y] });
  assert.equal(traced.winner.rule.stage, 'color-clusters');
  assert.equal(traced.outputMatchesSwatch, true);
  assert.deepEqual(ink.render(world, { ...view, raw: true }).rgb,
    ink.render(world, { ...view, raw: true, colorClusters: false }).rgb);
});

function browserCheck(createRenderer, plates, settings) {
  const w = 96, h = 64;
  const world = plates(makeBuilder, makeSculpt);
  const canvas = new OffscreenCanvas(w, h);
  const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  const gl = canvas.getContext('webgl2');
  function draw(frame) {
    renderer.render(world, { width: w, height: h, colored: false, outline: false, dither: 0, ...frame });
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (gl.getError()) throw Error('Color clusters generated a WebGL error');
    return pixels;
  }
  const before = draw({ colorClusters: false }), after = draw({ colorClusters: settings });
  let changed = 0;
  for (let i = 0; i < before.length; i += 4) if (before[i] !== after[i]) {
    if ((i / 4) % w >= w / 2) throw Error('Color clusters crossed into the unselected material');
    changed++;
  }
  if (changed < 100) throw Error('Browser did not merge the paving clusters');
  const drawOff = draw({ colorClusters: false });
  if (before.some((n, i) => n !== drawOff[i])) throw Error('Disabling the pass did not restore the pixels');
  renderer.dispose();
}

test('WebGL uses the resolved color and visible material owner on the native art grid',
  { skip: !process.env.INK_TEST_CHROME }, t => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-clusters-'));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const page = path.join(folder, 'index.html');
    fs.writeFileSync(path.join(folder, 'bundle.js'), ink.bundle());
    fs.writeFileSync(page, `<!doctype html><pre id="result">PENDING</pre><script src="bundle.js"></script><script type="module">
import { createRenderer } from ${JSON.stringify(pathToFileURL(path.resolve(__dirname, '../webgl.mjs')).href)};
const output = document.querySelector('#result');
try {
  (${browserCheck.toString()})(createRenderer, ${plates.toString()}, ${JSON.stringify(rule({ minPixels: 6 }))});
  output.textContent = 'PASS';
} catch (error) { output.textContent = error.stack; }
</script>`);
    const software = process.platform === 'darwin' ? [] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
    const chrome = spawnSync(process.env.INK_TEST_CHROME, ['--headless', '--no-first-run', '--disable-background-networking',
      '--allow-file-access-from-files', ...software, '--user-data-dir=' + path.join(folder, 'profile'),
      '--dump-dom', pathToFileURL(page).href], { timeout: 90000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (chrome.error) throw chrome.error;
    assert.equal(chrome.stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1], 'PASS');
  });
