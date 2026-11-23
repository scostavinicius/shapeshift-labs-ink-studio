const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K, SpriteSurface, makeBuilder } = require('..').load();
const { render } = require('../cli/render');
const webgl = require('../cli/look-webgl');

test('two-sided cutout rays use the visible texel, threshold, UV slip, and updated alpha', () => {
  const builder = SpriteSurface.make(8);
  const region = builder.reserve(2, 2, x => x === 0 ? 0x556688 : null);
  builder.faceRegion([-1, -1, 0], [2, 0, .8], [0, 2, 0], region, { id: 'cloth', castsShadow: true });
  const atlas = builder.finish();
  const world = { spriteSurfaces: atlas };
  const trace = (x, origin = -1, direction = 1, length = 3) =>
    K.shadowCutouts.occludes(K.shadowCutouts.prepare(world), [x, .5, origin], [0, 0, direction], length);
  assert.equal(trace(-.5), true);
  assert.equal(trace(.5), false);
  assert.equal(trace(-.5, 1, -1), true);
  assert.equal(trace(-.5, -1, 1, 1), false);
  assert.equal(trace(-1.5), false);
  SpriteSurface.uvSlip(atlas, [{ face: 'cloth', flipU: true }]);
  assert.equal(trace(-.5), false);
  assert.equal(trace(.5), true);
  SpriteSurface.update(atlas, region, { w: 2, h: 2, rgba: Uint8Array.from(
    [0,0,0,127, 0,0,0,128, 0,0,0,127, 0,0,0,128]
  ) });
  assert.equal(trace(-.5), true);
  assert.equal(trace(.5), false);
  for (let i = 0; i < atlas.vertices.length; i += 5) atlas.vertices[i] += 1;
  SpriteSurface.markGeometryDirty(atlas);
  assert.equal(trace(-.5), false);
  assert.equal(trace(.5), true);
  assert.deepEqual(K.shadowCutouts.prepare(world, { enabled: false }), []);
});

test('painted scenery admits holes and casts each depth band at its world offset', () => {
  const atlas = K.sprite.atlas({
    metadata: { width: 3, height: 1, unitsPerPixel: 1, scenery: {
      bands: { near: -.4, base: 0 }, base: 'base',
      depthPaint: [{ band: 'near', shape: { type: 'rect', rect: [0, 0, 1, 1] } }]
    } },
    images: { color: Uint8Array.from([255,0,0,255, 0,0,0,0, 255,0,0,255]) }
  });
  const placed = K.sprite.placeAtlas({ atlas, at: t => [t, 0, 0], castsShadow: true });
  const world = { spriteAtlases: [placed] };
  const trace = (x, reach, time = 0) => K.shadowCutouts.occludes(
    K.shadowCutouts.prepare(world, { time }), [x, 0, 1], [0, 0, -1], reach);
  assert.equal(trace(-1, .8), true);
  assert.equal(trace(1, .8), false);
  assert.equal(trace(1, 1.1), true);
  assert.equal(trace(0, 1.1), false);
  assert.equal(trace(0, .8, 1), true);
  assert.throws(() => K.sprite.placeAtlas({ atlas, at: [0,0,0], mode: 'card', castsShadow: true }), /oriented scenery/);
});

function scene({ KIT: K, SpriteSurface, makeBuilder }, { wall = true, spot = false, shell } = {}) {
  const atlas = SpriteSurface.make(32, 32);
  const region = atlas.reserve(5, 5, (x, y) => x === 2 && y >= 1 && y <= 3 ? null : 0x413141);
  atlas.faceRegion([-.65, .55, 0], [1.3, 0, 0], [0, 1.45, 0], region, { id: 'grille', castsShadow: true, shadowShell: shell });
  if (wall) atlas.face([-3, 0, -1.5], [6, 0, 0], [0, 3.3, 0], 1, 1, () => 0x6a6066);
  const surface = atlas.finish();
  const at = [-1.5, 1.82, 1.8], aim = [1.22, -.24, -2.55];
  const world = makeBuilder(11, [0x111725]).finish({
    spriteSurfaces: surface,
    cam: { target: [.1, 1.55, -.25], dist: 8, yaw: -.18, pitch: .1, sway: 0, fov: .52, projection: 'orthographic' },
    radius: 7, dither: 0, atmosphere: [K.atmosphere.box({ min: [-2, .2, -1.45], max: [2.8, 2.9, 1.2],
      density: .20, step: .19, color: '#a8a7a4', lit: true })],
    volumeLighting: { ambient: .12, ...(spot && { spots: [{ at, direction: aim, innerAngle: 24, outerAngle: 41,
      radius: 8, color: '#ffc986', intensity: 7, surfaceIntensity: 13 }] }) },
    areaLights: spot ? [] : [K.lightEmitters.disc({ id: 'window', at, normal: aim, visible: false, sampleGrid: 1,
      size: [.08, .08], radius: 8, intensity: 13, volumeIntensity: 7, color: '#ffc986' })]
  });
  return { world, surface, region };
}

function changed(a, b) {
  let count = 0;
  for (let i = 0; i < a.length; i += 3)
    if (Math.max(...[0, 1, 2].map(k => Math.abs(a[i + k] - b[i + k]))) > 5) count++;
  return count;
}

test('area and spot cutouts shadow surfaces and local fog independently', () => {
  const kit = require('..').load(), view = { w: 104, h: 68, px: 1, raw: true };
  for (const spot of [false, true]) {
    const { world } = scene(kit, { spot });
    const options = { ...view, atmosphere: false };
    assert(changed(render(world, options).rgb, render(world, { ...options, cutoutShadows: false }).rgb) > 80);
    const fog = scene(kit, { wall: false, spot }).world;
    const withShadow = render(fog, view), unshadowed = render(fog, { ...view, cutoutShadows: false });
    assert(changed(withShadow.rgb, unshadowed.rgb) > 80);
    assert.deepEqual(render(fog, { ...view, volumeLocalShadows: false }).rgb, unshadowed.rgb);
  }
});

test('WebGL cutouts invalidate surface and fog lighting when the paint changes', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = webgl({}, scene, (kit, build, backend) => {
    const { world, surface, region } = build(kit), mist = build(kit, { wall: false }).world;
    const gpu = backend(104, 68, { raw: true, offscreen: true, emitterFogResolution: 28, emitterSurfaceResolution: 48 });
    try {
      const draw = (options, subject = world) => { gpu.draw(subject, options); return atob(gpu.image()); };
      const compare = (a, b) => {
        let count = 0;
        for (let i = 0; i < a.length; i += 3) if (Math.abs(a.charCodeAt(i) - b.charCodeAt(i)) > 8) count++;
        return count;
      };
      const before = draw({}), disabled = draw({ cutoutShadows: false });
      const surfaceOnly = draw({ atmosphere: false }), flat = draw({ atmosphere: false, cutoutShadows: false });
      const fog = compare(draw({}, mist), draw({ volumeLocalShadows: false }, mist));
      const pixels = Uint8Array.from({ length: 5 * 5 * 4 }, (_, i) => [65,49,65,255][i % 4]);
      SpriteSurface.update(surface, region, { w: 5, h: 5, rgba: pixels });
      const filled = draw({});
      const filledBase = draw({ cutoutShadows: false });
      let updatedShadow = 0;
      for (let i = 0; i < filled.length; i += 3)
        if (filledBase.slice(i,i+3) === disabled.slice(i,i+3) &&
          Math.abs(filled.charCodeAt(i) - before.charCodeAt(i)) > 8) updatedShadow++;
      return { wall: compare(surfaceOnly, flat), fog, updatedShadow };
    } finally { gpu.close(); }
  });
  assert(result.wall > 40 && result.fog > 40 && result.updatedShadow > 10, JSON.stringify(result));
});

test('depth maps keep straight holes open and close their sides to oblique and parallel rays', () => {
  const A=SpriteSurface.make(16);
  const region=A.reserve(3,1,x=>x===1?null:0x335577);
  A.faceRegion([-1.5,-.5,0],[3,0,0],[0,1,0],region,
    {id:'kiln',shadowShell:{front:[.15,0,.04],back:[-.71,0,-.75]}});
  const atlas=A.finish(), world={spriteSurfaces:atlas};
  const ray=(p,d,stop=5,settings) => K.shadowCutouts.occludes(
    K.shadowCutouts.prepare(world,settings),p,K.V.norm(d),stop);
  assert.equal(ray([0,0,.8],[0,0,-1]),false);
  assert.equal(ray([0,0,.8],[.5,0,-.866]),true);
  assert.equal(ray([0,0,.8],[.5,0,-.866],5,{shadowShells:false}),false);
  assert.equal(ray([0,0,-.5],[1,0,0]),true);
  assert.equal(ray([0,0,-.5],[1,0,0],.3),false);
  assert.equal(ray([1.27,0,-1],[-.50,0,.866]),true);
  const firstKey=K.shadowCutouts.historyKey(K.shadowCutouts.prepare(world));
  assert(firstKey);
  assert.equal(K.shadowCutouts.historyKey(K.shadowCutouts.prepare(world)),firstKey);
  assert.equal(ray([-1,0,.4],[0,0,-1],.30),true);
  assert.equal(ray([1,0,.4],[0,0,-1],.30),false);

  // The holes and both depth maps travel together under UV flips.
  SpriteSurface.uvSlip(atlas,[{face:'kiln',flipU:true}]);
  assert.equal(ray([-1,0,.4],[0,0,-1],.30),false);
  assert.equal(ray([1,0,.4],[0,0,-1],.30),true);
  assert.throws(()=>SpriteSurface.setShadowShell(atlas,'kiln',{front:0,back:[0]}),/per paint texel/);
  assert.throws(()=>SpriteSurface.setShadowShell(atlas,'kiln',{front:0,back:.2}),/back at or behind/);
  assert.equal(ray([1,0,.4],[0,0,-1],.30),true);
  SpriteSurface.update(atlas,region,{w:3,h:1,rgba:Uint8Array.from([
    0,0,0,255,0,0,0,128,0,0,0,127
  ])});
  assert.equal(ray([-1,0,.8],[0,0,-1]),false);
  assert.equal(ray([0,0,.8],[0,0,-1]),true);
  assert.notEqual(K.shadowCutouts.historyKey(K.shadowCutouts.prepare(world)),firstKey);
  SpriteSurface.setShadowShell(atlas,'kiln',false);
  assert.equal(K.shadowCutouts.historyKey(K.shadowCutouts.prepare(world)),'');
  assert.equal(ray([0,0,-.1],[1,0,0]),false);
});

test('an edge-on ray checks the opaque texel between its two clear endpoints',()=>{
  const A=SpriteSurface.make(8);
  A.face([-2,-.5,0],[4,0,0],[0,1,0],5,1,i=>i===2?0x543141:null,{shadowShell:.4});
  const shapes=K.shadowCutouts.prepare({spriteSurfaces:A.finish()});
  assert.equal(K.shadowCutouts.occludes(shapes,[-1.8,0,-.2],[1,0,0],3.6),true);
  assert.equal(K.shadowCutouts.occludes(shapes,[-1.8,0,-.6],[1,0,0],3.6),false);
  assert.equal(K.shadowCutouts.occludes(shapes,[1.8,0,-.2],[-1,0,0],3.6),true);
});

test('scenery shells follow frame crops, depth bands and placement scale',()=>{
  const atlas=K.sprite.atlas({
    metadata:{width:4,height:1,unitsPerPixel:1,frames:[{rect:{x:1,y:0,width:3,height:1}}],
      scenery:{bands:{near:-.4,base:0},base:'base',
        depthPaint:[{band:'near',shape:{type:'rect',rect:[1,0,1,1]}}]}},
    images:{color:Uint8Array.from([0,0,0,0,124,0,0,255,0,0,0,0,255,0,0,255])}
  });
  const placed={atlas,at:[0,0,0],scale:2,shadowShell:{front:[0,.1,0,0],back:[0,-.7,0,-.3]}};
  const shapes=K.shadowCutouts.prepare({spriteAtlases:[placed]});
  assert.equal(shapes.length,2);
  assert.equal(K.shadowCutouts.occludes(shapes,[-2,0,1.1],[0,0,-1],.2),true);
  assert.equal(K.shadowCutouts.occludes(shapes,[-2,0,-.41],[0,0,1],.2),true);
  assert.equal(K.shadowCutouts.occludes(shapes,[2,0,-.51],[0,0,1],.2),true);
  assert.equal(K.shadowCutouts.occludes(shapes,[0,0,1.1],[0,0,-1],4),false);
});

test('headless shell depth changes wall shadows and fog independently of the painted color',()=>{
  const kit=require('..').load(), frame={w:104,h:68,px:1,raw:true};
  for (const spot of [false,true]) {
    const {world}=scene(kit,{spot,shell:.66});
    const flat={...frame,shadowShells:false}, wall={...frame,atmosphere:false};
    assert(changed(render(world,wall).rgb,render(world,{...flat,atmosphere:false}).rgb)>100);
    const mist=scene(kit,{wall:false,spot,shell:.66}).world;
    assert(changed(render(mist,frame).rgb,render(mist,flat).rgb)>60);
    assert.deepEqual(render(world,{...frame,cutoutShadows:false}).rgb,render(world,{...flat,cutoutShadows:false}).rgb);
  }
});

test('WebGL clips wall and fog rays against authored shell depth and responds to a depth-only edit', {
  skip: !process.env.INK_TEST_CHROME
},()=>{
  const result=webgl({},scene,(kit,build,backend)=>{
    const {world,surface}=build(kit,{shell:.66});
    const mist=build(kit,{wall:false,shell:.66}).world;
    const gpu=backend(104,68,{raw:true,offscreen:true,emitterFogResolution:34,emitterSurfaceResolution:56});
    try {
      const draw=(subject,frame)=>{gpu.draw(subject,frame);return atob(gpu.image());};
      const difference=(a,b)=>{
        let count=0;
        for(let i=0;i<a.length;i+=3)if(Math.abs(a.charCodeAt(i)-b.charCodeAt(i))>7)count++;
        return count;
      };
      const before=draw(world,{atmosphere:false}), flat=draw(world,{atmosphere:false,shadowShells:false});
      const fog=difference(draw(mist,{}),draw(mist,{shadowShells:false}));
      kit.SpriteSurface.setShadowShell(surface,'grille',false);
      const edited=draw(world,{atmosphere:false});
      return {wall:difference(before,flat),fog,editMatches:edited===flat};
    } finally {gpu.close();}
  });
  assert(result.wall>80&&result.fog>50&&result.editMatches,JSON.stringify(result));
});
