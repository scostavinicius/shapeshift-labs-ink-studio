const test=require('node:test'),assert=require('node:assert/strict');
const core=require('..'),{KIT:K,makeBuilder}=core.load(),{V,M}=K;
const near=(a,b,e=1e-5)=>assert(Math.abs(a-b)<e,`${a} != ${b}`);
const vectorNear=(a,b,e=1e-5)=>a.forEach((v,i)=>near(v,b[i],e));
const row=(D,i)=>Array.from(D.subarray(i*16,i*16+16));
function fixture(n=12,options={}){
  const B=makeBuilder(12,[0x101e28,0x3acbd9,0xffb96c]);
  for(let i=0;i<n;i++)B.disc((i%4)*.14,Math.floor(i/4)*.15+.8,0,[0,0,1],.04,.007,B.P[1],2.6);
  const W=B.finish(),stage=K.stage(W),ids=Array.from({length:n},(_,i)=>i);
  const fx=stage.add(K.materialisation.bind(stage,{ids,...options}));return {B,W,stage,ids,fx};
}
function gpuFixture(){
  const B=makeBuilder(12,[0,0x3acbd9]);B.disc(1,1,0,[0,0,1],.1,.02,B.P[1],2.6);
  const W=B.finish(),stage=K.stage(W),bones=new Float32Array(24);bones[0]=bones[4]=bones[8]=bones[12]=bones[16]=bones[20]=1;
  K.bones.tag(W,[0],[1]);stage.bones=bones;stage.boned=Int32Array.of(0);
  return {W,stage,bones};
}

test('materialisation reuses actual carriers and keeps untouched surface rows exact',()=>{
  const {W,stage,fx}=fixture(),before=W.data.slice();
  assert.deepEqual(W.data,before);assert.equal(fx.stats.home,12);
  fx.release({ids:[0,1],velocity:[2,0,0],normalImpulse:0});
  for(let i=0;i<W.data.length;i++)if(i%16!==11)near(W.data[i],before[i]);assert.equal(stage.geometryOwned[0],1);assert.equal(stage.geometryOwned[2],0);
  fx.advance(.5);assert.equal(W.count,12);assert.notDeepEqual(row(W.data,0),row(before,0));
  for(let i=2;i<12;i++)assert.deepEqual(row(W.data,i),row(before,i));
  assert(W.data.every(Number.isFinite));
});

test('GPU posed release preserves current position, full covariance, normals and restored skinning',()=>{
  const {W,stage,bones}=gpuFixture(),turn=M.rot([0,1,0],.7);bones.set(turn,12);bones[21]=2;
  const original=row(W.data,0),posed=K.bones.posed(W).slice(),fx=stage.add(K.materialisation.bind(stage,{ids:[0]}));
  fx.release({velocity:[0,0,0],normalImpulse:0});
  vectorNear(row(W.data,0).slice(0,3),row(posed,0).slice(0,3));for(const k of [4,5,6,8,9,10])near(W.data[k],posed[k]);
  assert.equal(W.data[11]%16,0);assert.deepEqual(K.bones.posed(W),W.data);
  fx.advance(.1);fx.rejoin({duration:.4});bones[21]=3;fx.advance(.4);
  assert.equal(W.data[11],original[11]);assert.deepEqual(row(W.data,0),original);assert.equal(stage.geometryOwned[0],0);
  vectorNear(Array.from(K.bones.posed(W).slice(0,3)),V.add(M.app(turn,[1,1,0]),[3,0,0]));
});

test('CPU rig releases inherit sampled motion and rejoin the current nonuniformly transformed part',()=>{
  const {W,stage}=fixture(4),fx0=stage.systems.pop();stage.painters.splice(stage.painters.indexOf(fx0),1);fx0.dispose();
  const matrix=new Float32Array(24);matrix[0]=matrix[4]=matrix[8]=matrix[12]=matrix[16]=matrix[20]=1;
  stage.rig={M:matrix,bid:new Uint16Array(W.count).fill(1),free:new Uint8Array(W.count)};
  const fx=stage.add(K.materialisation.bind(stage,{ids:[0,1,2,3],drag:0}));
  fx.update(.05);matrix[21]=.2;fx.update(.05);fx.release({normalImpulse:0});near(fx.inspect(0).velocity[0],4);
  fx.advance(.1);assert.equal(stage.rig.free[0],1);
  fx.rejoin({duration:.5});matrix[12]=1.7;matrix[16]=.65;matrix[21]=2;fx.advance(.5);
  vectorNear(row(W.data,0).slice(0,3),[2,.8*.65,0]);assert.equal(stage.rig.free[0],0);assert.equal(stage.geometryOwned[0],0);
});

test('shared flow, custom forces and fixed substeps are independent of visual frame partitions',()=>{
  const settings={flow:K.flow.sum(K.flow.wind([1,.4,0]),K.flow.vortex([0,1,0],[0,1,0],.2,4)),forces:[(ctx,out)=>{out[1]=-.1;}],drag:2};
  const a=fixture(12,settings),b=fixture(12,settings);a.fx.release();b.fx.release();
  a.fx.advance(1);for(let i=0;i<60;i++)b.fx.advance(1/60);
  assert.deepEqual(a.W.data,b.W.data);assert.equal(a.fx.stats.ticks,120);assert(a.fx.inspect(0).position[0]>.3);
});

test('retargeting and interrupted gathering have no position, opacity or covariance jump',()=>{
  const target=K.materialisation.anchors.points([[2,2,0],[-1,2,0]],{size:.02,color:'#ffb96c',pose(out,t){out.position[1]+=.2*Math.sin(t);}});
  const {fx,W}=fixture(12,{targets:{bloom:target},paths:[K.materialisation.paths.arc({height:1}),K.materialisation.paths.vortex({radius:.3,turns:2})]});
  fx.release();fx.advance(.25);const before=W.data.slice();fx.gather('bloom',{duration:1});assert.deepEqual(W.data,before);
  fx.advance(.37);const interrupted=W.data.slice();fx.rejoin({duration:.7});assert.deepEqual(W.data,interrupted);
  fx.advance(.7);assert.equal(fx.stats.home,12);
});

test('moving target anchors remain exact after settling; gather mappings are bounded and reproducible',()=>{
  const target=K.materialisation.anchors.points([[2,1,0],[2,2,0],[2,3,0]],{color:'#ffb96c',pose(out,t){out.position[0]+=t*.2;}});
  const {fx,W}=fixture(12,{targets:{form:target}});fx.gather('form',{duration:.4,mapping:'index'});fx.advance(.4);
  assert.equal(fx.stats.settled,12);for(let i=0;i<12;i++)vectorNear(row(W.data,i).slice(0,3),[2.08,1+Math.floor(i/4),0]);
  fx.advance(.5);for(let i=0;i<12;i++)near(W.data[i*16],2.18);
  const source=K.materialisation.anchors.points([[0,0,0],[0,1,0],[0,2,0]]),mapping=K.materialisation.correspondence(source,target,{mapping:'transport',transport:{iterations:20}});
  assert.equal(mapping.length,3);for(const links of mapping){assert(links.length<=4);near(links.reduce((sum,p)=>sum+p[1],0),1);}
});

test('staggered gathers keep untouched animated surfaces attached until each departure',()=>{
  const home=K.materialisation.anchors.points([[0,0,0],[0,1,0]],{pose(out,t){out.position[0]=t;}}),target=K.materialisation.anchors.points([[3,0,0],[3,1,0]]);
  const {fx,W,stage}=fixture(2,{source:home,targets:{form:target}});fx.gather('form',{duration:1,stagger:1});
  const snap=fx.snapshot();assert(snap.particles.some(s=>s.pending));
  const waiting=snap.particles.findIndex(s=>s.pending?.at>.05);fx.advance(.025);
  if(waiting>=0){near(W.data[waiting*16],.025);assert.equal(fx.inspect(waiting).mode,'home');}
  fx.advance(2);assert.equal(fx.stats.settled,2);assert(W.data.every(Number.isFinite));
});

test('dissolves fully hide selected geometry and reveals restore exact original rows',()=>{
  const {fx,W}=fixture(),before=W.data.slice();fx.dissolve({ids:[0,1,2],duration:.4,stagger:.1});fx.advance(.8);
  assert.equal(fx.stats.hidden,3);for(let i=0;i<3;i++)assert.equal(W.data[i*16+3],0);for(let i=3;i<12;i++)assert.deepEqual(row(W.data,i),row(before,i));
  fx.reveal({duration:.6});fx.advance(.6);assert.deepEqual(W.data,before);
  const black=fixture(4,{visible:false});assert.equal(black.fx.stats.hidden,4);assert(black.ids.every(i=>black.W.data[i*16+3]===0));
  black.fx.reveal({duration:.5});black.fx.advance(.5);assert.equal(black.fx.stats.home,4);
});

test('a repeatable timeline performs release, form gathering and full reattachment without adding splats',()=>{
  const target=K.materialisation.anchors.points([[2,1,0],[2,2,0]]),{fx,W}=fixture(12,{targets:{form:target}});
  fx.timeline([{at:.25,action:'release'},{at:.75,action:'gather',target:'form',options:{duration:.5}},{at:1.5,action:'rejoin',options:{duration:.5}}],{loop:2.5});
  fx.advance(2.2);assert.equal(fx.stats.home,12);const first=W.data.slice();fx.advance(2.5);assert.deepEqual(W.data,first);
  assert.equal(W.count,12);assert(fx.drainEvents().some(e=>e.type==='arrive'));
});

test('checkpoints branch exactly and invalid restore leaves geometry and state untouched',()=>{
  const {fx,W}=fixture(12,{flow:K.flow.wind([1,.3,0])});fx.release();fx.advance(.37);const saved=JSON.parse(JSON.stringify(fx.snapshot()));
  fx.advance(.5);const expected=W.data.slice(),state=fx.snapshot();fx.restore(saved);fx.advance(.5);assert.deepEqual(W.data,expected);
  const before=fx.snapshot(),data=W.data.slice(),bad=JSON.parse(JSON.stringify(saved));bad.particles[0].links=[[9999,1]];
  assert.throws(()=>fx.restore(bad),/checkpoint/);assert.deepEqual(W.data,data);assert.deepEqual(fx.snapshot(),before);
  assert.equal(state.particles.length,12);
});

test('chart anchors keep material coordinates on a deforming surface and provide flat splat covariance',()=>{
  const provider=K.materialisation.anchors.chart(t=>({sample:([u,v])=>({p:[u,v,Math.sin(t)*u],n:[-Math.sin(t),0,1]})}),[[.2,.4],[.7,.8]],{color:'#3acbd9'});
  const a=provider.sample(0,0),b=provider.sample(0,1);near(a.position[2],0);near(b.position[2],Math.sin(1)*.2);assert(b.covariance[0]>0);
  assert.equal(b.color,K.materialisation.color('#3acbd9'));
});

test('geometry ownership excludes competing bindings and preserves unrelated destruction',()=>{
  const {fx,stage,ids}=fixture(12);assert.throws(()=>K.materialisation.bind(stage,{ids:[0,1]}),/reserved/);
  assert.throws(()=>K.destruction(stage,{groups:[{id:'same',ids:[0]}]}),/ownership/);
  fx.release();fx.advance(.1);fx.dispose();assert.equal(stage.geometryOwned[0],0);
  const d=K.destruction(stage,{groups:[{id:'structure',ids:[0,1]}]});assert.throws(()=>K.materialisation.bind(stage,{ids:[0]}),/reserved/);
  d.release('structure');const own=d.inspect('structure');assert.equal(own.intact,false);assert.equal(stage.geometryOwned[0],1);d.dispose();assert.equal(stage.geometryOwned[0],0);
});

test('mask selections are deterministic and persistent cycles can peel only a surface edge',()=>{
  const {fx,stage,W}=fixture(48,{maxEvents:3});fx.release({mask:(x,y,z,t)=>x>.2?1:0,fraction:.7});fx.advance(.3);
  assert(fx.stats.drifting>0&&fx.stats.home>0);for(let i=0;i<48;i++)if(stage.base[i*16]<=.2)assert.equal(stage.geometryOwned[i],0);
  fx.rejoin({duration:.2});fx.advance(.2);fx.release();fx.rejoin();assert(fx.drainEvents().length<=3);assert(W.data.every(Number.isFinite));
});

test('invalid inputs and work budgets fail before changing geometry; nonfinite operators never upload NaNs',()=>{
  const {fx,W}=fixture(),data=W.data.slice();assert.throws(()=>fx.release({velocity:[NaN,0,0]}),/release/);assert.deepEqual(W.data,data);
  assert.throws(()=>fx.gather('nope'),/Unknown/);assert.throws(()=>fx.gather('home',{duration:0}),/duration/);assert.throws(()=>fx.advance(100),/budget/);
  assert.throws(()=>fx.release({mask:()=>2}),/weight/);assert.throws(()=>fx.gather('home',{ids:[99]}),/unknown/i);
  const bad=fixture(2,{flow:()=>[Infinity,0,0]});bad.fx.release();assert.throws(()=>bad.fx.advance(.1),/Flow/);assert(bad.W.data.every(Number.isFinite));
});

test('loop installation in mid-cycle retains upcoming events and timeline validation is immediate',()=>{
  const {fx}=fixture(4);fx.advance(1.5);fx.timeline([{at:.75,action:'release'}],{loop:1});fx.advance(.25);assert.equal(fx.stats.drifting,4);
  assert.throws(()=>fx.timeline([{at:1,action:'release',options:{velocity:[NaN,0,0]}}]),/Invalid/);
  assert.throws(()=>fx.timeline([{at:1,action:'gather',target:'missing'}]),/timeline/);
});

test('frame and pool writers cannot overwrite active surface fragments',()=>{
  const B=makeBuilder(1),pool=K.pool(B,4),W=B.finish(),stage=K.stage(W);
  for(let i=0;i<4;i++)pool.put(stage,i,i,1,0,.05,0xffffff,2.6);
  const fx=stage.add(K.materialisation.bind(stage,{ids:[0,1]}));fx.release({normalImpulse:0});const before=W.data.slice();
  pool.put(stage,0,99,99,99,1,0,0);pool.hide(stage,1);assert.deepEqual(W.data,before);
  pool.put(stage,2,88,1,0,.05,0xffffff,2.6);near(W.data[32],88);
  fx.dispose();pool.hide(stage,0);assert.equal(W.data[3],0);
});

test('textured heightfield anchors sample the same triangles used by attachment queries',()=>{
  const mesh=core.load().TexturedSurface.heightfield({bounds:[-2,2,-1,1],segments:[4,4],height:(x,z)=>x*x*.1+z*.2});
  const provider=K.materialisation.anchors.chart(mesh,[[.25,.6]]),sample=provider.sample(0,0),expected=mesh.sample(.25,.6);
  vectorNear(sample.position,expected.point);vectorNear(sample.normal,expected.normal);
});

test('dynamic fragment color bypasses the original pixel brush and restores it on rejoin in software',()=>{
  const {render}=require('../cli/render.js'),B=makeBuilder(1,[0,0x125b70,0x6be4ed,0xffbf75]);
  B.pixNext([1,2],.7,null,0,0,1);B.disc(0,0,0,[0,0,1],.45,.01,B.P[2],2.6);
  const W=B.finish({look:{pixel:true},cam:{target:[0,0,0],dist:3,pitch:0,yaw:0},radius:2,dither:0}),stage=K.stage(W);
  const target=K.materialisation.anchors.points([[0,0,0]],{color:'#ffbf75',size:.45,alpha:2.6});
  const fx=stage.add(K.materialisation.bind(stage,{ids:[0],targets:{warm:target}}));fx.gather('warm',{duration:.2});fx.advance(.2);
  const get=()=>{const image=render(W,{w:65,h:65,px:1,samples:true,edges:false}),p=(32*65+32)*3;return [...image.color.slice(p,p+3)];};
  const warm=get();assert(warm[0]>warm[1]&&warm[1]>warm[2],String(warm));
  fx.rejoin({duration:.2});fx.advance(.2);const cool=get();assert(cool[2]>cool[0],String(cool));
});

async function browserMaterialisationProbe(createRenderer){
  const B=makeBuilder(1,[0,0x125b70,0x6be4ed,0xffbf75]);
  B.pixNext([1,2],.7,null,0,0,1);B.disc(0,0,0,[0,0,1],.45,.01,B.P[2],2.6);
  const W=B.finish({look:{pixel:true,native:true},cam:{target:[0,0,0],dist:3,pitch:0,yaw:0},radius:2,dither:0}),stage=KIT.stage(W);
  const target=KIT.materialisation.anchors.points([[0,0,0]],{color:'#ffbf75',size:.45,alpha:2.6});
  const fx=stage.add(KIT.materialisation.bind(stage,{ids:[0],targets:{warm:target}})),canvas=document.querySelector('canvas');
  const renderer=createRenderer(canvas,{toolkit:{KIT,PixelLook,RenderStages}}),gl=canvas.getContext('webgl2');
  function draw(){renderer.render(W,{width:65,height:65,dither:0,damp:false,edges:false,stepAnimation:false,time:fx.stats.time});const rgba=new Uint8Array(4);gl.readPixels(32,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);if(gl.getError()!==0)throw Error('WebGL error');return [...rgba];}
  const before=draw();fx.gather('warm',{duration:.2});fx.advance(.2);const warm=draw();
  if(!(warm[0]>warm[1]&&warm[1]>warm[2]))throw Error('rest-space brush recolored the live target: '+warm);
  fx.rejoin({duration:.2});fx.advance(.2);const after=draw();
  if(before.some((v,i)=>Math.abs(v-after[i])>1))throw Error('rest-space material did not restore: '+before+' / '+after);
  renderer.dispose();return {before,warm,after};
}

test('native materialisation bypasses stale pixel brushes and restores authored material on arrival',{
  skip:!process.env.INK_TEST_CHROME
},()=>{
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-materialisation-'));
  try{
    fs.writeFileSync(path.join(temp,'bundle.js'),core.bundle());
    fs.writeFileSync(path.join(temp,'index.html'),`<!doctype html><canvas></canvas><pre id="result">PENDING</pre><script src="bundle.js"></script><script type="module">
import {createRenderer} from ${JSON.stringify(pathToFileURL(path.resolve(__dirname,'../webgl.mjs')).href)};
try{window.samples=await (${browserMaterialisationProbe.toString()})(createRenderer);document.querySelector('#result').textContent='PASS';}catch(e){document.querySelector('#result').textContent=e.stack;}</script>`);
    const html=execFileSync(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking','--allow-file-access-from-files',
      '--enable-unsafe-swiftshader','--use-angle=swiftshader','--user-data-dir='+path.join(temp,'profile'),'--dump-dom',pathToFileURL(path.join(temp,'index.html')).href],
      {timeout:90000,encoding:'utf8',maxBuffer:4e6,stdio:['ignore','pipe','ignore']});
    assert.equal(html.match(/<pre id="result">([^<]*)<\/pre>/)?.[1],'PASS');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});


test('bindings created mid-scene sample shader motion and shared flow on the scene clock',()=>{
  const B=makeBuilder(2);B.iso(0,1,0,.1,B.P[3],2.6,{k:6,ph:0,sp:1,rg:.2});
  const W=B.finish(),stage=K.stage(W);stage.time=4;let seen;
  const fx=stage.add(K.materialisation.bind(stage,{ids:[0],flow:(x,y,z,t,out)=>{seen=t;out[0]=1;},forces:[ctx=>{assert.equal(ctx.id,0);assert(ctx.source);return [0,0,0];}]}));
  fx.release({normalImpulse:0});near(W.data[1],1+.2*Math.sin(4));fx.advance(.1);near(seen,4.1);near(fx.stats.worldTime,4.1);
});


test('offline timeline masks evaluate at the cue time rather than the end of a large advance',()=>{
  const {fx}=fixture(4);fx.timeline([{at:.5,action:'release',options:{mask:(x,y,z,t)=>t<1?1:0}}]);fx.advance(2);assert.equal(fx.stats.drifting,4);
});

test('visual reconstruction leaves actively materialised carriers to their simulation owner',()=>{
  const B=makeBuilder(9);for(let i=0;i<3;i++)B.iso(i*.2,1,0,.08,B.P[3],2.6);B.describeSplats(0,3,{object:'surface'});
  const W=B.finish({look:{reconstruction:{select:{object:'surface'},cell:2,distance:1,keys:[{time:0,state:'solid'},{time:1,state:'fragmented'}]}}}),stage=K.stage(W);
  const fx=stage.add(K.materialisation.bind(stage,{ids:[0,1]}));fx.release({velocity:[1,0,0]});fx.advance(.2);
  const current=W.data.slice(),frame=K.reconstruction.frame(W,1);
  assert.deepEqual(row(frame.data,0),row(current,0));assert.deepEqual(row(frame.data,1),row(current,1));assert.notDeepEqual(row(frame.data,2),row(current,2));
});


test('rejoining a peeled subset never disturbs carriers that are already home',()=>{
  const {fx,W}=fixture(12,{flow:K.flow.wind([3,1,0])}),base=W.data.slice();
  fx.release({ids:[0,1]});fx.advance(.3);fx.rejoin({duration:.4});fx.advance(.2);
  for(let i=2;i<12;i++)assert.deepEqual(row(W.data,i),row(base,i));
  fx.advance(.2);assert.equal(fx.stats.home,12);
});


test('custom source anchors keep animating while home and after a completed rejoin',()=>{
  const source=K.materialisation.anchors.points([[0,1,0],[0,2,0]],{pose(out,t){out.position[0]=t;}}),{fx,W,stage}=fixture(2,{source});
  fx.advance(.2);near(W.data[0],.2);assert.equal(stage.geometryOwned[0],1);
  fx.release({normalImpulse:0});fx.advance(.1);fx.rejoin({duration:.3});fx.advance(.3);assert.equal(fx.stats.home,2);near(W.data[0],.6);
  fx.advance(.2);near(W.data[0],.8);const saved=fx.snapshot();fx.advance(.2);fx.restore(saved);fx.advance(.2);near(W.data[0],1);
  fx.dispose();assert.equal(stage.geometryOwned[0],0);assert.equal(Math.round(W.data[11])&K.materialisation.FLAG,0);
});
