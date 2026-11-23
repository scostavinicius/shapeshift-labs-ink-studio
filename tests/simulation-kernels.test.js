const assert = require('node:assert/strict');
const {test} = require('node:test');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');

const fixture = path.resolve(__dirname,'../examples/simulation-kernels');
const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const {kind, config, commands, register} = require('../examples/simulation-kernels/damped-spring.cjs');
const model = require('../examples/simulation-kernels/spring.model.json');
const kit = ink.load(), W = kit.KIT.world;
const operation = register(kit);
const json = value => JSON.parse(JSON.stringify(value));
const runCLI = (...args) => execFileSync(process.execPath,[cli,...args],{cwd:fixture,encoding:'utf8',maxBuffer:4*1024*1024});

test('prepared kernels snapshot both typed buffers and auxiliary data without changing saved values', () => {
  const kind = 'typed-kernel-test';
  W.kernels.register(kind,{
    inputs:{increment:'number'},outputs:{value:'number',negative:'bool'},
    prepare() {
      const float = new Float64Array(2), count = new Uint16Array(1);
      let reads;
      const out = () => ({value:float[1]+count[0]+reads, negative:Object.is(float[0],-0)});
      return {
        reset() {float.set([-0,0]); count[0]=0; reads=0; return out();},
        advance({input}) {float[1]+=input.increment; count[0]++; reads+=2; return out();},
        snapshot() {return {buffers:{float,count},data:{reads}};},
        restore({buffers,data}) {float.set(buffers.float); count.set(buffers.count); reads=data.reads;}
      };
    }
  });
  const a = W.kernels.prepare(kind,1);
  assert.deepEqual(a.advance({input:{increment:0.25}}),{value:3.25,negative:true});
  const saved = a.snapshot(), serialized = json(saved);
  assert.equal(saved.buffers.float.type,'Float64Array');
  assert.equal(saved.buffers.count.type,'Uint16Array');
  assert.equal(saved.data.reads,2);
  const b = W.kernels.prepare(kind,1);
  assert.deepEqual(b.restore(serialized),saved);
  assert.deepEqual(b.advance({input:{increment:0.75}}),a.advance({input:{increment:0.75}}));
  assert.equal(saved.steps,1);
  assert.equal(a.reset().outputs.value,0);
  assert.throws(()=>W.kernels.prepare(kind,1,{different:true}).restore(saved),/does not match/);
  serialized.buffers.float.base64 = 'A'.repeat(serialized.buffers.float.base64.length);
  assert.throws(()=>b.restore(serialized),/encoded kernel buffer/);
});

test('kernel failure rolls back mutated buffers before retrying an advance', () => {
  const kind = 'guarded-kernel-test';
  W.kernels.register(kind,{
    inputs:{fail:'bool'}, outputs:{value:'number'},
    prepare() {
      const state = new Int32Array(1);
      return {
        reset() {state[0]=0;return {value:0};},
        advance({input}) {state[0]++; return {value:input.fail?NaN:state[0]};},
        snapshot() {return {buffers:{state}};},
        restore({buffers}) {state.set(buffers.state);}
      };
    }
  });
  const run = W.kernels.prepare(kind,1);
  const good = run.snapshot();
  assert.throws(()=>run.advance({input:{fail:true}}),/Invalid or missing kernel port value value/);
  assert.equal(run.snapshot(),good);
  assert.deepEqual(run.advance(),{value:1});
  const world = W.runtime.create({systems:{guard:{kind,operatorRevision:1}}});
  world.schedule([{tick:1,action:'world/input',args:{port:'guard/fail',value:true}}]);
  assert.throws(()=>world.step(),/Invalid or missing kernel port value value/);
  assert.equal(world.view().tick,0);
});

test('world, direct kernel, and registered graph output agree after serialized checkpoint resume', () => {
  const run = W.runtime.create(model);
  run.advance(95);
  const saved = json(run.checkpoint()), restored = W.runtime.create(saved.world,{checkpoint:saved});
  const direct = W.kernels.prepare(kind,1,config,{dt:0.01});
  direct.restore(saved.states.solver);
  restored.advance(240);
  for (let tick=96; tick<=240; tick++)
    direct.advance({input:{force:tick>=158 && tick<176 ? 3.2 : 0}});
  run.advance(240);
  const expected = W.models.sample(run).outputs;
  assert.deepEqual(direct.snapshot().outputs,expected);
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());

  const graph = kit.KIT.procedural.graph.create({
    nodes:{spring:{op:operation,inputs:{config,commands,clock:{dt:0.01,tick:240},checkpoint:saved}}},
    outputs:{energy:{node:'spring',port:'energy'},state:{node:'spring',port:'checkpoint'}}
  });
  const outputs = graph.evaluate({}, {time:0}).outputs;
  assert.equal(outputs.energy,expected.energy);
  assert.deepEqual(outputs.state,run.checkpoint());
  assert.equal(graph.plan().outputs.energy.quantity.unit,'J');
  assert.equal(run.composition().systems.solver.kernel.revision,1);
});

test('kernel revisions have separate registrations and incompatible state layouts are rejected', () => {
  const name = 'kernel-version-test';
  const create = length => ({
    prepare() {
      const state = new Uint32Array(length);
      return {
        reset() {state.fill(0);return {};},advance() {return {};},
        snapshot() {return {buffers:{state}};},restore({buffers}) {state.set(buffers.state);}
      };
    }
  });
  W.kernels.register(name,create(1));
  W.kernels.register(name,{...create(2),revision:2});
  assert.throws(()=>W.kernels.register(name,create(3)),/Duplicate simulation kernel/);
  const first = W.kernels.prepare(name,1).snapshot();
  assert.throws(()=>W.kernels.prepare(name,2).restore(first),/does not match/);
  const forged = {...json(first),revision:2};
  assert.throws(()=>W.kernels.prepare(name,2).restore(forged),/Invalid kernel buffer layout/);
});

test('CLI load hook discovers registered kernels, describes their graph nodes, and replays a run', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-kernel-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const graph = path.join(dir,'example.json'), saved = path.join(dir,'spring.run.json');
  const detail = JSON.parse(runCLI('graph','describe',operation,'--json'));
  assert.equal(detail.outputs.displacement.quantity.unit,'m');
  assert.equal(detail.outputs.displacement.description,'Signed mass displacement.');
  assert.equal(detail.inputs.commands.properties.force.quantity.unit,'N');
  assert.ok(JSON.parse(runCLI('graph','nodes','--json')).nodes.some(node=>node.id===operation));
  fs.writeFileSync(graph,runCLI('graph','describe',operation,'--example'));
  const exported = JSON.parse(runCLI('graph','run',graph,'--json'));
  const result = JSON.parse(runCLI('sim','run','spring.model.json','--ticks','95','--record',saved,'--json'));
  assert.equal(exported.outputs.value,result.model.outputs.displacement);
  assert.equal(JSON.parse(runCLI('sim','verify',saved,'--json')).status,'verified');
});
