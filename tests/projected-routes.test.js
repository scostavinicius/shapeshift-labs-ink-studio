const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { KIT: K } = ink.load();
const { create } = K.procedural.routes.projected;
const paint = (rows, palette) => ({ width:rows[0].length,height:rows.length,rows,palette });
const copper = paint(['0'],['#a05030']);
const white = paint(['0'],['#fff2c0']);
const strip = (options = {}) => ({ id:'bed', paint:copper, ...options });
const camera = { at:[0,2,0],target:[0,2,1],fov:Math.PI/2,near:.4,far:100 };
const pixels = (frame, id) => [...frame.ids.keys()].filter(i => frame.owners[frame.ids[i]]?.id === id);

test('projected strips retain map registration and named depth samples across tessellation and scrolling', () => {
  const path = [[0,0,0],[0,0,70]], width = 12;
  const texture = paint(['01','10','00','11'],['#a05030','#bfe2c0']);
  const frame = (step, time) => create({ path, width, step, strips:[strip({paint:texture,repeat:8,scroll:2})] })
    .render({width:64,height:48,camera,time});
  const first=frame(undefined,0), subdivided=frame(2,0), moving=frame(2,1);
  assert.deepEqual(first.ids,subdivided.ids);
  const p = 32*64+32, z = 48/8.5;
  assert(Math.abs(first.depth[p]-z)<1e-8);
  assert(Math.abs(first.uv[p*2]-(.5+.5*z/24/width))<1e-8);
  assert(Math.abs(first.uv[p*2+1]-z/8)<1e-8);
  assert(Math.abs(moving.uv[p*2+1]-first.uv[p*2+1]+.25)<1e-8);
  assert.deepEqual(moving.ids,first.ids);
  assert.notDeepEqual(moving.data,first.data);
  assert.equal(first.depth[0],Infinity);
  assert.equal(first.data[3],0);
  assert.deepEqual(first.owners,[null,{id:'bed',kind:'strip'}]);
});

test('a crest shortens a prop from the bottom and then reveals its full, hand-painted native cel', () => {
  const path = [[0,0,0],[0,0,6],[0,5,15],[0,0,22],[0,0,70]];
  const route = K.procedural.routes.polyline(path);
  const post = { id:'signal',distance:route.closest([0,0,25]).t*route.length,height:7,sizes:[
    { paint:paint(['.0.','000','.0.','.0.','.0.','.0.','.0.'],['#fff2c0']),native:true },
    { minPixels:22,paint:paint(['.000.','00100','.000.','..0..','..0..','..0..','..0..','..0..','..0..'],
      ['#fff2c0','#ff4430']),native:true }
  ] };
  const model=create({path:route,width:8,step:9,strips:[strip()],props:[post]});
  const frame = (at,target) => model.render({width:80,height:64,camera:{...camera,at,target}});
  const behind=frame([0,2,0],[0,2,1]);
  assert.equal(behind.placements[0].cel,0);
  assert.equal(behind.placements[0].visiblePixels,0);
  const partial=frame([0,6,12],[0,6,13]);
  assert(partial.placements[0].visiblePixels>0 && partial.placements[0].visiblePixels<9);
  const near=frame([0,1.4,22],[0,1.4,23]);
  assert.equal(near.placements[0].cel,1);
  assert.deepEqual(near.placements[0].rect.slice(2),[5,9]);
  assert.equal(near.placements[0].visiblePixels,17);
  assert(pixels(near,'signal').some(i=>near.data[i*4]===255 && near.data[i*4+1]===68));
});

test('width keys, bends, cutout strips and oversized near props stay on the art grid', () => {
  const clear = paint(['.0'],['#989fb0']);
  const route = create({ path:[[0,0,0],[0,0,10],[8,2,19],[10,0,37]],
    width:[[0,4],[10,8]], strips:[strip(),{id:'screen',paint:clear,lift:[.6,.6],repeat:3}],
    props:[{id:'marker',distance:.5,offset:-.01,height:60,sizes:[{paint:white,pivot:[0,1]}]}]
  });
  assert.deepEqual(route.sample(5,{elevation:1}),{distance:5,point:[0,1,5],width:6});
  const outer = route.sample(5,{offset:2}).point;
  assert.equal(outer[0],2);
  assert(outer[2]<5,'offset follows the bend in the actual strip');
  assert.equal(route.sample(10).width,8);
  assert.equal(route.sample(route.length+3).distance,route.length);
  const frame = route.render({width:48,height:36,camera});
  assert(pixels(frame,'bed').length);
  assert(pixels(frame,'screen').length);
  assert(pixels(frame,'marker').length);
  assert([...frame.depth].every(z=>z===Infinity || z>=camera.near-.00001&&z<=camera.far+.00001));
});

test('prepared stamp rasters can paint a route and attach an export at the same integer grid', () => {
  const prepared = K.pixelStamps.image(paint(['0'],['#112244']));
  const route = create({path:[[0,0,0],[0,0,10]],strips:[strip({paint:prepared})]});
  const frame = route.render({width:40,height:30,camera});
  const world = ink.load().makeBuilder(3,[0]).finish({});
  const composited = ink.render(world,{w:40,h:30,px:1,renderGraph:{
    passes:[{id:'route',type:'composite',isolated:true,layer:{source:{slot:'road'},filter:'nearest'}}]
  },renderGraphInputs:{road:frame}});
  const first = pixels(frame,'bed')[0];
  assert.deepEqual([...composited.rgb.subarray(first*3,first*3+3)],[17,34,68]);
  assert.equal(route.render({width:40,height:30,camera:{distance:10}}).ids.some(Boolean),false);
});
