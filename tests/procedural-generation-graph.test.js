const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..');
const { KIT } = ink.load();
const P = KIT.procedural, G = P.generator;
const plane = (width, height, data) => ({ width, height, channels: 1, data });
const solid = (color, width = 1, height = 1) => P.raster.canvas({ width, height, color });
const alphaCount = ({ data }) => data.reduce((sum, value, index) => sum + +(index % 4 === 3 && value > 0), 0);
const red = [255, 0, 0, 255], blue = [0, 0, 255, 255];

test('seeded fields preserve spatial periods and sample moving patterns on XYZ planes', () => {
  const definition = { type: 'periodic', axes: ['x', 'z'], period: [3, null, 2], scale: .5 };
  const a = G.noise(definition, { seed: 12 }), b = G.noise(definition, { seed: 13 });
  assert.ok(Math.abs(a(.31, 0, .92) - a(3.31, 0, 2.92)) < 1e-12);
  assert.notEqual(a(.31, 0, .92), b(.31, 0, .92));
  const pattern = G.pattern({ kind: 'checker', size: 1, axes: 'xz', velocity: [1, 0] });
  const grid = { width: 2, height: 2, u: [2, 0, 0], v: [0, 0, 2] };
  assert.deepEqual([...G.sample(pattern, grid).data], [0, 1, 1, 0]);
  assert.deepEqual([...G.sample(pattern, { ...grid, time: 1 }).data], [1, 0, 0, 1]);
  assert.deepEqual([...G.sample({ sample: x => ({ value: x }) }, { width: 2, height: 1 }).data], [.25, .75]);
  assert.throws(() => G.sample(() => NaN, grid), /scalar field/);
});

test('plain repeat keeps scalar precision and socket tiling stitches named RGBA cells', () => {
  const source = plane(2, 1, Float64Array.of(-.25, 1.5));
  assert.deepEqual([...G.repeat(source, { width: 5, height: 1, offset: [-1, 0] }).data], [1.5, -.25, 1.5, -.25, 1.5]);
  assert.deepEqual([...G.repeat(source, { width: 4, height: 1, scale: [2, 1] }).data], [-.25, -.25, 1.5, 1.5]);
  const definitions = [{ id: 'left', sockets: { east: 'join' } }, { id: 'right', sockets: { west: 'join' } }];
  const layout = G.tiles(definitions, { width: 2, height: 1, pins: [{ x: 0, z: 0, tile: 'left' }] });
  assert.deepEqual(layout.tiles, ['left', 'right']);
  assert.deepEqual([...G.tileImage(layout, { left: solid(red), right: solid(blue) }).data], [...red, ...blue]);
  const masked = G.tiles(definitions, { width: 2, height: 1, mask: () => false });
  assert.equal(alphaCount(G.tileImage(masked, { left: solid(red) })), 0);
  const wang = [{ id: 'a' }, { id: 'b' }];
  const first = G.tiles(wang, { mode: 'wang', labels: [null], width: 4, height: 1, origin: [-2, 3] });
  const second = G.tiles(wang, { mode: 'wang', labels: [null], width: 4, height: 1, origin: [0, 3] });
  assert.deepEqual(first.tiles.slice(2), second.tiles.slice(0, 2));
});

test('scatter honors continuous and raster masks and returns reproducible spaced points', () => {
  const options = { radius: .11, seed: 444, mask: plane(2, 1, [0, 1]), reseed: 5 };
  const a = G.scatter(options), b = G.scatter(options);
  assert.deepEqual(a, b);
  assert.ok(a.value.length > 6);
  for (const [i, point] of a.value.entries()) {
    assert.ok(point[0] >= .5);
    for (const other of a.value.slice(0, i)) assert.ok(Math.hypot(point[0] - other[0], point[1] - other[1]) >= .11 - 1e-10);
  }
  const mask = (_x, _y, z, time) => z - time;
  const cloud = G.scatter({ bounds: { min: [0, 0, 0], max: [1, 1, 1] }, radius: .18, mask, time: .6 });
  assert.ok(cloud.value.length > 1);
  assert.ok(cloud.value.every(p => p.length === 3 && p[2] > .6));
});

test('paths keep their shape and close explicitly, and cables retain their 3D endpoints and sag', () => {
  const vertices = [[0, 0], [1, 1], [3, 0]];
  const smooth = G.path(vertices, { steps: 4 });
  assert.deepEqual(smooth.points[4], vertices[1]);
  const loop = G.path(vertices, { mode: 'linear', closed: true, samples: 9 });
  assert.equal(loop.value.closed, true);
  assert.equal(loop.points.length, 9);
  assert.deepEqual(loop.points[0], vertices[0]);
  assert.notDeepEqual(loop.points.at(-1), vertices[0]);
  const cable = G.cable([-2, 1, 0], [2, 1, 0], { sag: .6, segments: 6 });
  assert.deepEqual(cable.path[0], [-2, 1, 0]);
  assert.deepEqual(cable.path.at(-1), [2, 1, 0]);
  assert.ok(Math.abs(cable.path[3][1] - .4) < 1e-8);
  assert.ok(cable.length > 4 && alphaCount(cable.value) > 0);
});

test('Gray–Scott exposes the native U and V channels, respects masks and seeks by step count', () => {
  const width = 15, height = 11, spot = 5 * width + 7;
  const mask = plane(width, height, Array.from({ length: width * height }, (_, i) => +(i % width >= 6)));
  const options = { width, height, mask, spots: [spot], seed: 14, wrap: true };
  const initial = G.reaction({ ...options, steps: 0 });
  const result = G.reaction({ ...options, steps: 15 });
  assert.ok(initial.value.data[spot] > 0);
  assert.notDeepEqual(result.value.data, initial.value.data);
  assert.deepEqual(result, G.reaction({ ...options, steps: 15 }));
  assert.equal(result.u.data[0], 1);
  assert.equal(result.value.data[0], 0);
  assert.equal(result.report.steps, 15);
});

test('effect recipes seek deterministically and produce usable native scene descriptors', () => {
  for (const [method, options] of [['rain', {}], ['rain', { preset: 'snow' }], ['sparks', {}],
    ['plume', {}], ['plume', { preset: 'steam' }], ['plume', { preset: 'spray' }], ['plume', { preset: 'fog' }]]) {
    const args = { ...options, width: 72, height: 64, time: 1.65, seed: 29 };
    const result = G[method](args);
    assert.ok(alphaCount(result.value) > 0, options.preset ?? method);
    assert.notDeepEqual(G[method]({ ...args, time: .24 }).value.data, result.value.data);
    assert.deepEqual(G[method](args), result);
    if (result.recipe)
      assert.doesNotThrow(() => KIT.atmosphere.emitters.compile(JSON.parse(JSON.stringify(result.recipe))).frame(1.65));
  }
  const mask = solid([0, 0, 0, 0], 30, 20);
  assert.equal(alphaCount(G.rain({ width: 30, height: 20, mask }).value), 0);
  assert.equal(G.sparks({ start: 1, time: 0 }).particles.length, 0);
  const tree = G.tree({ species: 'broadleaf', seed: 46 });
  assert.ok(tree.leaves.length > 3 && alphaCount(tree.value) > 0);
  assert.ok(tree.branches.some(({ pts }) => pts[1][2] !== 0));
  assert.deepEqual(G.tree({ species: 'bare' }).leaves, []);
});

test('parallax moves distant and near layers independently and exports valid native band art', () => {
  const source = { width: 3, height: 1, channels: 4, data: Uint8Array.from([...red, ...blue, ...red]) };
  const still = G.parallax([{ source, factor: 0, repeat: 'x' }], { width: 3, height: 1, camera: [1, 0] });
  const moving = G.parallax([{ source, factor: 1, repeat: 'x' }], { width: 3, height: 1, camera: [1, 0] });
  assert.deepEqual(still, source);
  assert.deepEqual([...moving.data.slice(0, 4)], blue);
  const band = G.horizon([{ source, id: 'distant', radius: 20, height: [-1, 1] }]);
  const paint = KIT.horizonBands.compile(JSON.parse(JSON.stringify(band))).frame({ eye: [0, 0, 0], yaw: 0, pitch: 0, distance: 2 });
  assert.deepEqual(paint([0, 0, 1], [0, 0, 0]), [1, 0, 0]);
});

test('CLI graph samples a keyed procedural field and exports a raster and a recipe', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-procedural-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const n = (node, port) => ({ node, ...(port ? { port } : {}) }), file = path.join(dir, 'generators.json');
  fs.writeFileSync(file, JSON.stringify({
    format: 'ink-studio/graph-project', version: 1,
    nodes: {
      field: { op: 'proc.pattern', inputs: { options: { size: 1, velocity: [1, 0] } } },
      sample: { op: 'proc.sample', inputs: { source: n('field'), options: { width: 2, height: 2, u: [2, 0, 0], v: [0, 2, 0] } } },
      color: { op: 'color.gradient', inputs: { source: n('sample'), ramp: ['#ff0000', '#0000ff'], options: { channel: 0, range: [0, 1] } } },
      smoke: { op: 'proc.plume', inputs: { options: { width: 16, height: 20 } } },
      grow: { op: 'proc.reaction', inputs: { steps: { keys: [{ time: 0, value: 0, ease: 'step' }, { time: 1, value: 10 }] },
        options: { width: 8, height: 8 } } }
    },
    outputs: { image: n('color'), smoke: n('smoke', 'recipe'), growth: n('grow', 'report') },
    exports: { image: { output: 'image', format: 'png' }, smoke: { output: 'smoke', format: 'json' } }
  }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = spawnSync(process.execPath, [cli, 'graph', 'run', file, '--at', '1', '--out', dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const image = require('../cli/png.js').raster(path.join(dir, 'artifacts/image.png'));
  assert.deepEqual([...image.data], [...blue, ...red, ...red, ...blue]);
  const recipe = JSON.parse(fs.readFileSync(path.join(dir, 'artifacts/smoke.json'), 'utf8'));
  assert.equal(recipe.emitters[0].preset, 'smoke');
});
