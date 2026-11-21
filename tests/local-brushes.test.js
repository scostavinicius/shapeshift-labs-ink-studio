const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const PNG = require('../cli/png.js');
const runWebGL = require('../cli/look-webgl.js');

function scene() {
  return { id: 'local-brushes', seed: 3, camera: { target: [0, .1, 0], dist: 9, yaw: 0, pitch: .6 },
    solids: [
      { id: 'floor', kind: 'box', at: [0, 0, 0], half: [5.7, .28, 3.4], mat: 'stone', res: .16 },
      { id: 'backdrop', kind: 'ball', at: [-2.8, .85, -1.9], r: .25, mat: 'metal' }
    ] };
}
const region = { bounds: { min: [-4, -1, -3], max: [4, 2, 3] }, solids: ['floor'], cell: .2, chunkCells: 5 };
const ray = (x, z) => ({ origin: [x, 5, z], direction: [0, -1, 0] });
const stamp = (id, mode, point, radius, extra) => ({ id, mode, points: [point], radius, ...extra });
const samePacked = (a, b) => Buffer.from(a.data.buffer, a.data.byteOffset, a.data.byteLength)
  .equals(Buffer.from(b.data.buffer, b.data.byteOffset, b.data.byteLength));

test('sculpt and erase rebuild only local chunks while paint retains the sampled surface', () => {
  const editor = studio.createSceneEditor(scene());
  const outside = editor.pick(ray(5, 0)).hit.point;
  editor.setBrushRegion(region);
  const base = editor.build(), far = base.brushRegion.chunks.get('-20/-5/-15');
  assert.equal(editor.pick(ray(5, 0)).key, 'solid:floor');
  assert.deepEqual(editor.pick(ray(5, 0)).hit.point, outside);
  assert.equal(editor.pick(ray(-2.8, -1.9)).key, 'solid:backdrop');

  const sculpt = editor.applyBrush({ id: 'ridge', mode: 'sculpt', radius: .46, material: 'moss',
    points: [[.1, .35, 0], [.9, .35, 0]] });
  const work = sculpt.brushRegion.work;
  assert(work.sampled.length > 0 && work.reused > work.sampled.length);
  assert.equal(sculpt.brushRegion.chunks.get('-20/-5/-15'), far);
  assert(sculpt.splatIds.some(id => typeof id === 'string' && id.startsWith('brush-surface:')));
  assert(editor.pick(ray(.6, 0)).hit.point[1] > .65);

  const painted = editor.applyBrush(stamp('pale-ridge', 'paint', [.6, .76, 0], .32, { material: 'pale' }));
  assert(painted.brushRegion.work.rebuilt.length > 0);
  assert.equal(painted.brushRegion.work.sampled.length, 0);
  assert.equal(painted.brushRegion.chunks.get('-20/-5/-15'), far);
  assert.deepEqual(painted.splatIds, sculpt.splatIds);
  assert.equal(editor.pick(ray(.6, 0)).hit.target.material, 'pale');

  const erased = editor.applyBrush(stamp('hole', 'erase', [-1.5, 0, 1.4], .72));
  assert(erased.brushRegion.work.sampled.length > 0);
  assert(erased.brushRegion.work.reused > erased.brushRegion.work.sampled.length);
  assert.equal(editor.pick(ray(-1.5, 1.4)), null);
  assert.equal(erased.brushRegion.chunks.get('-20/-5/-15'), far);
  assert.deepEqual(editor.pick(ray(5, 0)).hit.point, outside);
  assert(editor.undo());
  assert(samePacked(editor.build(), painted));
  assert(editor.redo());
  assert(samePacked(editor.build(), erased));
});

test('place and scatter produce stable stamped objects and deterministic rebakes', () => {
  const editor = studio.createSceneEditor({ ...scene(), brushRegion: region });
  editor.build();
  editor.begin('Stamp set');
  const placed = editor.applyBrush(stamp('marker', 'place', [2.5, 1.3, 0], .32, { shape: 'box', material: 'ember' }));
  assert(placed.brushRegion.work.sampled.length > 0);
  const marker = editor.selectRay(ray(2.5, 0));
  assert.equal(marker.key, 'stroke:marker');
  assert.equal(marker.hit.target.object, 'brush:["marker",0]');
  assert.equal(editor.node(marker.key).stroke.mode, 'place');
  const scattered = editor.applyBrush(stamp('seeds', 'scatter', [2.4, .9, -1.6], .71,
    { count: 10, size: .19, shape: 'ball', material: 'accent', seed: 31 }));
  assert(scattered.renderMetadata.objects.some(id => id?.startsWith('brush:["seeds",')));
  assert(editor.commit());
  const result = studio.createSceneEditor(scattered).build();
  assert(samePacked(result, scattered));
  assert.deepEqual(result.splatIds, scattered.splatIds);
  assert.equal(editor.history().undo.at(-1), 'Stamp set');
  assert(editor.undo());
  assert.equal(editor.snapshot().brushRegion.strokes, undefined);

  const before = editor.serialize();
  assert.throws(() => editor.applyBrush(stamp('bad', 'paint', [0, 0, 0], .2, { material: 'undefined-role' })), /Unknown brush material/);
  assert.equal(editor.serialize(), before);
  assert.throws(() => editor.applyBrush(stamp('outside', 'erase', [60, 50, 60], 1)), /touch the selected region/);
  assert.equal(editor.serialize(), before);
});

test('the normal CLI validates and renders saved brush strokes', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-local-brushes-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const editor = studio.createSceneEditor({ ...scene(), brushRegion: region });
  const source = path.join(folder, 'scene.json'), png = path.join(folder, 'frame.png');
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe' });
  function render() {
    fs.writeFileSync(source, editor.serialize());
    run('render', source, '--w', '96', '--h', '64', '--px', '1', '--ortho', '--out', png);
    return Buffer.from(PNG.read(png).rgb);
  }
  const before = render();
  editor.applyBrush(stamp('visible-cut', 'erase', [.6, .03, .7], 1.15));
  fs.writeFileSync(source, editor.serialize());
  run('validate', source);
  assert(!render().equals(before));
});

test('WebGL draws and picks a locally rebuilt brush result', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({}, scene, (kit, source, backend, region) => {
    const editor = kit.KIT.authoring.sceneEditor.create({ ...source(), brushRegion: region });
    const draw = backend(96, 64, { raw: true, camera: { ortho: true } });
    try {
      draw.draw(editor.build());
      const initial = draw.image();
      const world = editor.applyBrush({ id: 'lift', mode: 'sculpt', radius: .47, material: 'moss', points: [[1, .42, 0]] });
      draw.draw(world);
      const pick = draw.pick(world, { origin: [1, 5, 0], direction: [0, -1, 0] });
      return { changed: initial !== draw.image(), material: pick.dominant?.target.material,
        touched: world.brushRegion.work.sampled.length, reused: world.brushRegion.work.reused };
    } finally {
      draw.close();
    }
  }, region);
  assert.equal(result.changed, true);
  assert.equal(result.material, 'moss');
  assert(result.touched > 0 && result.reused > result.touched);
});
