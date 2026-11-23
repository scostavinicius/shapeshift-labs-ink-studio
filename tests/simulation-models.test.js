const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const ink = require('..');

const W = ink.load().KIT.world;
const fixture = path.resolve(__dirname, '../examples/simulation-models/sluice.json');
const source = () => JSON.parse(fs.readFileSync(fixture,'utf8'));
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const invoke = (...args) => spawnSync(process.execPath, [cli,...args], {encoding:'utf8'});
function command(...args) {
  const result = invoke(...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('a model resolves its sections and named interfaces against the native world', () => {
  const asset = source(), world = W.runtime.validate(asset);
  assert.equal(world.seed, asset.seed);
  assert.equal(world.dt, asset.numerics.dt);
  assert.deepEqual(world.systems.basin.config.initial, asset.initial.water);
  assert.deepEqual(world.systems.basin.config.gates, asset.boundaries.gates);
  assert.equal(world.systems.basin.config.friction, asset.parameters.friction);
  assert.equal(world.systems.basin.operatorRevision, 1);
  assert.equal(world.commands[0].args.port, 'basin/gate.sluice');

  const run = W.runtime.create(asset);
  run.advance(4);
  assert.equal(W.models.sample(run).outputs.outletDepth, 0);
  run.advance(12);
  const sample = W.models.sample(run);
  assert.equal(sample.outputs.gateOpening, 0.85);
  assert.ok(sample.outputs.outletDepth > 0.05);
  assert.ok(Math.abs(sample.probes.waterBudget.value.error) < 1e-12);
  assert.ok(sample.probes.outletFlow.value[0] > 0);
  const saved = JSON.parse(JSON.stringify(run.recording()));
  const replay = W.runtime.replay(saved);
  assert.deepEqual(W.models.sample(replay), sample);
  replay.schedule([W.models.command(replay.view().world, 'gateOpening', 0.1, 13)]);
  replay.advance(13);
  assert.equal(W.models.sample(replay).outputs.gateOpening, 0.1);
});

test('models reject bad pins, bindings, and unresolved or connected interfaces', () => {
  const reject = (edit, message) => {
    const asset = source();
    edit(asset);
    assert.throws(() => W.runtime.validate(asset), message);
  };
  reject(asset => asset.version++, /supported version/);
  reject(asset => delete asset.operators.basin.revision, /pinned revision/);
  reject(asset => asset.operators.basin.revision++, /water revision 2/);
  reject(asset => asset.operators.basin.config.friction.$model = '/parameters/unknown', /Unresolved model binding/);
  reject(asset => asset.inputs.gateOpening = 'basin/unknown', /unconnected input port/);
  reject(asset => asset.outputs.waterVolume = 'basin/unknown', /Unknown port for model output/);
  reject(asset => asset.probes.outletFlow.field = 'basin/unknown', /Unknown field for model probe/);
  reject(asset => asset.probes.outletFlow.at = [1, 2], /Invalid model probe/);
  reject(asset => asset.commands[0].value = 'open', /Invalid value for basin\/gate.sluice/);
  reject(asset => {
    asset.operators.control = {kind:'control',revision:1};
    asset.connections = [{from:'control/value',to:'basin/gate.sluice'}];
  }, /unconnected input port/);
});

test('registered operator revisions coexist and a pinned operator survives serialization', () => {
  const kind = 'test-model-revision';
  const factory = value => () => ({initial:() => ({}), outputs:{value:'number'}, output:() => ({value})});
  W.runtime.register(kind, factory(1));
  W.runtime.register(kind, factory(2), {revision:2});
  assert.throws(() => W.runtime.register(kind, factory(3), {revision:2}), /duplicate/);

  const asset = {...source(), operators:{first:{kind,revision:1}, second:{kind,revision:2}},
    inputs:{}, outputs:{first:'first/value',second:'second/value'}, probes:{}, commands:[]};
  const run = W.runtime.create(asset, {implementations:{[kind]:factory(3)}});
  assert.deepEqual(W.models.sample(run).outputs, {first:1,second:2});
  const serialized = JSON.parse(JSON.stringify(run.checkpoint()));
  const restored = W.runtime.create(serialized.world,{checkpoint:serialized});
  assert.deepEqual(W.models.sample(restored).outputs, {first:1,second:2});
  const legacy = W.runtime.create({systems:{operator:{kind}}});
  assert.equal(legacy.view().signals['operator/value'],1);
});

test('the CLI compiles, runs, and replays a model and preserves it in a portable take', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-model-test-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const world = path.join(root,'compiled.json'), log = path.join(root,'run.json');
  const inspected = JSON.parse(command('sim','model','inspect',fixture));
  assert.equal(inspected.operators.basin.revision,1);
  assert.deepEqual(inspected.domain.grid,source().domain.grid);
  command('sim','model','compile',fixture,'--out',world);
  const live = JSON.parse(command('sim','run',fixture,'--ticks','12','--workers','2','--record',log));
  assert.ok(live.partitions.systems.basin > 0);
  assert.deepEqual(JSON.parse(command('sim','run',world,'--ticks','12')).model,live.model);
  assert.deepEqual(JSON.parse(command('sim','replay',log)).model,live.model);
  command('sim','verify',log);
  assert.match(invoke('sim','run',fixture,'--seed','99').stderr,/pins its seed and timestep/);

  const modelFile = path.join(root,'sluice.json'), take = path.join(root,'take.json'), bundle = path.join(root,'bundle.json');
  fs.copyFileSync(fixture,modelFile);
  fs.writeFileSync(take, JSON.stringify({
    format:'ink-studio/take', version:1, id:'sluice-take',
    clock:{fps:20,simulationRate:20}, world:'sluice.json'
  }));
  command('project','pack',take,'--out',bundle);
  const expected = JSON.parse(command('take','sample',take,'--frame','12'));
  fs.unlinkSync(modelFile);
  assert.deepEqual(JSON.parse(command('take','sample',bundle,'--frame','12')),expected);
});
