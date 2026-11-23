const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync,spawnSync} = require('node:child_process');
const ink = require('..');
const kit = require('../examples/simulation-block-independence/ink-studio.config.js').load();
const W = kit.KIT.world, A = W.blockReview;
const model = require('../examples/simulation-block-independence/vent.model.json');
const plan = require('../examples/simulation-block-independence/review.json');
const plain = value => JSON.parse(JSON.stringify(value));
const options = {samples:plan.samples,buffers:plan.buffers};

test('one long offline request, uneven live requests and scalar world ticks match exactly', () => {
  const {reference,report} = A.review(model,plan);
  assert.equal(report.status,'exact');
  assert.equal(report.reference.request.requested,1);
  assert.ok(report.cases[0].request.requested>20);
  assert.equal(report.cases[1].request.processed,512);
  assert.equal(report.cases[0].numericValues,519);
  assert.equal(report.cases[0].maxAbsoluteError,0);
  const run = W.runtime.create(model), scalar = W.runtime.create(model);
  run.advance(512);
  scalar.advance(512,{onTick() {}});
  assert.deepEqual(run.checkpoint(),scalar.checkpoint());
  assert.deepEqual(run.checkpoint().states.solver,reference.checkpoint);
  const browser = A.prepareCapture(model,{...options,path:'live',blocks:[1,19,31]});
  assert.throws(()=>browser.trace(),/has not finished/);
  while (browser.step()) {}
  assert.equal(A.compare(reference,plain(browser.trace())).status,'exact');
});

test('live playback splits before controls with multiple writes at one sample', () => {
  const calls=[];
  const player=A.playback(model,{onBlock:(start,end,outputs,views)=>{
    assert.equal(outputView,views.trace);
    calls.push([start,end,outputs.outlet]);
  }});
  const outputView=player.buffers.trace;
  assert.equal(player.process(93),93);
  assert.equal(player.process(92),185);
  assert.deepEqual(calls.map(call=>call.slice(0,2)),[[0,72],[72,93],[93,164],[164,185]]);
  const isolated=plain(model);
  isolated.commands.splice(2,1);
  const expected=A.capture(isolated,{samples:185,blocks:[185]});
  assert.deepEqual(player.snapshot(),expected.checkpoint);
});

test('timed block events stay at their exact sample and fractional onset under repartitioning', () => {
  const timed=require('../examples/simulation-timed-events/ink-studio.config.js').load();
  const review=timed.KIT.world.blockReview;
  const model=require('../examples/simulation-timed-events/note.model.json');
  const long=review.capture(model,{samples:1600,blocks:[1600]});
  const split=review.capture(model,{samples:1600,blocks:[999,1,32,79]});
  assert.equal(review.compare(long,split).status,'exact');
  assert.deepEqual(long.events.note,split.events.note);
  assert.equal(long.events.note[0].timing.sample,999);
  assert.equal(long.events.note[0].timing.fraction,0.5);
  const changed=plain(split);
  changed.events.note[0].timing.sample++;
  const report=review.compare(long,changed,{tolerance:{absolute:1,relative:1}});
  assert.equal(report.status,'diverged');
  assert.equal(report.firstFailure.path,'/events/note/0');
});

test('tolerances cover floats but retain strict sample schedules and checkpoint schemas', () => {
  const expected=A.capture(model,{...options,blocks:[512]});
  const actual=plain(expected);
  actual.tracks.trace.values[100]+=0.000001;
  const row=actual.checkpoint.buffers.pressure, bytes=Buffer.from(row.base64,'base64');
  bytes.writeDoubleLE(bytes.readDoubleLE(0)+0.000002,0);
  row.base64=bytes.toString('base64');
  assert.equal(A.compare(expected,actual).status,'diverged');
  const result=A.compare(expected,actual,{tolerance:{absolute:0.000003,relative:0}});
  assert.equal(result.status,'within-tolerance');
  assert.equal(result.firstDifference.sample,100);
  assert.equal(result.firstFailure,null);
  assert.equal(result.changedValues,2);
  assert.ok(result.maxAbsoluteError>0.0000019);
  const relative=A.compare(expected,actual,{tolerance:{relative:0.001}});
  assert.equal(relative.status,'within-tolerance');
  actual.identity.commands[0].sample=1;
  assert.equal(A.compare(expected,actual,{tolerance:{absolute:1},compareState:false}).status,'diverged');
  assert.throws(()=>A.compare(expected,actual,{tolerance:{absolute:null}}),/tolerances/);
});

test('a Float32 numerical backend is accepted only with its explicit tolerance', () => {
  const app=path.resolve(__dirname,'..');
  const alternate=JSON.parse(execFileSync(process.execPath,['-e',`
    const {KIT:K}=require('./index.js').load();
    require('./examples/simulation-prepared/vent-network.js')(K,'float32');
    const model=require('./examples/simulation-block-independence/vent.model.json');
    console.log(JSON.stringify(K.world.blockReview.capture(model,{
      samples:512,buffers:['trace'],path:'live',blocks:[7,23,11,32]
    })));
  `],{cwd:app,encoding:'utf8'}));
  const exact=A.capture(model,{...options,blocks:[512]});
  const rejected=A.compare(exact,alternate);
  assert.equal(rejected.status,'diverged');
  assert.equal(rejected.firstFailure.path,'/tracks/trace');
  const accepted=A.compare(exact,alternate,{tolerance:{absolute:2e-6,relative:1e-6}});
  assert.equal(accepted.status,'within-tolerance');
  assert.ok(accepted.maxAbsoluteError>0 && accepted.maxAbsoluteError<2e-6);
});

test('CLI exports a portable trace and exits 2 when an external sample diverges', t => {
  const cwd=path.resolve(__dirname,'../examples/simulation-block-independence');
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-block-review-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const reference=path.join(dir,'reference.json');
  const args=[cli,'sim','block-check','vent.model.json','review.json'];
  const report=JSON.parse(execFileSync(process.execPath,[...args,'--trace-out',reference],{cwd,encoding:'utf8'}));
  assert.equal(report.status,'exact');
  const trace=JSON.parse(fs.readFileSync(reference,'utf8'));
  trace.tracks.trace.values[31]+=1;
  fs.writeFileSync(reference,JSON.stringify(trace));
  const rejected=spawnSync(process.execPath,[...args,'--candidate',reference],{cwd,encoding:'utf8'});
  assert.equal(rejected.status,2,rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).cases.at(-1).firstFailure.sample,31);
});
