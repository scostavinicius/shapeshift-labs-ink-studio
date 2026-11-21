const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..');
const P = ink.load().KIT.procedural, A = P.animationGraph, S = P.rasterSimulation;
const copy = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' ~= ' + expected);
const art = (width, height, at = -1) => {
  const data = Array(width * height * 4).fill(0);
  if (at >= 0) data.splice(at * 4, 4, 250, 185, 116, 255);
  return { width, height, channels: 4, data };
};
const alpha = (value, x, y = 0) => value.data[(y * value.width + x) * 4 + 3];

test('animation clocks support delay, bounded reverse, pingpong and stagger', () => {
  const opts = { range: [.5, 1.5], delay: .75, rate: 2, reverse: true, mode: 'loop' };
  assert.equal(A.clock(.2, opts).active, false);
  assert.equal(A.clock(.2, opts).value, 1.5);
  close(A.clock(.9, opts).value, 1.2);
  assert.equal(A.clock(1.25, opts).value, 1.5);
  const alternate = A.clock(2.1, { range: [1, 2], delay: .4, mode: 'pingpong' });
  close(alternate.value, 1.3);
  assert.equal(alternate.direction, -1);
  A.stagger(.45, { count: 3, interval: .15 }).value.forEach((t, i) => close(t, [.45, .3, .15][i]));
  A.stagger(.45, { count: 3, interval: .15, reverseOrder: true }).value.forEach((t, i) => close(t, [.15, .3, .45][i]));
  assert.deepEqual([0, .1, .2, .3].map(t => A.frameIndex(8, t,
    { first: 2, end: 5, fps: 10, reverse: true, mode: 'loop' }).index), [4, 3, 2, 4]);
  assert.equal(A.frameIndex(8, .5, { first: 2, end: 5, fps: 10, mode: 'loop' }).index, 4);
  const sample = A.track({ angle: 'radians', p: 'vector' }, [
    { time: 0, value: { angle: 3, p: [0, 4] }, ease: 'linear' },
    { time: 1, value: { angle: -3, p: [2, 6] } }
  ]).sample(.5);
  close(Math.abs(sample.angle), Math.PI);
  assert.deepEqual(sample.p, [1, 5]);
});

const feedbackSettings = { frames: [art(12, 8, 26), art(12, 8, 30), art(12, 8)], fps: 8, halfLife: .4, warp: { velocity: [3, 0] } };
const cases = {
  particles: { emitters: [{ at: [15, 12], life: [1, 1.1], rate: 100, velocity: [18, 14], colors: ['#fee2ad'] }], walls: [[30, 0, 2, 30]] },
  cloth: { columns: 6, rows: 5, at: [4, 5], u: [18, 0], v: [0, 12], pins: [0, { index: 5,
    keys: [{ time: 0, value: [22, 5] }, { time: .6, value: [19, 7] }] }], spheres: [{ at: [15, 20, 0], r: 2 }] },
  strand: { strands: [[[8, 4], [10, 7], [12, 9], [13, 13]], [[20, 6], [22, 8], [24, 10]]] },
  smoke: { emitters: [{ at: [17, 22], density: 8, radius: 4 }], walls: [[0, 12, 12, 3]], pressureIterations: 6 },
  grain: { emitters: [{ at: [18, 4], rate: 380, radius: 3, end: .3 }], walls: [[12, 20, 13, 2]] },
  rigid: { bodies: [{ id: 'tall', at: [21, 15], size: [8, 8], spin: 2 }, { id: 'base', at: [19, 29],
    size: [10, 6], fixed: true }], impulses: [{ tick: 2, body: 'tall', linear: [5, 0], spin: .05 }] },
  flip: { fill: [[3, 3, 12, 17]], walls: [[22, 12, 4, 17]], pressureIterations: 12 },
  feedback: feedbackSettings
};

for (const [kind, settings] of Object.entries(cases)) test(kind + ' replays from exported snapshots and after backward seeks', () => {
  const recipe = S.define(kind, kind === 'feedback' ? settings : { width: 38, height: 34, ...settings }, { seed: 21, dt: .025 });
  const continuous = S.session(recipe, { every: 4, cache: 3 });
  const initial = continuous.seek(0);
  const middle = continuous.seek(.225);
  const direct = continuous.seek(.6);
  const imported = S.session(undefined, { checkpoint: copy(middle.checkpoint) }).seek(.6);
  assert.equal(imported.report.from, 9);
  assert.deepEqual(imported.checkpoint.state, direct.checkpoint.state);
  assert.deepEqual(imported.value, direct.value);
  assert.deepEqual(imported.field, direct.field);
  assert.deepEqual(continuous.seek(.05).value, S.session(recipe).seek(.05).value);
  assert.deepEqual(continuous.seek(.6).value, direct.value);
  assert.ok(continuous.seek(.58).report.cached.length <= 4);
  assert.notDeepEqual(direct.value, initial.value);
});

test('cloth triangle boundaries have continuous coverage at native raster size', () => {
  const recipe = S.define('cloth', { width: 30, height: 30, columns: 7, rows: 7,
    at: [2.5, 2.5], u: [21, 0], v: [0, 21], projection: [0, 0] });
  const frame = S.session(recipe).seek(0).value;
  for (let y = 3; y < 23; y++) for (let x = 3; x < 23; x++) assert.equal(alpha(frame, x, y), 255);
});

test('smoke and sand honor masked cells and retain material after emitters stop', () => {
  const width = 32, height = 26, wall = [0, 12, 17, 2], raster = art(width, height);
  for (let y = wall[1]; y < wall[1] + wall[3]; y++) for (let x = 0; x < wall[2]; x++) raster.data[(y * width + x) * 4 + 3] = 255;
  const smoke = S.session(S.define('smoke', { width, height, mask: raster,
    emitters: [{ at: [10, 20], radius: 4, density: 10 }] }));
  const cloud = smoke.seek(.85);
  assert.ok(cloud.report.mass > 0);
  assert.equal(cloud.field.data[12 * width + 12], 0);
  const sand = S.session(S.define('grain', { width, height, walls: [wall], emitters: [{ at: [10, 5], rate: 600, radius: 4, end: .3 }] }));
  const falling = sand.seek(.32), settled = sand.seek(1.2);
  assert.equal(falling.report.grains, settled.report.grains);
  assert.ok(settled.report.grains > 25);
  assert.equal(settled.field.data[12 * width + 12], 0);
});

test('PIC and FLIP diverge under pressure while preserving particles and reducing velocity divergence', () => {
  const settings = { width: 42, height: 32, fill: [[4, 4, 15, 17]], walls: [[22, 19, 4, 13]],
    pressureIterations: 25, velocity: [24, 0], particlesPerCell: 4 };
  const run = flip => S.session(S.define('flip', { ...settings, flip })).seek(.67);
  const pic = run(0), flip = run(.95);
  assert.equal(flip.report.count, 15 * 17 * 4);
  assert.ok(flip.report.divergenceAfter < flip.report.divergenceBefore * .66);
  assert.notDeepEqual(pic.points, flip.points);
  assert.ok(flip.points.every(({ point: [x, y] }) => x >= 0 && x < 42 && y >= 0 && y < 32 &&
    !(x >= 22 && x < 26 && y >= 19)));
});

test('feedback cuts clear retained pixels and transparent pixels reveal the decay', () => {
  const frames = [art(7, 2, 2), art(7, 2)], settings = { frames, fps: 4, halfLife: .25, filter: 'nearest' };
  const normal = S.session(S.define('feedback', settings, { dt: .25 / 3 }));
  assert.equal(alpha(normal.seek(0).value, 2), 255);
  const alphaAt = alpha(normal.seek(.5).value, 2);
  assert.ok(alphaAt > 0 && alphaAt < 170);
  const cut = S.session(S.define('feedback', { ...settings, cuts: [.49] }, { dt: .25 / 3 }));
  assert.equal(alpha(cut.seek(.5).value, 2), 0);
});

test('shared checkpoint store loads portable raster state for an independent branch', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-flow-blocks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const recipe = S.define('grain', { width: 38, height: 34 }, { seed: 8 });
  const run = S.session(recipe);
  const origin = run.seek(.6);
  const store = ink.openCheckpointStore(dir), { reference } = store.save(origin.checkpoint);
  assert.deepEqual(store.load(reference), origin.checkpoint);
  assert.deepEqual(S.session(undefined, { checkpoint: store.load(reference) }).seek(1).value, run.seek(1).value);
  assert.throws(() => S.session(S.define('grain', { width: 38, height: 34 }, { seed: 5 }), { checkpoint: origin.checkpoint }),
    /does not match/);
});

test('CLI retimes a group and resumes a graph raster checkpoint from an asset', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-animation-graph-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = (node, port) => ({ node, ...(port && { port }) });
  const base = { format: 'ink-studio/graph-project', version: 1, time: .5 };
  const project = { ...base,
    groups: { source: { nodes: {
      recipe: { op: 'sim.define', inputs: { kind: 'grain', settings: { width: 29, height: 24 }, clock: { seed: 20 } } },
      playback: { op: 'sim.run', inputs: { recipe: link('recipe'), options: { every: 4 } } }
    }, outputs: { value: link('playback'), checkpoint: link('playback', 'checkpoint'), report: link('playback', 'report') } } },
    nodes: { take: { op: 'anim.retime', group: 'source', inputs: { timing: { range: [0, 1.25], reverse: true } } } },
    outputs: { image: link('take'), save: link('take', 'checkpoint'), report: link('take', 'report') },
    exports: { image: { output: 'image', format: 'png' }, save: { output: 'save', format: 'json' } },
    assertions: [{ id: 'reverseTick', output: 'report', path: ['tick'], op: 'eq', value: 36 }]
  };
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = (id, spec) => {
    const file = path.join(dir, id + '.json');
    fs.writeFileSync(file, JSON.stringify(spec));
    const result = spawnSync(process.execPath, [cli, 'graph', 'run', file, '--out', path.join(dir, id)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  run('first', project);
  run('branch', { ...base, time: 1, assets: { saved: { format: 'json', file: 'first/artifacts/save.json' } },
    nodes: { load: { op: 'jsonAsset', inputs: { name: 'saved' } }, take: { op: 'sim.run', inputs: { checkpoint: link('load') } } },
    outputs: { image: link('take'), report: link('take', 'report') }, exports: { image: { output: 'image', format: 'png' } },
    assertions: [{ id: 'resumeTick', output: 'report', path: ['from'], op: 'eq', value: 36 }] });
  const png = require('../cli/png.js').raster(path.join(dir, 'branch/artifacts/image.png'));
  const expected = S.session(S.define('grain', { width: 29, height: 24 }, { seed: 20 })).seek(1);
  assert.deepEqual([...png.data], [...expected.value.data]);
});
