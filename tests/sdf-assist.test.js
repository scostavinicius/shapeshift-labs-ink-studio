const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');

const { makeBuilder, makeSculpt } = ink.load();
function fixture({ behind = false, front = false } = {}) {
  const B=makeBuilder(14,[0x122030,0xd5a36e,0x648b88,0xaa1720,0x55edc9]);
  const S=makeSculpt(B);
  const sandstone={r:[1],a:1.25,fat:.33,materialId:'sandstone'};
  const copper={r:[2],a:1.25,fat:.33,materialId:'copper'};
  S.keepRenderSdf=true;
  S.box([-.95,0,0],[.79,.84,.19],sandstone,{res:.31,rd:.01,objectId:'gate'});
  S.box([-.95,0,0],[.25,.34,.36],sandstone,{res:.14,neg:true,objectId:'gate'});
  S.box([.95,0,0],[.77,.82,.20],copper,{res:.29,rd:.02,objectId:'panel'});
  S.bake();
  if (behind) B.disc(-1.46,.46,-.06,[0,0,1],.11,.018,B.P[3],2,{nd:true});
  if (front) B.disc(-1.46,.46,.25,[0,0,1],.11,.018,B.P[4],.9,{nd:true});
  return B.finish({cam:{target:[0,0,0],dist:7,yaw:0,pitch:0,sway:0},radius:5,dither:0});
}

const view={w:104,h:72,px:1,raw:true,ortho:true,transparent:true,
  passes:['objectId','materialId','depth','coverage','position','normal']};
const paint=(world,sdfAssist,more={})=>ink.render(world,{...view,sdfAssist,...more});
const position=(frame,x,y)=>y*frame.w+x;
const rgb=(frame,p)=>Array.from(frame.rgb.subarray(3*p,3*p+3));
const region=(x0,y0,x1,y1)=>Array.from({length:y1-y0},(_,y)=>Array.from({length:x1-x0},(_,x)=>(y+y0)*view.w+x+x0)).flat();

test('the retained gate closes coverage gaps, reports its traced depth, and preserves the passage',()=>{
  const world=fixture();
  const old=paint(world,false), exact=paint(world,true);
  const passage=position(exact,38,36), left=region(30,26,34,45);
  assert(left.filter(p=>old.passes.coverage[p]<.5).length>20);
  const z=7+2*5+4-.19;
  for (const p of left) {
    assert.equal(exact.passes.coverage[p],1);
    assert(Math.abs(exact.passes.depth[p]-z)<.006);
    assert.equal(exact.passes.objects[exact.passes.objectId[p]],'gate');
    assert.equal(exact.passes.materials[exact.passes.materialId[p]],'sandstone');
    assert(exact.passes.normal[p*3+2]>.98);
    assert(Math.abs(exact.passes.position[p*3+2]-.19)<.006);
    assert.deepEqual(rgb(exact,p),[0xd5,0xa3,0x6e]);
  }
  assert.equal(exact.alpha[passage],0);
  assert.equal(exact.passes.depth[passage],Infinity);
  const perspective=paint(world,true,{ortho:false,pitch:.11,yaw:.27});
  assert(perspective.passes.coverage.some(value=>value===1));
});

test('material, object and region rules can be applied independently',()=>{
  const world=fixture(), baseline=paint(world,false), all=paint(world,true);
  const byObject=paint(world,{rules:[{select:{object:'gate'}}]});
  const byMaterial=paint(world,{rules:[{select:{material:'sandstone'}}]});
  assert.deepEqual(byObject.rgb,byMaterial.rgb);
  const right=region(58,23,78,49);
  assert(right.some(p=>all.alpha[p]!==baseline.alpha[p]));
  assert(right.every(p=>byMaterial.alpha[p]===baseline.alpha[p]));
  const upper={min:[-2,0,-1],max:[0,1,1]};
  const local=paint(world,{rules:[{select:{material:'sandstone'},bounds:upper}]});
  const top=region(30,26,34,34), low=region(30,39,34,46);
  assert(top.some(p=>local.alpha[p]!==baseline.alpha[p]));
  assert(low.every(p=>local.alpha[p]===baseline.alpha[p]));
  const excluded=paint(world,{rules:[{bounds:upper,enabled:false},{select:{object:'gate'}}]});
  assert(top.every(p=>excluded.alpha[p]===baseline.alpha[p]));
  assert(low.some(p=>excluded.alpha[p]!==baseline.alpha[p]));
});

test('opaque traced depth occludes rear splats and retains foreground paint',()=>{
  const solid=paint(fixture(),true), rear=paint(fixture({behind:true}),true), marked=paint(fixture({front:true}),true);
  const spot=region(27,25,34,33);
  assert(spot.every(p=>rgb(rear,p).every((v,k)=>v===rgb(solid,p)[k])));
  assert(spot.some(p=>rgb(marked,p)[1]>rgb(solid,p)[1]+20));
  assert(spot.every(p=>marked.passes.depth[p]===solid.passes.depth[p]));
});

test('JSON captures static geometry and validates scoped SDF settings',()=>{
  const { KIT }=ink.load();
  const spec={id:'sdf-data',finish:{look:{sdfAssist:{rules:[{select:{object:'pier'}}]}}},
    solids:[{id:'pier',kind:'box',at:[0,0,0],half:[1,1,.18],mat:'stone',res:.45}]};
  const world=KIT.diorama.build(spec);
  assert.equal(world.renderSdfs.length,1);
  assert(paint(world,undefined).passes.depth.some(Number.isFinite));
  assert.throws(()=>KIT.diorama.build({...spec,finish:{look:{sdfAssist:{steps:0}}}}),/finish\.look\.sdfAssist/s);
});

test('retained fields do not resurrect subsets or translated rows',()=>{
  const world=fixture(), { SplatProvenance }=ink.load();
  const subset=SplatProvenance.subset(world,[0,1,2]);
  assert.equal(subset.renderSdfs,undefined);
  const data=world.data.slice();
  for(let i=0;i<data.length;i+=16) data[i]+=.45;
  const shifted={...world,data};
  assert.deepEqual(paint(shifted,true).rgb,paint(shifted,false).rgb);
});
