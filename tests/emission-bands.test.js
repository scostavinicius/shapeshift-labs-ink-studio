const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = ink.load(), { KIT: K } = kit;

const palette = [{ crest: '#fffebb', body: ['#ff5544', '#912244'] }, { crest: '#bfffe8', body: ['#307788'] }];
const field = (width, height, data) => ({ width, height, channels: 1, data });
const red = [255,85,68,255], darkRed = [145,34,68,255], gold = [255,254,187,255];
const green = [191,255,232,255], clear = [0,0,0,0];
function pixel(image, x, y = 0) {
  const at = (y * image.width + x) * 4;
  return [...image.data.slice(at, at + 4)];
}

test('traveling fronts have an exact crest, hard body swatches and independent gaps', () => {
  const source = field(12, 1, Float32Array.from({ length: 12 }, (_, i) => i + .5));
  const options = { field: source, crest: 1, body: 4, gap: 1, speed: 1, palette, halo: false };
  const bands = K.emissionBands.create(options), first = bands.frame();
  assert.deepEqual([...first.mask.data], [0,0,0,0,0,255,0,0,0,0,0,255]);
  assert.deepEqual(pixel(first.value, 0), clear);
  assert.deepEqual(pixel(first.value, 1), darkRed);
  assert.deepEqual(pixel(first.value, 4), red);
  assert.deepEqual(pixel(first.value, 5), gold);
  assert.deepEqual(pixel(first.crest, 4), clear);
  assert.deepEqual(pixel(first.crest, 5), gold);
  assert.deepEqual(pixel(first.crest, 11), green);
  assert.deepEqual(pixel(bands.frame({ time: 1 }).crest, 6), gold);
  assert.deepEqual(bands.frame({ time: bands.period }).value.data, first.value.data);
  assert.deepEqual(bands.frame({ time: -bands.period }).value.data, first.value.data);
  const reverse = K.emissionBands.create({ ...options, speed: -1 });
  assert.deepEqual(pixel(reverse.frame().crest, 0), green);
  assert.deepEqual(pixel(reverse.frame().crest, 6), gold);
  assert.deepEqual(pixel(reverse.frame({ time: 1 }).crest, 5), gold);
  assert.deepEqual(pixel(reverse.frame().value, 7), red);
});

test('halo originates at crest pixels, leaves the hard art byte-exact and obeys both matte and distance range', () => {
  const source = field(11, 1, Float32Array.from({ length: 11 }, (_, i) => i + .5));
  const gate = field(11, 1, Uint8Array.of(255,255,255,0,255,128,255,0,255,255,255));
  const settings = { field: source, mask: gate, crest: 1, body: 3, gap: 3, start: 5, end: 9,
    palette, speed: 0 };
  const bands = K.emissionBands.create({ ...settings, halo: { radius: 2, strength: 2 } });
  const first = bands.frame(), plain = K.emissionBands.create({ ...settings, halo: false }).frame();
  assert.deepEqual(first.value.data, plain.value.data);
  assert.deepEqual([...first.mask.data], [0,0,0,0,0,0,255,0,0,0,0]);
  assert.deepEqual(pixel(first.halo, 4), clear);
  assert.deepEqual(pixel(first.halo, 7), clear);
  assert.deepEqual(pixel(first.halo, 9), clear);
  assert(pixel(first.halo, 5)[3] > 0);
  assert(pixel(first.halo, 8)[3] > 0);
  const layer = bands.layer().source({ w: 11, h: 1, time: 0 });
  assert.deepEqual(pixel({ width: 11, data: layer.rgba }, 6), gold);
  assert.throws(() => bands.frame({ width: 12 }), /match/);
  assert.throws(() => K.emissionBands.create({ crest: 0 }), /widths/);
  assert.throws(() => K.emissionBands.create({ field: field(1, 1, [Infinity]) }).frame(), /finite/);
});

test('the stock graph effect samples signed fields and exports the same aligned raster ports', () => {
  const source = field(9, 1, Float32Array.of(-3.5,-2.5,-1.5,-.5,.5,1.5,2.5,3.5,4.5));
  const gate = field(9, 1, Uint8Array.of(255,255,255,255,63,255,255,0,255));
  const options = { palette, crest: 1, body: 2, gap: 1, halo: { radius: 2 }, speed: 2 };
  const ports = ['value','crest','mask','halo'];
  const scene = K.procedural.graph.create({
    inputs: { field: 'raster', gate: 'raster' },
    nodes: { wave: { op: 'fx.emissionBands', inputs: { source: { input: 'field' }, mask: { input: 'gate' }, options } } },
    outputs: Object.fromEntries(ports.map(port => [port, { node: 'wave', port }]))
  });
  const time = .5;
  const { outputs } = scene.evaluate({ field: source, gate }, { time });
  const expected = K.emissionBands.create({ ...options, field: source, mask: gate }).frame({ time });
  for (const port of ports) {
    assert.equal(outputs[port].channels, expected[port].channels);
    assert.deepEqual([...outputs[port].data], [...expected[port].data]);
  }
});

function sceneFixture({ KIT, makeBuilder }) {
  const world = makeBuilder(23, [0x111527]).finish({ look: { pixelSize: 1 } });
  const bands = KIT.emissionBands.create({ start: 3, scale: [1.3,.86], body: 3, gap: 3, speed: 3,
    jagged: { amount: 4, seed: 34 }, halo: { radius: 2, strength: .8 } });
  world.look.renderGraph = { passes: [
    { id: 'body', type: 'composite', isolated: true, layer: bands.layer({ resolution: [24,18], part: 'value' }) },
    { id: 'emitter', type: 'composite', isolated: true, layer: bands.layer({ resolution: [24,18], part: 'crest' }) },
    { id: 'whole', type: 'composite', isolated: true, layer: bands.layer({ resolution: [24,18] }) }
  ] };
  return world;
}

test('WebGL and CPU share the same hard swatches and crest-driven glow through graph layers', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const captures = ['body','emitter','whole'], times = [0,.375];
  const world = sceneFixture(kit);
  const expected = times.map(t => {
    const { renderGraphPasses: values } = ink.render(world,
      { w: 24, h: 18, t, raw: true, transparent: true, renderGraphCapture: captures });
    return captures.map(name => Array.from(values[name].data));
  });
  const actual = runWebGL({}, sceneFixture, (kit, build, backend, { captures, times }) => {
    const world = build(kit), draw = backend(24, 18, { raw: true, offscreen: true, transparent: true });
    try {
      return { frames: times.map(time => {
        const values = draw.draw(world, { time, renderGraphCapture: captures });
        return captures.map(name => Array.from(values[name].data));
      }) };
    } finally { draw.close(); }
  }, { captures, times });
  assert.deepEqual(actual.frames, expected);
  assert.notDeepEqual(expected[0], expected[1]);
});
