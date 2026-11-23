const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const runWebGL = require('../cli/look-webgl');
const { KIT: K, SpriteSurface } = studio.load();
const R = K.renderOutputs;

function makeFrame(R, level = 200) {
  return R.create({
    width:3,height:2,
    data:Uint8Array.of(level,20,30,255, 20,200,30,255, 10,20,200,255,
      240,90,50,255, 50,50,60,255, 70,40,90,0),
    ids:Uint16Array.of(1,2,2, 1,0,0),
    depth:Float32Array.of(4,6,8, 10,Infinity,Infinity),
    uv:Float32Array.of(.125,2.5, .5,-1.5, .75,.25, 1,.5, 0,0, 0,0),
    owners:[null,{id:'signal',kind:'prop'},{id:'road'}],
    camera:{origin:[1,2,3],right:[1,0,0],up:[0,1,0],forward:[0,0,1],center:[1.5,1],scale:[2,2]}
  });
}

test('aligned render outputs expose exact color, coverage, depth, owner and texture coordinates', () => {
  const frame = makeFrame(R);
  assert.deepEqual(R.pick(frame,0,0),{
    x:0,y:0,id:1,owner:{id:'signal',kind:'prop'},depth:4,uv:[.125,2.5],
    rgba:[200,20,30,255],position:[-1,3,7]
  });
  assert.equal(R.pick(frame,1,1),null,'an opaque backdrop has no surface owner');
  assert.equal(R.pick(frame,3,0),null);
  assert.equal(R.pickUV(frame,.30,.1).owner.id,'signal');
  assert.equal(R.pickUV(frame,.30,.1,{surface:true}).owner.id,'road');
  assert.equal(R.pickUV(frame,1,1),null);
  assert.deepEqual([...R.mask(frame).data],[255,255,255,255,0,0]);
  assert.deepEqual([...R.mask(frame,'signal').data],[255,0,0,255,0,0]);
  assert.deepEqual([...R.raster(frame,'depth',{miss:-1}).data],[4,6,8,10,-1,-1]);
  assert.deepEqual([...R.raster(frame,'ids').data],[1,2,2,1,0,0]);
  assert.deepEqual([...R.raster(frame,'uv').data.subarray(0,6)],[.125,2.5,1,.5,-1.5,1]);
  assert.deepEqual([...R.raster(frame,'position').data.subarray(0,3)],[-1,3,7]);
  const flat = R.create({...frame,camera:{...frame.camera,projection:'orthographic'}});
  assert.deepEqual(R.pick(flat,0,0).position,[.5,2.25,7]);
  for (const lane of ['color','ids','depth','uv','position'])
    assert(K.procedural.graphTypes.validator('raster')(R.raster(frame,lane)));
  assert.throws(() => R.create({...frame,ids:Uint16Array.of(1,9,2,1,0,0)}),/agree per pixel/);
  assert.throws(() => R.create({...frame,camera:{...frame.camera,right:[0,0,0]}}),/orthonormal/);
});

test('a projected route uses calibrated depth to recover world surface positions', () => {
  const route = K.procedural.routes.projected.create({
    path:[[0,0,0],[0,0,50]],width:8,
    strips:[{id:'road',repeat:5,paint:{width:1,height:1,rows:['0'],palette:['#404c54']}}]
  });
  const frame = route.render({width:64,height:48,camera:{at:[0,2,0],target:[0,2,1],fov:Math.PI/2}});
  assert(R.is(frame));
  const hit=R.pick(frame,32,32);
  assert.equal(hit.owner.id,'road');
  assert(Math.abs(hit.position[1])<1e-8);
  assert(Math.abs(hit.position[2]-hit.depth)<1e-8);
  assert(Math.abs(hit.uv[1]-hit.position[2]/5)<1e-8);
  assert(Math.abs(hit.position[0]-(hit.uv[0]-.5)*8)<1e-8);
});

test('a scheduled source feeds a world surface and retains picking until that capture is replaced', () => {
  let packet = makeFrame(R), fails = false;
  const atlas = studio.createCameraAtlas({
    width:6,height:2,views:[
      {id:'remote',rect:[1,0,3,2],fps:2,source:() => fails ? {} : packet}
    ]
  });
  const surface = SpriteSurface.make(6), region = surface.reserve(3,2);
  surface.faceRegion([-1,-.5,0],[2,0,0],[0,1,0],region);
  const spriteSurfaces = surface.finish();
  const sync = atlas.bindSurface(spriteSurfaces,'remote',region);
  assert.equal(atlas.outputs('remote'),null);
  assert.deepEqual(atlas.capture({}, {time:0}).updated,['remote']);
  assert(sync());
  assert.deepEqual(spriteSurfaces.pixels.slice(0,12),packet.data.slice(0,12));
  assert.deepEqual(atlas.read('remote').rgba,packet.data);
  packet.data[0] = 0;
  const previous = atlas.outputs('remote');
  previous.depth[0] = 0;
  assert.equal(atlas.pick('remote',0,0).depth,4);
  assert.equal(atlas.pick('remote',0,0).rgba[0],200);
  assert.equal(atlas.pick('remote',.30,.1,{surface:true}).owner.id,'road');
  packet = makeFrame(R,127);
  assert.deepEqual(atlas.capture({}, {time:.25}).updated,[]);
  assert.equal(sync(),false);
  fails=true;
  assert.throws(() => atlas.capture({}, {time:.5}),/sized to its tile/);
  assert.equal(atlas.read('remote').rgba[0],200);
  assert.equal(atlas.lastCapture('remote'),0);
  fails=false;
  assert.deepEqual(atlas.capture({}, {time:.5}).updated,['remote']);
  assert(sync());
  assert.equal(atlas.pick('remote',0,0).rgba[0],127);
  assert.equal(spriteSurfaces.pixels[0],127);
  const world = studio.load().makeBuilder(1,[0]).finish({});
  const captured = atlas.outputs('remote');
  const view = studio.render(world,{w:3,h:2,px:1,composite:{layers:[R.layer(captured)]}});
  assert.deepEqual([...view.rgb.slice(0,3)],[127,20,30]);
  const graph = studio.render(world,{w:3,h:2,px:1,transparent:true,renderGraph:{passes:[
    {id:'matte',type:'mask',raster:{slot:'picked'}},
    {id:'feed',type:'composite',isolated:true,mask:'matte',layer:{source:{slot:'color'}}}
  ]}, renderGraphInputs:{picked:R.mask(captured,'signal'),color:R.raster(captured)}});
  assert.deepEqual([...graph.alpha],[255,0,0,255,0,0]);
  assert.deepEqual([...graph.rgb.slice(0,3)],[127,20,30]);
  atlas.reset();
  assert.equal(atlas.outputs('remote'),null);
  assert.equal(atlas.pick('remote',0,0),null);
  assert(sync());
  assert.equal(spriteSurfaces.pixels[3],0);
  atlas.dispose();
});

test('WebGL camera atlases display a packet without flipping rows and keep CPU picking aligned', {
  skip:!process.env.INK_TEST_CHROME
}, () => {
  function build({makeBuilder}) { return makeBuilder(3,[0]).finish({}); }
  function render(kit,build,backend) {
    const R = kit.KIT.renderOutputs;
    const world = build(kit), gpu = backend(12,8,{raw:true,scale:1,offscreen:true});
    const owners = [null,{id:'top'},{id:'bottom'}];
    const packet = R.create({width:2,height:2,owners,
      data:Uint8Array.of(250,0,10,255, 255,0,0,140, 20,30,240,255, 0,0,0,0),
      depth:Float32Array.of(2,2,12,Infinity),ids:Uint16Array.of(1,1,2,0),uv:new Float32Array(8)});
    const atlas = gpu.cameraAtlas({width:5,height:4,views:[{id:'custom',rect:[2,1,2,2],source:() => packet}]});
    try {
      atlas.capture(world);
      gpu.draw(world,{composite:{layers:[atlas.layer('custom',{rect:[2,2,8,4]})]}});
      return { image:[...atlas.read('custom').rgba], pick:atlas.pick('custom',.2,.8),
        screen:gpu.sample({top:[3,2],bottom:[3,5]}) };
    } finally {
      atlas.dispose();
      gpu.close();
    }
  }
  const result = runWebGL({},build,render,{});
  assert.deepEqual(result.image,[250,0,10,255,255,0,0,140,20,30,240,255,0,0,0,0]);
  assert.equal(result.pick.owner.id,'bottom');
  assert.equal(result.pick.depth,12);
  assert.deepEqual(result.screen,{top:[250,0,10],bottom:[20,30,240]});
});
