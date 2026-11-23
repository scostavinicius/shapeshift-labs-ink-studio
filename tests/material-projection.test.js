const {test} = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const {rasterize} = require('../cli/sprite-surfaces.js');
const {KIT:K,SpriteSurface:A} = ink.load();
const runWebGL = require('../cli/look-webgl.js');
const chrome = process.env.INK_TEST_CHROME;
const camera = {V:[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],W:64,H:64,focal:32,near:.5};
const skew = {points:[-1,-1,-2, 2,-2,-4, -1,1,-2],uvs:[0,0,1,0,0,1],triangles:[0,1,2]};

function raster(projection, mesh=skew, view=camera) {
  const atlas=A.make(32);
  atlas.reserve(16,4,()=>0x44ee44);
  atlas.mesh(mesh,16,4,x=>x<<16,{id:'panel',projection});
  return new Map(rasterize(atlas.finish(),view).map(f=>[f.p,f]));
}
const at=(image,x,y)=>image.get(y*camera.W+x);
const slot=sample=>Math.round(sample.color[0]*255);

test('affine UVs change the texel and keep a perspective-correct depth and world point',()=>{
  const original=raster(), affine=raster({mapping:'affine'});
  const a=at(original,24,24), b=at(affine,24,24);
  assert.equal(slot(a),2);
  assert.equal(slot(b),4);
  assert.equal(a.z,b.z);
  assert.deepEqual(a.position,b.position);
  assert.equal(original.size,affine.size);
  assert.deepEqual(raster(undefined,skew,{...camera,ortho:true}),raster({mapping:'affine'},skew,{...camera,ortho:true}));
});

test('regular subdivision brings affine texture samples closer to the perspective reference',()=>{
  const reference=raster(), coarse=raster({mapping:'affine'}), refined=raster({mapping:'affine',subdivisions:8});
  assert.equal(refined.size,reference.size);
  const error=image=>[...reference].reduce((sum,[p,sample])=>sum+Math.abs(slot(sample)-slot(image.get(p))),0);
  assert(error(coarse)>350);
  assert(error(refined)<error(coarse)*.12);
});

test('vertex snapping alone holds projected coverage through small motion within a grid cell',()=>{
  const shifted={...skew,points:skew.points.map((n,i)=>i%3===0?n+.075:n)};
  const start=raster({vertexSnap:4}), later=raster({vertexSnap:4},shifted);
  assert.deepEqual([...later.keys()],[...start.keys()]);
  assert.deepEqual([...later.values()].map(slot),[...start.values()].map(slot));
  assert.notDeepEqual([...raster().keys()],[...raster(undefined,shifted).keys()]);
  assert.notDeepEqual(at(later,24,24).position,at(start,24,24).position);
});

test('near clipping keeps the affine plane and limits extreme samples to the surface region',()=>{
  const mesh={...skew,points:[-.15,-.13,-.11, 2,-2,-4, -1,1,-2]};
  const a=raster({mapping:'affine',vertexSnap:1},mesh,{...camera,near:.19});
  const b=raster({mapping:'affine',vertexSnap:1},mesh,{...camera,near:.58});
  let matched=0;
  for (const [p,hit] of b) {
    const prior=a.get(p);
    if (!prior || Math.abs(prior.z-hit.z)>1e-7 || hit.z<.61) continue;
    assert.deepEqual(hit.color,prior.color);
    matched++;
  }
  assert(matched>150);
  for (const {color} of b.values()) assert.deepEqual(color.slice(1),[0,0]);
});

test('projection validation is atomic and subdivision preserves named slips, sampling and planar shadow casters',()=>{
  const atlas=A.make(8,4), axes=[[0,0,0],[2,0,0],[0,1,0]];
  for (const projection of [{mapping:'linear'},{vertexSnap:.1},{subdivisions:17},{subdivisions:1.5}])
    assert.throws(()=>atlas.face(...axes,8,4,()=>0,{id:'test',projection}),/Surface projection/);
  const from=atlas.reserve(4,4,()=>0x995555), to=atlas.reserve(4,4,(x)=>x<2?0x99aa33:undefined);
  atlas.faceRegion(...axes,from,{id:'test',castsShadow:true,sampling:true,
    projection:{mapping:'affine',vertexSnap:2,subdivisions:3}});
  const batch=atlas.finish();
  assert.equal(batch.vertices.length/15,18);
  assert.deepEqual(A.projectionPlan(batch),[{first:0,end:54,affine:true,vertexSnap:2,bounds:[0,0,3,3]}]);
  A.uvSlip(batch,[{face:'test',to}]);
  assert.equal(A.samplingPlan(batch)[0].end,54);
  const cast=()=>K.shadowCutouts.prepare({spriteSurfaces:batch});
  assert.equal(cast().length,1);
  A.setShadowShell(batch,'test',.1);
  assert.equal(batch.shadowFaces[0].subdivisions,3);
  assert.equal(cast().length,1);
  A.uvSlip(batch,[{first:0,count:6,from,to}]);
  assert.throws(cast,/whole painted shadow face/);
});

function sceneFixture({makeBuilder, SpriteSurface}) {
  const modes=[{}, {mapping:'affine'}, {vertexSnap:3}, {mapping:'affine',vertexSnap:3,subdivisions:4}];
  const worlds=modes.map(projection=>{
    const atlas=SpriteSurface.make(64);
    const stripes=atlas.reserve(16,16,(x,y)=>x<3?0x545b73:y<6?0x293849:x<9?0x793f45:0xcd945a);
    const pixels=atlas.reserve(2,2,()=>0x50b3ad);
    atlas.faceRegion([-1.45,-.88,1.4],[2.1,0,-2.7],[0,1.7,0],stripes,{projection,
      sampling:{palette:['#545b73','#293849','#793f45','#cd945a']}});
    atlas.faceRegion([.88,-.67,.1],[.65,0,0],[0,1.14,0],pixels);
    return makeBuilder(7,[0x121b29]).finish({spriteSurfaces:atlas.finish(),
      cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,fov:.8},radius:6});
  });
  return {worlds,points:{left:[17,45],middle:[26,35],bottom:[28,48],stable:[65,38]}};
}

test('WebGL and software sample authored projection, subdivision, snap and unchanged neighbor', {skip:!chrome},()=>{
  const w=80,h=72;
  const result=runWebGL({chrome},sceneFixture,(kit,build,backend,[w,h])=>{
    const {worlds,points}=build(kit), gpu=backend(w,h,{raw:true,offscreen:true});
    try { return {rgb:worlds.map(world=>{gpu.draw(world); return gpu.sample(points);})}; }
    finally {gpu.close();}
  },[w,h]);
  const {worlds,points}=sceneFixture(ink.load());
  const expected=worlds.map(world=>{
    const {rgb}=ink.render(world,{w,h,px:1,raw:true});
    return Object.fromEntries(Object.entries(points).map(([name,[x,y]])=>{
      const p=(y*w+x)*3;
      return [name,[...rgb.subarray(p,p+3)]];
    }));
  });
  assert(expected.every(frame=>frame.stable.join()==='80,179,173'));
  assert.notDeepEqual(expected[0],expected[1]);
  assert.deepEqual(result.rgb,expected);
});
