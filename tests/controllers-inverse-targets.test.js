const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {spawnSync}=require('node:child_process');
const ink=require('..'),{KIT:K}=ink.load(),W=K.world,C=W.controllers,F=W.inverseTargets;
const controller=(mode,extra={})=>({format:C.format,version:1,id:'bench',revision:1,mode,...extra});
const plan=(parameters,targets,extra={})=>({format:F.planFormat,version:1,id:'fit',parameters,targets,...extra});
const copy=value=>JSON.parse(JSON.stringify(value));
const near=(a,b,tol=1e-12)=>assert.ok(Math.abs(a-b)<=tol,`${a} differs from ${b}`);

test('followers apply time constants and asymmetric vector slew limits on the real interval',()=>{
  const asset=controller('follow',{settings:{timeConstant:.25}});
  const fine=C.prepare(asset).open(), coarse=C.prepare(asset).open();
  for(let i=0;i<10;i++)fine.step(.05,{target:3});
  near(fine.view().value,coarse.step(.5,{target:3}).value);
  near(fine.view().value,3*(1-Math.exp(-2)));
  const vector=C.prepare(controller('follow',{type:'vec3',initial:[0,0,0],limits:{
    min:[-1,-2,0],max:[1,2,1],rise:[1,2,1],fall:[3,4,2]
  }})).open();
  assert.deepEqual(vector.step(.1,{target:[2,-3,1]}).value,[.1,-.4,.1]);
  const moved=vector.step(.1,{target:[-.1,1,3]});
  assert.deepEqual(moved.value,[-.1,-.2,.2]);
  assert.equal(moved.axes[2].rangeLimited,true);
  assert.equal(moved.axes[2].rateLimited,true);
  assert.throws(()=>vector.step(0,{target:[0,0,0]}),/positive interval/);
  assert.deepEqual(vector.view(),moved);
});

test('hysteresis holds state inside the band and still observes rate limits',()=>{
  const run=C.prepare(controller('hysteresis',{settings:{low:.1,high:.3,off:0,on:1},limits:{rise:2,fall:1}})).open();
  const reading=(measurement)=>run.step(.1,{target:1,measurement});
  assert.equal(reading(.81).active,false);
  assert.equal(reading(.69).value,.2);
  assert.equal(reading(.81).active,true);
  assert.equal(reading(.9).active,false);
  near(run.view().value,.3);
});

test('PID supports derivative-on-measurement, proportional action and bounded integral through reversal',()=>{
  const asset=controller('pid',{settings:{kp:.6,ki:3,kd:.2,derivativeTime:.05,integralMin:-.5,integralMax:.5},
    limits:{min:0,max:1,rise:2,fall:3}});
  const compiled=C.prepare(asset), run=compiled.open();
  for(let i=0;i<40;i++)run.step(.05,{target:2,measurement:0});
  const saturated=run.view();
  assert.equal(saturated.value,1);
  assert.equal(saturated.axes[0].integral,0);
  assert.equal(saturated.axes[0].integralLimited,true);
  const saved=copy(run.snapshot());
  const next=run.step(.05,{target:.3,measurement:0});
  assert.equal(next.axes[0].derivative,0);
  near(next.value,.85);
  const replay=compiled.open(saved);
  assert.deepEqual(replay.step(.05,{target:.3,measurement:0}),next);
  const falling=run.step(.05,{target:.3,measurement:.1});
  near(falling.axes[0].derivative,-.4*(1-Math.exp(-1)));
  const pureI=C.prepare(controller('pid',{settings:{kp:0,ki:40},limits:{min:0,max:1,rise:1,fall:1}})).open();
  const held=pureI.step(.1,{target:1,measurement:0});
  near(held.value,.1);
  near(held.axes[0].integral,.1);
  assert.throws(()=>C.prepare({...asset,revision:2}).open(saved),/Incompatible/);
});

test('bounded fitting resolves coupled posture and force and exposes an unmet boundary target',()=>{
  const target=plan({shoulder:{min:-1,max:1},elbow:{min:.15,max:2.2},spring:{min:0,max:10}},
    {posture:{value:[1.12,.62,0],tolerance:.001},force:{value:3,tolerance:.001}});
  const measured=({shoulder,elbow,spring})=>({
    posture:[Math.cos(shoulder)+.64*Math.cos(shoulder+elbow),Math.sin(shoulder)+.64*Math.sin(shoulder+elbow),0],
    force:.7*spring
  });
  const report=F.fit(target,measured);
  assert.equal(report.status,'tolerance-met');
  assert.ok(report.maxRatio<=1);
  assert.deepEqual(report.targets.posture.measured,measured(report.parameters).posture);
  assert.equal(report.targets.force.measured,measured(report.parameters).force);
  assert.deepEqual(F.fit(target,measured),report);
  const forced=F.fit(plan({drive:{min:0,max:1}},{flow:{value:5,tolerance:.01}}),({drive})=>({flow:2*drive}));
  assert.equal(forced.converged,false);
  assert.equal(forced.bounds.drive,'max');
  assert.equal(forced.targets.flow.residual,-3);
  const budget=F.fit(plan({drive:{min:0,max:1}},{flow:{value:2,tolerance:.01}},
    {settings:{maxEvaluations:1,history:true}}),({drive})=>({flow:drive}));
  assert.equal(budget.status,'evaluation-limit');
  assert.equal(budget.history.length,1);
  const invalid=F.fit(plan({drive:{min:0,max:1}},{flow:{value:2,tolerance:.01}}),()=>null);
  assert.equal(invalid.status,'no-feasible-sample');
});

test('native world fitting produces replayable commands with physical port checks',()=>{
  const world={dt:.02,systems:{plant:{kind:'control',config:{op:'scale',scale:2},portQuantities:{
    inputs:{value:{unit:'1'}},outputs:{value:{unit:'N'}}
  }}}};
  const request=plan({drive:{min:0,max:1,quantity:{unit:'1'}}},{force:{value:1.7,tolerance:.00001,quantity:{unit:'N'}}},
    {evaluator:{kind:'world',world,inputs:{drive:'plant/value'},outputs:{force:{port:'plant/value',tick:1}}}});
  const fitted=F.fitWorld(request);
  assert.ok(fitted.converged);
  const run=W.runtime.create(world);
  run.schedule(fitted.commands);
  run.step();
  near(run.view().signals['plant/value'],fitted.targets.force.measured);
  const wrong=copy(request);
  wrong.parameters.drive.quantity.unit='m^3/s';
  assert.throws(()=>F.fitWorld(wrong),/Incompatible physical ports/);
});

test('world feedback-controller checkpoints and CLI traces use the same controller transitions',t=>{
  const asset=controller('pid',{settings:{kp:.75,ki:.6},limits:{min:-1,max:1,rise:3,fall:4}});
  const run=W.runtime.create({dt:.05,systems:{servo:{kind:'feedback-controller',config:{controller:asset}}}});
  const samples=[{target:1,measurement:.1},{target:1,measurement:.28},{target:1,measurement:.5}];
  const standalone=C.trace(asset,{dt:.05,samples});
  run.schedule(samples.flatMap((row,i)=>Object.entries(row).map(([name,value])=>({
    tick:i+1,action:'world/input',args:{port:'servo/'+name,value}
  }))));
  for(const expected of standalone.results){
    run.step();
    assert.deepEqual(run.query().probe('servo/detail').value,expected);
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-controller-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const write=(file,data)=>fs.writeFileSync(path.join(dir,file),typeof data==='string'?data:JSON.stringify(data));
  write('bench.json',asset);
  write('run.json',{format:C.runFormat,version:1,controller:'bench.json',dt:.05,samples});
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const call=(...args)=>spawnSync(process.execPath,[cli,'sim',...args],{cwd:dir,encoding:'utf8'});
  const trace=call('controller','run.json');
  assert.equal(trace.status,0,trace.stderr);
  assert.deepEqual(JSON.parse(trace.stdout),standalone);
  write('eval.cjs','module.exports = () => ({drive}) => ({flow:2*drive});');
  write('fit.json',plan({drive:{min:0,max:1}},{flow:{value:10,tolerance:.01}},
    {evaluator:{kind:'module',file:'eval.cjs'}}));
  const missed=call('fit-targets','fit.json','--require-tolerance','--out','fit.report.json');
  assert.notEqual(missed.status,0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'fit.report.json'))).bounds.drive,'max');
});
