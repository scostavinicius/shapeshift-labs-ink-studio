const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const silhouettes = require('../src/translucent-silhouettes.js');
const tea = require('../examples/translucent-silhouettes.js');
const kit = ink.load();

const rule = (material,policy,extra={}) => ({select:{material},policy,...extra});
const view = (h=32,extra={}) => ({w:h*1.5,h,px:1,raw:true,passes:['depth','coverage'],...extra});

function fixture() {
  const B=kit.makeBuilder(2,[0x192033,0x536071,0xffdeaa,0x82e3e4]);
  B.disc(0,0,0,[0,0,1],1.5,.03,B.P[1],2);
  B.describeSplats(0,1,{material:'stone'});
  B.axial(-.14,0,.18,[.91,.42,0],.72,.019,B.P[2],.72,{nd:true});
  B.describeSplats(1,2,{material:'thin'});
  B.axial(.20,.02,.18,[.26,.966,0],.75,.019,B.P[3],.55,{gl:true,nd:true});
  B.describeSplats(2,3,{material:'edge'});
  return B.finish({cam:{target:[0,0,0],ortho:true,dist:4,yaw:0,pitch:0,sway:0},radius:4,dither:0,
    refract:0,look:{stableTransparency:{mode:'blend',depthTolerance:.10}}});
}

test('translucent policies preserve ellipse axes and fade by native art size',()=>{
  const set=silhouettes.prepare({rules:[rule('thin','cloth'),rule('edge','glass')]});
  const at=set.bind(fixture());
  assert.deepEqual([32,64,96,128].map(set.weight),[1,1,.5,0]);
  assert.notDeepEqual(at(1),at(2));
  const fit=silhouettes.fit(at(1),1,.4,.5,1,1);
  assert(Math.abs(fit.b/(fit.a-fit.c)-.8)<1e-12);
  assert.throws(()=>silhouettes.prepare({rules:[rule('thin','steam',{width:-1})]}),/width/);
  assert.throws(()=>silhouettes.prepare({fade:[128,64],rules:[rule('thin','steam')]}),/increasing/);
  assert.throws(()=>silhouettes.prepare({rules:[{select:{medium:'mist'},policy:'steam'}]}),/splats/);
});

test('native coverage is selective, preserves opaque depth, and can be disabled',()=>{
  const scene=fixture();
  const policies={rules:[rule('stone','steam',{opacity:0}),rule('thin','cloth'),rule('edge','glass')]};
  for (const size of [32,64]) {
    const options=view(size), legacy=ink.render(scene,options), native=ink.render(scene,{...options,translucentSilhouettes:policies});
    assert.notDeepEqual(native.rgb,legacy.rgb);
    assert.notDeepEqual(native.passes.coverage,legacy.passes.coverage);
    assert.deepEqual(native.passes.depth,legacy.passes.depth);
    const onlyOpaque=ink.render(scene,{...options,translucentSilhouettes:{rules:[policies.rules[0]]}});
    assert.deepEqual(onlyOpaque.rgb,legacy.rgb);
    const ignored=ink.render(scene,{...options,translucentSilhouettes:{rules:[rule('thin','legacy'),policies.rules[1]]}});
    assert.deepEqual(ignored.rgb,legacy.rgb);
  }
  const authored={...scene,look:{...scene.look,translucentSilhouettes:policies}};
  assert.deepEqual(ink.render(authored,view(128)).rgb,ink.render(scene,view(128)).rgb);
  assert.deepEqual(ink.render(authored,view(32,{translucentSilhouettes:false})).rgb,ink.render(scene,view()).rgb);
});

test('steam, glass, cloth and shaped foliage stay visible at 32 and 64 pixels through a depth crossing',()=>{
  const demo=tea(kit), world=demo.build(demo.seed);
  demo.animate(world);
  const materials=kit.TargetSelectors.index(world);
  for (const size of [32,64]) {
    let before;
    for (const t of [.498,.5,.502]) {
      world.anim.update(0,t);
      const coverage={};
      const frame=ink.render(world,view(size,{t,fragmentProbe(_p,i,_center,_z,_r,_g,_b,alpha) {
        const material=materials.row(i).material;
        coverage[material]=(coverage[material]??0)+alpha;
      }}));
      for (const name of ['steam','glass-edge','silk','leaves']) assert(coverage[name]>2,name+' at '+size);
      if (before) {
        const mean=frame.rgb.reduce((sum,n,i)=>sum+Math.abs(n-before[i]),0)/before.length;
        assert(mean<1.25,'crossing change at '+size+' px was '+mean);
      }
      before=frame.rgb;
    }
  }
});
