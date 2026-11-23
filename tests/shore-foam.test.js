const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { KIT: K, CameraLens } = ink.load();

test('shoreline joins classify banks, tips and inside corners, including wet cells that only touch at a point', () => {
  const makeBody = (id, wet) => K.procedural.waterBodies.create({
    id, bounds: { min:[0,0], max:[3,3] }, resolution:[3,3],
    sample:(x,z) => wet(x,z) ? { bed:-1, surface:0 } : null
  });
  const body = makeBody('inlet', (x,z) => x<1 || z<1);
  const foam = K.shoreFoam.create(body,{ spacing:.4 });
  assert.deepEqual(new Set(foam.sites.map(site => site.kind)), new Set(['inside','tip','straight']));
  assert.ok(foam.sites.every(({at}) => body.columnAt(at[0],at[2])));
  const split = K.shoreFoam.create(makeBody('split', (x,z) => (x<1 && z<1) || (x>1 && x<2 && z>1 && z<2)));
  assert.equal(split.sites.filter(({kind}) => kind==='tip').length,0);
  assert.equal(split.sites.filter(({kind}) => kind==='inside').length,8);
});

test('foam uses individually painted cardinal and diagonal cels and accepts a workshop replacement', () => {
  const catalog = K.pixelStamps.catalog().clips.filter(({id}) => id.startsWith('foam-'));
  assert.equal(catalog.length,6);
  for (const kind of ['straight','inside','tip']) {
    const east = K.pixelStamps.clip('foam-'+kind+'-east');
    const diagonal = K.pixelStamps.clip('foam-'+kind+'-se');
    assert.equal(east.frames.length,4);
    assert.equal(east.width,9);
    assert.notDeepEqual(east.frames[0].rows,diagonal.frames[0].rows);
  }
  const body = { columnAt: () => ({ surface:0 }) };
  const exact = { width:1,height:1,rows:['0'],palette:['#f8f6db'] };
  const foam = K.shoreFoam.create(body,{
    paths:[[[0,0,0],[0,0,-.3]]],stagger:0,clips:{'foam-straight-east':exact}
  });
  const pose = CameraLens.orbitPose(0,.65,4,[0,0,0]);
  const camera = { eye:pose.eye,view:CameraLens.matrix(pose),ortho:true,tangent:1,aspect:1 };
  const [row] = K.shoreFoam.frame(foam,{},camera,{w:64,h:64});
  assert.deepEqual([...row.image.rgba],[248,246,219,255]);
});

test('cels stay anchored before release, drift with the current, and respect the mask at pixel centers', () => {
  const body = { columnAt:(x,z) => z>0 && z<1 ? { surface:0,current:[.65,0,.35] } : null };
  const paths = [[[-.50,0,0],[.50,0,0]]];
  const make = options => K.shoreFoam.create(body,{paths,spacing:1,period:2,stagger:0,...options});
  const pose = CameraLens.orbitPose(0,.8,4,[0,0,0]);
  const camera = { eye:pose.eye,view:CameraLens.matrix(pose),ortho:true,tangent:1,aspect:1 };
  const rows = (foam,time) => K.shoreFoam.frame(foam,{},camera,{w:80,h:80,time});
  const draw = (foam,time) => {
    const pixels = [];
    K.nativeCelPixels.pixels(rows(foam,time),80,80,(...pixel) => pixels.push(pixel));
    return pixels;
  };
  const free = make(), masked = make({mask:x=>x<.04});
  assert.equal(rows(free,0)[0].left,rows(free,.70)[0].left);
  assert.ok(rows(free,1.28)[0].left>rows(masked,1.28)[0].left+4);
  assert.ok(draw(masked,0).length>0);
  assert.ok(draw(masked,0).every(([x])=>x<=41));
  assert.deepEqual(draw(free,.35),draw(free,2.35));
  assert.deepEqual(draw(free,-.3),draw(free,1.7));
});

function fixture({ KIT: K, makeBuilder, SpriteSurface }, withRock) {
  const surfaces = SpriteSurface.make(16), water = 0x23515b, stone = 0x615660;
  surfaces.face([-2,0,2],[4,0,0],[0,0,-4],1,1,()=>water);
  if (withRock) surfaces.face([-.15,.22,1.5],[.31,0,0],[0,0,-3],1,1,()=>stone);
  const body = K.procedural.waterBodies.create({
    id:'test-pool',bounds:{min:[-2,-2],max:[2,2]},resolution:[4,4],sample:()=>({bed:-1,surface:0})
  });
  const solid = {width:9,height:9,rows:Array(9).fill('000000000'),palette:['#f8f6db']};
  return makeBuilder(2,[0x101824,water,stone]).finish({
    cam:{target:[0,0,0],yaw:0,pitch:.70,dist:4,fov:.6,ortho:true},radius:4,
    spriteSurfaces:surfaces.finish(),
    shoreFoam:K.shoreFoam.create(body,{paths:[[[-.24,0,0],[.24,0,0]]],spacing:1,stagger:0,
      clips:{'foam-straight-east':solid}})
  });
}
const probes = { covered:[32,30], exposed:[36,30] };
const foamRgb = [248,246,219];

test('headless draws exact native foam and keeps the nearer rock above it', () => {
  const options = {w:64,h:64,px:1,raw:true};
  const clear = ink.render(fixture(ink.load(),false),options);
  const world = fixture(ink.load(),true);
  const on = ink.render(world,options), off = ink.render(world,{...options,shoreFoam:false});
  const sample = (frame,[x,y]) => [...frame.rgb.subarray((y*64+x)*3,(y*64+x)*3+3)];
  assert.deepEqual(sample(clear,probes.covered),foamRgb);
  assert.deepEqual(sample(on,probes.covered),sample(off,probes.covered));
  assert.deepEqual(sample(on,probes.exposed),foamRgb);
  assert.notDeepEqual(sample(off,probes.exposed),foamRgb);
});

test('WebGL draws the same whole pixels with opaque depth masking', { skip:!process.env.INK_TEST_CHROME }, () => {
  const run = require('../cli/look-webgl');
  const result = run({},fixture,(kit,make,backend,points) => {
    const gpu = backend(64,64,{raw:true,scale:1,offscreen:true});
    try {
      const world = make(kit,true);
      gpu.draw(world,{shoreFoam:false});
      const off = gpu.sample(points);
      gpu.draw(world);
      const on = gpu.sample(points);
      gpu.draw(make(kit,false));
      return {off,on,clear:gpu.sample(points)};
    } finally {
      gpu.close();
    }
  },probes);
  assert.deepEqual(result.clear.covered,foamRgb);
  assert.deepEqual(result.on.covered,result.off.covered);
  assert.deepEqual(result.on.exposed,foamRgb);
});
