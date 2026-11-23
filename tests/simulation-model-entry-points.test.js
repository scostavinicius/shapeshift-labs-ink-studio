const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('..');
const {embedModels} = require('../cli/simulation-model-files.js');

const {KIT: K} = ink.load(), W = K.world;
const fixture = path.resolve(__dirname, '../examples/simulation-models');
const model = require('../examples/simulation-models/sluice.json');
const world = require('../examples/simulation-models/sluice.world.json');
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const json = data => JSON.parse(JSON.stringify(data));
const cli = (...args) => execFileSync(process.execPath,
  [path.resolve(__dirname,'../cli/ink-studio.js'),...args],{encoding:'utf8'});
const command = (...args) => JSON.parse(cli(...args));

test('one asset matches in standalone runs, a differently clocked world, a graph, and a take', () => {
  const run = W.runtime.create(model);
  run.advance(12);
  const expected = W.models.sample(run);
  const crossed = embedModels(world, path.join(fixture,'sluice.world.json'));
  const parent = W.runtime.create(crossed);
  parent.advance(6);
  for (const [name, value] of Object.entries(expected.outputs))
    assert.deepEqual(parent.view().signals['sluice/'+name], value);
  assert.equal(parent.view().signals['overflow/value'],true);
  assert.deepEqual(parent.query().probe('sluice/outletFlow'),expected.probes.outletFlow);
  assert.deepEqual(parent.view().states.sluice.checkpoint,run.checkpoint());

  const graph = ink.readGraphProject(path.join(fixture,'sluice.graph.json'));
  assert.deepEqual(graph.run({time:0.6}).outputs.sluice,expected);
  assert.equal(graph.run({time:0.1}).outputs.sluice.tick,2);
  assert.deepEqual(graph.run({time:0.6}).outputs.sluice,expected);

  const loaded = ink.readTake(path.join(fixture,'sluice.take.json')).take;
  const frame = loaded.seek(12);
  assert.equal(frame.world.tick,6);
  assert.deepEqual(frame.graph.outputs.sluice,expected);
  assert.deepEqual(frame.query.probe('sluice/waterBudget'),expected.probes.waterBudget);
  const direct = ink.createTake({clock:{fps:20,simulationRate:20},world:model});
  assert.deepEqual(direct.seek(12).model,expected);
});

test('model instances keep separate inputs and resume the same driven results', () => {
  const run = W.runtime.create({dt:0.05, systems:{
    autonomous:W.models.system(model), manual:W.models.system(model,{drive:['gateOpening']}),
    wired:W.models.system(model), driver:{kind:'control',config:{op:'scale',scale:0,offset:0.4}}
  }, connections:[{from:'driver/value',to:'wired/gateOpening'}]});
  run.schedule([{tick:5,action:'world/input',args:{port:'manual/gateOpening',value:0.2}}]);
  run.advance(8);
  assert.equal(run.view().signals['autonomous/gateOpening'],0.85);
  assert.equal(run.view().signals['manual/gateOpening'],0.2);
  assert.equal(run.view().signals['wired/gateOpening'],0.4);
  const saved = json(run.checkpoint());
  const resumed = W.runtime.create(saved.world,{checkpoint:saved});
  resumed.advance(12);
  run.advance(12);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('event ports transfer each event across model and world clock boundaries once', () => {
  const kind = 'test-model-events';
  W.runtime.register(kind, () => ({
    inputs:{pulse:'event'},outputs:{pulse:'event'},initial:() => [],
    step:(_, {input}) => input.pulse,output:state => ({pulse:state})
  }));
  const pulses = {...model, operators:{echo:{kind,revision:1}}, inputs:{pulse:'echo/pulse'},
    outputs:{pulse:'echo/pulse'}, probes:{}, commands:[]};
  const parent = W.runtime.create({dt:0.025, systems:{box:W.models.system(pulses,{drive:['pulse']})}});
  parent.schedule([1,2].map(tick => ({tick,action:'world/input',args:{port:'box/pulse',value:[{tick}]}})));
  parent.step();
  assert.deepEqual(parent.view().signals['box/pulse'],[]);
  const checkpoint = json(parent.checkpoint());
  const restored = W.runtime.create(checkpoint.world,{checkpoint});
  restored.step();
  assert.deepEqual(restored.view().signals['box/pulse'],[{tick:1},{tick:2}]);
  restored.advance(4);
  assert.deepEqual(restored.view().signals['box/pulse'],[]);

  pulses.commands = [1,2].map(tick => ({tick,input:'pulse',value:[{tick}]}));
  const slow = W.runtime.create({dt:0.1,systems:{box:W.models.system(pulses)}});
  slow.step();
  assert.deepEqual(slow.view().signals['box/pulse'],[{tick:1},{tick:2}]);
});

test('model graph options resume a compatible checkpoint and can schedule additional inputs', () => {
  const saved = W.models.session(model);
  saved.seek(6);
  const checkpoint = json(saved.checkpoint()), commands = [{tick:8,input:'gateOpening',value:0.2}];
  const resumed = W.models.session(model,{checkpoint,commands});
  resumed.seek(8);
  const graph = K.procedural.graph.create({
    nodes:{model:{op:'sim.model',inputs:{model,commands,checkpoint,options:{tick:8}}}},
    outputs:{value:{node:'model'}, checkpoint:{node:'model',port:'checkpoint'}}
  });
  const sampled = graph.evaluate({},{time:0}).outputs;
  assert.equal(sampled.value.outputs.gateOpening,0.2);
  assert.deepEqual(sampled.value,W.models.sample(resumed));
  assert.deepEqual(sampled.checkpoint,resumed.checkpoint());
  assert.throws(() => W.models.session({...model,revision:2},{checkpoint}),/does not match/);
});

test('take bundles retain referenced models, and world loads enforce model revision pins', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-model-entries-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const sources = path.join(dir,'sources'), pack = path.join(dir,'packed.json');
  fs.cpSync(fixture,sources,{recursive:true});
  const take = path.join(sources,'sluice.take.json'), source = path.join(sources,'sluice.json');
  const expected = command('take','sample',take,'--frame','12');
  cli('project','pack',take,'--out',pack);
  const container = read(pack);
  assert.ok(Object.hasOwn(container.files,'sluice.json'));
  write(source,{...read(source),revision:2});
  assert.throws(() => embedModels(world,path.join(sources,'sluice.world.json')),/Expected simulation model revision 1/);
  fs.rmSync(sources,{recursive:true});
  assert.deepEqual(command('take','sample',pack,'--frame','12'),expected);
});

test('nested model references use the defining file and reject cycles', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-model-nested-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const inner = path.join(dir,'sluice.json'), outer = path.join(dir,'outer.json'), graphFile = path.join(dir,'graph.json');
  write(inner,model);
  const entry = {...model,id:'outer',operators:{child:{kind:'simulation-model',revision:1,
    config:{model:{file:'sluice.json',revision:1}}}}, inputs:{}, outputs:{depth:'child/outletDepth'}, probes:{}, commands:[]};
  write(outer,entry);
  const graph = read(path.join(fixture,'sluice.graph.json'));
  graph.assets.model.file = 'outer.json';
  write(graphFile,graph);
  const first = ink.readGraphProject(graphFile);
  assert.ok(first.sourceFiles().includes(inner));
  assert.ok(first.run().outputs.sluice.outputs.depth > 0);
  write(inner,{...model,seed:123});
  assert.notEqual(ink.readGraphProject(graphFile).plan().projectHash,first.plan().projectHash);
  entry.operators.child.config.model.file = 'outer.json';
  write(outer,entry);
  assert.throws(() => ink.readGraphProject(graphFile),/model file cycle/);
});
