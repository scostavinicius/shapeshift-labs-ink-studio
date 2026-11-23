const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('..');
const {KIT:{world:W}} = ink.load();
const json = value => JSON.parse(JSON.stringify(value));
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-12,a+' differs from '+b);
const pulse = (time,value) => W.timedEvents.at(time,{value});

const split = () => ({
  initial:()=>({v:0,x:0,times:[]}),
  inputs:{pulses:{type:'event',timing:'split'}},
  outputs:{v:'number'}, output:({v})=>({v}),
  react(state,ctx) {
    assert.equal(ctx.dt,0);
    return {...state,times:state.times.concat(ctx.time),
      v:state.v+ctx.input.pulses.reduce((total,row)=>total+row.value,0)};
  },
  step:(state,{dt,input})=>{
    assert.equal(input.pulses.length,0);
    return {...state,x:state.x+state.v*dt};
  }
});
const options = {implementations:{split}};

test('a solver splits once per event instant, retains future events, and restores the same pending queue', () => {
  const run = W.runtime.create({dt:1,systems:{solver:{kind:'split'}},causality:true},{
    ...options,profile:true,traceSteps:8,recordRun:true
  });
  run.schedule([{tick:1,action:'world/input',args:{port:'solver/pulses',value:[
    pulse(0.75,3),pulse(0.25,1),pulse(0.25,2),pulse(1,7),pulse(1.75,1)
  ]}}]);
  run.step();
  assert.deepEqual(run.view().states.solver,{v:13,x:3,times:[0.25,0.75,1]});
  assert.equal(run.profile().solver.calls,3);
  assert.deepEqual(run.stepFrame().steps[0].reactions.map(row=>row.time),[0.25,0.75,1]);
  const saved = json(run.checkpoint());
  assert.deepEqual(saved.sampling['solver/pulses'],[pulse(1.75,1)]);
  const resumed = W.runtime.create(saved.world,{...options,checkpoint:saved});
  resumed.step();
  run.step();
  assert.deepEqual(run.view().states.solver,{v:14,x:16.25,times:[0.25,0.75,1,1.75]});
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording()),options).checkpoint(),run.checkpoint());
  assert.equal(run.recording().evidence.timing.steps.solver.calls,5);
});

test('a later producer clamps late delivery and a delayed wire preserves the original occurrence', () => {
  const source = () => ({
    initial:()=>[],outputs:{events:'event'},
    step:(_,ctx)=>ctx.tick===2?[ctx.eventAt(0.25,{value:1})]:[],
    output:events=>({events})
  });
  const later = W.runtime.create({dt:1,systems:{source:{kind:'source',schedule:{every:2}},
    consumer:{kind:'split'}},connections:[{from:'source/events',to:'consumer/pulses'}]},
  {implementations:{source,split}});
  later.advance(2);
  assert.deepEqual(later.view().states.consumer,{v:1,x:1,times:[1]});
  assert.equal(later.view().signals['consumer/pulses'][0].timing.time,0.5);
  const delayed = W.runtime.create({dt:1,systems:{source:{kind:'source',schedule:{every:2}},
    consumer:{kind:'split',schedule:{every:3}}},connections:[{from:'source/events',to:'consumer/pulses',delay:1}]},
  {implementations:{source,split}});
  delayed.advance(3);
  assert.deepEqual(delayed.view().states.consumer,{v:1,x:1.5,times:[1.5]});
  assert.equal(delayed.view().signals['consumer/pulses'][0].timing.time,0.5);
  assert.equal(delayed.view().signals['consumer/pulses'][0].timing.deliveryTime,1.5);
});

test('a receiving module forwards timed rows to their child tick and preserves fractional reactions', () => {
  const kind='timed-test-inner';
  W.runtime.register(kind,split);
  const child={format:W.models.format,version:1,revision:1,id:kind,seed:1,numerics:{dt:0.25},
    domain:{},parameters:{},initial:{},boundaries:{},operators:{inner:{kind,revision:1}},
    inputs:{pulses:'inner/pulses'},outputs:{v:'inner/v'},probes:{}};
  const run = W.runtime.create({dt:1,systems:{module:W.models.system(child,{drive:['pulses']})},
    commands:[{tick:1,action:'world/input',args:{port:'module/pulses',value:[pulse(0.625,2)]}}]});
  run.step();
  assert.deepEqual(run.checkpoint().states.module.checkpoint.states.inner,{v:2,x:0.75,times:[0.625]});
});

test('a failed reaction rolls back and a registered timed kernel can split in place', () => {
  const kind='timed-test-kernel';
  let fail=true;
  W.kernels.register(kind,{
    inputs:{pulses:{type:'event',timing:'split'}},outputs:{value:'number'},
    prepare() {
      const buffer=new Float64Array(2);
      const output=()=>({value:buffer[0]});
      return {reset(){buffer.fill(0);return output();},
        advance({dt}){buffer[0]+=buffer[1]*dt;return output();},
        react({input}){buffer[1]+=input.pulses[0].value;if(fail)throw Error('reaction failed');return output();},
        snapshot:()=>({buffers:{buffer}}),restore:({buffers})=>buffer.set(buffers.buffer)};
    }
  });
  const run=W.runtime.create({dt:1,systems:{solver:{kind}},commands:[
    {tick:1,action:'world/input',args:{port:'solver/pulses',value:[pulse(0.25,4)]}}
  ]});
  const before=run.checkpoint();
  assert.throws(()=>run.step(),/reaction failed/);
  assert.equal(run.checkpoint(),before);
  fail=false;
  run.step();
  assert.equal(run.view().signals['solver/value'],3);
});

test('native CCD and an audio block report their first in-tick events through the CLI', () => {
  const cwd=path.resolve(__dirname,'../examples/simulation-timed-events');
  const cliFile=path.resolve(__dirname,'../cli/ink-studio.js');
  const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[cliFile,...args],{cwd,encoding:'utf8'}));
  const plan=cli('sim','plan','bench.world.json').execution;
  assert.ok(plan.signals.some(row=>row.to==='precise/note' && row.publication==='same-phase-event'));
  const source=path.join(cwd,'bench.world.json');
  const world=require('../cli/simulation-model-files.js').embedModels(require(source),source);
  const kit=require('../examples/simulation-timed-events/ink-studio.config.js').load();
  const R=kit.KIT.world.runtime;
  const run=R.create(world);
  run.step();
  const saved=json(run.checkpoint()), note=saved.states.score.eventValues.note[0];
  assert.equal(note.timing.sample,999);
  assert.equal(note.timing.fraction,0.5);
  close(note.timing.time,999.5/96000);
  assert.deepEqual(saved.states.score.checkpoint.outputs['solver/note'],[]);
  assert.equal(saved.states.precise.received.length,2);
  close(saved.states.precise.received[0].reaction,0.00625);
  close(saved.states.precise.received[1].reaction,999.5/96000);
  assert.deepEqual(saved.states.coarse.received,[]);
  const resumed=R.create(saved.world,{checkpoint:saved});
  resumed.step();
  run.step();
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  const kernel=kit.KIT.world.kernels.prepare('note-clock',1,{}, {dt:1/96000});
  assert.deepEqual(kernel.advanceBlock({end:1600}).note,[note]);
});
