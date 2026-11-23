const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..');
const example=path.resolve(__dirname,'../examples/simulation-fast-checkpoints');
const kit=require(path.join(example,'ink-studio.config.js')).load(), W=kit.KIT.world;
const json=value=>JSON.parse(JSON.stringify(value));
const model=require(path.join(example,'voice.model.json'));
const takeSpec=require(path.join(example,'bench.take.json'));
const worldPath=path.join(example,'bench.world.json');
const world=require('../cli/simulation-model-files.js').embedModels(require(worldPath),worldPath);
const make=(spec=takeSpec,checkpoint)=>ink.createTake({clock:spec.clock,world,simulation:spec.simulation},{kit,checkpoint});
const fast=checkpoint=>checkpoint.world.states.voice.checkpoint.states.osc;

test('a block playback checkpoint restores typed histories, future controls and unread notes',()=>{
  const options={path:'offline',retainEvents:true};
  const source=W.blockReview.playback(model,options);
  source.process(891);
  const checkpoint=json(source.checkpoint());
  assert.equal(checkpoint.kernel.steps,891);
  assert.deepEqual(Object.keys(checkpoint.kernel.buffers).sort(),['delay','filter','head','noise','phase']);
  assert.equal(checkpoint.events.notes[0].timing.sample+checkpoint.events.notes[0].timing.fraction,211.5);
  const resume=W.blockReview.playback(model,{path:'offline',checkpoint});
  for(const count of [3,99,347]) resume.process(count);
  source.process(449);
  assert.deepEqual(resume.checkpoint(),source.checkpoint());
  assert.deepEqual(resume.drainEvents().notes.map(row=>row.note),[60,67]);
  assert.equal(resume.drainEvents().notes.length,0);
  const smaller=json(model);
  smaller.numerics.blockSize=13;
  const repartitioned=W.blockReview.playback(smaller,{path:'offline',checkpoint});
  repartitioned.process(449);
  assert.deepEqual(repartitioned.checkpoint(),source.checkpoint());
  const changed=json(model);
  changed.commands[0].value=0.5;
  assert.throws(()=>W.blockReview.playback(changed,{path:'offline',checkpoint}),/does not match/);
});

test('a seek uses saved fast state and suppresses callbacks and notes during reconstruction',()=>{
  let blocks=0;
  const play=W.blockReview.playback(model,{path:'offline',retainEvents:true,onBlock:()=>blocks++});
  play.process(600);
  const anchor=json(play.checkpoint());
  const observed=blocks;
  play.seek(1300,{checkpoint:anchor});
  assert.equal(blocks,observed);
  assert.deepEqual(play.drainEvents().notes.map(row=>row.note),[60]);
  play.seek(180);
  assert.equal(play.cursor(),180);
  assert.equal(play.drainEvents().notes.length,0);
  play.process(50);
  assert.equal(play.drainEvents().notes[0].note,60);
  assert.equal(play.snapshot().steps,230);
});

test('a prepared fast checkpoint transfers from offline blocks to the live processor',()=>{
  const register=require('../examples/simulation-prepared/vent-network.js');
  register(kit.KIT);
  const prepared=require('../examples/simulation-block-independence/vent.model.json');
  const offline=W.blockReview.playback(prepared,{path:'offline',retainEvents:true});
  offline.process(164);
  const checkpoint=json(offline.checkpoint());
  const live=W.blockReview.playback(prepared,{path:'live',checkpoint});
  live.process(5);
  live.process(97);
  offline.process(102);
  assert.deepEqual(live.checkpoint(),offline.checkpoint());
  live.seek(164,{checkpoint});
  assert.deepEqual(live.checkpoint(),checkpoint);
});

test('take checkpoints keep native wire delays, pending events, and the embedded sample cursor',()=>{
  const take=make();
  const warm=take.seek(0);
  assert.equal(warm.world.tick,1);
  assert.deepEqual(warm.events,[]);
  assert.equal(warm.world.history[0].kind,'initial-excitation');
  take.seek(1);
  const saved=json(take.checkpoint());
  assert.equal(fast(saved).steps,1600);
  assert.equal(saved.world.sampling['meter/notes'].length,2);
  assert.equal(saved.world.delays['meter/level'].length,2);
  assert.equal(saved.world.states.meter.notes.length,0);
  const resumed=make(takeSpec,saved);
  resumed.seek(3);
  take.seek(3);
  assert.deepEqual(resumed.checkpoint(),take.checkpoint());
  assert.deepEqual(take.checkpoint().world.states.meter.notes.map(row=>row.note),[60,67]);
  const restarted=make();
  restarted.seek(1);
  assert.deepEqual(restarted.checkpoint(),saved);
});

test('reset cuts, warm-up and restore loops seek by the same local clock',()=>{
  const take=make();
  const before=take.seek(3);
  assert.equal(before.simulation.originFrame,0);
  assert.equal(before.world.tick,4);
  const opening=take.seek(6);
  const reset=json(take.checkpoint());
  assert.equal(opening.simulation.originCut,'reset-cut');
  assert.equal(opening.world.tick,2);
  assert.equal(opening.simulation.preRoll,true);
  assert.equal(fast(reset).steps,1600);
  take.seek(9);
  const wrapped=take.next();
  assert.equal(wrapped.frame.frame,6);
  assert.equal(wrapped.simulation.iteration,1);
  assert.deepEqual(take.checkpoint().world,reset.world);
  const resume=make(takeSpec,json(take.checkpoint()));
  assert.equal(resume.next().frame.frame,7);
  assert.equal(resume.checkpoint().simulation.iteration,1);
  take.seek(1);
  assert.deepEqual(fast(take.checkpoint()),fast(reset));
});

test('carry loops advance fast state at a seam, including a loop with an interior reset',()=>{
  const spec=json(takeSpec);
  spec.simulation.loop.state='carry';
  const take=make(spec);
  take.seek(9);
  const wrap=take.next();
  assert.equal(wrap.world.tick,6);
  assert.equal(fast(take.checkpoint()).steps,4800);
  const direct=make(spec);
  direct.seek(6,{iteration:1});
  assert.deepEqual(direct.checkpoint(),take.checkpoint());
  direct.seek(6);
  assert.equal(fast(direct.checkpoint()).steps,1600);
  spec.simulation.loop.from=2;
  const interior=make(spec);
  const at=interior.seek(2,{iteration:2});
  assert.equal(at.simulation.originFrame,6);
  assert.equal(at.world.tick,6);
  assert.equal(interior.seek(6,{iteration:2}).world.tick,2);
  assert.throws(()=>interior.seek(1,{iteration:1}),/inside the authored loop/);
});

test('CLI resumes a paged sample checkpoint and a JSON take checkpoint',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-fast-checkpoint-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const invoke=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:example,encoding:'utf8'}));
  const state=path.join(dir,'sample.ref.json'), take=path.join(dir,'take.json');
  const first=invoke('sim','block-play','voice.model.json','--samples','891','--checkpoint',state,'--checkpoint-store',path.join(dir,'blocks'));
  assert.equal(first.pendingEvents.notes.length,1);
  const second=invoke('sim','block-play','voice.model.json','--samples','1340','--resume',state);
  assert.deepEqual(second,invoke('sim','block-play','voice.model.json','--samples','1340'));
  invoke('take','sample','bench.take.json','--frame','6','--iteration','1','--checkpoint',take);
  assert.deepEqual(invoke('take','sample','bench.take.json','--frame','8','--iteration','1','--resume',take),
    invoke('take','sample','bench.take.json','--frame','8','--iteration','1'));
});
