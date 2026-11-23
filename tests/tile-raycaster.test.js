const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const { KIT: K } = studio.load();
const R = K.renderOutputs, create = K.tileRaycaster.create;
const palette = ['#141722','#3d5165','#778f9e','#f5b870','#7f4339','#d15c58'];
const paint = (...rows) => ({width:rows[0].length,height:rows.length,rows});
const tile = { paint:paint('22'),faces:{west:paint('33')} };
const room = ['#######','#.....#','#.....#','#.....#','#.....#','#.....#','#######'];
const rgba = (frame,x,y) => [...frame.data.subarray((y*frame.width+x)*4,(y*frame.width+x)*4+4)];
const camera = {at:[3.5,.5,1.5],fov:Math.PI/2};

test('walls have straight axial depth, registered face UV and exact palette distance bands', () => {
  const map = create({map:room,palette,tiles:{'#':tile},floor:paint('1'),ceiling:paint('0'),
    shade:{distances:[2,4],ramps:{2:[2,1,0],3:[3,4,0]},sideBias:{x:1}}});
  const frame = map.render({width:41,height:40,camera});
  const middle = R.pick(frame,20,20), offCenter = R.pick(frame,22,20);
  assert.equal(middle.depth,4.5);
  assert.equal(offCenter.depth,4.5);
  assert.equal(middle.owner.id,'wall-3-6');
  assert.equal(offCenter.owner.id,'wall-3-6');
  assert.equal(middle.uv[0],.5);
  assert(offCenter.uv[0]>middle.uv[0]);
  assert.deepEqual(middle.rgba,[20,23,34,255]);
  const floor = R.pick(frame,21,28);
  assert.equal(floor.owner.id,'floor');
  assert(Math.abs(floor.position[1])<1e-9);
  assert.equal(R.pick(frame,20,5).owner.id,'ceiling');
  assert.equal(map.cast({at:[4.5,2.5],direction:[2,0]}).face,'west');
  const side = map.render({width:41,height:40,camera:{...camera,at:[4.5,.5,2.5],yaw:Math.PI/2}});
  assert.deepEqual(rgba(side,20,20),[127,67,57,255]);
  const seam = map.render({width:41,height:40,camera:{...camera,at:[3.5,.5625,1.5]}});
  assert(seam.ids.every(Boolean),'the floor meets the wall even when the seam is at a pixel center');
});

test('sliding doors move texture addresses with the slab and reveal a sprite one column at a time', () => {
  const map = create({map:[...room.slice(0,3),'###.###',...room.slice(4)],palette,tiles:{'#':tile},
    doors:[{id:'gate',at:[3,3],paint:paint('2345'),open:t=>Math.min(1,t)}],
    sprites:[{id:'guest',at:[3.5,0,4.8],height:.89,views:[{yaw:Math.PI,paint:paint('333','353','333')}]}]});
  const frame=t=>map.render({width:41,height:40,camera,time:t});
  const closed=frame(0), halfway=frame(.5), open=frame(1), center=21;
  assert.equal(closed.placements[0].visiblePixels,0);
  assert(halfway.placements[0].visiblePixels>0);
  assert(halfway.placements[0].visiblePixels<open.placements[0].visiblePixels);
  assert.equal(R.pick(halfway,19,20).owner.id,'guest');
  const covered=R.pick(halfway,center,20);
  assert.equal(covered.owner.id,'gate');
  assert.equal(covered.depth,2);
  assert(Math.abs(R.pick(closed,center,20).uv[0]-covered.uv[0]-.5)<1e-9);
  assert.equal(map.cast({at:[3.25,1.5],direction:[0,1],time:.5}).owner.id,'wall-3-6');
  assert.equal(map.cast({at:[3.75,1.5],direction:[0,1],time:.5}).owner.id,'gate');
  const override=map.render({width:41,height:40,camera,doors:{gate:1}});
  assert.deepEqual(override.ids,open.ids);
});

test('doors in either axis can slide toward negative coordinates and can be viewed from either side', () => {
  const map=create({map:room,palette,tiles:{'#':tile},
    doors:[{id:'shutter',at:[3,3],axis:'x',slide:'negative',open:.5,paint:paint('34')}]});
  const cast=(at,direction)=>map.cast({at,direction});
  assert.equal(cast([1.5,3.75],[1,0]).owner.kind,'wall');
  assert.equal(cast([1.5,3.25],[1,0]).owner.id,'shutter');
  const back=cast([4.5,3.25],[-1,0]);
  assert.deepEqual([back.face,back.depth,back.u],['east',1,.75]);
  assert.equal(cast([3.25,3.25],[1,0]).owner.id,'shutter');
});

test('directional animated cutouts keep transparent pixels clear and publish a camera-atlas feed', () => {
  const map = create({map:room,palette,tiles:{'#':tile},sprites:[{
    id:'paper-moth',at:[3.5,0,3.5],height:1,views:[
      {yaw:0,paint:{width:3,height:3,fps:2,frames:[
        {rows:['.3.','333','.3.']},{rows:['.4.','444','.4.']}
      ]}},
      {yaw:-Math.PI/2,paint:paint('.5.','555','.5.')}
    ]
  }]});
  const view=(at,yaw,time=0)=>map.render({width:41,height:40,time,camera:{at,yaw,fov:Math.PI/2}});
  const front=view([3.5,.5,5.5],Math.PI), side=view([1.5,.5,3.5],Math.PI/2);
  assert.equal(front.placements[0].yaw,0);
  assert.equal(side.placements[0].yaw,-Math.PI/2);
  assert.deepEqual(rgba(front,20,20),[245,184,112,255]);
  assert.deepEqual(rgba(side,20,20),[209,92,88,255]);
  assert.deepEqual(rgba(view([3.5,.5,5.5],Math.PI,.5),20,20),[127,67,57,255]);
  const [left,top]=front.placements[0].rect;
  assert.notEqual(R.pick(front,left,top)?.owner.id,'paper-moth');
  const atlas=studio.createCameraAtlas({width:41,height:40,views:[{id:'hall',rect:[0,0,41,40],source:()=>side}]});
  atlas.capture({});
  assert.equal(atlas.pick('hall',.5,.5).owner.id,'paper-moth');
  assert.deepEqual(atlas.read('hall').rgba,side.data);
  assert.throws(()=>map.render({width:41,height:40,camera:{at:[0,.5,0]}}),/empty or door cell/);
  assert.throws(()=>create({map:room,palette,tiles:{'#':{paint:paint('.')}}}),/every texel/);
  atlas.dispose();
});
