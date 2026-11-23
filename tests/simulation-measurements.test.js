const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..'),kit=ink.load(),W=kit.KIT.world,M=W.simulationMeasurements;
const CLI=require('../cli/simulation-measurements.js');
const plan=(measurements,assertions)=>({format:M.format,version:1,id:'named-bench',measurements,...(assertions&&{assertions})});
const trace=(samples,{sampleRate=8000,startSample=0,unit='Pa'}={})=>
  ({sampleRate,startSample,channels:{probe:{samples,unit}}});
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
const source=(kind,settings)=>({kind,source:'track',...settings});

test('arrival reports the first sustained crossing at an absolute sample and can use a trigger reference',()=>{
  const track=trace([0,3,0,-2,-3,0,5,6,7],{sampleRate:1000,startSample:40});
  const recipe=plan({
    falling:source('arrival',{threshold:2,holdSamples:2,direction:'falling',referenceSample:40}),
    rising:source('arrival',{threshold:3,holdSamples:3,direction:'rising'}),
    limited:source('arrival',{threshold:3,holdSamples:3,direction:'rising',window:{from:40,to:48}})
  },{
    within:{measurement:'falling',expected:.003,absolute:1e-9,unit:'s'},
    forbidden:{measurement:'limited',max:1}
  });
  const result=M.run(recipe,{track}), rows=result.measurements;
  close(rows.falling.value,.003);
  assert.equal(rows.falling.evidence.sample,43);
  assert.equal(rows.falling.evidence.confirmedAtSample,44);
  assert.equal(rows.rising.evidence.sample,46);
  assert.equal(rows.limited.reason,'threshold-not-reached');
  assert.equal(result.assertions.forbidden.status,'unavailable');
  assert.equal(result.passed,false);
});

test('windowed FFT resolves a non-bin frequency, and logarithmic RMS recovers a known decay',()=>{
  const rate=8000, hz=437.3, decay=5.25, count=8000;
  const values=Float64Array.from({length:count},(_,i)=>.125+4*Math.exp(-decay*i/rate)*Math.sin(2*Math.PI*hz*i/rate));
  const result=M.run(plan({
    hz:source('frequency',{band:[420,460]}),
    rate:source('decay',{baseline:.125,blockSamples:320,minRms:.01,minFit:.999}),
    rt:source('decay',{baseline:.125,blockSamples:320,minRms:.01,output:'t60'})
  }),{track:trace(values)});
  close(result.measurements.hz.value,hz,.035);
  close(result.measurements.rate.value,decay,.03);
  close(result.measurements.rt.value,Math.log(1000)/decay,.01);
  assert.ok(result.measurements.rate.evidence.rSquared>.999);
  assert.equal(result.measurements.hz.evidence.fftSize,8192);
  const flat=M.run(plan({hz:source('frequency',{}),decay:source('decay',{blockSamples:32})}),
    {track:trace(Array(192).fill(2))});
  assert.equal(flat.measurements.hz.reason,'no-ac-signal');
  assert.equal(flat.measurements.decay.reason,'insufficient-decay-evidence');
});

test('steady-state windows measure recorded controller rows and sample-locked traces',()=>{
  const controller={results:[{time:.1,answer:.5},{time:.2,answer:0},{time:.3,answer:2},{time:.4,answer:5}]};
  const result=M.run(plan({
    bias:{kind:'steady-state',source:'controller',rows:'/results',valuePath:'/answer',fromTime:.2,toTime:.4,
      unit:'m',target:1,mode:'bias'},
    tail:source('steady-state',{target:2,window:{from:8,to:11},mode:'rms'})
  }),{controller,track:trace([100,1,3,2],{startSample:7,unit:'m'})});
  close(result.measurements.bias.value,0);
  assert.equal(result.measurements.bias.evidence.count,2);
  assert.equal(result.measurements.bias.evidence.worst.row,1);
  close(result.measurements.tail.value,Math.sqrt(2/3));
  assert.equal(result.measurements.tail.evidence.worst.sample,8);
});

test('conservation assertions keep the native location, signed residual and tolerance',()=>{
  const audit={format:W.diagnostics.format,version:1,metrics:[{code:'network-energy-balance',value:-.00012,
    threshold:.0001,severity:'error',location:{kind:'ledger',name:'energy'},time:4}]};
  const result=M.run(plan({
    absolute:{kind:'conservation',source:'audit',path:'/diagnostics',metric:'network-energy-balance'},
    ratio:{kind:'conservation',source:'audit',path:'/diagnostics',metric:'network-energy-balance',mode:'ratio'},
    absent:{kind:'conservation',source:'audit',path:'/diagnostics',metric:'another'},
  },{
    balance:{measurement:'ratio',max:1,unit:'1'}
  }),{audit:{diagnostics:audit}});
  close(result.measurements.absolute.value,.00012);
  assert.equal(result.measurements.absolute.unit,'J');
  close(result.measurements.ratio.value,1.2);
  assert.equal(result.measurements.absolute.evidence.signed,-.00012);
  assert.equal(result.measurements.ratio.evidence.location.name,'energy');
  assert.equal(result.measurements.absent.reason,'conservation-metric-not-found');
  assert.equal(result.assertions.balance.status,'out-of-bounds');
  assert.equal(result.passed,false);
});

test('contact force excludes idle samples and retains the worst signed force vector',()=>{
  const impact={format:W.contactExciters.traceFormat,version:1,info:{sampleRate:8000},start:20,end:24,
    tracks:{heel:{active:[0,1,1,0],force:[999,0,0,3,4,0,0,-6,0,999,0,0]}}};
  const result=M.run(plan({
    peak:source('contact-force',{track:'heel'}),
    signed:source('contact-force',{track:'heel',project:[0,2,0],mode:'mean'}),
    idle:source('contact-force',{track:'heel',window:{from:20,to:21}})
  }),{track:impact});
  assert.equal(result.measurements.peak.value,6);
  assert.equal(result.measurements.signed.value,-1);
  assert.equal(result.measurements.peak.evidence.activeSamples,2);
  assert.deepEqual(result.measurements.peak.evidence.worst.vector,[0,-6,0]);
  assert.equal(result.measurements.peak.evidence.worst.sample,22);
  assert.equal(result.measurements.idle.reason,'no-active-contact-samples');
});

test('graph reports native measurements and its existing assertions can gate a named measurement suite',()=>{
  const measurement=plan({tap:source('arrival',{threshold:.5})},{timing:{measurement:'tap',expected:.001}});
  const graph=ink.createGraphProject({format:'ink-studio/graph-project',version:1,nodes:{
    named:{op:'sim.measure',inputs:{plan:measurement,sources:{track:trace([0,1],{sampleRate:1000})}}}
  },outputs:{passed:{node:'named',port:'passed'},summary:{node:'named'}},
  assertions:[{id:'measurement-suite',output:'passed',op:'eq',value:true}],
  exports:{summary:{output:'summary',format:'json'}}},{kit});
  const result=graph.run();
  assert.equal(result.report.passed,true);
  assert.equal(result.outputs.summary.measurements.tap.evidence.sample,1);
  assert.equal(JSON.parse(result.artifacts[0].bytes).passed,true);
});

test('CLI runs native contacts, retains a failed report, and uses exit code 2 for CI assertions',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-measure-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=name=>path.join(folder,name), save=(name,obj)=>fs.writeFileSync(file(name),JSON.stringify(obj));
  const contact={format:W.contactExciters.runFormat,version:1,samples:100,
    excitation:{format:W.contactExciters.format,version:1,id:'hammer',sampleRate:8000,
      tracks:{pad:{kind:'impact',at:.002,duration:.001,normal:[0,1,0],impulse:[0,.005,0]}}}};
  save('contact.json',contact);
  const recipe={format:CLI.runFormat,version:1,plan:plan({force:source('contact-force',{track:'pad'})},
    {ceiling:{measurement:'force',max:10,unit:'N'}}),sources:{track:{file:'contact.json'}}};
  const exe=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=()=>spawnSync(process.execPath,[exe,'sim','measure','bench.json','--out','report.json'],{cwd:folder,encoding:'utf8'});
  save('bench.json',recipe);
  const passed=run();
  assert.equal(passed.status,0,passed.stderr);
  assert.equal(JSON.parse(fs.readFileSync(file('report.json'))).passed,true);
  recipe.plan.assertions.ceiling.max=2;
  save('bench.json',recipe);
  const failed=run();
  assert.equal(failed.status,2,failed.stderr);
  const report=JSON.parse(fs.readFileSync(file('report.json')));
  assert.equal(report.passed,false);
  assert.ok(report.measurements.force.value>2);
  assert.equal(report.assertions.ceiling.status,'out-of-bounds');
});
