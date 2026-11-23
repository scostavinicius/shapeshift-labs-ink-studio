const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {KIT:{world:W}} = require('..').load();

test('execution plans reflect mixed phases, publication, and feedback from the compiled scheduler', () => {
  const process = ({live = false}) => ({
    combinational:live, initial:() => 0,
    inputs:{level:'number',total:'number',pulse:'event'},
    outputs:{level:'number',pulse:'event'},
    step:state => state+1, output:level => ({level,pulse:level ? [level] : []})
  });
  const observer = () => ({initial:() => 0,afterStep:count => count+1});
  const run = W.runtime.create({
    dt:0.12,
    systems:{
      a:{kind:'process',schedule:{substeps:3},config:{live:true}},
      b:{kind:'process',schedule:{substeps:4}},
      sink:{kind:'process',schedule:{every:3},contract:{reads:{loop:'b'}}},
      observe:{kind:'observer',schedule:{every:3}}
    },
    connections:[
      {from:'a/level',to:'b/level'},
      {from:'b/level',to:'a/level',delay:2},
      {from:'sink/level',to:'b/total',sample:'sum'},
      {from:'a/pulse',to:'sink/pulse',delay:1},
      {from:'a/level',to:'sink/level',sample:'average'}
    ]
  },{implementations:{process,observer},profile:true});
  const saved = run.checkpoint(), {execution} = run.composition();
  assert.equal(run.checkpoint(),saved);
  assert.equal(run.composition().execution,execution);
  assert.equal(execution.clock.subdivision,12);
  assert.deepEqual(execution.phases.map(({slice})=>slice),[3,4,6,8,9,12]);
  assert.deepEqual(execution.phases[1].candidates,['a']);
  assert.deepEqual(execution.postStep.observers,['observe']);
  assert.equal(execution.resources.work.observerCallsPerTick,1);
  assert.equal(execution.resources.work.maxSolverVisitsPerTick,8);
  assert.equal(execution.resources.memory.delaySlots,3);
  const byTarget = Object.fromEntries(execution.signals.map(row=>[row.to,row]));
  assert.equal(byTarget['b/level'].publication,'same-phase-if-due');
  assert.equal(byTarget['a/level'].delaySeconds,0.24);
  assert.equal(byTarget['b/total'].buffer.mode,'sum');
  assert.equal(byTarget['sink/pulse'].buffer.maxEvents,10000);
  assert.equal(byTarget['sink/level'].publication,'elapsed-interval');
  assert.equal(byTarget['sink/level'].buffer.pendingQuanta,0);
  assert.ok(execution.signals.every(row=>row.crossRate));
  assert.deepEqual(execution.feedback[0].systems,['a','b','sink']);
  assert.ok(execution.feedback[0].boundaries.some(row=>row.kind==='state' && row.alias==='loop'));
  assert.ok(execution.feedback[0].boundaries.some(row=>row.to==='a/level' && row.delay===2));
  run.advance(3);
  assert.equal(run.view().states.observe,3);
  for (const name of ['a','b','sink'])
    assert.equal(run.profile()[name].calls,execution.systems[name].cadence[0].visitsPerTick*3);
});

test('single-rate stateful self-feedback is shown with no extra sampling storage', () => {
  const run = W.runtime.create({
    systems:{counter:{kind:'counter'}},
    connections:[{from:'counter/value',to:'counter/value'}]
  },{implementations:{counter:()=>({
    initial:()=>0, inputs:{value:'number'}, outputs:{value:'number'},
    step:(_,ctx)=>ctx.input.value+1, output:value=>({value})
  })}});
  const {execution} = run.composition();
  assert.equal(execution.clock.mode,'fixed');
  assert.equal(execution.resources.memory.samplingJsonBytes,0);
  assert.equal(execution.signals[0].crossRate,false);
  assert.equal(execution.feedback[0].boundaries[0].publication,'after-source-phase');
  assert.equal(run.step().signals['counter/value'],1);
});

test('a chunk plan exposes available clocks and the current sleeping or active level', () => {
  const run = W.runtime.create(require('../examples/world-persistent-valley.json'));
  const start = run.composition().execution;
  assert.deepEqual(start.systems.props.cadence.map(row=>[row.level,row.every,row.substeps]),
    [['full',1,2],['coarse',4,1]]);
  run.advance(25);
  const finish = run.composition().execution;
  assert.equal(finish.systems.props.chunk.level,'sleep');
  assert.equal(finish.tick,25);
  assert.ok(finish.resources.work.variableSystems.includes('props'));
  assert.equal(start.systems.props.chunk.level,'full');
});

test('the CLI reports embedded assets, nested kernel costs, and live queue storage from a checkpoint', t => {
  const cwd = path.resolve(__dirname,'../examples/simulation-execution-plan');
  const cliFile = path.resolve(__dirname,'../cli/ink-studio.js');
  const cli = (...args) => JSON.parse(execFileSync(process.execPath,[cliFile,'sim',...args],{cwd,encoding:'utf8'}));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-execution-plan-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const checkpoint = path.join(dir,'spring.checkpoint.json');
  const recording = path.join(dir,'spring.run.json');
  const start = cli('plan','bench.world.json').execution;
  assert.equal(start.tick,0);
  assert.equal(start.assets.storage,'embedded-in-world');
  assert.deepEqual(start.assets.packs[0].bakedImages,[{id:'bench-art/backdrop',width:2,height:1}]);
  assert.equal(start.assets.dataInputs[0].rowCount,5);
  assert.equal(start.signals.find(wire=>wire.to==='meter/value').buffer.pendingQuanta,0);
  assert.equal(start.assets.modules[0].revision,1);
  assert.equal(start.systems.meter.cadence[0].hz,6.25);
  const child = start.systems.spring.child;
  assert.equal(child.ticksPerHostTick,4);
  assert.deepEqual(child.hostToModel.hold,['force']);
  assert.equal(child.plan.execution.systems.solver.cadence[0].hz,100);
  assert.equal(child.plan.execution.systems.solver.resources.workPerStep.springIntegrations,1);
  assert.equal(start.resources.memory.typedStateBytes,20);
  cli('run','bench.world.json','--ticks','3','--checkpoint',checkpoint,'--record',recording);
  const finish = cli('plan',checkpoint).execution;
  assert.deepEqual(finish,cli('plan',recording).execution);
  assert.equal(finish.tick,3);
  assert.equal(finish.signals.find(wire=>wire.to==='meter/value').buffer.pendingQuanta,6);
  assert.equal(finish.systems.spring.child.plan.execution.tick,12);
  assert.deepEqual(finish.assets,start.assets);
  assert.equal(finish.resources.memory.typedStateBytes,20);
  assert.ok(finish.resources.memory.samplingJsonBytes > start.resources.memory.samplingJsonBytes);
});
