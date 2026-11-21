const test=require('node:test'), assert=require('node:assert/strict'), ink=require('..');
const {reflectionSampler}=require('../cli/scene-optics.js');
const detail=require('../src/reflection-detail.js');
const Probes=require('../src/reflection-probes.js');
const V=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

test('planar capture keeps the sharp core, aligns the streak and retains all energy in a distant block',()=>{
  const w=16,h=16,rgb=new Float32Array(w*h*3),coverage=new Float32Array(w*h);
  // A single source texel between the usual sparse filter taps. The distant block must retain it.
  const pixel=5*w+5;
  rgb[pixel*3]=1;
  coverage[pixel]=1;
  let captures=0;
  const sampler=reflectionSampler([{id:'p'}],()=>{ captures++; return {w,h,rgb,coverage}; },V,[0,1,3],1,{width:w,height:h});
  const layer={plane:'p',detail:detail.prepare({core:.7,stretch:[3,0],direction:'surface',distance:[4,8],cluster:4})};
  const value=(x,y,depth,axis=[1,0,0])=>sampler(layer,x,y,0,0,0,undefined,{axis,depth})?.coverage ?? 0;
  assert(value(5.5,5.5,3)>.7);
  assert(value(8.5,5.5,3)>0);
  assert.equal(value(5.5,8.5,3),0);
  assert(value(5.5,8.5,3,[0,1,0])>0);
  assert.equal(value(4.5,4.5,8),1/16);
  assert.equal(value(7.5,7.5,8),1/16);
  assert.equal(value(8.5,7.5,8),0);
  const midpoint=value(5.5,5.5,6);
  assert(Math.abs(midpoint-(value(5.5,5.5,3)+1/16)*.5)<1e-10);
  assert.equal(captures,1);
  assert.deepEqual(detail.axis(detail.prepare(true),[0,1,0],[.4,1,0],[1,0,0]),[0,0,-1]);
  assert.throws(()=>detail.prepare({distance:[9,9]}),/distance/);
});

test('local probes reuse their faces while distance selects prefiltered reflection blocks',()=>{
  let captures=0;
  const sample=Probes.sampler([Probes.probe({id:'probe',at:[0,0,0],size:32})],(probe,face)=>{
    captures++;
    const rgb=new Float32Array(32*32*3),coverage=new Float32Array(32*32);
    if (face===4) {
      rgb[(18*32+12)*3]=.8;
      coverage[18*32+12]=1;
    }
    return {w:32,h:32,rgb,coverage};
  });
  const direction=[1-12.5/16,18.5/16-1,1];
  const options={axis:[1,0,0],sharp:direction,pixelAngle:.015,
    settings:detail.prepare({core:1,distance:[2,4],cluster:4})};
  const at=depth=>sample('probe',[0,0,0],direction,[.9,.9],undefined,{...options,depth})?.coverage;
  assert(Math.abs(at(1)-1)<1e-8);
  assert.equal(at(5),1/16);
  assert.equal(captures,6);
});

test('a planar material and a rough probe layer expose detail through the native reflection pass',()=>{
  const scene=require('../examples/reflection-detail.js')(ink.load());
  const world=scene.build(scene.seed), view={w:136,h:90,px:1,t:.65,passes:['reflections','depth']};
  const baseline=ink.render(world,{...view,reflectionDetail:false}), after=ink.render(world,view);
  assert.notDeepEqual(after.passes.reflections,baseline.passes.reflections);
  assert.deepEqual(after.passes.depth,baseline.passes.depth);
  const baselineFromAuthoring={...world,surfaces:world.surfaces.map(row=>({...row,settings:{...row.settings,
    layers:Object.fromEntries(Object.entries(row.settings.layers??{}).map(([name,{detail,...layer}])=>[name,layer]))
  }}))};
  assert.deepEqual(ink.render(baselineFromAuthoring,view).rgb,baseline.rgb);
});

function livePool({KIT:K,makeBuilder}) {
  const B=makeBuilder(1,[0,0xff2600]);
  B.disc(0,1,-2,[0,0,1],.64,.02,B.P[1],3);
  B.disc(0,-.8,0,[0,1,0],3,.02,B.P[0],3);
  const api=K.procedural.waterBodies;
  function water(detail) {
    return api.scene([api.create({id:'water',bounds:{min:[-1,-3],max:[1,2]},resolution:[8,8],
      sample:()=>({bed:-1,surface:0}),optics:{tint:[0,0,0],extinction:[0,0,0],surfaceColor:[1,1,1],
        surface:1,refraction:0,foam:0,caustics:0,reflection:{plane:'plane',distortion:0,detail}}})]);
  }
  const world=B.finish({water:water(),radius:8,reflections:[K.reflection.plane({id:'plane'})],
    cam:{target:[0,0,0],dist:Math.sqrt(45),pitch:Math.atan(.5),yaw:0}});
  return {world,water};
}

test('live water keeps the captured light through distance filtering in Node and WebGL',{
  skip:!process.env.INK_TEST_CHROME
},()=>{
  const settings={core:.7,stretch:[3,.25],distance:[0,1],cluster:6};
  const {world,water}=livePool(ink.load());
  const view={w:64,h:64,px:1,raw:true}, before=ink.render(world,view);
  world.water=water(settings);
  const after=ink.render(world,view);
  assert.notDeepEqual(after.rgb,before.rgb);
  assert.deepEqual(ink.render(world,{...view,reflectionDetail:false}).rgb,before.rgb);
  const result=require('../cli/look-webgl')({chrome:process.env.INK_TEST_CHROME,hardware:true},livePool,
    (_kit,build,backend,settings)=>{
      const {world,water}=build(_kit), draw=backend(64,64,{raw:true,dither:0,damp:false,reflectionScale:1});
      draw.draw(world);
      const baseline=draw.image(), centerAt=[32,32];
      const before=draw.sample({p:centerAt}).p;
      world.water=water(settings);
      draw.draw(world);
      const authored=draw.image(), after=draw.sample({p:centerAt}).p;
      draw.draw(world,{reflectionDetail:false});
      const disabled=draw.image();
      draw.close();
      return {before,after,changed:authored!==baseline,restored:disabled===baseline};
    },settings);
  assert(result.changed);
  assert(result.restored);
  assert(result.before[0]>35 && result.after[0]>30 && result.after[1]<result.after[0]*.5,JSON.stringify(result));
});
