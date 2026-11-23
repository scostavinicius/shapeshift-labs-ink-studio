const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const { SurfaceLook } = ink.load();

const palette = [0x000000, 0x676767, 0xff0000, 0x0000ff, 0x00ff00, 0xff00ff];
const views = { left:2, right:3, front:4, back:5 };
const direction = { type:'directionalColor', views };
const cardinal = [[0,0,1],[-1,0,0],[1,0,0],[0,0,-1]];
const expected = [[0,255,0],[255,0,0],[0,0,255],[255,0,255]];

function surfaceColor(layer, view) {
  return SurfaceLook.shade(SurfaceLook.prepare({ layers:{ coat:layer } },palette),
    { position:[0,0,0], normal:[0,1,0], view }, [.25,.25,.25]).slice(0,3);
}

test('signed swatches use opposite directions, optional contrasts, and authored axes', () => {
  for (const [i, view] of cardinal.entries())
    assert.deepEqual(surfaceColor(direction,view),expected[i].map(c=>c/255));
  assert.deepEqual(surfaceColor(direction,[0,1,0]),[.25,.25,.25]);
  assert.deepEqual(surfaceColor({ ...direction, views:{ left:2 } },[1,0,0]),[.25,.25,.25]);
  assert.deepEqual(surfaceColor({ ...direction, axes:{ right:[0,0,1], front:[-1,0,0] } },[-1,0,0]),[0,1,0]);
  assert.deepEqual(surfaceColor({ ...direction, blendAngle:10 },[1,0,1]),[0,.5,.5]);
  const legacy = { type:'directionalColor', color:2, crossColor:3 };
  assert.deepEqual(surfaceColor(legacy,[-1,0,0]),surfaceColor(legacy,[1,0,0]));
  const invalid = options => surfaceColor({ ...direction, ...options },[0,0,1]);
  assert.throws(() => invalid({ axes:{ right:[0,0,1] } }),/independent/);
  assert.throws(() => invalid({ views:{ top:2 } }),/swatches/);
});

function fixture({ KIT, makeBuilder, makeSculpt }, palette, views, patterned, gpu) {
  const B = makeBuilder(11,palette), S = KIT.sculpt(makeSculpt(B));
  const rig = gpu ? null : KIT.rig(B,S);
  const coat = KIT.surface.material({ r:[1] },{ layers:{ coat:{ type:'directionalColor', views } } });
  S.pixel = patterned;
  S.ball([0,0,0],[.70,.56,.82],coat,{ res:.05, tag:'beetle' });
  S.bake();
  const world = B.finish({ cam:{ yaw:0,pitch:0,dist:5,target:[0,0,0] },
    radius:3, dither:0, look:{ pixel:patterned } });
  const M = new Float32Array(12);
  if (rig) rig.bind(KIT.stage(world));
  else {
    M.set([1,0,0,0,1,0,0,0,1,0,0,0]);
    const ids = Array.from({ length:world.count },(_,i)=>i);
    KIT.bones.bind(world,{ ids,bid:new Uint8Array(ids.length),M,pose() {} });
  }
  world.turn = angle => {
    const rotation = KIT.M.rot([0,1,0],angle);
    if (rig) {
      rig.set('beetle',rotation,[0,0,0],[0,0,0]);
      rig.apply();
    } else M.set(rotation);
  };
  return world;
}

const rotations = [0,Math.PI/2,-Math.PI/2,Math.PI];
test('CPU art pixels use the camera and the posed axes independently', () => {
  for (const gpu of [true,false]) {
    const world = fixture(ink.load(),palette,views,true,gpu);
    const view = { w:80,h:64,px:1,ortho:true,outline:false };
    const center = frame => Array.from(frame.rgb.slice((32*80+40)*3,(32*80+41)*3));
    for (const [i, angle] of rotations.entries()) {
      world.turn(angle);
      assert.deepEqual(center(ink.render(world,view)),expected[i]);
    }
    world.turn(0);
    assert.deepEqual(center(ink.render(world,{...view,yaw:Math.PI/2})),expected[2]);
    assert.deepEqual(center(ink.render(world,{...view,directionalColors:false})),[103,103,103]);
  }
});

function browserFrames(toolkit, build, backend, [palette, views, rotations]) {
  const draw = backend(80,64,{ offscreen:true,ortho:true,outline:false,colored:false,dither:0,damp:false });
  try {
    const results = [];
    for (const [patterned,gpu] of [[false,true],[true,true],[true,false]]) {
      const world = build(toolkit,palette,views,patterned,gpu);
      const center = { center:[40,32] };
      draw.draw(world);
      const colors = rotations.map((angle,i) => {
        world.turn(angle);
        draw.draw(world,{ time:i+1, changedRows:undefined });
        return draw.sample(center).center;
      });
      draw.draw(world,{ directionalColors:false });
      results.push({ colors, disabled:draw.sample(center).center });
    }
    return { results };
  } finally { draw.close(); }
}

test('WebGL art pixels preserve all four colors on native and indexed posed splats', { skip: !process.env.INK_TEST_CHROME }, () => {
  const { results } = runWebGL({},fixture,browserFrames,[palette,views,rotations]);
  for (const result of results) {
    assert.deepEqual(result.colors,expected);
    assert.deepEqual(result.disabled,[103,103,103]);
  }
});
