const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('..');
const {embedModels} = require('../cli/simulation-model-files.js');

const {KIT: K} = ink.load(), W = K.world;
const fixture = path.resolve(__dirname,'../examples/simulation-modules');
const valve = require('../examples/simulation-modules/valve.json');
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const write = (file, value) => fs.writeFileSync(file,JSON.stringify(value));
const clone = K.procedural.data.clone;
const json = value => JSON.parse(JSON.stringify(value));
const cli = (...args) => execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),...args],{encoding:'utf8'});
const load = (folder, name) => {
  const file = path.join(folder,name);
  return embedModels(read(file),file);
};

test('one pinned reservoir module keeps independent parameters, signals and state in two instances', () => {
  const run = W.runtime.create(load(fixture,'bench.world.json'));
  const plan = run.composition();
  assert.equal(plan.systems.fast.module.revision,1);
  assert.equal(plan.systems.fast.module.parameters.valveGain.value,0.85);
  assert.equal(plan.systems.slow.module.parameters.valveGain.value,0.25);
  assert.equal(plan.systems.slow.writes.outputs.receiver.quantity.unit,'world^3');
  run.advance(17);
  const closed = run.view().signals;
  assert.equal(closed['fast/flow'],0);
  assert.ok(closed['slow/flow'] > 0);
  assert.ok(closed['fast/receiver'] > closed['slow/receiver']);
  for (const name of ['fast','slow'])
    assert.ok(Math.abs(run.query().probe(name+'/balance').value.error) < 1e-12);
  const checkpoint = json(run.checkpoint());
  const resumed = W.runtime.create(checkpoint.world,{checkpoint});
  resumed.advance(36);
  run.advance(36);
  const final = run.view().signals;
  assert.equal(final['fast/receiver'],closed['fast/receiver']);
  assert.ok(final['slow/receiver'] > closed['slow/receiver']);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('module parameters are explicit, checked and isolated from the shared definition', () => {
  const adjusted = W.models.instantiate(valve,{parameters:{gain:0.4},seed:81});
  assert.equal(adjusted.parameters.gain,0.4);
  assert.equal(adjusted.seed,81);
  assert.equal(valve.parameters.gain,1);
  assert.equal(valve.seed,11);
  assert.throws(()=>W.models.instantiate(valve,{parameters:{internal:1}}),/does not expose parameter internal/);
  assert.throws(()=>W.models.instantiate(valve,{parameters:{gain:2}}),/Invalid override for model parameter gain/);
  assert.throws(()=>W.models.instantiate(valve,{parameters:{gain:'0.4'}}),/Invalid override/);
  assert.throws(()=>W.models.instantiate(valve,{seed:NaN}),/seed must be an integer/);
  const badDefault = clone(valve);
  delete badDefault.parameters.gain;
  assert.throws(()=>W.runtime.validate(badDefault),/Invalid default model parameter gain/);
  const parent = W.runtime.create({dt:0.05,systems:{controller:W.models.system(valve,{parameters:{gain:0.6},seed:42})}});
  assert.equal(parent.composition().systems.controller.module.seed,42);
  assert.equal(parent.composition().systems.controller.module.parameters.gain.value,0.6);
});

test('models can consist of named module instances linked through their public ports', () => {
  const assembly = clone(valve);
  assembly.id = 'paired-valves';
  delete assembly.operators;
  assembly.modules = {Valve:valve};
  assembly.instances = {
    first:{module:'Valve',parameters:{gain:0.5},drive:['opening']},
    second:{module:'Valve',parameters:{gain:{$model:'/parameters/gain'}}}
  };
  assembly.parameters.gain = 0.8;
  assembly.inputs = {opening:'first/opening'};
  assembly.outputs = {valve:'second/valve'};
  assembly.connections = [{from:'first/valve',to:'second/opening'}];
  assembly.commands = [{tick:1,input:'opening',value:1}];
  const run = W.runtime.create(assembly);
  run.advance(3);
  assert.equal(W.models.sample(run).outputs.valve,0.4);
  assert.throws(()=>W.runtime.validate({...assembly,instances:{...assembly.instances,bad:{module:'missing'}}}),
    /Unknown or invalid module for instance bad/);
  assert.throws(()=>W.runtime.validate({...assembly,operators:{first:{kind:'control',revision:1}}}),/Duplicate.*first/);
  assert.throws(()=>W.runtime.validate({...assembly,connections:[{from:'first/internal',to:'second/opening'}]}),
    /Incompatible or missing ports/);
});

test('CLI plans and portable takes follow nested module references from the world and graph', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-simulation-modules-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const source = path.join(directory,'source');
  fs.mkdirSync(source);
  for (const name of ['bench.world.json','reservoir.json','valve.json'])
    fs.copyFileSync(path.join(fixture,name),path.join(source,name));
  const bench = path.join(source,'bench.world.json'), reservoir = path.join(source,'reservoir.json');
  const take = path.join(source,'take.json'), pack = path.join(directory,'bundle.json');
  write(path.join(source,'sample.graph.json'),{
    format:'ink-studio/graph-project',version:1,
    assets:{model:{format:'json',file:'reservoir.json'}},
    nodes:{asset:{op:'jsonAsset',inputs:{name:'model'}},sample:{op:'sim.model',inputs:{model:{node:'asset'}}}},
    outputs:{value:{node:'sample'}}
  });
  write(take,{format:'ink-studio/take',version:1,id:'bench-take',clock:{fps:20,simulationRate:20},
    world:'bench.world.json',graph:'sample.graph.json'});
  const inspected = JSON.parse(cli('sim','model','inspect',reservoir));
  assert.deepEqual(inspected.modules.valve,{id:'valve-controller',revision:1});
  assert.equal(inspected.exposedParameters.valveGain.value,0.6);
  const plan = JSON.parse(cli('sim','plan',bench));
  assert.equal(plan.systems.fast.module.parameters.valveGain.value,0.85);
  const expected = JSON.parse(cli('take','sample',take,'--frame','20'));
  assert.ok(expected.graph.outputs.value.outputs.receiver > 0.08);
  cli('project','pack',take,'--out',pack);
  assert.ok(Object.hasOwn(read(pack).files,'valve.json'));
  const controller = path.join(source,'valve.json');
  write(controller,{...valve,revision:2});
  assert.throws(()=>load(source,'bench.world.json'),/Expected simulation model revision 1/);
  write(controller,{...valve,modules:{loop:{file:'reservoir.json',revision:1}}});
  assert.throws(()=>load(source,'bench.world.json'),/Simulation model file cycle/);
  fs.rmSync(source,{recursive:true});
  assert.deepEqual(JSON.parse(cli('take','sample',pack,'--frame','20')),expected);
});
