const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const W=require('..').load().KIT.world,F=W.parameterFit;
const series=(candidate,reference,times,weight=1)=>({kind:'series',candidate,reference,times,tolerance:.1,weight});
const rows=(source,unit='m')=>({source,rows:'/rows',unit});
const plan=(objectives,settings)=>({format:F.planFormat,version:1,id:'reference-fit',
  parameters:{gain:{min:0,max:1,initial:.5}},objectives,...(settings&&{settings})});
const close=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<=tolerance,a+' differs from '+b);

test('weights change the minimum independently of the number of samples in each objective',()=>{
  const times=Array.from({length:96},(_,i)=>i/95), source={source:'trial',channel:'level'};
  const scalar={kind:'measurement',candidate:{kind:'steady-state',source:'trial',channel:'level',target:0},
    reference:{value:.25,unit:'m'},tolerance:.1,weight:4};
  const request=plan({scalar,curve:series(source,rows('captured'),times)});
  const reference={captured:{rows:[{time:0,value:.75},{time:1,value:.75}]}};
  const evaluate=({gain})=>({trial:{sampleRate:2,channels:{level:{unit:'m',samples:[gain,gain,gain]}}}});
  const report=F.fit(request,reference,evaluate);
  close(report.parameters.gain,.35);
  assert.equal(Object.isFrozen(request.objectives.curve.times),false);
  assert.notEqual(report.objectives.curve.times,request.objectives.curve.times);
  assert.equal(report.metTolerance,false);
  assert.deepEqual(F.fit(request,reference,evaluate),report);
  assert.equal(report.work.evaluations,report.candidates.length);
  const best=report.candidates.find(row=>row.evaluation===report.bestEvaluation);
  close(best.errors.scalar.rms,.1);
  close(best.errors.curve.bias,-.4);
  close(best.errors.curve.worst.residual,-.4);
  assert.ok(best.rms<report.candidates[0].rms);
  const flipped=F.fit({...request,objectives:{scalar:{...scalar,weight:1},curve:{...request.objectives.curve,weight:4}}},
    reference,evaluate);
  close(flipped.parameters.gain,.65);
  const loose=F.fit({...request,objectives:{scalar:{...scalar,tolerance:1},curve:{...request.objectives.curve,tolerance:1}}},
    reference,evaluate);
  assert.equal(loose.metTolerance,true);
  assert.ok(loose.candidates[0].maxRatio<1);
  close(loose.parameters.gain,.35);
});

test('interpolates native clocks, preserves failed candidates, and checks units and reference coverage',()=>{
  const times=[.25,.4375,.625], capture={sampleRate:8,startSample:2,channels:{level:{unit:'m',samples:[.2,.3,.4,.5,.6]}}};
  const request=plan({curve:series(rows('trial'),{source:'capture'},times)});
  const evaluate=({gain})=>({trial:{rows:[{time:.25,value:gain*.4},{time:gain<.51?.5:.75,value:gain*1.2}]}});
  const report=F.fit({...request,starts:[{gain:.75}]},{capture},evaluate);
  assert.equal(report.candidates[0].feasible,false);
  assert.deepEqual(report.candidates[0].issues,[{objective:'curve',reason:'time-outside-series',time:.625}]);
  close(report.objectives.curve.reference[1],.35);
  assert.ok(report.bestEvaluation>1);
  assert.throws(()=>F.fit(request,{capture:{...capture,startSample:8}},evaluate),/Fit reference curve is unavailable/);
  assert.throws(()=>F.fit({...request,starts:[{gain:.75}],objectives:{curve:{...request.objectives.curve,
    candidate:rows('trial','N')}}},{capture},evaluate),/units differ/);
  const absent=F.fit({...request,settings:{maxEvaluations:1}},{capture},()=>null);
  assert.equal(absent.status,'no-feasible-sample');
  assert.equal(absent.bestEvaluation,null);
  assert.deepEqual(absent.candidates[0].issues,[{reason:'candidate-rejected'}]);
});

test('native CLI applies linked bindings from fresh templates and saves the report on an unmet tolerance',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-param-fit-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name), write=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const times=[.1,.2], template={format:W.controllers.runFormat,version:1,dt:.1,
    controller:{format:W.controllers.format,version:1,revision:1,id:'drive',mode:'follow'},
    samples:[{target:.2},{target:.2}]};
  write('trial.json',template);
  write('reference.json',{rows:times.map(time=>({time,value:.76}))});
  const request={format:'ink-studio/parameter-fit-run',version:1,candidate:{trial:'trial.json'},
    reference:{observed:{file:'reference.json'}},
    plan:plan({position:series({...rows('trial','1'),rows:'/results'},rows('observed','1'),times)}),
    bindings:{gain:[{source:'trial',path:'/samples/0/target'},{source:'trial',path:'/samples/1/target'}]}};
  const report=()=>JSON.parse(fs.readFileSync(file('report.json'),'utf8'));
  const run=(recipe,out='report.json')=>{
    write('fit.json',recipe);
    return spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'sim','fit-parameters',
      file('fit.json'),'--out',file(out),'--require-tolerance'],{cwd:os.tmpdir(),encoding:'utf8'});
  };
  const pass=run(request);
  assert.equal(pass.status,0,pass.stderr);
  const fitted=report();
  close(fitted.parameters.gain,.76);
  assert.equal(fitted.metTolerance,true);
  const replay=W.apply(template,fitted.edits.trial,{validate:null}).world;
  for(const sample of replay.samples)close(sample.target,.76);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('trial.json'),'utf8')),template);
  const fail=run({...request,plan:{...request.plan,settings:{maxEvaluations:1}}});
  assert.equal(fail.status,2,fail.stderr);
  assert.equal(report().metTolerance,false);
  assert.equal(report().candidates.length,1);
  assert.equal(run(request,'reference.json').status,1);
  const wrong=run({...request,bindings:{gain:[...request.bindings.gain,request.bindings.gain[0]]}});
  assert.equal(wrong.status,1);
  assert.match(wrong.stderr,/distinct existing finite number/);
});
