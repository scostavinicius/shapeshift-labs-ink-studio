const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ KIT, makeBuilder }) {
  const width = 16, height = 12;
  const world = makeBuilder(31, [0x000000]).finish({
    radius: 3, cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 }
  });
  world.dataMarks = new Map([['relic', { status: 'visible', channels: { position: [0, 0, 0] } }]]);
  const fill = (rect, color) => ({ type: 'rect', rect, color });
  const plate = (id, draw) => ({ id, type: 'composite', isolated: true, layer: { draw } });
  const graph = { passes: [
    plate('clean', [fill([0, 0, width, height], '#ff0000'), fill([3, 0, width - 3, height], '#00ff00')]),
    plate('scan', [fill([0, 0, width, height], '#0000ff')]),
    plate('base', [fill([0, 0, width, height], '#000000')]),
    { id: 'source-matte', type: 'mask', rect: [0, 0, 3, 12] },
    { id: 'dest-matte', type: 'mask', rect: [8, 0, 7, 12] },
    { id: 'window', type: 'trackedWindow', input: 'base', source: 'clean',
      switches: [[1, 'scan'], [3, 'clean']], sourceMask: 'source-matte', mask: 'dest-matte',
      at: ({ time }) => time < 4 ? [7, 6] : null,
      crop: { at: ({ source }) => source === 'clean' ? [3, 3] : [2, 3], size: [4, 4] },
      place: { at: [11, 6], size: [8, 8] }, chrome: { color: '#ffff00', border: 1, leader: true } },
    { id: 'linear', type: 'trackedWindow', input: 'window', source: 'clean', at: [3, 1],
      crop: { size: [1, 1] }, place: { at: [1.5, 1.5] }, sourceMask: 'source-matte', filter: 'linear' },
    { id: 'world', type: 'trackedWindow', source: 'scan', at: { mark: 'relic' },
      crop: { at: [1.5, .5], size: [3, 1] } },
    { id: 'hidden', type: 'trackedWindow', source: 'clean', at: [0, 0, 100],
      crop: { size: [4, 4] }, place: { at: [3, 9] } },
    { id: 'moving', type: 'composite', isolated: true, layer: {
      source({ time }) {
        const rgba = new Uint8Array(width * height * 4);
        rgba.set(time < 1 ? [255, 0, 0, 255] : [0, 255, 0, 255], (2 + time) * 4);
        return { w: width, h: height, rgba };
      }
    } },
    { id: 'history', type: 'frameAge', fps: 1, cameraMotion: 'keep', regions: [{ mode: 'delay', frames: 1 }] },
    { id: 'last', type: 'trackedWindow', input: 'hidden', source: 'moving', switches: [[1, 'history'], [4, 'moving']],
      at: ({ time }) => [12 + time / 4, 10.5],
      crop: { at: ({ time, source }) => [2.5 + (source === 'history' ? time - 1 : time), .5], size: [1, 1] } }
  ] };
  return { world, width, height, graph, editor: KIT.renderGraph.create(graph) };
}

const names = ['window', 'linear', 'world', 'hidden', 'last'];
function cpu({ world, width, height, editor }, t, renderHistory) {
  return ink.render(world, { w: width, h: height, t, px: 1, raw: true, transparent: true,
    renderGraph: editor, renderHistory, renderGraphCapture: names }).renderGraphPasses;
}

function pixel(image, x, y) {
  const start = (y * image.width + x) * 4;
  return [...image.data.slice(start, start + 4)];
}

test('tracked windows keep source cues and both mattes, follow named anchors and clip out-of-view pins', () => {
  const demo = fixture(ink.load());
  const use = demo.editor.snapshot();
  assert.equal(use.passes[5].type, 'trackedWindow');
  const frame = cpu(demo, 0);
  assert.deepEqual(pixel(frame.window, 7, 2), [0, 0, 0, 255]);
  assert.deepEqual(pixel(frame.window, 8, 5), [255, 0, 0, 255]);
  assert.deepEqual(pixel(frame.window, 11, 5), [0, 0, 0, 255]);
  assert.deepEqual(pixel(frame.window, 14, 7), [255, 255, 0, 255]);
  assert.deepEqual(pixel(cpu(demo, 1).window, 11, 5), [0, 0, 255, 255]);
  assert.deepEqual(pixel(cpu(demo, 3).window, 8, 5), [255, 0, 0, 255]);
  assert.deepEqual(pixel(cpu(demo, 4).window, 8, 5), [0, 0, 0, 255]);
  assert.deepEqual(pixel(frame.linear, 1, 1), [128, 0, 0, 255]);
  assert.deepEqual(pixel(frame.world, 8, 6), [0, 0, 255, 255]);
  assert.deepEqual(frame.hidden.data, frame.world.data);
  const history = ink.load().KIT.renderGraph.history();
  assert.deepEqual(pixel(cpu(demo, 0, history).last, 12, 10), [255, 0, 0, 255]);
  assert.deepEqual(pixel(cpu(demo, 1, history).last, 12, 10), [255, 0, 0, 255]);
});

test('registered nearest crops preserve pixels and reject bad cues and reference types', () => {
  const { world, width, height, graph } = fixture(ink.load());
  const source = graph.passes[0], base = graph.passes[2];
  const window = { id: 'v', type: 'trackedWindow', source: 'clean', at: [3.4, 3.25], crop: { size: [4, 4] } };
  const make = (...entries) => ({ passes: [source, base, ...entries] });
  const { renderGraphPasses: selected } = ink.render(world, { w: width, h: height, px: 1, raw: true,
    renderGraph: make(window), renderGraphCapture: ['clean','v'] });
  for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++)
    assert.deepEqual(pixel(selected.v, x, y), pixel(selected.clean, x, y));
  assert.deepEqual(pixel(selected.v, 5, 4), [0, 0, 0, 255]);
  const { prepare } = ink.load().KIT.renderGraph;
  assert.throws(() => prepare(make({ ...window, switches: [[1, 'clean'], [1, 'scene']] })), /strictly increasing/);
  assert.throws(() => prepare(make({ ...window, sourceMask: 'clean' })), /mask/);
  assert.throws(() => prepare(make({ ...window, crop: { size: [1.5, 4] } })), /integer/);
  assert.throws(() => prepare(make({ ...window, switches: [[1, 'v']] })), /earlier/);
});

test('WebGL and CPU agree on crop registration, matte filtering, cue frames and world anchors', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const times = [0, 1, 3, 4], data = fixture(ink.load());
  const renderHistory = ink.load().KIT.renderGraph.history();
  const expected = times.map(t => {
    const outputs = cpu(data, t, renderHistory);
    return names.map(name => [...outputs[name].data]);
  });
  const actual = runWebGL({}, fixture, (kit, build, backend, { times, names }) => {
    const { world, width, height, editor } = build(kit);
    const gl = backend(width, height, { raw: true, offscreen: true, transparent: true });
    try {
      return { outputs: times.map(time => {
        const captured = gl.draw(world, { time, renderGraph: editor, renderGraphCapture: names });
        return names.map(name => [...captured[name].data]);
      }) };
    } finally { gl.close(); }
  }, { times, names });
  assert.deepEqual(actual.outputs, expected);
});
