const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const PNG = require('../cli/png.js');
const { KIT: K } = studio.load();

const body = { id: 'body', kind: 'box', at: [0, 0, 0], half: [1, .75, .48], res: .08, mat: 'metal' };
const camera = { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0 };
const scene = (solid = body) => ({ id: 'retained-shapes', seed: 4, camera, solids: [solid] });
const editBody = spec => {
  const ed = studio.createSceneEditor(spec);
  ed.select('solid:body');
  return ed;
};
const makeMask = (radius = .5, mode = 'keep') => ({
  id: 'round/crop', kind: 'mask', mode, shape: { kind: 'ball', at: [0, 0, 0], r: radius, mat: 'ember' }
});
const grow = { id: 'grow', kind: 'swell', by: .2 };
const ray = x => ({ origin: [x, 0, 5], direction: [0, 0, -1] });

test('bakes reopen their original modifier stack and survive reorder, bypass, and undo', () => {
  const ed = editBody(scene()), base = ed.build();
  const mask = makeMask(), slot = 'slot:0/modifiers/round~1crop/shape';
  ed.setModifiers([grow, mask]);
  const clipped = ed.build();
  assert(clipped.made.body.sd(.62, 0, 0) > .1);
  assert.equal(ed.pick(ray(.75)), null);
  assert.equal(ed.pick(ray(0)).hit.target.material, 'metal');
  assert.deepEqual(clipped.spec.solids[0].half, body.half);
  assert(clipped.count > 0);

  ed.setModifiers([mask, grow]);
  const expanded = ed.build();
  assert(expanded.made.body.sd(.62, 0, 0) < -.05);
  assert.equal(ed.node(slot).modifier, mask.id);
  ed.updateShape({ r: .35 }, slot);
  const adjusted = ed.build();
  assert(adjusted.made.body.sd(.62, 0, 0) > 0);
  assert(!Buffer.from(adjusted.data.buffer).equals(Buffer.from(expanded.data.buffer)));
  assert.equal(clipped.spec.solids[0].modifiers[1].shape.r, .5);
  assert.equal(expanded.spec.solids[0].modifiers[0].shape.r, .5);

  const reopen = editBody(clipped);
  assert.equal(reopen.snapshot().solids[0].modifiers[1].shape.r, .5);
  assert.deepEqual(reopen.build().data, clipped.data);
  const before = ed.serialize();
  ed.begin('Bypass modifiers');
  ed.updateModifier('round/crop', { enabled: false });
  ed.updateModifier('grow', { enabled: false });
  assert(ed.commit());
  assert.deepEqual(ed.build().data, base.data);
  assert.equal(ed.node(slot).solid.r, .35);
  assert(ed.undo());
  assert.equal(ed.serialize(), before);
  assert.deepEqual(ed.build().data, adjusted.data);
  assert(ed.redo());
  assert.deepEqual(ed.build().data, base.data);
});

test('native boolean operands and mask cutters remain editable in the same tree', () => {
  const shape = { id: 'body', kind: 'join', how: 'cut', a: { ...body, id: 'base' },
    b: { id: 'cutter', kind: 'ball', at: [0, 0, 0], r: .54 } };
  const ed = editBody(scene(shape));
  assert.equal(ed.pick(ray(0)), null);
  const baked = ed.build();
  ed.updateShape({ r: .15 }, 'solid:cutter');
  assert.equal(ed.pick(ray(0)).key, 'solid:body');
  ed.updateShape({ how: 'union' });
  assert(ed.build().made.body.sd(0, 0, 0) < 0);
  assert(K.diorama.build(baked.spec).made.body.sd(0, 0, 0) > 0);

  ed.setModifiers([makeMask(.3, 'cut')]);
  const before = ed.serialize();
  ed.begin('Invalid draft');
  ed.setModifiers([makeMask(), makeMask()]);
  assert.throws(() => ed.preview(), error => error.problems.some(p => p.path === 'solids[0].modifiers[1].id'));
  assert.equal(ed.serialize(), before);
  assert.throws(() => ed.updateModifier('round/crop', { mode: 'blend' }), /modifiers\[0\]\.mode/);
  assert.equal(ed.serialize(), before);
  ed.select('slot:0/modifiers/round~1crop/shape');
  ed.setModifiers([], 'solid:body');
  assert.deepEqual(ed.selection(), []);
  assert(ed.undo());
  assert.deepEqual(ed.selection(), ['slot:0/modifiers/round~1crop/shape']);
  assert.throws(() => studio.createSceneEditor({ data: new Float32Array(), count: 0 }), /no retained diorama source/);
});

test('procedural masks and joins apply to recipe geometry before the world transform', () => {
  const flight = { id: 'body', kind: 'stairs', at: [0, 0, 0], dir: [1, 0, 0], rise: .6, res: .1, mat: 'stone',
    transform: { translation: [2, 0, 0] } };
  const ed = editBody(scene(flight));
  const original = ed.build();
  ed.setModifiers([{ id: 'side', kind: 'mask', mode: 'keep', shape: {
    kind: 'box', at: [.38, .3, -.4], half: [.55, .6, .28]
  } }, { id: 'stretch', kind: 'warp', taper: [.9, 1.3] }, {
    id: 'union', kind: 'join', how: 'union', shape: { kind: 'ball', at: [0, .5, -.45], r: .2 }
  }]);
  const edited = ed.build();
  assert(edited.count > 0);
  assert.notEqual(edited.count, original.count);
  assert(edited.made.body.sd(2, .5, -.45) < -.1);
  assert(edited.made.body.sd(0, .5, -.45) > .2);
  assert(Array.from(edited.renderMetadata.objectIds).every(i => edited.renderMetadata.objects[i] === 'body'));
});

test('scene JSON rebakes through CLI with a mesh operand and retained disabled operations', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-retained-shapes-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const obj = [
    'v -1 -1 -1', 'v 1 -1 -1', 'v 0 1 -1', 'v 0 0 1',
    'f 3 2 1', 'f 1 2 4', 'f 2 3 4', 'f 3 1 4'
  ].join('\n');
  const ed = studio.createSceneEditor(scene(), { env: { assets: { tetra: K.mesh.obj(obj) } } });
  ed.select('solid:body');
  ed.setModifiers([{
    id: 'mesh', kind: 'mask', mode: 'keep', shape: { kind: 'mesh', asset: 'tetra', size: 1, cells: 24 }
  }, { ...grow, enabled: false }]);
  fs.writeFileSync(path.join(folder, 'tetra.obj'), obj);
  const input = path.join(folder, 'edited.json'), output = path.join(folder, 'edited.png');
  fs.writeFileSync(input, ed.serialize());
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe' });
  run('validate', input);
  run('render', input, '--w', '96', '--h', '64', '--px', '1', '--ortho', '--out', output);
  const previous = PNG.read(output).rgb;
  ed.updateModifier('mesh', { enabled: false });
  fs.writeFileSync(input, ed.serialize());
  run('render', input, '--w', '96', '--h', '64', '--px', '1', '--ortho', '--out', output);
  assert(!Buffer.from(PNG.read(output).rgb).equals(Buffer.from(previous)));
  assert.deepEqual(K.diorama.build(scene()).data, ed.build().data);
});
