const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('..').load(), W=K.world;
const {measure,format}=W.massProperties;
const plan=(parts,patch={})=>({format,version:1,id:'balance',revision:1,parts,...patch});
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
const plain=value=>JSON.parse(JSON.stringify(value));
const {pack,density}=(()=>{
  const density={dry:600,wet:750};
  return {density,pack:{format:'ink-studio/asset-pack',version:1,id:'bench',title:'Bench stock',revision:3,materials:[
    {id:'bench/stock',label:'Stock',density,elastic:{youngModulus:{dry:1e9,wet:8e8},poissonRatio:0.28},
      damping:{dry:0.1,wet:0.2},intrinsicPermeability:2e-11,permeability:0.04,
      thermal:{specificHeat:1800,conductivity:0.19,expansion:2e-5}}
  ]}};
})();
const box=(half,center)=>({kind:'box',half,...(center!==undefined&&{center})});

function cube(h,center=[0,0,0]) {
  const [x,y,z]=h;
  const points=[[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]].map(p=>K.V.add(p,center));
  const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,4,7],[0,7,3],
    [1,2,6],[1,6,5],[0,1,5],[0,5,4],[3,7,6],[3,6,2]];
  return {points,faces};
}

test('physical material assets retain new coefficients, revision, wetness and old thermal behavior',()=>{
  const world=W.runtime.create({assetPacks:[pack]});
  const sample=world.query().probe('world/material',{}, {id:'bench/stock',wetness:0.5}).value;
  assert.equal(sample.revision,3);
  assert.equal(sample.density,675);
  assert.equal(sample.elastic.youngModulus,9e8);
  assert.equal(sample.elastic.poissonRatio,0.28);
  close(sample.damping,0.15);
  assert.equal(sample.intrinsicPermeability,2e-11);
  assert.equal(sample.permeability,0.04);
  assert.equal(sample.thermal.specificHeat,1800);
  for(const material of [
    {...pack.materials[0],density:-1},
    {...pack.materials[0],elastic:{poissonRatio:0.5}},
    {...pack.materials[0],thermal:{conductance:30}},
    {...pack.materials[0],thermal:{conductivity:-2}}
  ]) assert.throws(()=>K.authoring.assetPacks.manifest({...pack,materials:[material]}),/Invalid physical material/);
});

test('reports use SI dimensional values with world centres and full rotated inertia tensors',()=>{
  const rotation=K.M.rot([0,0,1],Math.PI/2);
  const result=measure(plan({body:{source:box([2,1,1]),pose:{translate:[10,3,4],rotation},density:100,
    probes:[{id:'axial',from:[10,-5,4],to:[10,9,4]}]}},{metersPerUnit:0.5,about:[10,2,4]}));
  const {body}=result.parts;
  close(body.volume,2);
  close(body.area,10);
  close(body.mass,200);
  assert.deepEqual(plain(body.centerOfMass),[10,3,4]);
  close(body.inertia[0],200*1.25/3);
  close(body.inertia[4],200*0.5/3);
  close(body.about.tensor[0],body.inertia[0]+50);
  close(body.about.tensor[4],body.inertia[4]);
  close(body.probes[0].minimum,2);
  const diagonal=measure(plan({body:{source:box([2,1,1]),density:1,
    pose:{rotation:K.M.rot([0,0,1],Math.PI/4)}}})).inertia;
  assert.ok(Math.abs(diagonal[1])>1);
  close(diagonal[1],diagonal[3]);
});

test('mixed assemblies use volume weights separately from mass and report missing densities',()=>{
  const rows={a:{source:box([1,1,1],[-2,0,0]),material:'bench/stock',wetness:0.5},
    b:{source:box([1,1,1],[2,0,0]),density:225}};
  const result=measure(plan(rows,{assetPacks:[pack],about:[0,0,0]}));
  assert.equal(result.mass,7200);
  assert.equal(result.volume,16);
  assert.deepEqual(plain(result.volumeCentroid),[0,0,0]);
  close(result.centerOfMass[0],-1);
  close(result.inertia[8],7200*(2/3+3));
  close(result.about.tensor[8],result.inertia[8]+7200);
  assert.deepEqual(plain(result.missingMass),[]);

  const partial=measure(plan({...rows,b:{source:rows.b.source}},{assetPacks:[pack]}));
  assert.equal(partial.volume,16);
  assert.equal(partial.mass,null);
  assert.equal(partial.inertia,null);
  assert.deepEqual(plain(partial.missingMass),['b']);
});

test('watertight mesh moments subtract the void, and probes report separate material spans',()=>{
  const outer=cube([2,2,2],[100000,0,0]), inner=cube([1,1,1],[100000,0,0]);
  const mesh={points:[...outer.points,...inner.points],
    faces:[...outer.faces,...inner.faces.map(face=>face.map(i=>i+8).reverse())]};
  const p={source:{kind:'mesh',mesh},density:1,probes:[
    {id:'walls',from:[99997,0.2,0.1],to:[100003,0.2,0.1]},
    {id:'clipped',from:[99998.5,0.2,0.1],to:[100003,0.2,0.1]}
  ]};
  const result=measure(plan({shell:p})), out=result.parts.shell;
  close(out.volume,56);
  close(out.area,120);
  close(out.centerOfMass[0],100000);
  close(out.inertia[0],496/3);
  close(out.probes[0].minimum,1);
  assert.equal(out.probes[0].spans.length,2);
  assert.equal(out.probes[1].status,'clipped');
  assert.equal(out.probes[1].minimum,null);
  const reversed=measure(plan({shell:{...p,source:{...p.source,mesh:{...mesh,faces:mesh.faces.map(f=>f.slice().reverse())}}}}));
  close(reversed.volume,result.volume);
});

test('surface area is available for open meshes and a declared shell thickness supplies volume and inertia',()=>{
  const mesh={points:[[0,0,0],[2,0,0],[2,1,0],[0,1,0]],faces:[[0,1,2],[0,2,3]]};
  const open=measure(plan({sheet:{source:{kind:'mesh',mesh},density:100}})).parts.sheet;
  close(open.area,2);
  assert.equal(open.volume,null);
  assert.equal(open.status,'unclosed-surface');
  const shell=measure(plan({sheet:{source:{kind:'mesh',mesh,shellThickness:0.2},density:100}})).parts.sheet;
  close(shell.mass,40);
  close(shell.inertia[0],40*1.04/12);
  close(shell.inertia[4],40*4.04/12);
  close(shell.shellThickness,0.2);
  assert.equal(shell.method,'thin-shell');
});

test('analytic bore, bounded SDFs, and compiled cut-cell domains publish measured properties',()=>{
  const report=measure(plan({bore:{source:{kind:'cylinder',height:2,radius:1,innerRadius:0.6},density:1,probes:[
    {id:'bore-wall',from:[-2,0,0],to:[2,0,0]},
    {id:'air',from:[0,-2,0],to:[0,2,0]}]}}));
  close(report.volume,Math.PI*0.64*2);
  close(report.parts.bore.thickness,0.4);
  assert.equal(report.parts.bore.probes[1].status,'miss');
  const sphere={kind:'sdf',field:(x,y,z)=>Math.hypot(x,y,z)-1,
    bounds:{min:[-1.2,-1.2,-1.2],max:[1.2,1.2,1.2]},resolution:0.075};
  const ball=measure(plan({ball:{source:sphere,density:1}}));
  close(ball.volume,4*Math.PI/3,0.05);
  close(ball.inertia[0],8*Math.PI/15,0.05);
  assert.throws(()=>measure(plan({ball:{source:{...sphere,bounds:{min:[-0.5,-0.5,-0.5],max:[0.5,0.5,0.5]}}}})),
    /positive at the sampling bounds/);
  const {compile,format}=W.discretization, domain=compile({format,version:1,id:'sample',revision:1,
    source:{kind:'grid',size:[2,2,1],cutPlanes:[{id:'edge',normal:[1,1,0],offset:2.5}]}});
  const cut=measure(plan({solid:{density:3,source:{kind:'discretization',domain}}}));
  close(cut.volume,domain.measure);
  close(cut.mass,domain.measure*3);
});

test('the CLI resolves imported assets and the report binds into a model',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-mass-properties-')), cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const write=(file,value)=>fs.writeFileSync(path.join(folder,file),typeof value==='string'?value:JSON.stringify(value));
  try {
    const mesh=cube([1,1,1]);
    write('block.obj',K.mesh.toObj(K.mesh.make(mesh.points.flat(),mesh.faces.flat())));
    write('pack.json',pack);
    write('bench.json',plan({body:{source:{kind:'mesh',file:'block.obj'},material:'bench/stock',wetness:1}}));
    execFileSync(process.execPath,[cli,'sim','mass-properties','bench.json','--asset-pack','pack.json','--out','report.json'],{cwd:folder});
    const report=JSON.parse(fs.readFileSync(path.join(folder,'report.json'),'utf8'));
    assert.equal(report.parts.body.material.density,density.wet);
    const model={format:W.models.format,version:1,id:'move-stock',revision:1,seed:2,numerics:{dt:0.05},
      domain:{report},parameters:{},initial:{},boundaries:{},inputs:{},outputs:{},probes:{},
      operators:{mechanics:{kind:'mechanics',revision:1,config:{bodies:{body:{half:[1,1,1],
        mass:{$model:'/domain/report/mass'}}}}}}};
    const run=W.runtime.create(model);
    assert.equal(run.view().states.mechanics.bodies.body.mass,6000);
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
});
