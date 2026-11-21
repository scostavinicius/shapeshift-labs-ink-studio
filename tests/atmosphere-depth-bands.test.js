const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { KIT:K, makeBuilder, makeSculpt, SceneOptics } = ink.load();
const Depth=K.atmosphere.depthBands;
const facing={origin:[0,0,0],forward:[0,0,-1]};
const bind=(bands,camera=facing,options)=>SceneOptics.prepareVolumes(Depth.frame(Depth.settings(bands),camera,options));
const close=(value,expected,tolerance=1e-6)=>assert(Math.abs(value-expected)<tolerance,`${value} differs from ${expected}`);

test('depth bands clip on camera-axis planes and layer extinction only up to the visible surface',()=>{
  const bands=bind([
    {id:'middle',depth:[3,7],feather:0,color:'#ff0000',density:.12},
    {id:'far',depth:[7,15],feather:0,color:'#0000ff',density:.20}
  ]);
  const ray=[.6,0,-.8];
  const bounds=SceneOptics.rayBounds(bands,facing.origin,ray,30);
  close(bounds.ranges[0][0],3/.8);
  close(bounds.ranges[1][1],15/.8);
  assert.deepEqual(SceneOptics.trace(bands,facing.origin,ray,3),[0,0,0,1]);
  const mid=SceneOptics.trace(bands,facing.origin,ray,6/.8);
  close(mid[3],Math.exp(-.12*3/.8));
  assert(mid[0]>0 && mid[2]===0);
  const options={rayBounds:bounds};
  const far=SceneOptics.trace(bands,facing.origin,ray,9/.8,undefined,options);
  close(far[3],Math.exp(-(.12*4+.20*2)/.8));
  close(far[0],1-Math.exp(-.12*4/.8));
  assert(far[2]>0);
  assert.deepEqual(far,SceneOptics.trace(bands,facing.origin,ray,9/.8));
});

test('depth and height feathers multiply optical density, and texture drifts in world space',()=>{
  const feathered=bind([{id:'veil',depth:[2,6],feather:1,height:[-1,1],heightFeather:.5,
    density:.30,step:.05}]);
  const forward=facing.forward;
  close(SceneOptics.trace(feathered,facing.origin,forward,7)[3],Math.exp(-.30*3));
  close(SceneOptics.trace(feathered,[0,.75,0],forward,7)[3],Math.exp(-.30*3*.5));
  assert.deepEqual(SceneOptics.trace(feathered,[0,1.1,0],forward,7),[0,0,0,1]);
  const definition=[{id:'mist',depth:[1,12],feather:0,texture:{scale:[3,.5,2],velocity:[.7,-.1,.2],strength:1,seed:8}}];
  const start=bind(definition,facing,{seed:11})[0].depthBand.sample;
  const later=bind(definition,facing,{seed:11,time:2})[0].depthBand.sample;
  const movedCamera=bind(definition,{...facing,origin:[.58,0,0]},{seed:11})[0].depthBand.sample;
  const samples=Array.from({length:8},(_,i)=>[i*.27,.8-i*.071,-6.4]);
  for (const [x,y,z] of samples) {
    close(start(x,y,z),later(x+1.4,y-.2,z+.4));
    close(start(x,y,z),movedCamera(x,y,z));
  }
  assert(samples.some(p=>Math.abs(start(...p)-later(...p))>.02));
});

test('the native renderer keeps a foreground rail clear and exports the same nominal band in either projection',()=>{
  const b=makeBuilder(1,[0x1d2b42,0xca8c54]);
  const sculpt=K.sculpt(makeSculpt(b));
  for (const [x,z,label] of [[-.8,3,'rail'],[1,0,'headland']])
    sculpt.box([x,0,z],[.29,.39,.095],{r:[1]},{res:.065,objectId:label});
  sculpt.bake();
  const atmosphereDepthBands=[{id:'path',depth:[4.3,8],feather:0,density:.28,color:'#a2bcd4'}];
  const world=b.finish({cam:{target:[0,0,0],yaw:0,pitch:0,dist:6,sway:0},radius:10,atmosphereDepthBands,
    look:{splatCoverage:'continuous'}});
  const view={w:110,h:65,px:1,raw:true,passes:['objectId','coverage','fogTransmittance']};
  for (const ortho of [false,true]) for (const aerialPerspective of [false,{start:30,density:.01}]) {
    const settings={...view,ortho,aerialPerspective};
    const image=ink.render(world,settings);
    const none=ink.render(world,{...settings,atmosphereDepthBands:false});
    const label=p=>image.passes.objects[image.passes.objectId[p]];
    const p=image.passes.objectId.findIndex((_,pixel)=>label(pixel)==='rail' && image.passes.coverage[pixel]>.999);
    const q=image.passes.objectId.findIndex((_,pixel)=>label(pixel)==='headland');
    assert(p>=0 && q>=0);
    assert.equal(image.passes.fogTransmittance[p],1);
    assert(image.passes.fogTransmittance[q]<.67);
    assert.deepEqual(image.rgb.slice(p*3,p*3+3),none.rgb.slice(p*3,p*3+3));
    assert.equal(none.passes.fogTransmittance[q],1);
  }
});

test('depth bands reuse environment pack revisions and validate their portable data',()=>{
  const definition=[{id:'haze',depth:[5,18],feather:[1,2],texture:{scale:3,velocity:[.14,0,0]}}];
  const pack={format:'ink-studio/asset-pack',version:1,id:'shore',revision:2,title:'Shore',
    environments:[{id:'shore/haze',label:'Haze',settings:{atmosphereDepthBands:definition}}]};
  const spec={id:'cliff',assetPacks:[pack],environmentPreset:{asset:'shore/haze',revision:2},
    solids:[{kind:'box',at:[0,0,0],half:[.5,.5,.5],mat:'stone'}]};
  assert.deepEqual(K.diorama.build(spec).atmosphereDepthBands,definition);
  const bundle=K.authoring.assetPacks.bundle([pack],['shore']);
  assert.deepEqual(bundle.packs[0].environments[0].settings.atmosphereDepthBands,definition);
  assert.throws(()=>Depth.settings([...definition,...definition]),/unique/);
  assert.throws(()=>Depth.settings([{...definition[0],feather:[9,9]}]),/within its range/);
  assert.throws(()=>Depth.settings([{...definition[0],texture:{scale:[1,0,1]}}]),/texture scale/);
});
