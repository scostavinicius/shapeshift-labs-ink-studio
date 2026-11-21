const assert=require('node:assert/strict');
const test=require('node:test');
const ink=require('..');
const { KIT:K, makeBuilder, makeSculpt }=ink.load();
const { traceMedia }=require('../cli/scene-optics.js');
const { compile:cutouts }=require('../src/volume-cutouts.js');
const shape={
  bounds:{min:[-3,-4],max:[3,4]}, height:0, thickness:4, steps:28, opacity:.94,
  color:'#ccd5e5', resolution:[40,48],
  coverage:(x,z)=>Math.max(0,Math.min(1,1.1-Math.hypot((x-.48)/2.4,(z-.72)/2.3)))
};
const radius=Math.sqrt(29);
const asset=K.clouds.asset(shape,{resolution:48});
const source=asset.frame(0);
const ray=(frame,eye,direction,stop=100,start=0)=>frame.trace(eye,direction,start,stop,[0,0,0,1]);
const close = (value,expected,tolerance=1e-10)=>assert(Math.abs(value-expected)<tolerance,value+' vs '+expected);

test('a single cloud asset selects deterministic representations across both distance blends', () => {
  const path=[8,6.8,5.7,4.6,3,2.4,1.875,1.35,1,0].map(distance=>[0,0,distance*radius]);
  const views=path.map(eye=>source.view(eye).weights);
  assert.deepEqual(views[0],{card:1,impostor:0,volume:0});
  assert.deepEqual(views[4],{card:0,impostor:1,volume:0});
  assert.deepEqual(views.at(-1),{card:0,impostor:0,volume:1});
  close(views[2].card,.5);
  close(views[6].volume,.5);
  views.forEach(weights=>close(weights.card+weights.impostor+weights.volume,1));
  const reverse=path.slice().reverse().map(eye=>source.view(eye).weights).reverse();
  assert.deepEqual(reverse,views);
  for (const distance of [8,3,1]) {
    const eye=[0,0,distance*radius];
    const mode=Object.keys(source.view(eye).weights).find(key=>source.view(eye).weights[key]===1);
    assert.deepEqual(ray(source.view(eye),eye,[0,0,-1]),ray(asset.frame(0,undefined,undefined,undefined,mode).view(eye),eye,[0,0,-1]));
  }
  assert.throws(()=>K.clouds.asset({...shape,repeat:true}),/bounded/);
  assert.throws(()=>K.clouds.asset({...shape,thickness:0}),/thickness/);
  assert.throws(()=>K.clouds.asset(shape,{volume:[1,4],card:[3,8]}),/distance ranges/);
  assert.throws(()=>asset.frame(0,undefined,undefined,undefined,'nope'),/representation/);
  assert.equal(asset.frame(0,undefined,undefined,undefined,'off').view,null);
});

test('view-indexed projections track cloud azimuth and elevation and blend across the heading wrap', () => {
  const projected=asset.frame(0,undefined,undefined,undefined,'impostor');
  const distant=asset.frame(0,undefined,undefined,undefined,'card');
  const point=[.5,-1.7,2], dist=16;
  function at(frame,heading,pitch) {
    const eye=[Math.sin(heading)*Math.cos(pitch),Math.sin(pitch),Math.cos(heading)*Math.cos(pitch)].map(value=>value*dist);
    const d=point.map((value,i)=>value-eye[i]), length=Math.hypot(...d);
    return ray(frame.view(eye),eye,d.map(value=>value/length))[3];
  }
  assert(Math.abs(at(projected,0,0)-at(projected,Math.PI/2,0))>.04);
  assert(Math.abs(at(projected,.32,0)-at(projected,.32,-1))>.10);
  assert(Math.abs(at(projected,Math.PI/2,0)-at(distant,Math.PI/2,0))>.04);
  close(at(projected,-.0001,.21),at(projected,.0001,.21),.001);
});

test('each representation clips at opaque depth and the volume integrates from inside the cloud', () => {
  const eye=[.42,0,16], direction=[0,0,-1];
  for (const mode of ['card','impostor','volume']) {
    const view=asset.frame(0,undefined,undefined,undefined,mode).view(eye);
    assert.deepEqual(ray(view,eye,direction,9),[0,0,0,1]);
    const part=ray(view,eye,direction,15.5), all=ray(view,eye,direction,22);
    assert(part[3]<1 && part[3]>all[3] && all[3]<.45);
  }
  const inside=[.42,0,.6], view=source.view(inside);
  const short=ray(view,inside,direction,.4), long=ray(view,inside,direction,4);
  assert(short[3]<1 && short[3]>long[3] && long[3]>.05);
  const optical=traceMedia([],[],inside,direction,4,new Float64Array(6),[0,0,0,1],{cloud:view});
  close(optical[3],long[3]);
  const orthoEye=[inside[0],inside[1],inside[2]+20];
  const orthographic=traceMedia([],[],orthoEye,direction,24,new Float64Array(6),[0,0,0,1],
    { cloud:view, cloudStart:20 });
  close(orthographic[3],long[3]);
});

function renderScene() {
  const B=makeBuilder(3,[0x3b5e7f,0xa53028,0x2c973e]);
  const S=K.sculpt(makeSculpt(B));
  S.box([-.76,0,6],[.26,.38,.09],{ r:[1],em:true,materialId:'front' },{ res:.05 });
  S.box([1,0,-6],[.48,.5,.09],{ r:[2],em:true,materialId:'back' },{ res:.055 });
  S.bake();
  return B.finish({ cam:{target:[0,0,0],dist:14,pitch:0,yaw:0}, radius:11,
    cloudField:asset, dither:0 });
}
test('Ink composites the cloud between near and far splats in both camera modes', () => {
  const world=renderScene();
  for (const ortho of [false,true]) {
    const options={ ortho, w:112,h:80,px:1,raw:true,passes:['materialId','coverage','sky','fogTransmittance'] };
    const base=ink.render({...world,cloudField:false},options);
    for (const mode of ['card','impostor','volume','auto']) {
      const rendered=ink.render(world,{...options,cloudRepresentation:mode});
      const { coverage,materialId,materials,sky,fogTransmittance }=rendered.passes;
      assert(sky.some((value,i)=>value-base.passes.sky[i]>.1), 'cloud appears in the backdrop pass');
      assert(fogTransmittance.every(value=>value===1), 'cloud extinction is separate from fog');
      let front=0, back=0;
      for (let p=0;p<materialId.length;p++) {
        if (coverage[p]<.985) continue;
        const red=p*3, color=materials[materialId[p]];
        if (color==='front' && Math.abs(base.rgb[red]-rendered.rgb[red])<=2) front++;
        if (color==='back' && rendered.rgb[red]-base.rgb[red]>30) back++;
      }
      assert(front>6 && back>5, mode+' ortho='+ortho+' front='+front+' back='+back);
    }
    const transparent=ink.render(world,{...options,transparent:true});
    assert(transparent.alpha.some(a=>a>0 && a<240));
  }
});

test('bounded cloud self-shadows follow the sun without changing extinction or baked views', () => {
  const field = {
    ...shape, bounds:{min:[-4,-4],max:[4,4]}, coverage:()=>1, color:'#20243d', velocity:[.8,.1],
    lighting:{ ambient:.16,strength:.85,rim:0 }, lod:{resolution:24}
  };
  const selfShadows={steps:6,distance:4};
  const cloud = K.clouds.compile({...field,selfShadows});
  function trace({ x=0, direction=[0,.65,-.76], mode='volume', enabled, time=0, stop=100,
    source=cloud, flash, cutout }={}) {
    const eye=[x+time*.8,0,9+time*.1], view=source.frame(time,null,direction,undefined,mode,flash,cutout,undefined,enabled).view(eye);
    const counters={cloudTraces:0,cloudSamples:0,cloudShadowRays:0,cloudShadowSamples:0};
    return { sample:view.trace(eye,[0,0,-1],0,stop,[],counters), counters };
  }
  const lit=trace({enabled:false}), shadowed=trace();
  assert(shadowed.sample[0] < lit.sample[0]-.09);
  assert.equal(shadowed.sample[3],lit.sample[3]);
  assert.equal(shadowed.counters.cloudSamples,lit.counters.cloudSamples);
  assert(shadowed.counters.cloudShadowRays > 0 && shadowed.counters.cloudShadowRays <= shadowed.counters.cloudSamples);
  assert(shadowed.counters.cloudShadowSamples > 0 &&
    shadowed.counters.cloudShadowSamples <= selfShadows.steps*shadowed.counters.cloudShadowRays);
  assert.deepEqual(lit,trace({source:K.clouds.compile(field)}));
  assert.deepEqual(lit,trace({enabled:true,source:K.clouds.compile({...field,selfShadows:{strength:0}})}));
  assert(trace({enabled:true,source:K.clouds.compile(field)}).counters.cloudShadowSamples > 0);
  const short=trace({source:K.clouds.compile({...field,selfShadows:{...selfShadows,distance:.1}})});
  assert(short.sample[0] > shadowed.sample[0]+.08 && short.sample[0] < lit.sample[0]);
  for (const side of [-1,1]) {
    const direction=[side*.96,.27,0];
    const near=trace({x:side*3.4,direction}), far=trace({x:-side*3.4,direction});
    assert(near.sample[0] > far.sample[0]+.06);
    assert.equal(near.sample[3],far.sample[3]);
  }
  trace({time:4}).sample.forEach((channel,i)=>close(channel,shadowed.sample[i]));
  assert.deepEqual(trace({stop:4}).sample,[0,0,0,1]);
  assert.equal(trace({stop:4}).counters.cloudShadowSamples,0);
  assert.deepEqual(trace({direction:[0,-1,0]}),trace({direction:[0,-1,0],enabled:false}));
  for (const mode of ['card','impostor']) assert.deepEqual(trace({mode}),trace({mode,enabled:false}));
  const gap=trace({cutout:cutouts({zones:[{type:'box', min:[-4,.0001,-4], max:[4,2,4],
    affects:'cloud',feather:0}]}).frame().cloud});
  assert.deepEqual(gap.sample,lit.sample);
  assert.equal(gap.counters.cloudShadowSamples,0);
  const flash=()=>[.1,.2,.3];
  trace({flash}).sample.slice(0,3).forEach((value,i)=>{
    close(value-shadowed.sample[i],(1-shadowed.sample[3])*flash()[i]);
  });
  assert.throws(()=>K.clouds.compile({...field,selfShadows:{steps:17}}),/1–16/);
  assert.throws(()=>K.clouds.compile({...field,selfShadows:{distance:Infinity}}),/distance/);
  assert.throws(()=>K.clouds.compile({...field,repeat:true,selfShadows:true}),/nonrepeating/);
});

test('cloud self-shadow render overrides and counters work in both camera projections', () => {
  const cloudField=K.clouds.asset({...shape,color:'#253049',lighting:{ambient:.1,strength:.9,rim:0},
    selfShadows:{steps:4,distance:4}},{resolution:24});
  const world={...renderScene(),cloudField};
  for (const ortho of [false,true]) {
    const options={ortho,w:64,h:48,px:1,raw:true,renderStats:true,cloudRepresentation:'volume',
      passes:['coverage','fogTransmittance','sky']};
    const on=ink.render(world,options);
    const off=ink.render(world,{...options,cloudSelfShadows:false});
    assert.notDeepEqual(on.passes.sky,off.passes.sky);
    assert.deepEqual(on.passes.coverage,off.passes.coverage);
    assert.deepEqual(on.passes.fogTransmittance,off.passes.fogTransmittance);
    assert(on.renderStats.volume.cloudShadowSamples > 0);
    assert.equal(off.renderStats.volume.cloudShadowSamples,0);
  }
});
