const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('..');
const {KIT:{world:W}} = ink.load();
const json = value => JSON.parse(JSON.stringify(value));

test('prepared processing reuses buffers and topology, bounds requests, and reports deadline misses', () => {
  const kind='prepared-test-filter';
  let prepares=0, seen, time=0;
  W.kernels.register(kind,{
    inputs:{gain:'number'},outputs:{level:'number'},
    processing:{maxSamples:8,maxWork:15,maxBytes:80,deadlineMs:1},
    prepare(_, {allocate}) {
      prepares++;
      const state=allocate('memory','Float64Array',1,'state');
      const view=allocate('wave','Float32Array',8,'output');
      return {
        workPerSample:3,
        process(ctx) {
          if (seen) assert.equal(ctx,seen);
          seen=ctx;
          for (let i=ctx.start;i<ctx.end;i++) {
            state[0]+=ctx.input.gain;
            view[i-ctx.start]=state[0];
          }
          ctx.output.level=state[0];
          time+=2;
        }
      };
    }
  });
  const run=W.kernels.prepare(kind,1,{}, {clock:()=>time});
  const proc=run.processor, view=proc.buffers.wave, first=proc.snapshot();
  proc.input.gain=2;
  assert.equal(proc.capacity.effectiveMaxSamples,5);
  assert.equal(proc.process(9),'sample-capacity');
  assert.equal(proc.process(6),'work-capacity');
  assert.equal(proc.snapshot(),first);
  assert.equal(proc.process(5),'deadline');
  assert.equal(proc.output.level,10);
  assert.deepEqual(Array.from(view.slice(0,5)),[2,4,6,8,10]);
  assert.equal(proc.process(1),'deadline');
  assert.equal(proc.buffers.wave,view);
  assert.equal(prepares,1);
  const measured=proc.report();
  assert.equal(measured.memory.allocatedBytes,80);
  assert.equal(measured.memory.rollbackBytes,40);
  assert.deepEqual(measured.observed.overruns,{samples:1,work:1,deadline:2});
  assert.equal(measured.observed.cursor,6);
  assert.equal(measured.observed.peakWork,15);
  assert.equal(measured.observed.peakMs,2);
  const saved=json(proc.snapshot());
  run.advanceBlock({end:8,input:{gain:2}});
  assert.equal(run.snapshot().outputs.level,16);
  proc.restore(saved);
  assert.equal(proc.output.level,12);
  proc.process(2);
  assert.equal(proc.snapshot().steps,8);
  assert.equal(prepares,1);
});

test('cooperative work exhaustion and a callback fault roll back state and published output buffers', () => {
  const kind='prepared-test-rollback';
  W.kernels.register(kind,{
    inputs:{mode:'number'},outputs:{value:'number'},
    processing:{maxSamples:4,maxWork:8,maxBytes:64},
    prepare(_, {allocate}) {
      const state=allocate('s','Float64Array',1,'state');
      const output=allocate('wave','Float32Array',4,'output');
      return {workPerSample:1,process(ctx){
        state[0]++;
        output[0]=state[0];
        if (ctx.input.mode===1 && !ctx.charge(8)) return;
        if (ctx.input.mode===2) throw Error('test fault');
        ctx.output.value=state[0];
      }};
    }
  });
  const proc=W.kernels.prepare(kind,1).processor;
  assert.equal(proc.process(1),'ok');
  const saved=proc.snapshot();
  proc.input.mode=1;
  assert.equal(proc.process(1),'work-capacity');
  assert.equal(proc.buffers.wave[0],1);
  proc.input.mode=2;
  assert.throws(()=>proc.process(1),/test fault/);
  assert.equal(proc.buffers.wave[0],1);
  assert.equal(proc.snapshot(),saved);
  assert.equal(proc.report().observed.faults,1);
  proc.input.mode=0;
  assert.equal(proc.process(1),'ok');
  assert.equal(proc.output.value,2);
});

test('prepare enforces buffer capacity and rejects process-time allocation', () => {
  W.kernels.register('prepared-test-memory',{
    processing:{maxSamples:2,maxWork:2,maxBytes:15},
    prepare(_, {allocate}) {
      allocate('state','Float64Array',1,'state');
      return {workPerSample:1,process() {}};
    }
  });
  assert.throws(()=>W.kernels.prepare('prepared-test-memory',1),/byte capacity/);
  W.kernels.register('prepared-test-late',{
    processing:{maxSamples:2,maxWork:2,maxBytes:16},
    prepare(_, {allocate}) {
      return {workPerSample:1,process(){allocate('late','Float64Array',1);}};
    }
  });
  const proc=W.kernels.prepare('prepared-test-late',1).processor;
  assert.throws(()=>proc.process(1),/late prepared kernel buffer allocation/);
  assert.equal(proc.report().observed.cursor,0);
});

test('models split requests at compiled capacity and retain the same checkpoint through CLI and graph execution', () => {
  const cwd=path.resolve(__dirname,'../examples/simulation-prepared');
  const cliFile=path.resolve(__dirname,'../cli/ink-studio.js');
  const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[cliFile,...args],{cwd,encoding:'utf8'}));
  const plan=cli('sim','plan','vent.model.json').execution;
  assert.equal(plan.blocks.maxSamples,160);
  assert.equal(plan.blocks.effectiveMaxSamples,96);
  assert.equal(plan.systems.solver.processing.capacity.workPerSample,12);
  const profile=cli('sim','run','vent.model.json','--ticks','288','--profile');
  assert.equal(profile.profile.solver.blockCalls,3);
  assert.equal(profile.processing.solver.observed.peakSamples,96);
  assert.equal(profile.processing.solver.observed.processedSamples,288);
  const kit=require('../examples/simulation-prepared/ink-studio.config.js').load();
  const R=kit.KIT.world.runtime, model=require('../examples/simulation-prepared/vent.model.json');
  const run=R.create(model), scalar=R.create(model);
  run.advance(288);
  scalar.advance(288,{onTick() {}});
  assert.deepEqual(run.checkpoint(),scalar.checkpoint());
  const module=R.create({dt:0.006,systems:{vent:kit.KIT.world.models.system(model)}});
  module.step();
  assert.equal(module.processing().vent.solver.observed.processedSamples,288);
  const saved=json(run.checkpoint());
  const restored=R.create(saved.world,{checkpoint:saved});
  restored.advance(400);
  run.advance(400);
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
  const {example}=ink.describeGraphNode('kernel.prepared-vent-network.v1',{kit});
  const graph=ink.createGraphProject(example.project,{kit}).run();
  assert.ok(graph.outputs.value>0);
});
