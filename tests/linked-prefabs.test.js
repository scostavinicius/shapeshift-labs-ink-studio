const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const studio = require('..');
const PNG = require('../cli/png.js');
const { KIT: K } = studio.load(), W = K.world;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const blank = { id: 'visual-scenes', solids: [], camera: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0 } };
const near = (actual, expected) => assert(K.V.dist(actual, expected) < 1e-6, JSON.stringify({ actual, expected }));
const edit = (path, value) => ({ op: 'set', path, value });

function visual(revision, r, mat, speed, strength) {
  return { revision,
    solids: { panel: { kind: 'box', at: [.15, 0, 0], half: [r, .17, .19], mat, part: 'vane', res: .09 },
      post: { kind: 'ball', at: [-.4, 0, 0], r: .12, mat, res: .08 } },
    parts: { vane: { joint: [.15, 0, 0] } },
    motion: { spin: { do: 'spin', part: 'vane', speed } },
    effects: { lamp: { do: 'lamp', at: [0, .5, .4], strength, follow: 'vane' } }
  };
}

test('visual prefab instances inherit shared defaults while retaining scene-local material, motion, and behavior', () => {
  const v1 = visual(1, .25, 'stone', 1, .75), v2 = visual(2, .42, 'ember', 3, 1.4);
  const env = { prefabs: { vane: v1 } };
  const north = studio.createSceneEditor({ ...blank, prefabLibrary: 'library.json' }, { env });
  north.setPrefabInstance('north', {
    prefab: 'vane', transform: { translation: [1, .15, 0], rotation: [0, 0, Math.PI / 2] },
    overrides: [edit('/solids/panel/mat', 'stone'), edit('/solids/panel/transform', { translation: [.1, 0, 0], scale: 1.25 }),
      edit('/motion/spin/speed', .4), edit('/effects/lamp/strength', .75)]
  });
  const south = studio.createSceneEditor({ ...blank, id: 'south', prefabLibrary: 'library.json',
    instances: { south: { prefab: 'vane', transform: { translation: [-1, 0, 0] } } } }, { env });
  const before = north.serialize(), old = north.build();
  assert.equal(north.node('prefab:north').revision, 1);
  assert.equal(old.spec.instances.north.prefab, 'vane');
  const latest = { prefabs: { vane: v2 } };
  const renewed = studio.createSceneEditor(old, { env: latest });
  const northData = K.authoring.scenePrefabs.expand(renewed.snapshot(), latest).spec;
  const southData = K.authoring.scenePrefabs.expand(south.snapshot(), latest).spec;
  assert.equal(renewed.node('prefab:north').revision, 2);
  assert.deepEqual(northData.solids.map(solid => solid.mat), ['stone', 'ember']);
  assert.deepEqual(southData.solids.map(solid => solid.mat), ['ember', 'ember']);
  assert.equal(northData.solids[0].half[0], .42);
  near(northData.parts['north.vane'].joint, [1, .3, 0]);
  near(northData.motion[0].axis, [-1, 0, 0]);
  assert.equal(northData.motion[0].speed, .4);
  assert.equal(southData.motion[0].speed, 3);
  assert.equal(northData.effects[0].strength, .75);
  assert.equal(southData.effects[0].strength, 1.4);
  assert.equal(northData.effects[0].follow, 'north.vane');
  const updated = renewed.build();
  near(updated.made['north.panel'].bc, [1, .4, 0]);
  assert.deepEqual(renewed.selectRay({ origin: [1, .4, 3], direction: [0, 0, -1] }).hit.target.prefabs, ['vane']);
  assert.equal(north.serialize(), before);
  assert.equal(renewed.serialize(), before);
  north.refreshPrefabs(latest.prefabs);
  assert.equal(north.node('prefab:north').revision, 2);
  assert.equal(north.serialize(), before);
  const retired = { prefabs: { vane: { ...v2, solids: { post: v2.solids.post } } } };
  assert.throws(() => studio.createSceneEditor(old, { env: retired }), /Override refers to missing solids\/panel/);
  assert.throws(() => north.refreshPrefabs(retired.prefabs), /Override refers to missing solids\/panel/);
  assert.equal(north.node('prefab:north').revision, 2);
});

function simulationDefinition(revision) {
  return { revision, params: { duration: revision * 3 },
    entities: { panel: { position: [0, revision, 0], visual: {
      material: revision === 1 ? 'stone' : 'metal', half: [.2 * revision, .3, .4] } } },
    systems: { clock: { kind: 'control', config: { op: 'timer', ticks: { $param: 'duration' } } } } };
}
function simulation(id) {
  const def = simulationDefinition(1);
  return W.stamp(W.manifest({ id, prefabs: { gate: def, pinned: def } }), 'gate', 'a', {
    position: [3, 0, 2],
    overrides: [edit('/entities/a.panel/position', [.6, 1, 0]),
      { op: 'merge', path: '/entities/a.panel/visual', value: { material: 'stone' } },
      edit('/systems/a.clock/config/ticks', 3)]
  }).world;
}

test('one simulation release updates all linked assemblies and preserves checkpoint state and explicit overrides', () => {
  const a = W.stamp(simulation('alpha'), 'pinned', 'hold').world;
  const b = W.stamp(simulation('beta'), 'gate', 'b').world;
  const run = W.runtime.create(b);
  run.advance(2);
  const checkpoint = run.checkpoint(), release = { id: 'gate', definition: simulationDefinition(2) };
  const result = W.syncPrefab([{ world: a }, { world: checkpoint.world, checkpoint }], release);
  assert.equal(result.report.ok, true, JSON.stringify(result.report));
  assert.deepEqual(result.report.scenes.map(s => s.status), ['updated', 'updated']);
  for (const { world } of result.scenes) {
    assert.deepEqual(world.entities.a.position, [3, 0, 2]);
    assert.deepEqual(world.entities['a.panel'].position, [.6, 1, 0]);
    assert.equal(world.entities['a.panel'].visual.material, 'stone');
    assert.deepEqual(world.entities['a.panel'].visual.half, [.4, .3, .4]);
    assert.equal(world.systems['a.clock'].config.ticks, 3);
  }
  assert.equal(result.scenes[0].world.entities.hold.revision, 1);
  const updated = result.scenes[1];
  assert.equal(updated.checkpoint.tick, 2);
  assert.deepEqual(updated.checkpoint.states, checkpoint.states);
  assert.equal(updated.world.entities['b.panel'].visual.material, 'metal');
  assert.deepEqual(updated.world.entities['b.panel'].position, [0, 2, 0]);
  const resumed = W.runtime.create(updated.world, { checkpoint: updated.checkpoint });
  resumed.advance(3);
  assert.equal(resumed.checkpoint().tick, 3);
  const again = W.syncPrefab(result.scenes, release);
  assert(again.report.ok && again.report.scenes.every(s => s.status === 'unchanged'));
  assert.equal(a.entities.a.revision, 1);
});

test('explicit nested mappings still migrate individual coordinates of a placed override', () => {
  const release = { id: 'gate', definition: simulationDefinition(2),
    migration: { overridePaths: { '/entities/panel/position/0': '/entities/panel/position/2' } } };
  const result = W.syncPrefab([{ world: simulation('axis-mapping') }], release);
  assert.equal(result.report.ok, true, JSON.stringify(result.report));
  assert.deepEqual(result.scenes[0].world.entities['a.panel'].position, [0, 2, .6]);
});

test('a retired overridden member blocks publishing the entire simulation batch', () => {
  const bad = simulation('blocked');
  const good = W.stamp(W.manifest({ id: 'good', prefabs: { gate: simulationDefinition(1) } }), 'gate', 'new').world;
  const release = { id: 'gate', definition: { ...simulationDefinition(2), entities: {} } };
  const result = W.syncPrefab([{ world: good }, { world: bad }], release);
  assert.equal(result.report.ok, false);
  assert.equal(result.scenes, undefined);
  assert.equal(result.report.scenes[1].status, 'blocked');
  assert(result.report.scenes[1].instances[0].issues.some(i => i.kind === 'override'));
  assert.equal(good.entities.new.revision, 1);
});

test('two CLI dioramas read updates from the same visual prefab file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-visual-prefabs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const library = path.join(root, 'library.json');
  fs.writeFileSync(path.join(root, 'tetra.obj'),
    ['v -1 -1 -1', 'v 1 -1 -1', 'v 0 1 -1', 'v 0 0 1', 'f 3 2 1', 'f 1 2 4', 'f 2 3 4', 'f 3 1 4'].join('\n'));
  const def = (revision, r) => ({ orb: { revision, solids: {
    body: { kind: 'ball', at: [0, 0, 0], r, mat: 'metal' },
    foot: { kind: 'mesh', asset: 'tetra', at: [0, -.65, 0], size: .26, cells: 16, mat: 'dark' }
  } } });
  fs.writeFileSync(library, JSON.stringify(def(1, .31)));
  const scenes = ['left', 'right'].map((id, i) => {
    const dir = path.join(root, id);
    fs.mkdirSync(dir);
    const file = path.join(dir, id + '.json'), output = path.join(dir, 'preview.png');
    const source = JSON.stringify({ ...blank, id, prefabLibrary: '../library.json', instances: {
      orb: { prefab: 'orb', transform: { translation: [i ? .45 : -.45, 0, 0] },
        overrides: [edit('/solids/body/mat', i ? 'accent' : 'stone')] }
    } });
    fs.writeFileSync(file, source);
    function render() {
      execFileSync(process.execPath, [cli, 'render', file, '--w', '96', '--h', '64', '--px', '1', '--ortho', '--out', output], { stdio: 'pipe' });
      return Buffer.from(PNG.read(output).rgb);
    }
    return { file, source, render, before: render() };
  });
  fs.writeFileSync(library, JSON.stringify(def(2, .64)));
  for (const { file, source, render, before } of scenes) {
    assert(!render().equals(before));
    assert.equal(fs.readFileSync(file, 'utf8'), source);
  }
});

test('CLI publishes a validated world batch to a new directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-sync-prefabs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const release = path.join(root, 'release.json'), out = path.join(root, 'out');
  const sources = ['one', 'two'].map(id => {
    const file = path.join(root, id + '.json');
    fs.writeFileSync(file, JSON.stringify(simulation(id)));
    return file;
  });
  const run = (...args) => JSON.parse(execFileSync(process.execPath,
    [cli, 'scene', 'sync-prefab', release, ...sources, '--json', ...args], { encoding: 'utf8' }));
  fs.writeFileSync(release, JSON.stringify({ id: 'gate', definition: simulationDefinition(2) }));
  assert(run('--dry-run').ok);
  assert(!fs.existsSync(out));
  assert(run('--out', out).ok);
  for (const file of sources) {
    assert.equal(JSON.parse(fs.readFileSync(file)).entities.a.revision, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, path.basename(file)))).entities.a.revision, 2);
  }
  fs.writeFileSync(release, JSON.stringify({ id: 'gate', definition: { ...simulationDefinition(2), entities: {} } }));
  const blocked = path.join(root, 'blocked');
  const failed = spawnSync(process.execPath,
    [cli, 'scene', 'sync-prefab', release, ...sources, '--out', blocked, '--json'], { encoding: 'utf8' });
  assert.equal(failed.status, 2, failed.stderr);
  assert(!fs.existsSync(blocked));
});
