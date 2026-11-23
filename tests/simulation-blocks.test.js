const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {KIT:{world:W}} = require('..').load();

const kind = 'block-parity';
const taps = [];
W.kernels.register(kind,{
  block:true,
  inputs:{drive:'number'}, outputs:{signal:'number'},
  prepare() {
    const state = new Float64Array(1);
    const output = () => ({signal:state[0]});
    function compute({start,end,input,randomAt}) {
      taps.push([start,end]);
      for (let i=start;i<end;i++) {
        state[0] = state[0]*0.75 + input.drive + randomAt(i,'noise');
        if (input.drive===99 && i===4) throw Error('intentional block failure');
      }
      return output();
    }
    return {
      reset() { state.fill(0); return output(); },
      advance:({tick,input,random}) => compute({start:tick-1,end:tick,input,randomAt:(_,key)=>random(key)}),
      advanceBlock:compute,
      snapshot:()=>({buffers:{state}}),
      restore:({buffers})=>state.set(buffers.state)
    };
  }
});
const makeModel = (blockSize=6) => ({
  format:W.models.format,version:1,revision:1,id:kind,seed:7,numerics:{dt:1/96000,blockSize},
  domain:{},parameters:{},initial:{},boundaries:{},
  operators:{solver:{kind,revision:1}},inputs:{drive:'solver/drive'},outputs:{signal:'solver/signal'},probes:{}
});
const plain = value => JSON.parse(JSON.stringify(value));

test('integer blocks match scalar samples across partitions and roll back a partially written buffer', () => {
  const run = W.kernels.prepare(kind,1,{}, {dt:1/96000,seed:7});
  const before = run.snapshot();
  assert.throws(()=>run.advanceBlock({end:8,input:{drive:99}}),/intentional block failure/);
  assert.equal(run.snapshot(),before);
  assert.throws(()=>run.advanceBlock({start:1,end:4}),/contiguous integer/);
  assert.throws(()=>run.advanceBlock({end:1.5}),/contiguous integer/);
  assert.throws(()=>run.advanceBlock({end:65537}),/at most/);
  assert.deepEqual(run.advanceBlock({end:0}),before.outputs);
  run.advanceBlock({end:5,input:{drive:1}});
  const resumed = W.kernels.prepare(kind,1,{}, {dt:1/96000,seed:7});
  resumed.restore(plain(run.snapshot()));
  resumed.advanceBlock({end:13,input:{drive:1}});
  const scalar = W.kernels.prepare(kind,1,{}, {dt:1/96000,seed:7});
  for (let i=0;i<13;i++) scalar.advance({input:{drive:1}});
  assert.deepEqual(resumed.snapshot(),scalar.snapshot());
});

test('world blocks split on input changes and observable commands and replay like ordinary ticks', () => {
  const model = {...makeModel(),commands:[{tick:5,input:'drive',value:3},{tick:11,input:'drive',value:-2}]};
  const commands = [{tick:7,action:'world/event',args:{kind:'sample-marker'}}];
  const run = W.runtime.create(model,{profile:true}), scalar = W.runtime.create(model);
  run.schedule(commands);
  scalar.schedule(commands);
  const start = taps.length;
  run.advance(13);
  assert.deepEqual(taps.slice(start),[[0,4],[4,6],[6,7],[7,10],[10,13]]);
  assert.equal(run.profile().solver.calls,13);
  assert.equal(run.profile().solver.blockCalls,4);
  let publications = 0;
  scalar.advance(13,{onTick(){ publications++; }});
  assert.equal(publications,13);
  assert.deepEqual(run.checkpoint(),scalar.checkpoint());
  assert.equal(run.history[0].kind,'sample-marker');
  assert.deepEqual(W.runtime.replay(plain(run.recording())).checkpoint(),run.checkpoint());
  const checkpoint = plain(run.checkpoint()), restored = W.runtime.create(checkpoint.world,{checkpoint});
  restored.advance(22);
  const fork = run.fork();
  fork.advance(22);
  run.advance(22);
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
  assert.deepEqual(fork.checkpoint(),run.checkpoint());
});

test('a 60 Hz world advances a 96 kHz child in held blocks and keeps authored control precedence', () => {
  const model = {...makeModel(1600),commands:[{tick:900,input:'drive',value:24}]};
  const scalarModel = plain(model);
  delete scalarModel.numerics.blockSize;
  for (const substeps of [1,3]) {
    const create = child => W.runtime.create({dt:1/60,
      systems:{voice:{...W.models.system(child,{drive:['drive']}),schedule:{substeps}}},
      commands:[{tick:1,action:'world/input',args:{port:'voice/drive',value:0.5}},
        {tick:2,action:'world/input',args:{port:'voice/drive',value:-1}}]});
    const run = create(model), scalar = create(scalarModel);
    const start = taps.length;
    run.advance(3);
    assert.equal(taps.slice(start).reduce((total,[from,to])=>total+to-from,0),4800);
    assert.equal(taps.length-start,substeps*3+1);
    scalar.advance(3);
    const result = parent => parent.checkpoint().states.voice.checkpoint;
    assert.equal(result(run).tick,4800);
    assert.deepEqual(result(run).states,result(scalar).states);
    assert.deepEqual(result(run).manual,result(scalar).manual);
    const saved = plain(run.checkpoint());
    const resumed = W.runtime.create(saved.world,{checkpoint:saved});
    resumed.advance(4);
    run.advance(4);
    assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  }
});

test('a failure in a later child block does not commit the enclosing host tick', () => {
  const child = {...makeModel(2),commands:[{tick:5,input:'drive',value:99}]};
  const setup = () => W.runtime.create({dt:8/96000,systems:{voice:W.models.system(child)}});
  const run = setup(), checkpoint = run.checkpoint();
  assert.throws(()=>run.step(),/intentional block failure/);
  assert.equal(run.checkpoint(),checkpoint);
  assert.equal(run.composition().execution.systems.voice.child.plan.execution.tick,0);
  assert.throws(()=>run.step(),/intentional block failure/);
  assert.equal(run.checkpoint(),checkpoint);
});

test('an async advance accepts input queued between blocks', async () => {
  const run = W.runtime.create(makeModel(2)), scalar = W.runtime.create(makeModel(2));
  const command = {tick:4,action:'world/input',args:{port:'solver/drive',value:2}};
  const advancing = run.advanceAsync(8);
  run.schedule([command]);
  await advancing;
  scalar.schedule([command]);
  scalar.advance(8,{onTick() {}});
  assert.deepEqual(run.checkpoint(),scalar.checkpoint());
});

test('block models validate topology and the CLI and graph run the registered executor', () => {
  const wrong = makeModel();
  wrong.operators.extra = {kind:'control',revision:1,config:{op:'pass'}};
  assert.throws(()=>W.runtime.validate(wrong),/one block kernel/);
  assert.throws(()=>W.runtime.validate(makeModel(0)),/blockSize/);
  const cwd = path.resolve(__dirname,'../examples/simulation-blocks');
  const cliFile = path.resolve(__dirname,'../cli/ink-studio.js');
  const cli = (...args) => JSON.parse(execFileSync(process.execPath,[cliFile,...args],{cwd,encoding:'utf8'}));
  const plan = cli('sim','plan','bench.world.json');
  assert.equal(plan.execution.systems.voice.child.ticksPerHostTick,1600);
  assert.equal(plan.execution.systems.voice.child.plan.execution.blocks.maxSamples,1600);
  const result = cli('sim','run','resonator.model.json','--ticks','3200','--profile');
  assert.equal(result.profile.solver.blockCalls,2);
  assert.equal(result.profile.solver.calls,3200);
  const description = cli('graph','describe','kernel.sample-resonator.v1','--json');
  assert.equal(description.inputs.clock.properties.blockSize.max,65536);
  const ink = require('..');
  const kit = require('../examples/simulation-blocks/ink-studio.config.js').load();
  const operation = ink.describeGraphNode('kernel.sample-resonator.v1',{kit});
  const graph = ink.createGraphProject(operation.example.project,{kit}).run();
  assert.ok(graph.outputs.value !== 0);
});
