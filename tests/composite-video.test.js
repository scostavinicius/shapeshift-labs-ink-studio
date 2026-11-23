const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K, SpriteSurface } = require('..').load();

const effect = K.procedural.pixelEffects.compositeVideo;
const source = (width, height, at) => ({
  width, height, channels: 4, pivot: [2, 1],
  data: Uint8Array.from(Array.from({ length: width * height }, (_, i) => at(i % width, Math.floor(i / width))).flat())
});
const sample = (image, x, y) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

test('luma and chroma have independent horizontal bandwidths', () => {
  const stripes = source(24, 2, (x, y) => {
    if (!y) return x % 2 ? [210, 210, 210, 255] : [30, 30, 30, 255];
    return x % 2 ? [184, 91, 92, 255] : [65, 130, 199, 255];
  });
  const original = stripes.data.slice();
  const luma = effect(stripes, { lumaBandwidth: .35, chromaBandwidth: 1, artifacts: 0 });
  const chroma = effect(stripes, { lumaBandwidth: 1, chromaBandwidth: .2, artifacts: 0 });
  assert.ok(Math.abs(sample(luma, 11, 0)[0] - sample(luma, 12, 0)[0]) < 10);
  assert.deepEqual(sample(chroma, 11, 0), sample(stripes, 11, 0));
  assert.ok(Math.abs(sample(chroma, 11, 1)[2] - sample(chroma, 12, 1)[2]) < 10);
  assert.ok(Math.abs(sample(luma, 11, 1)[2] - sample(luma, 12, 1)[2]) > 90);
  assert.deepEqual(effect(stripes, { lumaBandwidth: 1, chromaBandwidth: 1 }), stripes);
  assert.deepEqual(chroma.pivot, stripes.pivot);
  assert.deepEqual(stripes.data, original);
  assert.throws(() => effect(stripes, { chromaBandwidth: -1 }), /bandwidth/);
});

test('phase follows the graph clock and flat colors and coverage survive decoding', () => {
  const edge = source(16, 4, (x, y) => {
    if (y === 2) return x === 7 ? [250, 0, 250, 0] : [100, 130, 145, 100];
    const value = x < 8 ? 48 : 193;
    return [value, value, value, 255];
  });
  const parameters = { artifacts: .9, phaseRate: -1 };
  const graph = K.procedural.graph.create({ inputs: { source: 'raster' }, nodes: {
    decoder: { op: 'fx.compositeVideo', inputs: { source: { input: 'source' }, options: { value: parameters } } }
  }, outputs: { frame: { node: 'decoder' } } });
  const at = time => graph.evaluate({ source: edge }, { time }).outputs.frame;
  const first = at(0), later = at(.25);
  assert.deepEqual(first, effect(edge, { ...parameters, time: 0 }));
  assert.notDeepEqual(sample(first, 8, 0).slice(0, 3), sample(later, 8, 0).slice(0, 3));
  assert.notDeepEqual(sample(first, 8, 0).slice(0, 3), sample(first, 8, 1).slice(0, 3));
  assert.deepEqual(at(1), first);
  assert.deepEqual(at(0), first);
  for (let x = 0; x < edge.width; x++) assert.deepEqual(sample(first, x, 2), sample(edge, x, 2));
  assert.deepEqual(sample(first, 0, 0), sample(edge, 0, 0));
  assert.deepEqual(effect(edge, { phaseRate: 0, time: 5 }), effect(edge, { phaseRate: 0, time: 2 }));
});

test('a treated tile stays local, holds at its own cadence and binds its decoded pixels to a screen', () => {
  const raster = source(12, 4, (x, y) => (x + y) % 2 ? [255, 132, 179, 255] : [37, 48, 110, 200]);
  const settings = { phaseRate: 1, artifacts: .95 };
  const atlas = K.cameraAtlas.raster({ width: 25, height: 4, views: [
    { id: 'rgb', rect: [0, 0, 12, 4], fps: 12 },
    { id: 'video', rect: [13, 0, 12, 4], compositeVideo: settings, fps: 2 }
  ] }, () => ({ w: 12, h: 4, rgba: raster.data }));
  const box = SpriteSurface.make(12, 4);
  const region = box.reserve(12, 4), panel = box.finish();
  const sync = atlas.bindSurface(panel, 'video', region);
  assert.deepEqual(atlas.capture({}, { time: .125 }).updated, ['rgb', 'video']);
  const first = atlas.read('video').rgba;
  assert.deepEqual(first, effect(raster, { ...settings, time: .125 }).data);
  assert.deepEqual(atlas.read('rgb').rgba, raster.data);
  assert.deepEqual(Array.from(atlas.read().rgba.subarray(48, 52)), [0, 0, 0, 0]);
  assert.equal(sync(), true);
  assert.deepEqual(panel.pixels, first);
  assert.deepEqual(atlas.capture({}, { time: .31 }).updated, ['rgb']);
  assert.equal(sync(), false);
  atlas.capture({}, { time: .625 });
  assert.notDeepEqual(atlas.read('video').rgba, first);
  assert.equal(atlas.capture({}, { time: .125 }).rewound, true);
  assert.deepEqual(atlas.read('video').rgba, first);
});

test('WebGL decodes the requested native tile on the GPU with the same phase and sampling', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const run = require('../cli/look-webgl');
  function build({ makeBuilder }) {
    return makeBuilder(7, [0x111111, 0xeeeeee]).finish({
      cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 }, radius: 3
    });
  }
  function inspect(kit, make, backend) {
    const gpu = backend(32, 16, { raw: true, offscreen: true });
    const draw = [
      { type: 'rect', rect: [0, 0, 7, 4], color: '#e97648' },
      { type: 'rect', rect: [7, 0, 6, 1], color: '#44668c' },
      { type: 'rect', rect: [7, 1, 6, 3], color: '#387ae8' },
      { type: 'rect', rect: [0, 3, 4, 1], color: '#6efde4' }
    ];
    const settings = { phase: -.12, phaseRate: 1.5, artifacts: .9 };
    const frame = { raw: true, composite: { layers: [{ draw }] } };
    const atlas = gpu.cameraAtlas({ width: 28, height: 8, views: [
      { id: 'source', rect: [1, 1, 13, 4], frame },
      { id: 'filtered', rect: [14, 2, 13, 4], frame, compositeVideo: settings }
    ] });
    try {
      const world = make(kit), time = .15;
      const readPixels = WebGL2RenderingContext.prototype.readPixels;
      let reads = 0;
      WebGL2RenderingContext.prototype.readPixels = function (...args) { reads++; return readPixels.apply(this, args); };
      try { atlas.capture(world, { time }); }
      finally { WebGL2RenderingContext.prototype.readPixels = readPixels; }
      const rgb = atlas.read('source').rgba, decoded = atlas.read('filtered').rgba;
      const expected = kit.KIT.procedural.pixelEffects.compositeVideo(
        { width: 13, height: 4, channels: 4, data: rgb }, { ...settings, time }).data;
      let maxError = 0, difference = 0;
      for (let i = 0; i < decoded.length; i++) {
        maxError = Math.max(maxError, Math.abs(decoded[i] - expected[i]));
        difference += Math.abs(decoded[i] - rgb[i]);
      }
      return { reads, maxError, difference };
    } finally {
      atlas.dispose();
      gpu.close();
    }
  }
  const result = run({}, build, inspect);
  assert.equal(result.reads, 0);
  assert.ok(result.difference > 300);
  assert.ok(result.maxError <= 1, JSON.stringify(result));
});
