const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('..').load(), W=K.world, R=W.resonantModes, WAV=require('../cli/wav.js');
const near=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol,`${a} differs from ${b}`);
const point=p=>({point:p});
const base=(source,excitations={drive:point([.25,.31,0])},pickups={read:point([.65,.28,0])})=>
  ({format:R.planFormat,version:1,id:'resonator',revision:2,source,excitations,pickups});
const authored=()=>R.bake(base({kind:'authored',modes:[{id:'tone',hz:100,decay:3}]},
  {drive:{point:[0,0,0],gains:[2]}},{read:{point:[.1,0,0],gains:[3]}}));
function rectMesh(nx,ny,h=.64){
  const positions=[],indices=[];
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++)positions.push(i/nx,h*j/ny,0);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
    indices.push(a,b,d,a,d,c);
  }
  return {positions,indices};
}

test('authored gains and fractional impulses follow the damped sine response',()=>{
  const asset=authored(), resonator=R.prepare(asset,{sampleRate:1000});
  const completed=resonator.process(40,{impulses:[{excitation:'drive',sample:2,fraction:.375,value:1.4}]});
  for(const [i,value] of completed.pickups.read.entries()){
    const t=(i-2.375)/1000,w=2*Math.PI*100;
    near(value,t<=0?0:1.4*6/w*Math.exp(-3*t)*Math.sin(w*t),1e-14);
  }
  assert.equal(asset.excitations.drive.point[0],0);
  assert.throws(()=>R.shape(asset,[0,0,0]),/explicit site gains/);
  assert.throws(()=>R.prepare(asset,{pickups:{read:point([0,0,0])}}),/Invalid modal site/);
});

test('analytic pinned string binds moved pickups and suppresses even harmonics at its center',()=>{
  const asset=R.bake(base({kind:'string',origin:[3,4,5],axis:[0,0,2],length:2,speed:240,count:4},
    {drive:point([3,4,5.3])},{read:point([3,4,6])}));
  assert.deepEqual(asset.modes.map(row=>Math.round(row.hz)),[60,120,180,240]);
  const middle=R.bind(asset).pickups.read.gains, moved=R.bind(asset,{pickups:{read:point([3,4,5.5])}}).pickups.read.gains;
  near(middle[1],0);
  near(middle[3],0);
  near(moved[1],1);
  assert.ok(asset.excitations.drive.point.every((x,i)=>x===[3,4,5.3][i]));
  assert.deepEqual(R.shape(asset,[3,4,5]),[0,0,0,0]);
  assert.throws(()=>R.shape(asset,[3.02,4,6]),/outside the analytic/);
});

test('a verified triangular membrane converges toward the analytical rectangle under refinement',()=>{
  const analytic=R.bake(base({kind:'rectangle',size:[1,.64],speed:300,count:5}));
  const coarse=R.bake(base({kind:'mesh',speed:300,count:5,mesh:rectMesh(9,7)}));
  const refined=R.bake(base({kind:'mesh',speed:300,count:5,mesh:rectMesh(18,12)}));
  for(const [i,expected] of analytic.modes.entries()){
    const a=Math.abs(coarse.modes[i].hz/expected.hz-1),b=Math.abs(refined.modes[i].hz/expected.hz-1);
    assert.ok(b<a&&b<.012);
  }
  assert.ok(refined.evidence.maxRelativeResidual<1e-9);
  assert.ok(refined.evidence.maxOrthonormalError<1e-10);
  assert.ok(refined.evidence.fixedVertices.every(i=>refined.modes.every(mode=>mode.shape[i]===0)));
  const pointA=refined.geometry.vertices[42], viaSite=R.shape(refined,pointA);
  for(const [i,mode] of refined.modes.entries())near(viaSite[i],mode.shape[42]);
  assert.throws(()=>R.shape(refined,[.5,.3,.01]),/outside the mesh/);
  assert.throws(()=>R.bake(base({kind:'mesh',speed:300,count:5,mesh:rectMesh(9,7),maxWork:1})),/work limit/);
});

test('a free tetrahedral cavity skips the constant mode and reproduces its discrete eigenvalues',()=>{
  const mesh={positions:[0,0,0, 1,0,0, 0,1,0, 0,0,1],tetrahedra:[0,1,2,3]};
  const asset=R.bake(base({kind:'mesh',fixed:[],speed:100,count:3,mesh},
    {drive:point([.15,.2,.25])},{read:point([.25,.25,.25])}));
  assert.equal(asset.evidence.skippedZeroModes,1);
  assert.equal(asset.geometry.dimension,3);
  [1,1,2].forEach((n,i)=>near(asset.modes[i].hz,n*100/Math.PI,1e-11));
  for(const [i,value] of R.shape(asset,[.25,.25,.25]).entries()){
    near(value,asset.modes[i].shape.reduce((sum,n)=>sum+n,0)/4);
  }
});

test('held-force response and checkpoint replay stay exact across blocks',()=>{
  const asset=authored(), a=R.prepare(asset,{sampleRate:2000}), b=R.prepare(asset,{sampleRate:2000}), w=2*Math.PI*100;
  const result=a.process(82,{forces:{drive:2}});
  for(const [i,value] of result.pickups.read.entries()){
    const t=i/2000, expected=12/(w*w+9)*(1-Math.exp(-3*t)*(Math.cos(w*t)+3/w*Math.sin(w*t)));
    near(value,expected,1e-15);
  }
  b.process(31,{forces:{drive:2}});
  const c=R.prepare(asset,{sampleRate:2000});
  c.restore(JSON.parse(JSON.stringify(b.snapshot())));
  assert.deepEqual(c.process(51,{forces:{drive:2}}).pickups.read,result.pickups.read.subarray(31));
  assert.deepEqual(c.snapshot(),a.snapshot());
  assert.throws(()=>c.process(1,{impulses:[{excitation:'drive',sample:77,value:1}]}),/out-of-block/);
  assert.deepEqual(c.snapshot(),a.snapshot());
  assert.throws(()=>R.prepare(R.bake(base({kind:'string',length:1,speed:1200,count:1},
    {drive:point([.2,0,0])},{read:point([.4,0,0])})),{sampleRate:1000}),/below Nyquist/);
});

test('the prepared block kernel publishes the same endpoint as the standalone resonator',()=>{
  const asset=authored(), config={asset,excitation:'drive',pickup:'read'};
  const kernel=W.kernels.prepare('modal-resonator',1,config,{dt:.001});
  const direct=R.prepare(asset,{sampleRate:1000});
  kernel.advanceBlock({start:0,end:12,input:{force:1.5}});
  const restored=W.kernels.prepare('modal-resonator',1,config,{dt:.001});
  restored.restore(JSON.parse(JSON.stringify(kernel.snapshot())));
  direct.process(40,{forces:{drive:1.5},collect:false});
  near(restored.advanceBlock({start:12,end:40,input:{force:1.5}}).position,direct.view().pickups.read,1e-15);
});

test('sim resonator bakes a versioned asset and renders a matching WAV',t=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'ink-modal-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const input=base({kind:'string',length:1,speed:200,count:1},
    {drive:point([.25,0,0])},{read:point([.5,0,0])});
  fs.writeFileSync(path.join(out,'bake.json'),JSON.stringify(input));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const exec=(...args)=>execFileSync(process.execPath,[cli,'sim','resonator',...args],{cwd:out});
  exec('bake','bake.json','--out','bank.json');
  const asset=JSON.parse(fs.readFileSync(path.join(out,'bank.json'),'utf8'));
  assert.equal(asset.format,R.assetFormat);
  fs.writeFileSync(path.join(out,'run.json'),JSON.stringify({format:R.runFormat,version:1,asset:'bank.json',
    settings:{sampleRate:1000},samples:32,impulses:[{excitation:'drive',sample:0,fraction:.25,value:1}],
    audio:{pickup:'read',gain:100}}));
  exec('render','run.json','--out','trace.json','--wav','sound.wav');
  const trace=JSON.parse(fs.readFileSync(path.join(out,'trace.json'),'utf8'));
  assert.equal(trace.format,R.traceFormat);
  near(trace.pickups.read[1]*100,WAV.read(path.join(out,'sound.wav')).samples[1],1/32768);
});
