const {test}=require('node:test'), assert=require('node:assert/strict'), path=require('node:path');
const {execFileSync}=require('node:child_process'), ink=require('..');
const {world:W}=ink.load().KIT;

const store=(initial,options={})=>({kind:'store',config:{accounts:{q:{resource:'heat',units:'J',initial,...options}}}});
const config=(links,patch={})=>({law:'proportional',revision:1,links,...patch});
const link=(a,b,options={})=>({from:a+'/q',to:b+'/q',...options});
const group=config=>({kind:'transfer-coupling',config});
const report=(run,name='exchange')=>run.query().probe(name+'/coupling').value;
const close=(value,target,tolerance=1e-8)=>assert.ok(Math.abs(value-target)<=tolerance,`${value} differs from ${target}`);
const raw=value=>JSON.parse(JSON.stringify(value));

test('bounded implicit exchange solves the accepted amount against both resulting balances',()=>{
  const world={dt:0.1,systems:{cold:store(2),hot:store(10),exchange:group(config({heat:link('cold','hot')}))}};
  const run=W.runtime.create(world);
  run.step();
  const {states,transfers}=run.view(), result=report(run);
  const expected=(2-10)*0.1/(1+0.2);
  assert.equal(result.status,'converged');
  assert.ok(result.iterations>1&&result.iterations<=16);
  assert.equal(result.committed,true);
  close(result.links.heat.applied,expected);
  close(states.cold.q+states.hot.q,12);
  close(result.links.heat.residual,Math.abs((states.cold.q-states.hot.q)*0.1-result.links.heat.applied),1e-14);
  assert.equal(transfers.length,1);
  assert.equal(transfers[0].from,'hot/q');
  assert.equal(transfers[0].to,'cold/q');
  assert.equal(transfers[0].applied,-result.links.heat.applied);
  assert.equal(run.events.filter(event=>event.kind==='transfer').length,1);
  assert.equal(run.composition().execution.transferCouplings[0].maxSettlements,32);

  const saved=raw(run.checkpoint()), resumed=W.runtime.create(world,{checkpoint:saved});
  run.advance(5);
  resumed.advance(5);
  assert.deepEqual(run.checkpoint(),resumed.checkpoint());
});

test('same-boundary ordinary transfers and account capacity participate in the feedback calculation',()=>{
  const world={dt:0.1,systems:{source:store(10),dest:store(1,{max:2}),
    exchange:group(config({heat:link('source','dest')},{parameters:{gain:10}}))},
    commands:[{tick:1,action:'world/transfer',args:{from:'source/q',to:'dest/q',amount:0.75}}]};
  const run=W.runtime.create(world);
  run.step();
  const {states,transfers}=run.view(), result=report(run);
  assert.equal(result.status,'converged');
  assert.equal(result.links.heat.applied,0.25);
  assert.equal(result.links.heat.capacity,'partial');
  assert.deepEqual(Array.from(result.links.heat.limitedBy),['destination']);
  assert.deepEqual(Array.from(transfers,receipt=>receipt.applied),[0.75,0.25]);
  assert.equal(states.source.q,9);
  assert.equal(states.dest.q,2);
});

test('one law couples projected momentum and mass and posts both exactly once',()=>{
  W.transferCoupling.registerLaw('test-mass-and-impulse',()=>({link})=>{
    const gas=link('gas'), push=link('push');
    return {gas:(gas.from.values.pressure-push.to.balance[0])*0.1,
      push:[gas.from.values.pressure*0.05,-push.to.balance[1]*0.2+0.1,0]};
  });
  const air=()=>({initial:()=>({gas:4,p:[0,0,0]}),accounts:{
    gas:{resource:'gas',units:'kg',type:'number',read:s=>({balance:s.gas}),
      write:(s,gas)=>({...s,gas}),observe:s=>({pressure:s.gas*2})},
    p:{resource:'momentum',units:'N*s',type:'vec3',read:s=>({balance:s.p}),write:(s,p)=>({...s,p})}}});
  const momentum={resource:'momentum',units:'N*s',type:'vec3'};
  const run=W.runtime.create({systems:{air:{kind:'test-air'},tank:store(0,{resource:'gas',units:'kg'}),
    reed:store([0,0,0],momentum),exchange:group({
      law:'test-mass-and-impulse',links:{gas:{from:'air/gas',to:'tank/q'},push:{from:'air/p',to:'reed/q'}},
      iteration:{maxIterations:32,relaxation:0.8,onLimit:'error'}
    })}},{implementations:{'test-air':air}});
  run.step();
  const {states,transfers}=run.view(), result=report(run);
  assert.equal(result.status,'converged');
  close(states.air.gas+states.tank.q,4);
  close(states.reed.q[0],states.air.gas*0.1);
  close(states.reed.q[1],0.1/1.2);
  for (let i=0;i<3;i++) close(states.air.p[i]+states.reed.q[i],0);
  assert.deepEqual(Array.from(transfers,row=>row.requestId),['gas','push']);
  close(result.links.gas.residual,Math.abs((states.air.gas*2-states.reed.q[0])*0.1-states.tank.q),1e-14);
});

test('a limited solve can accept, reject, or roll back the tick, and can be disabled',()=>{
  const world={dt:0.1,systems:{a:store(10),b:store(2),exchange:group(config({heat:link('a','b')}))}};
  const runFor=onLimit=>W.runtime.create({...world,systems:{...world.systems,
    exchange:group(config({heat:link('a','b')},{iteration:{maxIterations:1,onLimit}}))}});
  const reject=runFor('reject'), accept=runFor('accept'), abort=runFor('error');
  reject.step();
  assert.equal(report(reject).status,'limit');
  assert.equal(report(reject).links.heat.estimate,0.8);
  assert.equal(report(reject).links.heat.applied,0);
  assert.equal(reject.view().transfers?.length??0,0);
  accept.step();
  assert.equal(report(accept).links.heat.applied,0.8);
  assert.equal(accept.view().transfers[0].applied,0.8);
  const before=abort.checkpoint();
  assert.throws(()=>abort.step(),/did not converge at tick 1/);
  assert.deepEqual(abort.checkpoint(),before);
  abort.schedule([{tick:1,action:'world/input',args:{port:'exchange/enabled',value:false}}]);
  abort.step();
  assert.equal(report(abort).status,'disabled');
});

test('coupling validates the pinned law, units, continuous account types, and clock',()=>{
  const world=(a,b,patch={})=>({systems:{a,b,exchange:group(config({heat:link('a','b')},patch))}});
  assert.throws(()=>W.runtime.validate(world(store(4),store(0),{revision:7})),/Unregistered transfer coupling law/);
  assert.throws(()=>W.runtime.validate(world(store(4),store(0,{units:'W'}))),/Incompatible transfer accounts/);
  assert.throws(()=>W.runtime.validate(world(store(4,{type:'integer'}),store(0,{type:'integer'}))),/continuous transfer accounts/);
  assert.throws(()=>W.runtime.validate(world(store(4),{...store(0),schedule:{every:2}})),/schedule|solver/);
  assert.throws(()=>W.runtime.validate(world(store(4),store(0),{iteration:{maxIterations:65}})),/iteration settings/);
});

test('CLI exposes the reed model plan, residuals, and normal transfer receipts',()=>{
  const cwd=path.resolve(__dirname,'../examples/simulation-transfer-coupling'), cli=path.resolve(cwd,'../../cli/ink-studio.js');
  const invoke=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  const info=invoke('sim','plan','reed.world.json').execution.transferCouplings[0];
  assert.equal(info.id,'feedback');
  assert.equal(info.latest.status,'ready');
  assert.deepEqual(info.links.map(row=>row.units),['kg','N*s']);
  const at=['reed.world.json','--ticks','173','--field'];
  const feedback=invoke('probe',...at,'feedback/coupling').value;
  const {receipts}=invoke('probe',...at,'world/transfers').value;
  assert.equal(feedback.status,'converged');
  assert.ok(feedback.residualRatio<=1);
  assert.deepEqual(receipts.map(row=>row.requestId),['air','push']);
});
