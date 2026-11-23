const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('..').load();
const {measure}=K.procedural.pathSections, {V}=K;
const road=[[0,0,0],[0,0,4]];
const rect=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d]];
const close=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b} by more than ${tolerance}`);
const plain=value=>JSON.parse(JSON.stringify(value));
const profile=(loops)=>({kind:'contours',profiles:[{at:0,loops}]});
const cube=()=>{
  const corners=[[-2,-1],[2,-1],[2,1],[-2,1]], pos=[0,4].flatMap(z=>corners.flatMap(([x,y])=>[x,y,z]));
  const tri=[0,2,1,0,3,2,4,5,6,4,6,7];
  for(let i=0;i<4;i++){
    const next=(i+1)%4;
    tri.push(i,next,next+4,i,next+4,i+4);
  }
  return {pos,tri};
};

test('indexed and unindexed sections follow an oblique route and include coplanar caps once',()=>{
  const mesh=cube(), t=V.norm([1,2,3]), u=V.perp(t), v=V.cross(t,u), origin=[3,-2,5];
  function point([x,y,z]) {
    return V.mad(V.mad(V.mad(origin,u,x),v,y),t,z);
  }
  const pos=Array.from({length:8},(_,i)=>point(mesh.pos.slice(i*3,i*3+3))).flat();
  const line=[point([0,0,0]),point([0,0,4])], route=K.procedural.routes.polyline(line);
  const stations=[0,1,3,route.length];
  for(const sourceMesh of [{pos,tri:mesh.tri},{positions:mesh.tri.flatMap(i=>pos.slice(3*i,3*i+3))}]){
    const result=measure({path:route,distances:stations,source:{kind:'mesh',mesh:sourceMesh},contours:true});
    assert.equal(result.complete,true);
    for(const row of result.sections){
      assert.equal(row.status,'ok');
      assert.equal(row.components,1);
      close(row.area,8);
      close(row.perimeter,12);
      close(row.minimumOpening,2);
      close(row.centerClearance,2);
      close(V.dot(row.tangent,row.u),0);
      assert.equal(row.contours.length,1);
    }
    close(result.sections.reduce((sum,row)=>sum+row.sectionLength,0),4);
  }
});

test('a broken mesh produces an open diagnostic and no fabricated dimensions',()=>{
  const mesh=cube();
  mesh.tri.splice(-6);
  const report=measure({path:road,source:{kind:'mesh',mesh},samples:1});
  assert.equal(report.complete,false);
  assert.equal(report.sections[0].status,'open');
  assert.equal(report.sections[0].perimeter,null);
  assert.equal(report.minima.area,null);
  assert.throws(()=>measure({path:road,source:{kind:'mesh',mesh},samples:5,maxWork:12}),/work budget/);
});

test('SDF marching retains annular holes and distinguishes a clipped or undefined plane',()=>{
  const bounds={min:[-2,-2],max:[2,2]}, field=(x,y)=>Math.max(Math.hypot(x,y)-1.2,0.4-Math.hypot(x,y));
  const source={kind:'sdf',field,bounds,cell:0.02};
  const a=measure({path:road,source,selection:'all',contours:true,samples:1}).sections[0];
  assert.equal(a.status,'ok');
  close(a.area,Math.PI*(1.2**2-0.4**2),0.0025);
  close(a.perimeter,2*Math.PI*(1.2+0.4),0.003);
  close(a.minimumOpening,2.4,0.001);
  assert.equal(a.centerClearance,0);
  assert.deepEqual(Array.from(a.contours.map(row=>row.kind)).sort(),['hole','outer']);
  const center=measure({path:road,source,samples:1}).sections[0];
  assert.equal(center.status,'empty');
  assert.equal(center.area,0);
  const clipped=measure({path:road,source:{...source,bounds:{min:[-1,-1],max:[1,1]}},samples:1}).sections[0];
  assert.equal(clipped.status,'clipped');
  assert.equal(clipped.area,null);
  const missing=measure({path:road,source:{...source,field:(x,y)=>x>1?null:field(x,y)},samples:1}).sections[0];
  assert.equal(missing.status,'undefined');
  assert.equal(missing.minimumOpening,null);
});

test('contour keys interpolate corresponding vertices in the section frame',()=>{
  const source={kind:'contours',profiles:[
    {at:0,loops:[rect(-2,-1,2,1),rect(0.6,-0.2,1.2,0.2).reverse(),rect(3,-0.4,4,0.4)]},
    {at:1,loops:[rect(-1,-0.5,1,0.5),rect(0.3,-0.1,0.6,0.1),rect(3,-0.4,4,0.4)]}
  ]};
  source.profiles[1].loops[1].reverse();
  const mid=measure({path:road,source,distances:[2],contours:true}).sections[0];
  close(mid.area,4.5-0.45*0.30);
  close(mid.perimeter,9+2*(0.45+0.30));
  close(mid.minimumOpening,1.5);
  close(mid.centerClearance,0.9);
  assert.equal(mid.contours.find(row=>row.kind==='hole').selected,true);
  const all=measure({path:road,source,distances:[2],selection:'all'}).sections[0];
  close(all.area,mid.area+0.8);
  close(all.minimumOpening,0.8);
  assert.equal(all.components,2);
  const crossed=measure({path:road,source:profile([rect(-2,-1,2,1),rect(1,0,3,2)]),distances:[2]});
  assert.equal(crossed.sections[0].status,'ambiguous');
  assert.equal(crossed.complete,false);
});

test('paired channel banks return an arc-length-weighted section profile',()=>{
  const source={kind:'contours',banks:{
    left:[[0,-2],[0.5,-0.5],[1,-1]],right:[[0,2],[1,1]],depth:1.25
  }};
  const result=measure({path:road,source,range:[0.5,3.75],distances:[0.5,2,3.5]});
  const mid=result.sections[1];
  close(mid.area,2.5);
  close(mid.perimeter,6.5);
  close(mid.centerClearance,1);
  close(mid.minimumOpening,1.25);
  assert.deepEqual(plain(result.sections.map(row=>row.span)),[[0.5,1.25],[1.25,2.75],[2.75,3.75]]);
  close(result.sections.reduce((sum,row)=>sum+row.sectionLength,0),result.measuredLength);
  assert.equal(result.minima.area.index,1);
  const cross={...source,banks:{...source.banks,left:[[0,-2],[0.25,3],[1,-1]]}};
  assert.throws(()=>measure({path:road,source:cross}),/banks cross/);
});

test('CLI measures raw-unit OBJ and a native JSON sculpt',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-path-sections-')), cli=path.join(__dirname,'../cli/ink-studio.js');
  const base={format:'ink-studio/path-section-plan',version:1,path:road,distances:[2]};
  const plan=path.join(folder,'test.json'), file=path.join(folder,'result.json');
  function run(source) {
    fs.writeFileSync(plan,JSON.stringify({...base,source}));
    execFileSync(process.execPath,[cli,'sim','sections',plan,'--out',file]);
    return JSON.parse(fs.readFileSync(file,'utf8')).sections[0];
  }
  try {
    const {pos,tri}=cube();
    fs.writeFileSync(path.join(folder,'duct.obj'),K.mesh.toObj(K.mesh.make(pos,tri)));
    close(run({kind:'mesh',file:'duct.obj'}).area,8);
    fs.writeFileSync(path.join(folder,'duct.json'),JSON.stringify({id:'test-duct',
      solids:[{kind:'box',at:[0,0,2],half:[2,1,2]}]}));
    const sdf=run({kind:'sdf',file:'duct.json',bounds:{min:[-2.5,-1.5],max:[2.5,1.5]},cell:0.03});
    close(sdf.area,8,0.004);
    close(sdf.minimumOpening,2,0.003);
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
});
