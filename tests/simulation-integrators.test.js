const test=require('node:test'), assert=require('node:assert/strict');
const path=require('node:path'), {execFileSync}=require('node:child_process');
const ink=require('..'), {KIT:K}=ink.load(), I=K.world.integrators;
const near=(n,expected,tolerance)=>assert.ok(Math.abs(n-expected)<=tolerance,`${n} differs from ${expected}`);
const unit=(t,state,out)=>{out[0]=1;};

test('RK4 evaluates at stage times and shows fourth-order convergence',()=>{
  const integrate=step=>I.create({method:'rk4',initial:[1,0],time:1,step,
    derivative(t,[x],out){out[0]=x;out[1]=t**3;}}).advance(2);
  const coarse=integrate(.25), fine=integrate(.125);
  assert.ok(Math.abs(coarse.state[0]-Math.E)>14*Math.abs(fine.state[0]-Math.E));
  near(fine.state[1],15/4,1e-13);
  assert.equal(fine.stats.evaluations,32);
  assert.equal(fine.time,2);
  const decimal=I.create({initial:[0],derivative:unit,step:.1,maxSteps:10}).advance(1);
  assert.equal(decimal.stats.acceptedSteps,10);
  assert.equal(decimal.time,1);
});

test('semi-implicit Euler kicks velocity before drifting position',()=>{
  const run=I.create({method:'semi-implicit',initial:[1,2,0,1],step:.25,
    acceleration(t,q,v,out,input){assert.equal(t,0);out[0]=input;out[1]=-q[1]-v[1];}});
  assert.deepEqual(run.advance(.25,8).state,[1.5,2.0625,2,.25]);
  assert.throws(()=>I.create({method:'semi-implicit',initial:[1],acceleration(){}}),/initial state/);
});

test('adaptive RK4 rejects a large proposal and resumes with its accepted step history',()=>{
  const options={method:'adaptive',initial:[1,1],step:1,maxStep:1,absoluteTolerance:[1e-10,1e-12],
    relativeTolerance:1e-9,derivative(t,[x,y],out){out[0]=x;out[1]=-9*y;}};
  const run=I.create(options), first=run.advance(1);
  assert.ok(first.stats.rejectedSteps>0);
  assert.ok(first.stats.acceptedSteps<200);
  near(first.state[0],Math.E,4e-8);
  near(first.state[1],Math.exp(-9),1e-10);
  const saved=JSON.parse(JSON.stringify(run.snapshot())), resumed=I.create(options);
  resumed.restore(saved);
  assert.deepEqual(run.advance(2),resumed.advance(2));
  assert.throws(()=>I.create({...options,maxStep:2}).restore(saved),/Incompatible/);
  resumed.reset();
  assert.deepEqual(resumed.snapshot(),I.create(options).snapshot());
});

test('a falling event reacts inside a coarse host interval using either RK4 method',()=>{
  const load=require('../examples/simulation-integrators/bounce.cjs');
  for(const method of ['rk4','adaptive']){
    const options={method,initial:[0,1,0,0],step:.6,eventStep:.15,...load(ink,{bounce:.5})};
    const run=I.create(options), result=run.advance(.6);
    assert.equal(result.events.length,1);
    const event=result.events[0], expected=Math.sqrt(2/9.81), after=.6-expected;
    near(event.time,expected,1e-9);
    near(event.before[1],0,1e-8);
    near(event.after[3],.5*9.81*expected,1e-8);
    assert.equal(event.after[1],0);
    near(result.state[1],after*(.5*9.81*expected-.5*9.81*after),1e-8);
    assert.equal(result.time,.6);
  }
});

test('eventStep finds separate crossings, simultaneous reactions follow declaration order, and terminal time can resume',()=>{
  const run=I.create({step:2,eventStep:.1,initial:[0,0],derivative(t,state,out){out[0]=1;out[1]=0;},
    events:[
      {id:'rising',direction:'rising',value:t=>Math.sin(Math.PI*(t-.25))},
      {id:'first',value:t=>t-.75,react(t,state){state[1]=3;}},
      {id:'terminal',terminal:true,value:t=>t-.75,react(t,state){state[1]*=2;}},
      {id:'falling',direction:'falling',value:t=>Math.sin(Math.PI*(t-.25))}
    ]});
  const hit=run.advance(2);
  assert.deepEqual(hit.events.map(row=>row.id),['rising','first','terminal']);
  assert.equal(hit.terminal,'terminal');
  near(hit.time,.75,1e-9);
  assert.equal(hit.state[1],6);
  assert.deepEqual(run.advance(2).events.map(row=>row.id),['falling']);
});

test('work limits, non-finite inputs, and reaction failures leave the committed state intact',()=>{
  const budget=I.create({initial:[0],step:.1,maxSteps:1,derivative:unit}), saved=budget.snapshot();
  assert.throws(()=>budget.advance(1),/step budget/);
  assert.deepEqual(budget.snapshot(),saved);
  const strict=I.create({method:'adaptive',initial:[1],step:1,minStep:1,absoluteTolerance:1e-12,relativeTolerance:0,
    derivative(t,[x],out){out[0]=x;}});
  assert.throws(()=>strict.advance(1),/minimum step/);
  assert.equal(strict.snapshot().time,0);
  const failed=I.create({initial:[0],derivative:unit,events:[{id:'failed',value:t=>t-.25,
    react(_time,out){out[0]=Infinity;}}]});
  assert.throws(()=>failed.advance(.5),/reaction produced non-finite/);
  assert.deepEqual(failed.snapshot().state,[0]);
  assert.throws(()=>I.create({initial:[0],derivative(){}}).advance(.1),/finite rate/);
  assert.throws(()=>I.create({initial:[0],derivative:unit,time:1e16,step:1}).advance(1e16+2),/time resolution/);
});

test('an existing prepared kernel checkpoints the integrator and keeps its original event stamps',()=>{
  const W=K.world, name='test-state-integrator-port';
  W.kernels.register(name,{
    revision:1,outputs:{position:'number',hits:'event'},
    prepare(){
      const solver=I.create({initial:[0],derivative:unit,step:.2,events:[{id:'mark',value:(_t,[x])=>x-.3}]});
      return {
        reset(){solver.reset();return {position:0,hits:[]};},
        advance({time}){
          const {state,events}=solver.advance(time);
          return {position:state[0],hits:events.map(row=>W.timedEvents.at(row.time,{kind:row.id}))};
        },
        snapshot:()=>({buffers:{},data:solver.snapshot()}),
        restore:({data})=>solver.restore(data)
      };
    }
  });
  const run=W.kernels.prepare(name,1,{}, {dt:.2});
  run.advance();
  const saved=JSON.parse(JSON.stringify(run.snapshot())), replay=W.kernels.prepare(name,1,{}, {dt:.2});
  replay.restore(saved);
  const live=run.advance();
  assert.deepEqual(replay.advance(),live);
  assert.equal(live.position,.4);
  near(live.hits[0].timing.time,.3,1e-9);
});

test('sim integrate uses the plan-relative equations and reports original event times',()=>{
  const root=path.join(__dirname,'..','examples','simulation-integrators');
  const trace=JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'sim','integrate','bounce.plan.json'],{cwd:root,encoding:'utf8'}));
  assert.equal(trace.format,'ink-studio/integration-trace');
  assert.equal(trace.checkpoint.time,2.4);
  assert.equal(trace.initial.state[1],1.55);
  const third=trace.results[2], event=third.events[0];
  near(event.time,Math.sqrt(2*1.55/9.81),1e-9);
  assert.equal(third.time,.72);
  assert.equal(event.id,'floor-impact');
});
