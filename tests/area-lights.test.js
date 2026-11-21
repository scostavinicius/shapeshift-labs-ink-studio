const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { KIT: K, AreaLights, makeBuilder, makeSculpt, ColorSpace } = ink.load();
const linear = ColorSpace.prepare('srgb','srgb-linear');
const palette = [0x1c2837,0x545352,0x74847b,0xc0d0b0];
const lighting = { id:'window', at:[-1.03,2.08,-.17], normal:[0,-1,0], size:[1.72,.81],
  intensity:5, radius:5.4, sampleGrid:6, visible:false, reflection:false, color:'#ffffff' };

function room() {
  const B = makeBuilder(1,palette), S = K.sculpt(makeSculpt(B));
  S.keepRenderSdf = true;
  S.box([0,-.18,0],[2.25,.18,1.65],{ r:[1], materialId:'paving' },{ res:.14 });
  S.box([0,.40,-.13],[.09,.40,.76],{ r:[2], materialId:'divider' },{ res:.095 });
  S.bake();
  return B.finish({ cam:{ target:[.1,.1,0], yaw:.06, pitch:.82, dist:6.8, ortho:true },
    radius:6, dither:0, areaLights:[lighting] });
}

function visibility(base, full, lit, region) {
  const result = [];
  const { materialId, materials, position, coverage } = base.passes;
  const floor = materials.indexOf('paving');
  for (let p=0;p<coverage.length;p++) {
    const q=p*3, a=base.rgb[q], b=full.rgb[q], c=lit.rgb[q];
    if (materialId[p]!==floor || coverage[p]<.995 || b-a<22 || !region(position[q],position[q+2])) continue;
    const [start,end,value] = linear([a/255,b/255,c/255]);
    result.push((value-start)/(end-start));
  }
  return result;
}

test('a broad window makes a wider penumbra than a compact source and supports stepped visibility', () => {
  const world=room(), view={w:122,h:94,px:1,raw:true,passes:['position','materialId','coverage','depth'],sdfAssist:true};
  const off=ink.render(world,{...view,areaLights:false});
  const active = source => ink.render(world,{...view,areaLights:[{...lighting,...source}]});
  const wide=active({}), clear=active({shadows:false}), stepped=active({shadowSteps:3});
  const compact={size:[.022,.022]};
  const region=(x,z)=>x>.10 && x<1.87 && Math.abs(z)<.64;
  const penumbra=values=>values.filter(n=>n>.12 && n<.88).length;
  const soft=visibility(off,clear,wide,region);
  const hard=visibility(off,active({...compact,shadows:false}),active(compact),region);
  const bands=visibility(off,clear,stepped,region);
  assert(soft.length>50 && hard.length>50);
  assert(penumbra(soft)>penumbra(hard)+18);
  assert(soft.some(n=>n<.05) && soft.some(n=>n>.80));
  assert(bands.some(n=>Math.abs(n-.5)<.05));
  assert(bands.every(n=>[0,.5,1].some(step=>Math.abs(n-step)<.075)));
  assert.deepEqual(wide.passes.depth,off.passes.depth);
});

function pool() {
  const B=makeBuilder(1,palette), S=K.sculpt(makeSculpt(B));
  const plane=K.reflection.plane({id:'pool'});
  const water=K.reflection.material({r:[2], materialId:'water'},'pool',{f0:1,strength:1,distortion:0});
  S.box([0,-.025,.32],[2.4,.025,2.14],water,{res:.10});
  S.bake();
  return B.finish({cam:{target:[0,.48,0],yaw:0,pitch:.44,dist:6.7},
    radius:6,dither:0,reflections:[plane]});
}

test('an authored disk is visible in the pool capture and can be disabled independently', () => {
  const world=pool(), view={w:118,h:104,px:1,raw:true,passes:['emission','reflections']};
  const light={ id:'lantern', at:[0,.91,-.64], normal:[0,0,1], shape:'disk',size:[.68,1.04],
    color:'#ffc062',twoSided:true,shadows:false,visible:false };
  const render=overrides=>ink.render(world,{...view,areaLights:[{...light,...overrides}]});
  const disk=render({}), rectangle=render({shape:'rectangle'}), hidden=render({reflection:false});
  const reflected=frame=>frame.passes.reflections.filter((n,i)=>i%3===0 && n>.55).length;
  assert(reflected(disk)>20 && reflected(rectangle)>reflected(disk));
  assert.equal(reflected(hidden),0);
  assert(disk.passes.emission.every(n=>!n));
  assert(render({visible:true}).passes.emission.some(n=>n>.8));
  assert(ink.render(world,{...view,areaLights:[light],reflections:false}).passes.reflections.every(n=>!n));
});

test('opaque splat depth can hide the emitter without removing its lighting definition', () => {
  const B=makeBuilder(1,palette);
  B.disc(0,0,.55,[0,0,1],.65,.015,B.P[1],2);
  const world=B.finish({cam:{target:[0,0,0],yaw:0,pitch:0,dist:4,ortho:true},
    areaLights:[{id:'occluded',at:[0,0,0],size:[.3,.3],shadows:false}],radius:4,look:{splatCoverage:'continuous'}});
  const view={w:65,h:65,px:1,raw:true,passes:['emission']};
  assert(ink.render(world,view).passes.emission.every(n=>n===0));
  const hidden=world.data.slice();
  hidden[3]=0;
  assert(ink.render({...world,data:hidden},view).passes.emission.some(n=>n>.8));
});

test('JSON validation retains static shadow geometry and the configured emitter shape', () => {
  const spec={id:'shaped-window',finish:{areaLights:[lighting]},
    solids:[{id:'floor',kind:'box',at:[0,-.14,0],half:[1,.14,1],mat:'stone'}]};
  const world=K.diorama.build(spec);
  assert.deepEqual(world.areaLights,[lighting]);
  assert(world.renderSdfs.length);
  assert.equal(AreaLights.prepare([lighting])[0].points.length,36);
  assert.throws(()=>K.diorama.build({...spec,finish:{areaLights:[{...lighting,size:[0,1]}]}}),/finish\.areaLights/s);
  assert.throws(()=>AreaLights.prepare([{...lighting,up:lighting.normal}]),/Area light up/);
});
