const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..');
const { KIT } = ink.load();
const P = KIT.procedural, A = P.sceneGraph, R = P.raster;

const rgba = (width, height, pixels) => ({ width, height, channels: 4, data: Uint8Array.from(pixels.flat()) });
const red = [215, 74, 65, 255], blue = [51, 116, 206, 255], clear = [0, 0, 0, 0];
const pixel = (image, x, y) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
const near = (a, b, epsilon = 1e-5) => assert.ok(Math.abs(a - b) <= epsilon, `${a} ~= ${b}`);
const solid = (width, height) => R.canvas({ width, height, color: red });

function edges(mesh) {
  const counts = new Map();
  for (let i = 0; i < mesh.tri.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = mesh.tri[i + j], b = mesh.tri[i + (j + 1) % 3], key = a < b ? a + ':' + b : b + ':' + a;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()];
}

test('native geometry operations preserve triangle orientation, tags and bounds', () => {
  const box = A.box({ center: [0, .5, 0], half: [1, .5, .3] });
  const mirror = A.transform(box, { position: [2, 0, 0], scale: [-1, 1, 1] });
  assert.deepEqual(KIT.mesh.box(mirror).lo.slice(0, 2), [1, 0]);
  assert.deepEqual([...mirror.tri.slice(0, 3)], [box.tri[0], box.tri[2], box.tri[1]]);
  const tube = A.tube([0, 0, 0], [0, 1, 0], { sides: 6 });
  assert.equal(A.merge([box, tube]).tri.length, box.tri.length + tube.tri.length);
  const clipped = A.clip(box, [{ normal: [1, 0, 0], offset: 0 }], { cap: true });
  assert.equal(KIT.mesh.box(clipped).hi[0], 0);
  assert.ok(clipped.tmat.some(n => clipped.mats[n].name === 'cap'));
  const tri = A.triangulate([[[0, 0], [3, 0], [3, 3], [0, 3]], [[1, 1], [1, 2], [2, 2], [2, 1]]], { z: 2 });
  assert.ok(tri.tri.length > 6);
  assert.equal(KIT.mesh.box(tri).lo[2], 2);
});

test('extruded masks keep holes, colors and separated diagonal shells', () => {
  const ring = rgba(3, 3, [red, red, red, red, clear, blue, blue, blue, blue]);
  const { value, front, bounds, report } = A.extrudeImage(ring, { pixelSize: .5, depth: .25, edgeColor: '#794c35' });
  assert.equal(report.solid, 8);
  assert.ok(edges(value).every(n => n === 2));
  assert.equal(value.mats.length, 3);
  assert.deepEqual(bounds, { min: [-.75, -.75, -.125], max: [.75, .75, .125] });
  assert.equal(front.tri.length / 3, 16);
  assert.equal(KIT.mesh.box(front).lo[2], .125);
  assert.ok(front.uvs.every(n => n >= 0 && n <= 1));
  const diagonal = A.extrudeImage(rgba(2, 2, [red, clear, clear, red]), { depth: 1 });
  assert.equal(diagonal.report.vertices, 16);
  assert.ok(edges(diagonal.value).every(n => n === 2));
  assert.throws(() => A.extrudeImage(rgba(1, 1, [clear])), /No raster cells/);
});

test('slice stacks remove internal faces and keep anisotropic world alignment', () => {
  const slices = [solid(1, 1), solid(1, 1)];
  const volume = A.sliceStack(slices, { pixelSize: [2, 3], spacing: .5, axis: 'x', center: [1, 2, 3] });
  assert.deepEqual(volume.bounds, { min: [.5, .5, 2], max: [1.5, 3.5, 4] });
  assert.equal(volume.report.triangles, 20);
  assert.ok(edges(volume.value).every(n => n === 2));
  assert.throws(() => A.sliceStack([solid(1, 2), solid(2, 1)]), /aligned rasters/);
  const sphere = A.shape('sphere', { center: [1, 2, 3], radius: .8 });
  const sampled = A.sdfSlices(sphere, { width: 16, height: 12, count: 11, axis: 'y' });
  const rebuilt = A.sliceStack(sampled.value, sampled.layout);
  assert.equal(rebuilt.report.slices, 11);
  assert.ok(rebuilt.report.solid > 500);
  assert.ok(edges(rebuilt.value).every(n => n === 2));
  rebuilt.bounds.min.forEach((n, i) => near((n + rebuilt.bounds.max[i]) / 2, [1, 2, 3][i]));
});

test('standalone SDF ray rendering preserves boolean holes and reports depth, normal and projection', () => {
  const shell = A.shape('box', { half: [.72, .62, .26], round: .08 });
  const cut = A.shape('capsule', { radius: .31, rotation: [Math.PI / 2, 0, 0], length: 1.2 });
  const source = A.combineSDF([shell, cut], { operation: 'subtract' });
  assert.ok(source(0, 0, 0) > 0);
  assert.ok(source(.55, 0, 0) < 0);
  const render = camera => A.renderSDF(source, { width: 55, height: 39, camera, transparent: true });
  const camera = A.camera({ dist: 2.5, projection: 'orthographic' });
  const result = render(camera);
  assert.equal(result.report.projection, 'orthographic');
  assert.deepEqual(pixel(result.value, 27, 19), clear);
  const owned = result.frame.passes.depth.findIndex(Number.isFinite);
  assert.ok(owned >= 0 && result.report.hits > 100);
  const normal = result.frame.passes.normal.slice(owned * 3, owned * 3 + 3);
  near(Math.hypot(...normal), 1);
  const exact = ink.graphRenderPass(result.frame, 'depth', { emptyDepth: 9 });
  assert.equal(exact.data.data[owned], result.frame.passes.depth[owned]);
  assert.equal(exact.data.data[19 * 55 + 27], 9);
  assert.equal(exact.valid.data[19 * 55 + 27], 0);
  assert.ok(A.sdfMesh(source, { resolution: .13 }).tri.length > 24);
  assert.notDeepEqual(render(A.camera({ dist: 2.5, yaw: .38 })).value.data, result.value.data);
});

test('native cameras, lights and owned art passes flow through a graph render frame', () => {
  const shot = A.cameraTrack({
    shots: { left: { yaw: -.38, dist: 3.5 }, right: { yaw: .57, dist: 4 } },
    sequence: [{ time: 0, shot: 'left' }, { time: 1, shot: 'right', blend: 1 }]
  }, { time: 2 });
  near(shot.camera.yaw, .57);
  const cube = A.object(A.box(), { id: 'bench', material: 'iron', resolution: .08 });
  const world = A.world([cube], { lights: [A.light('sun', { mapSize: 64 })],
    look: { sdfAssist: { rules: [{ select: { object: 'bench' } }] } } });
  assert.ok(world.renderSdfs?.length);
  const local = A.light('disk', { id: 'window', at: [1, 1, 1], normal: [-1, -1, -1], color: '#ffc67e', visible: false });
  const settings = { camera: shot.camera, options: { width: 49, height: 37 }, channels: ['normal', 'objectId', 'position', 'environment'] };
  const base = ink.renderGraphScene(world, settings), lit = ink.renderGraphScene(world, { ...settings, lights: [local] });
  assert.equal(lit.value.width, 49);
  assert.equal(lit.value.height, 37);
  assert.ok(lit.report.passes.includes('sky'));
  const ids = ink.graphRenderPass(lit.frame, 'objectId');
  assert.ok(ids.report.legend.some(row => row.label === 'bench'));
  assert.ok(ids.data.data.some(n => n > 0));
  const position = ink.graphRenderPass(lit.frame, 'position');
  assert.equal(position.data.channels, 3);
  assert.ok(position.report.range.max[2] > position.report.range.min[2]);
  assert.notDeepEqual(base.value.data, lit.value.data);
  const before = ink.renderGraphScene(world, { ...settings, channels: ['depth'],
    options: { ...settings.options, captureMotion: true, sdfAssist: false } });
  const after = ink.renderGraphScene(world, { ...settings, camera: A.camera({ ...shot.camera, yaw: -.2 }), channels: ['motion'],
    options: { ...settings.options, motionFrom: before.motionReference, sdfAssist: false } });
  assert.ok(ink.graphRenderPass(after.frame, 'motion').data.data.some(n => Math.abs(n) > .25));
});

test('sprite poses inherit parent motion, normalize weights and keep identity pixels', () => {
  const source = rgba(2, 2, [red, blue, blue, clear]);
  const bones = [{ id: 'wrist', parent: 'root', pivot: [1, 1], tip: [2, 1] }, { id: 'root', pivot: [0, 0], tip: [1, 1] }];
  const mesh = { points: [[0, 0], [2, 0], [0, 2], [2, 2]], triangles: [0, 1, 2, 2, 1, 3] };
  const bind = A.bindSprite(source, bones, { mesh, weights: [{ root: 3 }, { root: 4 }, { wrist: 1 }, { wrist: 2, root: 2 }] });
  assert.deepEqual(bind.weights[3], { wrist: .5, root: .5 });
  assert.deepEqual(A.skinSprite(source, bind).value, source);
  const pose = A.spritePose({ root: [{ time: 0, angle: 0 }, { time: 1, angle: Math.PI / 2 }],
    wrist: [{ time: 0, translate: [1, 0] }] }, 1);
  const result = A.skinSprite(source, bind, pose, { width: 4, height: 3 });
  near(result.joints.wrist.pivot[0], -1);
  near(result.joints.wrist.pivot[1], 2);
  near(result.points[3][0], -2);
  near(result.points[3][1], 2.5);
  const auto = A.bindSprite(source, bones, { segments: [3, 3] });
  assert.equal(auto.points.length, 16);
  assert.throws(() => A.bindSprite(source, [{ id: 'a', parent: 'a', pivot: [0, 0] }]), /without cycles/);
  assert.throws(() => A.skinSprite(source, bind, { missing: {} }), /unknown bone/);
});

test('CLI runs stock 3D graph nodes and exports exact pass data plus editable mesh', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-3d-graph-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = (node, port) => ({ node, ...(port && { port }) });
  const spec = {
    format: 'ink-studio/graph-project', version: 1,
    nodes: {
      image: { op: 'raster.canvas', inputs: { width: 10, height: 12, color: red } },
      slab: { op: 'geo.extrudeImage', inputs: { source: link('image'), options: { pixelSize: .11, depth: .28 } } },
      prop: { op: 'scene.object', inputs: { source: link('slab'), options: { cells: 24, resolution: .08 } } },
      records: { op: 'data.record', inputs: { prop: link('prop') } },
      objects: { op: 'data.collect', inputs: { source: link('records'), keys: ['prop'] } },
      world: { op: 'scene.world', inputs: { objects: link('objects') } },
      view: { op: 'scene.camera', inputs: { options: { dist: 3, yaw: .42, projection: 'orthographic' } } },
      render: { op: 'scene.render', inputs: { source: link('world'), camera: link('view'), channels: ['depth', 'normal'],
        options: { width: 45, height: 33, transparent: true } } },
      pass: { op: 'scene.pass', inputs: { frame: link('render', 'frame'), channel: 'depth' } },
      rig: { op: 'rig.bindSprite', inputs: { source: link('image'), bones: [{ id: 'root', pivot: [5, 6] }] } },
      pose: { op: 'rig.pose', inputs: { tracks: { root: [{ time: 0 }, { time: 1, translate: [2, 0] }] } } },
      skin: { op: 'rig.skinSprite', inputs: { source: link('image'), bind: link('rig'), pose: link('pose') } }
    },
    outputs: { color: link('render'), depth: link('pass', 'data'), slab: link('slab'), skin: link('skin') },
    exports: { color: { output: 'color', format: 'png' }, depth: { output: 'depth', format: 'json' },
      slab: { output: 'slab', format: 'json' }, skin: { output: 'skin', format: 'png' } },
    assertions: [{ id: 'width', output: 'color', path: ['width'], op: 'eq', value: 45 }]
  };
  const file = path.join(dir, 'workbench.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = spawnSync(process.execPath, [cli, 'graph', 'run', file, '--at', '1', '--out', dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const depth = JSON.parse(fs.readFileSync(path.join(dir, 'artifacts/depth.json')));
  assert.equal(depth.data.length, 45 * 33);
  assert.ok(depth.data.some(n => n !== 1e9));
  const mesh = JSON.parse(fs.readFileSync(path.join(dir, 'artifacts/slab.json')));
  assert.ok(mesh.tri.length && mesh.pos.length && mesh.uvs.length);
  const skin = require('../cli/png.js').raster(path.join(dir, 'artifacts/skin.png'));
  assert.equal(skin.data[3], 0);
  assert.equal(skin.data[11], 255);
});
