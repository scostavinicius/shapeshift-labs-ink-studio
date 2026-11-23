const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('..').load(), {discretization:D,gridOperators:O}=K.world;
const compile=(source,regions)=>D.compile({format:D.format,version:1,id:'domain',revision:1,units:'m',source,regions});
const near=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol,`${a} differs from ${b}`);
const tagSides=(...names)=>names.map(tag=>({tag,side:tag}));
const as=list=>Array.from(list);
function linear(x,y,z){
  return 9+2*x-3*y+4*z;
}

test('regular anisotropic grids reproduce affine gradients, face values and point samples',()=>{
  const domain=compile({kind:'grid',size:[4,3],plane:'xz',spacing:[.3,.7],origin:[.2,1.2]},tagSides('x0','x1','z0','z1'));
  const ops=O.prepare(domain), u=domain.cells.map(({center})=>linear(...center));
  const boundary=Object.fromEntries([['x0',-2],['x1',2],['z0',-4],['z1',4]].map(([tag,value])=>[tag,{kind:'gradient',value}]));
  const gradient=ops.gradient(u,{boundary}), faces=ops.interpolate(u,{boundary});
  domain.cells.forEach((_,i)=>[2,0,4].forEach((v,j)=>near(gradient[i*3+j],v)));
  domain.faces.forEach((f,i)=>near(faces[i],linear(...f.center)));
  const point=[.3,0,1.55], [sample]=ops.sample(u,[{cell:0,point}],{boundary});
  near(sample,linear(...point));
  assert.ok(as(ops.diffusion(u,{boundary}).rate).every(n=>Math.abs(n)<1e-10));
});

test('skewed surface triangles reconstruct affine states with face-centred boundary values',()=>{
  const source={kind:'mesh',positions:[0,0,0, 2,0,0, .2,1,0, 2,2,0],indices:[0,1,2, 2,1,3]};
  const edges=[[0,1],[2,0],[1,3],[3,2]];
  const domain=compile(source,edges.map((vertices,i)=>({tag:'side'+i,vertices:[vertices]})));
  const ops=O.prepare(JSON.parse(JSON.stringify(domain))), values=domain.cells.map(({center})=>linear(...center));
  const boundary=Object.fromEntries(domain.faces.filter(f=>f.region!==null)
    .map(f=>[f.region,{kind:'value',value:linear(...f.center)}]));
  const gradients=ops.gradient(values,{boundary}), faces=ops.interpolate(values,{boundary,scheme:'reconstructed'});
  domain.cells.forEach((_,i)=>[2,-3,0].forEach((v,j)=>near(gradients[i*3+j],v)));
  domain.faces.forEach((f,i)=>near(faces[i],linear(...f.center)));
  const diffusion=ops.diffusion([1,0]);
  assert.ok(diffusion.rate[0]<0&&diffusion.rate[1]>0);
  near(diffusion.rate.reduce((sum,rate,i)=>sum+rate*domain.cells[i].measure,0),0);
});

test('folded surface neighbors use their own in-surface gradients and share one flux',()=>{
  const source={kind:'mesh',positions:[0,0,0, 2,0,0, .5,-1,0, .5,0,1],indices:[0,2,1, 0,1,3]};
  const edges=[[0,2],[2,1],[1,3],[3,0]];
  const domain=compile(source,edges.map((vertices,i)=>({tag:'side'+i,vertices:[vertices]})));
  const ops=O.prepare(domain), unfolded=([x,y,z])=>x+y+z;
  const values=domain.cells.map(row=>unfolded(row.center));
  const boundary=Object.fromEntries(domain.faces.filter(f=>f.region!==null)
    .map(f=>[f.region,{kind:'value',value:unfolded(f.center)}]));
  const g=ops.gradient(values,{boundary}), outward=ops.flux([0,1,0, 0,0,1],{location:'cells'});
  [1,1,0,1,0,1].forEach((value,i)=>near(g[i],value));
  const seam=domain.faces.find(f=>f.neighbor!==null);
  near(outward[seam.id],seam.area);
  near(ops.divergence(outward).reduce((sum,rate,i)=>sum+rate*domain.cells[i].measure,0),0);
});

test('tetrahedra share an oriented diffusive transfer through a harmonic interface',()=>{
  const domain=compile({kind:'mesh',positions:[0,0,0, 1,0,0, 0,1,0, 0,0,1, 0,0,-2],tetrahedra:[0,1,2,3, 0,2,1,4]});
  const ops=O.prepare(domain), seam=domain.faces.find(f=>f.neighbor!==null);
  const result=ops.diffusion([2,0],{diffusivity:[1,2]});
  near(result.flux[seam.id],seam.area*2/(seam.ownerDistance+seam.neighborDistance/2));
  near(result.rate.reduce((sum,rate,i)=>sum+rate*domain.cells[i].measure,0),0);
  const blocked=ops.diffusion([2,0],{diffusivity:[1,0]});
  assert.equal(blocked.flux[seam.id],0);
  assert.equal(blocked.stableDt,null);
});

test('cut cells keep their measures in the explicit transport balance',()=>{
  const domain=compile({kind:'grid',size:[4,3,2],spacing:[.5,.7,.6],
    cutPlanes:[{id:'bank',normal:[1,.3,.2],offset:1.8}]});
  const ops=O.prepare(domain), values=domain.cells.map(({center})=>linear(...center));
  const {stableDt}=ops.diffusion(values), result=ops.transport(values,{dt:stableDt*.8,diffusivity:1});
  assert.ok(domain.cells.some(c=>c.fraction<.5));
  near(result.ledger.after,result.ledger.before);
  assert.equal(result.ledger.netOut,0);
  assert.ok(as(result.values).every(v=>v>=Math.min(...values)&&v<=Math.max(...values)));
});

test('tagged inflow and outflow conserve transported amount and apply the combined stable step',()=>{
  const ops=O.prepare(compile({kind:'grid',size:[3,1]},tagSides('x0','x1')));
  const boundary={x0:{kind:'open',inflow:1},x1:{kind:'open'}};
  const carrierFlux=ops.flux([.75,0,0],{location:'constant',boundary});
  const div=ops.divergence(carrierFlux);
  assert.ok(as(div).every(v=>v===0));
  const a=ops.transport([0,.5,1],{dt:.25,carrierFlux,boundary});
  near(a.ledger.boundary.x0.in,.1875);
  near(a.ledger.boundary.x1.out,.1875);
  near(a.ledger.error,0);
  const combined={...boundary,x0:{kind:'value',value:1}};
  const transport=ops.transport([0,0,0],{dt:.2,diffusivity:1,carrierFlux,boundary:combined});
  assert.ok(as(transport.values).every(v=>v>=0));
  assert.ok(transport.stableDt<ops.diffusion([0,0,0],{boundary:combined}).stableDt);
  near(transport.ledger.after,transport.ledger.boundary.x0.in);
  assert.throws(()=>ops.transport([0,0,0],{dt:1,diffusivity:1,carrierFlux,boundary:combined}),/stability bound/);
  assert.throws(()=>ops.advection([0,0,0],{carrierFlux,boundary:{...boundary,x0:{kind:'open'}}}),/inflow value/);
});

test('boundary application distinguishes imposed values, gradients, and prescribed diffusive flux',()=>{
  const domain=compile({kind:'grid',size:[1,1]},tagSides('x0','x1','y0','y1'));
  const ops=O.prepare(domain);
  const boundary={x0:{kind:'value',value:4},x1:{kind:'gradient',value:3},y0:{kind:'flux',value:6},y1:{kind:'closed'}};
  const rows=Object.fromEntries(ops.applyBoundaries([1],{boundary,diffusivity:2}).map(row=>[row.region,row]));
  assert.equal(rows.x0.value,4);
  assert.equal(rows.x0.normalGradient,6);
  assert.equal(rows.x0.advectiveInflow,4);
  assert.equal(rows.x1.value,2.5);
  assert.equal(rows.x1.diffusiveFluxDensity,-6);
  assert.equal(rows.y0.normalGradient,-3);
  assert.equal(rows.y0.diffusiveFluxDensity,6);
  near(ops.diffusion([1],{boundary,diffusivity:2}).rate[0],12);
  assert.ok(as(ops.advection([1],{boundary,carrierFlux:[0,0,0,0]}).flux).every(v=>v===0));
  assert.throws(()=>ops.faceGradient([1],{boundary,diffusivity:0}),/undefined/);
  assert.throws(()=>ops.diffusion([1],{boundary:{misspelled:{kind:'closed'}}}),/boundary region/);
  assert.throws(()=>ops.divergence([0,,0,0]),/component/);
});

test('sim grid-ops resolves authored relative domains and writes a portable transport report',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-grid-ops-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  const domain={format:D.format,version:1,id:'cli',revision:1,source:{kind:'grid',size:[2,1]},regions:tagSides('x0','x1')};
  fs.writeFileSync(path.join(root,'domain.json'),JSON.stringify(domain));
  fs.writeFileSync(path.join(root,'plan.json'),JSON.stringify({format:O.planFormat,version:1,domain:'domain.json',
    operation:'transport',values:[0,0],boundary:{x0:{kind:'value',value:1},x1:{kind:'open'}},
    settings:{velocity:[1,0,0],location:'constant',dt:.25}}));
  execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),
    'sim','grid-ops','plan.json','--out','report.json'],{cwd:root});
  const report=JSON.parse(fs.readFileSync(path.join(root,'report.json'),'utf8'));
  assert.equal(report.format,O.reportFormat);
  assert.deepEqual(report.result.values,[.25,0]);
  assert.equal(report.result.ledger.boundary.x0.in,.25);
  assert.equal(report.result.ledger.error,0);
});
