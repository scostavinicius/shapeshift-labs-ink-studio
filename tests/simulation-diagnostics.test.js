const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const kit=require('..').load(), W=kit.KIT.world,D=W.diagnostics;
const metric=(report,name)=>report.metrics.find(row=>row.code===name);
const gridDefinition={format:W.discretization.format,version:1,id:'grid-audit',revision:1,
  source:{kind:'grid',size:[4,1],spacing:1},regions:[{tag:'cold',side:'x0'}]};
const grid=W.gridOperators.prepare(W.discretization.compile(gridDefinition));
const waveDomain={format:W.waveNetworks.format,version:1,id:'step-tube',nodes:{inlet:{},tee:{},outlet:{}},tubes:{
  body:{from:'inlet',to:'tee',sections:[{length:.4,area:.02}]},
  shim:{from:'tee',to:'outlet',sections:[{length:.0003,area:.01}]}
}};
const waveSettings={sampleRate:24000,sources:{tap:{kind:'flow',node:'inlet'}},
  terminations:{outlet:{kind:'matched'}},probes:{last:{node:'outlet'}}};
const network={format:W.lumpedNetworks.format,version:1,id:'swing',
  nodes:{ground:{kind:'reference'},tank:{kind:'storage',capacity:1,initialEffort:1},joint:{kind:'junction'}},
  elements:{spring:{kind:'inertance',inertance:1,from:'tank',to:'ground'},
    anchor:{kind:'resistor',resistance:1,from:'joint',to:'ground'}},numerics:{step:.9}};

test('transport reports the actual limiting cell and refuses the same step in the normal entry point',()=>{
  const values=[0,.75,1,.2], settings={dt:.4,diffusivity:1,boundary:{cold:{kind:'value',value:0}}};
  const {diagnostics}=grid.inspectTransport(values,settings);
  assert.equal(diagnostics.status,'error');
  assert.equal(diagnostics.context.advanced,false);
  const bound=metric(diagnostics,'transport-timestep');
  assert.equal(bound.threshold,1/3);
  assert.equal(bound.location.cell,0);
  assert.deepEqual(bound.location.address,[0,0]);
  assert.throws(()=>grid.transport(values,settings),/stability bound .* at cell 0/);
});

test('opposite cell errors remain visible even if the whole-grid balance closes',()=>{
  const values=[.5,1,.75,.5], options={dt:.2,diffusivity:1};
  const observed=grid.transport(values,options).values;
  const clean=grid.inspectTransport(values,options).diagnostics;
  assert.equal(clean.status,'pass');
  observed[1]+=.1;
  observed[2]-=.1;
  const check=grid.inspectTransport(values,options,{observed}).diagnostics;
  assert.equal(check.status,'error');
  assert.equal(metric(check,'transport-balance').severity,'pass');
  const failed=metric(check,'transport-cell-balance');
  assert.equal(failed.severity,'error');
  assert.ok([1,2].includes(failed.location.cell));
  assert.ok(Math.abs(Math.abs(failed.value)-.1)<1e-14);
  assert.deepEqual(check.findings.map(row=>row.location.cell).sort(),[1,2]);
});

test('wave diagnostics locate delay clamping and blocked CFL steps and preserve sample streams',()=>{
  const settings={...waveSettings,method:'delay'};
  const plain=W.waveNetworks.prepare(waveDomain,settings);
  const reviewed=W.waveNetworks.prepare(waveDomain,settings,{diagnostics:true});
  const input={inputs:{tap:1e-5}};
  assert.deepEqual(reviewed.process(60,input),plain.process(60,input));
  assert.deepEqual(reviewed.snapshot(),plain.snapshot());
  const report=reviewed.diagnostics();
  const drift=metric(report,'wave-travel-drift');
  assert.equal(drift.location.tube,'shim');
  assert.ok(drift.value>.9);
  assert.equal(metric(report,'wave-flow-balance').severity,'pass');
  reviewed.restore(reviewed.snapshot());
  assert.equal(reviewed.diagnostics().context.start,60);
  assert.equal(metric(reviewed.diagnostics(),'wave-flow-balance'),undefined);
  const inspected=W.waveNetworks.prepare(waveDomain,settings,{diagnostics:true});
  inspected.process(15,input);
  inspected.process(45,input);
  assert.deepEqual(inspected.diagnostics(),report);
  assert.throws(()=>W.waveNetworks.prepare(waveDomain,waveSettings,{diagnostics:true}),error=>{
    assert.equal(error.diagnostics.context.advanced,false);
    assert.equal(metric(error.diagnostics,'wave-cfl-budget').location.tube,'shim');
    return true;
  });
});

test('a distributed wave audits volume flow at solved connections during all substeps',()=>{
  const domain={...waveDomain,tubes:{...waveDomain.tubes,
    shim:{...waveDomain.tubes.shim,sections:[{length:.08,area:.01}]}}};
  const wave=W.waveNetworks.prepare(domain,waveSettings,{diagnostics:true});
  wave.process(200,{inputs:{tap:1e-6}});
  const report=wave.diagnostics();
  assert.ok(wave.info.substeps>=2);
  assert.equal(metric(report,'wave-flow-balance').severity,'pass');
  assert.equal(metric(report,'wave-substep').location.kind,'section');
  assert.ok(metric(report,'wave-substep').value<=metric(report,'wave-substep').threshold);
});

test('lumped and authored integrators measure real energy drift and name invariant or connection',()=>{
  const run=W.lumpedNetworks.prepare(network,{diagnostics:true});
  const traced=run.advance(9);
  const report=run.diagnostics();
  assert.equal(report.status,'error');
  assert.equal(metric(report,'network-energy-balance').value,traced.ledger.balance);
  assert.deepEqual(metric(report,'network-junction-residual').location,
    {kind:'connection',node:'joint',elements:['anchor']});
  const integrator=W.integrators.create({step:.9,initial:[1,0],derivative(_time,[x,v],out){out[0]=v;out[1]=-x;},
    invariants:{energy:{measure:(_time,[x,v])=>(x*x+v*v)/2}}});
  integrator.advance(9);
  const energy=metric(integrator.diagnostics(),'invariant.energy');
  assert.equal(energy.location.name,'energy');
  assert.ok(energy.value<-.02&&energy.time>8);
  assert.ok(integrator.diagnostics().context.maxAcceptedDt<.90000000000001);
  const adaptive=W.integrators.create({method:'adaptive',initial:[1,1],step:.2,diagnostics:true,
    derivative(_t,[x,y],out){out[0]=0;out[1]=-10*y;}});
  assert.ok(adaptive.advance(.5).stats.rejectedSteps>0);
  assert.equal(metric(adaptive.diagnostics(),'adaptive-trial-error').location.index,1);
});

test('solve diagnostics name the residual row and coupling diagnostics keep the failing connection',()=>{
  const result=W.solvers.sparse({rowPointers:[0,1,2],columns:[0,1],values:[1,1]},[2,-7],{maxIterations:0});
  const residual=metric(D.solve(result),'linear-residual');
  assert.equal(residual.location.row,1);
  assert.equal(residual.value,-7);
  assert.equal(residual.severity,'error');
  const packed=D.coupling({status:'limit',iterations:3,committed:false,links:{
    air:{units:'kg',residual:.02,ratio:12},heat:{units:'J',residual:.001,ratio:.3}
  }});
  assert.equal(packed.status,'error');
  assert.deepEqual(metric(packed,'coupling-residual').location,{kind:'connection',link:'air'});
});

test('state-remap diagnostics reconcile accounted escape and initialization by channel',()=>{
  const target={...gridDefinition,id:'narrow-region',source:{kind:'grid',size:[3,1],spacing:1}};
  const result=W.stateRemap.transfer(W.discretization.compile(gridDefinition),W.discretization.compile(target),
    {heat:{units:'J',values:[1,2,3,4]}});
  const review=D.remap(result);
  assert.equal(review.status,'pass');
  assert.equal(metric(review,'remap-source-balance').details.escaped,4);
  const scaled={...result,ledger:{heat:{...result.ledger.heat,output:5}}};
  const targetBalance=metric(D.remap(scaled),'remap-target-balance');
  assert.equal(targetBalance.value,1);
  assert.deepEqual(targetBalance.location,{kind:'channel',channel:'heat',domain:'narrow-region'});
});

test('CLI writes a diagnostic report when a CI gate fails',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-sim-diag-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const save=(filename,value)=>fs.writeFileSync(path.join(dir,filename),JSON.stringify(value));
  save('grid.json',gridDefinition);
  save('plan.json',{format:W.gridOperators.planFormat,version:1,domain:'grid.json',operation:'transport',values:[1,2,3,4],
    boundary:{cold:{kind:'value',value:0}},settings:{dt:.333,diffusivity:1}});
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(source,gate)=>spawnSync(process.execPath,[cli,'sim','diagnose',source,'--fail-on',gate,'--out','diagnostics.json'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(run('plan.json','error').status,0);
  const aborted=run('plan.json','warning');
  assert.notEqual(aborted.status,0);
  assert.match(aborted.stderr,/reached warning/);
  const report=JSON.parse(fs.readFileSync(path.join(dir,'diagnostics.json'),'utf8'));
  assert.equal(metric(report,'transport-timestep').location.cell,0);
  save('wave.json',{format:W.waveNetworks.runFormat,version:1,settings:waveSettings,network:waveDomain,samples:100});
  assert.notEqual(run('wave.json','error').status,0);
  const failed=JSON.parse(fs.readFileSync(path.join(dir,'diagnostics.json'),'utf8'));
  assert.equal(metric(failed,'wave-cfl-budget').location.tube,'shim');
});
