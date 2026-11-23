const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl');
const kit = ink.load(), P = kit.KIT.procedural;
const chrome = process.env.INK_TEST_CHROME;
const image = (reds, alpha = 255) => ({ width: reds.length, height: 1, channels: 4,
  data: Uint8Array.from(reds.flatMap(value => [value, 0, 0, alpha])) });
const vector = (x, width = 4) => ({ width, height: 1, channels: 2,
  data: Float32Array.from({ length: width * 2 }, (_, i) => i % 2 ? 0 : x) });
const mask = (...data) => ({ width: data.length, height: 1, channels: 1, data });
const red = raster => [...raster.data].filter((_, i) => i % 4 === 0);

test('datamosh reads signed displacements, recovers by half-life and honors confidence, validity and refresh independently', () => {
  const session = P.datamosh.create({ halfLife: .25, minConfidence: .2 });
  const start = image([20, 60, 100, 180]), clean = image([200, 200, 200, 200]);
  const planes = { confidence: mask(.1, .5, 1, 1), valid: mask(255, 255, 0, 255), refresh: mask(0, 0, 0, 128) };
  assert.deepEqual(session.sample(start, null, 0).value, start);
  const result = session.sample(clean, vector(1), .25, planes);
  assert.deepEqual(red(result.value), [200, 155, 200, 176]);
  assert.deepEqual([...result.carry.data.slice(0, 3)], [0, .25, 0]);
  assert(Math.abs(result.carry.data[3] - .5 * 127 / 255) < 1e-7);
  const again = session.sample(start, vector(-1), .25);
  assert.deepEqual(again, result);
  again.value.data[4] = 8;
  assert.equal(session.sample(start, vector(3), .25).value.data[4], 155);
  const still = session.sample(clean, vector(0), .5);
  assert.deepEqual(red(still.value), [200, 178, 200, 188]);
  assert.deepEqual(session.sample(clean, null, .75).value, clean);
  assert.deepEqual(session.sample(start, vector(1), .1).value, start);

  for (const [options, field] of [
    [{ direction: 'backward' }, vector(-1)], [{ units: 'pixels/second' }, vector(4)]
  ]) {
    const copy = P.datamosh.create({ halfLife: .25, minConfidence: .2, ...options });
    copy.sample(start, null, 0);
    assert.deepEqual(copy.sample(clean, field, .25, planes), result);
  }
});

test('datamosh transports premultiplied alpha, keeps clean resets atomic and supports fractional donors', () => {
  const session = P.datamosh.create({ halfLife: .5, filter: 'linear' }), initial = image([40, 160, 80, 10]);
  const clean = image([0, 0, 0, 0], 0);
  session.sample(initial, vector(0), 0);
  assert.throws(() => session.sample(clean, vector(.5, 2), .5), /aligned/);
  const corrupt = vector(.5); corrupt.data[0] = NaN;
  assert.throws(() => session.sample(clean, corrupt, .5), /finite/);
  const result = session.sample(clean, vector(.5), .5, { refresh: mask(0, 0, 255, 0) });
  assert.deepEqual([...result.value.data.filter((_, i) => i % 4 === 3)], [127, 127, 0, 127]);
  assert.equal(result.value.data[4], 100);
  assert.deepEqual(session.sample(initial, vector(-1), .5, { reset: true }).value, initial);
  assert.deepEqual(session.sample(image([20, 40]), vector(-1, 2), 1).value, image([20, 40]));
});

test('backward optical flow drives an aligned displaced donor without color packing', () => {
  const width = 32, height = 28;
  function guide(offset) {
    const data = Uint8Array.from({ length: width * height }, (_, p) => {
      const x = p % width - offset, y = Math.floor(p / width);
      return x >= 0 ? (x * 37 + y * 29 + (x * y * 13) % 127) % 256 : 0;
    });
    return { width, height, channels: 1, data };
  }
  const before = guide(0), after = guide(2);
  const { value: motion, confidence } = P.rasterWarp.opticalFlow(before, after, { direction: 'backward', search: 4 });
  const session = P.datamosh.create({ direction: 'backward', halfLife: 1 });
  const source = P.raster.canvas({ width, height, color: [64, 120, 180, 255] });
  session.sample(before, null, 0);
  const result = session.sample(source, motion, .1, { confidence });
  const p = 13 * width + 14;
  assert(motion.data[p * 2] < -1.65 && motion.data[p * 2] > -2.35);
  assert(result.carry.data[p] > 0.2);
  assert.notEqual(result.value.data[p * 4], source.data[p * 4]);
});

test('portable captured motion feeds the graph operator and clip cuts restore the clean frame', () => {
  const recording = P.visualResampling.create({ fps: 4 });
  for (const [index, shade] of [20, 80, 110, 160].entries())
    recording.append(image(Array.from({ length: 4 }, (_, x) => shade + x * 10)), index ? { motion: vector(1) } : {});
  const link = (node, port) => ({ node, ...(port && { port }) });
  const project = ink.createGraphProject({
    format: 'ink-studio/graph-project', version: 1, nodes: {
      replay: { op: 'anim.visualSample', inputs: { source: recording.snapshot() } },
      smear: { op: 'anim.datamosh', inputs: { source: link('replay'), motion: link('replay', 'motion'),
        valid: link('replay', 'motionValid'), options: { halfLife: .25 } } }
    },
    outputs: { value: link('smear'), carry: link('smear', 'carry') }
  });
  const { artifacts } = project.clip({ output: 'value', to: 4, format: 'frames',
    clock: { fps: 4, cuts: [{ frame: 2, id: 'fresh' }] } });
  assert.deepEqual(artifacts.map(({ bytes }) => red(require('../cli/png.js').raster(bytes))),
    [[20, 30, 40, 50], [80, 55, 65, 75], [110, 120, 130, 140], [160, 140, 150, 160]]);
});

function fixture({ makeBuilder }) {
  const w = 6, h = 4;
  const world = makeBuilder(13, [0x122032]).finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
  const graph = { passes: [
    { id: 'feed', type: 'composite', isolated: true, layer: { source: { slot: 'image' } } },
    { id: 'fresh', type: 'mask', raster: { slot: 'refresh' } },
    { id: 'smear', type: 'motionSmear', input: 'feed', refresh: 'fresh', cameraMotion: 'keep', halfLife: .25,
      motion: { slot: 'vectors', confidence: 'confidence', valid: 'valid', direction: 'backward' } }
  ] };
  function slots(index) {
    const make = (channels, data) => ({ width: w, height: h, channels, data });
    const cell = (channels, fn, Type) => Type.from({ length: w * h * channels }, (_, i) => fn(Math.floor(i / channels), i % channels));
    return {
      image: make(4, cell(4, (p, channel) => [20 + p * 6 + index * 10, 60, 15 + index * 10, 255][channel], Uint8Array)),
      vectors: index === 3 ? null : make(2, cell(2, (p, channel) =>
        channel ? (p >= w ? -1 : 0) : (p % w > 2 ? -1.25 : .75), Float32Array)),
      confidence: make(1, cell(1, p => p % w === 1 ? .5 : 1, Float32Array)),
      valid: make(1, cell(1, p => p % w === 2 ? 0 : 255, Uint8Array)),
      refresh: make(1, cell(1, p => p % w === 4 && index === 2 ? 255 : 0, Uint8Array))
    };
  }
  return { world, graph, w, h, slots };
}
const times = [0, .25, .5, .75, .25];

function headless() {
  const { world, graph, w, h, slots } = fixture(kit), history = kit.KIT.renderGraph.history();
  return times.map((t, index) => [...ink.render(world, { w, h, t, px: 1, raw: true,
    renderGraph: graph, renderGraphInputs: slots(index), renderGraphCapture: ['smear'], renderHistory: history
  }).renderGraphPasses.smear.data]);
}

test('screen passes read aligned signed motion slots and recover on missing motion and rewind', () => {
  const { graph, slots } = fixture(kit);
  const actual = headless();
  assert.notDeepEqual(actual[1], [...slots(1).image.data]);
  assert.deepEqual(actual[3], [...slots(3).image.data]);
  assert.deepEqual(actual[4], [...slots(4).image.data]);
  const { prepare } = kit.KIT.renderGraph;
  const invalid = motion => prepare({ passes: [...graph.passes.slice(0, -1), { ...graph.passes.at(-1), motion }] });
  assert.throws(() => invalid({ slot: 'vectors', direction: 'forward' }), /direction/);
  assert.throws(() => invalid({ slot: 'vectors', minConfidence: 2 }), /confidence/);
});

test('WebGL transports signed float vectors in top-down coordinates with CPU parity', { skip: !chrome }, () => {
  const actual = runWebGL({ chrome }, fixture, (toolkit, build, backend, times) => {
    const { world, graph, w, h, slots } = build(toolkit);
    const draw = backend(w, h, { raw: true, offscreen: true });
    try {
      const frames = times.map((time, index) => Array.from(draw.draw(world, { renderGraph: graph, time,
        renderGraphInputs: slots(index), renderGraphCapture: ['smear'] }).smear.data));
      return { frames };
    } finally { draw.close(); }
  }, times);
  assert.deepEqual(actual.frames, headless());
});

test('block memory holds exact stale pixels and refreshes complete feed-local blocks and groups', () => {
  const settings = { halfLife: .25, blockSize: [2, 1], blockMemory: {
    rect: [1, 0, 7, 1], recovery: { fps: 4, every: 4, groupSize: [2, 1] }
  } };
  const session = P.datamosh.create(settings);
  const before = image([9, 25, 35, 45, 55, 65, 75, 85, 99]);
  const solid = n => image(Array(9).fill(n));
  const hold = mask(0, 0, 255, 0, 255, 0, 255, 255, 0);
  const refresh = mask(0, 255, 0, 0, 255, 0, 0, 0, 0);
  assert.deepEqual(session.sample(before, null, 0, { hold }).value, before);
  const frozen = session.sample(solid(200), null, .125, { hold, refresh });
  assert.deepEqual(red(frozen.value), [200, 25, 35, 200, 200, 65, 75, 85, 200]);
  assert.deepEqual([...frozen.carry.data], [0, 1, 1, 0, 0, 1, 1, 1, 0]);
  const group = session.sample(solid(210), null, .25, { hold });
  assert.deepEqual(red(group.value), [210, 25, 35, 200, 200, 210, 210, 210, 210]);
  assert.deepEqual(session.sample(solid(90), null, .25), group);
  const skipped = session.sample(solid(220), null, 1, { hold });
  assert.deepEqual(red(skipped.value), [220, 220, 220, 220, 220, 210, 210, 210, 220]);
  assert.deepEqual(session.sample(solid(230), null, 1, { hold, reset: true }).value, solid(230));
  assert.deepEqual(session.sample(before, null, .5, { hold }).value, before);

  assert.throws(() => P.datamosh.create().sample(before, null, 0, { hold }), /blockMemory/);
  assert.throws(() => P.datamosh.create({ blockMemory: { recovery: { groupSize: [0, 1] } } }), /groupSize/);
  assert.throws(() => P.datamosh.create({ blockMemory: { rect: [0, 0, 0, 2] } }), /rectangle/);
});

test('feed-local prediction shares the center vector and keeps linear taps inside the feed', () => {
  const session = P.datamosh.create({ halfLife: .25, blockSize: [2, 1], filter: 'linear',
    blockMemory: { rect: [1, 0, 4, 1] } });
  const start = image([250, 20, 60, 100, 140, 250]);
  const current = image([200, 200, 200, 200, 200, 200]);
  const motion = { width: 6, height: 1, channels: 2, data: [0,0,3,0,.25,0,5,0,-.25,0,0,0] };
  session.sample(start, null, 0);
  const { value, carry } = session.sample(current, motion, .25);
  assert.deepEqual(red(value), [200, 110, 125, 155, 170, 200]);
  assert.deepEqual([...carry.data], [0,.5,.5,.5,.5,0]);
});

function blockFixture({ makeBuilder }) {
  const w = 12, h = 8, rect = [2, 1, 9, 6];
  const world = makeBuilder(13, [0x122032]).finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
  const graph = { passes: [
    { id: 'feed', type: 'composite', isolated: true, layer: { source: { slot: 'image' } } },
    { id: 'freeze', type: 'mask', raster: { slot: 'hold' } },
    { id: 'fresh', type: 'mask', raster: { slot: 'refresh' } },
    { id: 'decoder', type: 'motionSmear', input: 'feed', hold: 'freeze', refresh: 'fresh',
      motion: { slot: 'vectors' }, blockSize: [3, 2], halfLife: .25, cameraMotion: 'keep',
      budget: { scale: .75, filter: 'linear' },
      blockMemory: { rect, recovery: { groupSize: [2, 2], fps: 4, every: 4 } } }
  ] };
  function slots(index) {
    const raster = (channels, value, Type) => ({ width: w, height: h, channels,
      data: Type.from({ length: w * h * channels }, (_, i) => value(Math.floor(i / channels), i % channels)) });
    return {
      image: raster(4, (p, channel) => [p % w * 9 + index * 12, (p / w | 0) * 10 + index * 14, 90, 255][channel], Uint8Array),
      vectors: index === 1 || index === 2 ? null :
        raster(2, (p, channel) => channel ? (p % w > 6 ? -.625 : 0) : .625, Float32Array),
      hold: raster(1, p => p % w < 7 ? 255 : 0, Uint8Array),
      refresh: raster(1, p => index === 1 && p % w === 3 && (p / w | 0) === 2 ? 255 : 0, Uint8Array)
    };
  }
  return { world, graph, w, h, rect, slots };
}
const blockTimes = [0, .125, .25, .625, 1, 1, .125];

function blockHeadless() {
  const { world, graph, w, h, slots } = blockFixture(kit), history = kit.KIT.renderGraph.history();
  return blockTimes.map((t, index) => {
    const planes = slots(index === 5 ? 4 : index);
    return [...ink.render(world, { w, h, t, px: 1, raw: true, renderGraph: graph,
      renderGraphInputs: planes, renderGraphCapture: ['decoder'], renderHistory: history
    }).renderGraphPasses.decoder.data];
  });
}

test('the screen pass isolates a single feed during holds, group recovery and a rewind', () => {
  const { rect: [x0,y0,width,height], w, h, slots } = blockFixture(kit);
  const actual = blockHeadless();
  for (const [index, frame] of actual.entries()) {
    const clean = [...slots(index === 5 ? 4 : index).image.data];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (x < x0 || x >= x0 + width || y < y0 || y >= y0 + height)
        assert.deepEqual(frame.slice(p,p+4), clean.slice(p,p+4));
    }
  }
  assert.deepEqual(actual[0], [...slots(0).image.data]);
  assert.notDeepEqual(actual[1], [...slots(1).image.data]);
  const refreshed = (1 * w + 2) * 4;
  assert.deepEqual(actual[1].slice(refreshed,refreshed+4), [...slots(1).image.data.slice(refreshed,refreshed+4)]);
  assert.deepEqual(actual[4], actual[5]);
  assert.deepEqual(actual[6], [...slots(6).image.data]);
});

test('WebGL block history matches the CPU for grouped recovery and cropped linear sampling', { skip: !chrome }, () => {
  const actual = runWebGL({ chrome }, blockFixture, (toolkit, build, backend, frames) => {
    const { world, graph, w, h, slots } = build(toolkit);
    const draw = backend(w, h, { raw: true, offscreen: true });
    try {
      return { frames: frames.map((time, index) => Array.from(draw.draw(world, { renderGraph: graph, time,
        renderGraphInputs: slots(index === 5 ? 4 : index), renderGraphCapture: ['decoder'] }).decoder.data)) };
    } finally { draw.close(); }
  }, blockTimes);
  assert.deepEqual(actual.frames, blockHeadless());
});
