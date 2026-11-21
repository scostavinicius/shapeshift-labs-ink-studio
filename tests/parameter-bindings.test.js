const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const PNG = require('../cli/png.js');
const kit = studio.load(), K = kit.KIT, W = K.world;
const ref = name => ({ source: 'parameter', name });
const attach = (path, parameter) => ({ path, parameter });

function diorama() {
  return { id: 'shared-controls', camera: { target: [0, .3, 0], yaw: 0, pitch: 0, dist: 5 },
    solids: [{ id: 'panel', kind: 'box', at: [0, 0, 0], half: [.55, .35, .25], part: 'panel', mat: 'stone', res: .09 }],
    motion: [{ do: 'bob', part: 'panel', period: 4 }],
    effects: [{ do: 'lamp', at: [0, 0, 2], r: 3, strength: 0 },
      { do: 'sparks', at: [0, 0, 1], every: .05, n: 0 }],
    parameterBindings: {
      controls: { hue: 'stone', gain: 1 },
      values: {
        heat: { source: 'signal', port: 'heater/value', fallback: 0 },
        response: { op: 'multiply', args: [{ source: 'parameter', name: 'heat' }, { source: 'control', name: 'gain' }] },
        emission: { op: 'multiply', args: [{ source: 'parameter', name: 'response' }, 10] },
        reach: { source: 'time', fallback: 3, keys: [[0, 3], [1, 4]] }
      },
      bindings: [
        { path: '/solids/0/mat', parameter: 'hue' },
        { path: '/motion/0/amount', parameter: 'response' },
        { path: '/effects/0/strength', parameter: 'response' },
        { path: '/effects/0/r', parameter: 'reach' },
        { path: '/effects/1/n', parameter: 'emission' }
      ]
    } };
}

test('the shared program resolves expressions once against typed controls and one query snapshot', () => {
  const query = [], made = [];
  const field = { source: 'field', field: 'conditions/site', target: [1, 2, 3] };
  const definition = { controls: { scale: 2 }, values: {
    temp: { ...field, path: ['temperature'], fallback: .2, keys: [[0, 0], [100, 1]] },
    wet: { ...field, path: ['wet'], fallback: false },
    enabled: { source: 'signal', port: 'heater/value', fallback: 0, keys: [[0, 0], [1, 1]] },
    mixed: { op: 'multiply', args: [ref('temp'), ref('scale')] }
  }, bindings: [attach('/lamp/strength', 'mixed'), attach('/motion/amount', 'mixed'), attach('/lamp/on', 'enabled')] };
  const program = K.parameters.prepare(definition);
  const base = { lamp: { strength: 0, on: 0 }, motion: { amount: 0 } };
  const { document, values } = program.apply(base, { controls: { scale: 4 }, query: () => {
    made.push(true);
    return { probe(field, target, args) {
      query.push([field, target, args]);
      return field === 'world/signal' ? { status: 'ok', value: true } :
        { status: 'ok', value: { temperature: 25, wet: true } };
    } };
  } });
  assert.equal(made.length, 1);
  assert.equal(query.length, 2);
  assert.deepEqual(document, { lamp: { strength: 1, on: 1 }, motion: { amount: 1 } });
  assert.deepEqual(values, { scale: 4, temp: .25, wet: true, enabled: 1, mixed: 1 });
  assert.deepEqual(base, { lamp: { strength: 0, on: 0 }, motion: { amount: 0 } });
  assert.equal(program.sample().mixed, .4);
  assert.throws(() => K.parameters.prepare({ values: { a: ref('b'), b: ref('a') } }), /Cyclic parameter/);
  assert.throws(() => program.sample({ controls: { scale: 'four' } }), /incompatible value/);
  assert.throws(() => K.parameters.prepare({ ...definition, bindings: [definition.bindings[0], definition.bindings[0]] }), /Duplicate parameter binding/);
});

test('a diorama shares live rig, lamp, and particle values while retaining baked material controls', () => {
  const original = diorama(), editor = studio.createSceneEditor(original);
  const world = editor.build({ controls: { hue: 'moss' } });
  assert(world.renderMetadata.materials.includes('moss'));
  assert.equal(world.lab.lit.lights[0].s, 0);
  world.anim.update(0, 0);
  assert.equal(world.lab.ps.live, 0);
  world.parameters.setInputs({ controls: { gain: 1, hue: 'ember' }, query: {
    probe: field => field === 'world/signal' ? { status: 'ok', value: .8 } : { status: 'missing' }
  } });
  world.anim.update(.05, 1);
  assert(Math.abs(world.lab.rig.at('panel', [0, 0, 0])[1] - .8) < 1e-6);
  assert.equal(world.lab.lit.lights[0].s, .8);
  assert.equal(world.lab.lit.lights[0].r, 4);
  assert.equal(world.lab.ps.live, 8);
  assert.equal(world.parameters.values().response, .8);
  assert.throws(() => world.parameters.setInputs({ controls: { gain: 'invalid' } }), /incompatible/);
  assert.equal(world.parameters.values().gain, 1);
  assert(world.renderMetadata.materials.includes('moss'));
  assert(world.parameters.bake().renderMetadata.materials.includes('ember'));
  assert.deepEqual(editor.snapshot(), original);
});

test('saved world snapshots drive visual bindings from real simulation fields and signals', () => {
  const world = {
    id: 'world-controls', dt: .25,
    systems: { thermo: { kind: 'fields', config: { fields: { temperature: { default: 20 } } } },
      heater: { kind: 'control', config: { op: 'pass' } } },
    entities: { panel: { position: [0, .5, 0], visual: { half: [.5, .3, .2], material: 'stone' } } },
    prefabs: { marker: { entities: { foot: { position: [0, 0, 0] } } } },
    visual: { bounds: { min: [-1, -.2, -1], max: [1, 1.7, 1] },
      camera: { target: [0, .5, 0], dist: 3, yaw: 0, pitch: 0 },
      parameterBindings: { controls: { distance: 3 },
        values: {
          hue: { source: 'signal', port: 'heater/value', fallback: 'stone', keys: [[0, 'stone'], [.5, 'ember']], interpolation: 'step' },
          heat: { source: 'field', field: 'thermo/temperature', target: { entity: 'panel' },
            fallback: 0, keys: [[20, 0], [100, 1]] },
          lens: { op: 'add', args: [ref('distance'), ref('heat')] }
        }, bindings: [attach('/entities/panel/visual/material', 'hue'), attach('/visual/camera/dist', 'lens')]
      }
    }
  };
  const run = W.runtime.create(world);
  const cold = W.visual(kit, run.view(), run.query());
  run.schedule([
    { tick: 2, action: 'world/input', args: { port: 'heater/value', value: .8 } },
    { tick: 3, action: 'thermo/set', args: { field: 'temperature', region: { bounds: { min: [-1, 0, -1], max: [1, 1, 1] }, value: 100 } } }
  ]);
  run.advance(4);
  const warm = W.visual(kit, run.view(), run.query(), { controls: { distance: 4 } });
  assert.equal(cold.cam.dist, 3);
  assert.equal(warm.cam.dist, 5);
  assert(warm.renderMetadata.materials.includes('ember'));
  assert.equal(warm.parameterValues.heat, 1);
  assert.equal(run.view().world.entities.panel.visual.material, 'stone');
  const checkpoint = JSON.parse(JSON.stringify(run.checkpoint()));
  const saved = W.runtime.create(checkpoint.world, { checkpoint });
  const replay = W.visual(kit, saved.view(), saved.query(), { controls: { distance: 4 } });
  assert.deepEqual(replay.data, warm.data);
  assert.deepEqual(replay.parameterValues, warm.parameterValues);
});

test('CLI controls and bake time pass through the normal diorama renderer', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-shared-parameters-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const spec = diorama();
  spec.parameterBindings.values.pulse = { source: 'time', fallback: 'stone', interpolation: 'step', keys: [[0, 'stone'], [1, 'ember']] };
  spec.parameterBindings.bindings[0] = attach('/solids/0/mat', 'pulse');
  spec.light = { amb: .1 };
  spec.parameterBindings.bindings.push(attach('/light/amb', 'gain'));
  const scene = path.join(folder, 'scene.json'), png = path.join(folder, 'frame.png');
  fs.writeFileSync(scene, JSON.stringify(spec));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  function draw(time, gain) {
    execFileSync(process.execPath, [cli, 'render', scene, '--raw', '--w', '96', '--h', '64', '--px', '1',
      '--ortho', '--parameter-time', String(time), '--params', JSON.stringify({ gain }), '--out', png], { stdio: 'pipe' });
    return Buffer.from(PNG.read(png).rgb);
  }
  const first = draw(0, .1);
  assert(!first.equals(draw(1, .1)));
  assert(!first.equals(draw(0, .8)));
});

test('WebGL consumes the same bound stage pose and baked material', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({}, diorama, (kit, fixture, backend) => {
    const world = kit.KIT.diorama.build(fixture(), { parameterInputs: { controls: { hue: 'moss' } } });
    const draw = backend(96, 64, { raw: true, camera: { ortho: true } });
    try {
      world.anim.update(0, 0);
      draw.draw(world, { time: 0 });
      const initial = draw.image();
      world.parameters.setInputs({ query: { probe: () => ({ status: 'ok', value: .8 }) } });
      world.anim.update(.05, 1);
      draw.draw(world, { time: 1, changedRows: [0, 1] });
      const pick = draw.pick(world, { origin: [0, .8, 3], direction: [0, 0, -1] }, { time: 1 });
      return { changed: initial !== draw.image(), material: pick.dominant?.target.material, strength: world.lab.lit.lights[0].s };
    } finally {
      draw.close();
    }
  });
  assert.deepEqual({ changed: result.changed, material: result.material, strength: result.strength },
    { changed: true, material: 'moss', strength: .8 });
});
