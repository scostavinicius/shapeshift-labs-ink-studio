const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');

const { KIT: K, makeBuilder } = ink.load();
const { raster: R } = K.procedural;
const evaluate = K.sprite.scanlineBudget.evaluate;
const pixel = ({width, data}, x, y) => Array.from(data.subarray((y * width + x) * 4, (y * width + x + 1) * 4));

test('sprite admission is independent per row and rotates ties without displacing an authored priority', () => {
  const sprites = [
    {id:'a', top:-2, bottom:6},
    {id:'b', top:2, bottom:8},
    {id:'hero', priority:10, top:3, bottom:5},
    {id:'offscreen', top:10, bottom:12}
  ];
  const sample = frame => evaluate(sprites, {height:8, budget:{limit:1, rotate:true, holdFrames:2}, frame});
  const first = sample(0);
  assert.deepEqual([...first.report.used], [1,1,1,1,1,1,1,1]);
  assert.deepEqual([...first.report.droppedCounts], [0,0,1,2,2,1,0,0]);
  assert.deepEqual(first.report.sprites.map(s => s.dropped), [[[3,5]],[[2,6]],[],[]]);
  assert.deepEqual(sample(1).report.sprites, first.report.sprites);
  const next = sample(2);
  assert.deepEqual(next.report.sprites.map(s => s.dropped), [[[2,6]],[[3,5]],[],[]]);
  assert.equal(next.allows(1, 2), true);
  assert.equal(next.allows(2, 3), true);
  assert.equal(next.allows(0, 3), false);
  assert.equal(next.allows(3, 8), false);
  assert.deepEqual(sample(0).report, first.report);
  assert.deepEqual(evaluate(sprites, {height:8, budget:{limit:0}}).report.sprites[0].dropped, [[0,6]]);
});

test('raster sprite layer clips whole rows by bounds but keeps ordinary stack order and remains opt-in', () => {
  const base = R.canvas({width:2, height:4, color:[240,80,20]});
  base.data[3] = base.data[7] = 0;
  const blue = R.canvas({width:2, height:2, color:[10,40,240]});
  const sprites = [
    {id:'paint', source:base, priority:1},
    {id:'offscreen', source:blue, x:-2, priority:9},
    {id:'detail', source:blue, x:1, y:-1}
  ];
  const render = budget => R.spriteLayer({width:4, height:5, sprites, budget});
  const result = render({limit:1});
  assert.deepEqual(result.report.sprites.map(sprite => sprite.dropped), [[],[],[[0,1]]]);
  assert.deepEqual(pixel(result.value, 2, 0), [0,0,0,0]);
  const clear = render(false);
  assert.deepEqual(clear.report, {enabled:false});
  assert.deepEqual(clear.value, R.stack({width:4, height:5, layers:sprites}).value);
  assert.deepEqual(pixel(clear.value, 1, 0), [10,40,240,255]);
  const overlap = R.spriteLayer({width:3,height:4,budget:{limit:2},sprites:[sprites[0], {...sprites[2],y:1}]});
  assert.deepEqual(pixel(overlap.value, 1, 1), [10,40,240,255]);
});

test('raster.spriteLayer uses graph time when seeking and outputs the inspection report', () => {
  const port = key => ({node:'layer', port:key});
  const project = ink.createGraphProject({format:'ink-studio/graph-project', version:1, nodes:{
    layer:{op:'raster.spriteLayer', inputs:{width:2,height:1,
      sprites:[{id:'a',source:{width:1,height:1,data:[230,4,1,255]}},
        {id:'b',x:1,source:{width:1,height:1,data:[5,9,220,255]}}],
      options:{budget:{limit:1,rotate:true,fps:10}}}}
  }, outputs:{picture:port('value'), rows:port('report')}});
  const frame = time => project.run({time}).outputs;
  assert.deepEqual(pixel(frame(0).picture, 0, 0), [230,4,1,255]);
  assert.deepEqual(pixel(frame(0.1).picture, 1, 0), [5,9,220,255]);
  assert.deepEqual(frame(0.1).rows.sprites[0].dropped, [[0,1]]);
  assert.deepEqual(frame(0).rows.sprites[1].dropped, [[0,1]]);
});

test('world cards apply layers independently and report dropped art rows with emission and depth clipped', () => {
  const atlases = [[230,45,20],[20,50,215],[40,200,65]].map(rgb => K.sprite.atlas({
    metadata:{width:2,height:3,unitsPerPixel:.1,frames:[{rect:{x:0,y:0,width:2,height:3}}]},
    images:{color:Uint8Array.from(Array.from({length:6}, () => [...rgb,255]).flat()),
      emission:Uint8Array.from(Array.from({length:6}, () => [...rgb,255]).flat())}
  }));
  const cards = ['pinned','spark','other'].map((id, i) => K.sprite.placeAtlas({atlas:atlases[i], at:[0,0,0],
    mode:'card', nativePixels:true, pixelOffset:()=>[i*4, i===1 ? 1 : 0], budgetId:id,
    budgetLayer:i===2 ? 'other' : 'effects', budgetPriority:i===0 ? 4 : 0}));
  const B = makeBuilder(11, [0x14283a]);
  const world = B.finish({radius:4, cam:{target:[0,0,0],dist:4,pitch:0,yaw:0},
    spriteAtlases:cards, spriteAtlasBudgets:{effects:{limit:1,rotate:true},other:{limit:1}}});
  const reports = [], view = {w:32,h:24,px:1,raw:true,transparent:true,passes:['depth','emission']};
  const on = ink.render(world, {...view,spriteAtlasBudgetFrame:report => reports.push(report)});
  const off = ink.render(world, {...view,spriteAtlasBudgets:false});
  assert.deepEqual(reports.map(report => report.layer), ['effects','other']);
  const {top, dropped} = reports[0].sprites[1];
  assert.deepEqual(dropped, [[top,top+2]]);
  assert.deepEqual(reports[1].sprites[0].dropped, []);
  const offset = top * 32 + 19;
  assert.equal(off.alpha[offset],255);
  assert.equal(on.alpha[offset],0);
  assert.equal(on.passes.depth[offset],Infinity);
  assert.deepEqual([...on.passes.emission.slice(offset*3,offset*3+3)], [0,0,0]);
  assert.equal(on.alpha[offset+32*2],255);
  assert.equal(on.alpha[offset+4],255);
});
