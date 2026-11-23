const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('..').load(), W=K.world, N=W.lumpedNetworks;
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol,`${a} differs from ${b}`);
const network=parts=>({format:N.format,version:1,id:'bench',...parts});
const base={kind:'reference'};
const spring=network({
  units:{effort:'m/s',flow:'N'},nodes:{ground:base,bob:{kind:'storage',capacity:2}},
  elements:{spring:{kind:'spring',from:'bob',to:'ground',stiffness:8,initialDisplacement:.8},
    damper:{kind:'damper',from:'bob',to:'ground',damping:1}},
  numerics:{method:'adaptive',step:.02,maxStep:.1,absoluteTolerance:1e-12,relativeTolerance:1e-10},
  outputs:{speed:{node:'bob'},force:{element:'spring'},position:{element:'spring',measure:'displacement'},energy:{ledger:'energy'}}
});

test('mass, spring and damper follow the analytical damped oscillator and balance energy',()=>{
  const run=N.prepare(spring), result=run.advance(3);
  const beta=.25, frequency=Math.sqrt(4-beta**2), time=3;
  const exact=.8*Math.exp(-beta*time)*(Math.cos(frequency*time)+beta/frequency*Math.sin(frequency*time));
  near(result.outputs.position,exact,3e-9);
  near(result.outputs.force,8*exact,3e-8);
  assert.ok(result.ledger.dissipated>0);
  assert.equal(result.ledger.supplied,0);
  near(result.ledger.balance,0,1e-8);
  assert.equal(run.outputs.speed.quantity.unit,'m/s');
  assert.equal(run.outputs.force.quantity.unit,'N');
});

test('junctions solve current balance and reverse signed flow with a source',()=>{
  const def=network({
    inputs:{push:{default:3,quantity:{unit:'Pa'}}}, units:{effort:'Pa',flow:'m^3/s'},
    nodes:{supply:{kind:'reference',effort:{input:'push',scale:2}},a:{kind:'junction'},b:{kind:'junction'},ground:base},
    elements:{
      left:{kind:'resistor',from:'supply',to:'a',resistance:1},
      middle:{kind:'resistor',from:'a',to:'b',resistance:1},
      right:{kind:'resistor',from:'b',to:'ground',resistance:1},
      tap:{kind:'flow-source',from:'ground',to:'b',flow:1}
    }
  });
  const run=N.prepare(def), result=run.advance(1);
  near(result.nodes.a.effort,13/3);
  near(result.nodes.b.effort,8/3);
  near(result.elements.left.flow,5/3);
  near(result.elements.right.flow,8/3);
  near(result.ledger.junctionResidual,0);
  near(result.ledger.sourcePower,result.ledger.lossPower);
  near(result.ledger.balance,0);
  assert.ok(run.advance(2,{push:-4}).elements.left.flow<0);
});

test('inertance and storage preserve charge and energy in a closed reversible exchange',()=>{
  const def=network({
    nodes:{a:{kind:'storage',capacity:2,initialEffort:2},b:{kind:'storage',capacity:1}},
    elements:{pipe:{kind:'inertance',from:'a',to:'b',inertance:.8}},
    numerics:{step:.005}
  });
  const run=N.prepare(def), result=run.advance(2);
  near(result.nodes.a.stored+result.nodes.b.stored,4);
  near(result.ledger.energy,result.ledger.initialEnergy,1e-8);
  assert.equal(result.ledger.supplied,0);
  const saved=JSON.parse(JSON.stringify(run.snapshot())), resumed=N.prepare(def);
  resumed.restore(saved);
  assert.deepEqual(resumed.advance(3),run.advance(3));
  assert.throws(()=>N.prepare({...def,elements:{pipe:{...def.elements.pipe,inertance:.5}}}).restore(saved),/Incompatible/);
});

test('series drive, resistance, and storage yield the expected energy account',()=>{
  const def=network({nodes:{ground:base,a:{kind:'storage',capacity:1}},
    elements:{pump:{kind:'inertance',from:'ground',to:'a',head:2,inertance:.5,resistance:.6}}});
  const result=N.prepare(def).advance(1);
  assert.ok(result.nodes.a.effort>0&&result.ledger.dissipated>0&&result.ledger.supplied>0);
  near(result.ledger.balance,0,1e-8);
});

test('invalid configurations and failed steps leave committed network states intact',()=>{
  assert.throws(()=>N.prepare(network({nodes:{ground:base,free:{kind:'junction'}},
    elements:{pipe:{kind:'inertance',from:'ground',to:'free',inertance:1}}})),/Floating junction free/);
  const run=N.prepare({...spring,inputs:{gain:{}}}), saved=run.snapshot();
  assert.throws(()=>run.advance(1,{typo:1}),/declared finite/);
  assert.deepEqual(run.snapshot(),saved);
  const model=network({nodes:{ground:base,a:{kind:'storage',capacity:1}}, inputs:{drive:{}},
    elements:{path:{kind:'resistor',from:'ground',to:'a',resistance:1,head:{input:'drive',scale:1e300}}}});
  const overflow=N.prepare(model), prior=overflow.snapshot();
  assert.throws(()=>overflow.advance(1,{drive:1e100}),/numeric range/);
  assert.deepEqual(overflow.snapshot(),prior);
});

test('a versioned world model publishes declared network probes and restores them',()=>{
  const model={format:W.models.format,version:1,id:'oscillator',revision:1,seed:1,
    domain:{},parameters:{},initial:{},boundaries:{},probes:{},numerics:{dt:.02},
    operators:{osc:{kind:'lumped-network',revision:1,config:{network:spring}}},inputs:{},outputs:{position:'osc/position'}};
  const live=W.runtime.create(model);
  live.advance(37);
  const resumed=W.runtime.create(model,{checkpoint:JSON.parse(JSON.stringify(live.checkpoint()))});
  live.advance(95);resumed.advance(95);
  assert.deepEqual(live.view().signals,resumed.view().signals);
  const direct=N.prepare(spring);
  for(let i=1;i<=95;i++)direct.advance(i*.02);
  near(live.view().signals['osc/position'],direct.view().outputs.position,1e-12);
});

test('sim network resolves a relative definition and honors between-sample source changes',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-lumped-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const def=network({nodes:{ground:base,a:{kind:'storage',capacity:2}},
    inputs:{flow:{default:0}},elements:{pump:{kind:'flow-source',from:'ground',to:'a',flow:{input:'flow'}}}});
  fs.writeFileSync(path.join(dir,'network.json'),JSON.stringify(def));
  fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify({format:N.runFormat,version:1,network:'network.json',samples:[.5,1],
    commands:[{time:.125,inputs:{flow:2}},{time:.5,inputs:{flow:0}}]}));
  execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'sim','network',
    'run.json','--out','trace.json'],{cwd:dir});
  const trace=JSON.parse(fs.readFileSync(path.join(dir,'trace.json')));
  assert.equal(trace.format,N.traceFormat);
  near(trace.results[0].nodes.a.effort,.375);
  near(trace.results[1].nodes.a.effort,.375);
  assert.equal(trace.results[0].elements.pump.flow,0);
});
