const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const { KIT: K } = studio.load();
const R=K.renderOutputs, create=K.projectedStage.create;
const colors=['#18252d','#7e9aa5','#f2ae6e','#75cea6'];
const paint=(...rows)=>({width:rows[0].length,height:rows.length,palette:colors,rows});
const ground=(options={})=>({id:'paving',at:[-9,0,0],size:[18,30],paint:paint('0'),...options});
const canvas={width:65,height:48,camera:{at:[0,1,0],fov:Math.PI/2,horizon:24}};
const rgba=(packet,x,y)=>Array.from(packet.data.subarray((y*packet.width+x)*4,(y*packet.width+x)*4+4));

test('painted ground, upright parallax and ground anchors share the camera and native depth', () => {
  const stage=create({layers:[ground({paint:paint('01'),repeat:[2,3]}),
    {id:'backdrop',type:'upright',at:[-4,0,10],size:[8,4],paint:paint('1')},
    {id:'frame',type:'upright',at:[-2,0,5],size:[2.5,2],paint:paint('2.')}],
    props:[{id:'marker',at:[2,5],height:1.2,paint:paint('.3.','333','.3.')}]
  });
  let frame=stage.render(canvas);
  assert.equal(R.pick(frame,24,23).owner.id,'frame');
  assert.equal(R.pick(frame,32,23).owner.id,'backdrop');
  const floor=R.pick(frame,32,32);
  const view=stage.view(canvas), fromScreen=view.ground(32,32);
  assert.equal(floor.owner.id,'paving');
  assert.deepEqual(floor.position,fromScreen.point);
  assert(Math.abs(floor.uv[1]-fromScreen.point[2]/3)<1e-10);
  const anchor=view.project([2,0,5]);
  assert.deepEqual(frame.placements[0].anchor,[anchor.x,anchor.y]);
  const first=frame.placements[0].anchor[0];
  frame=stage.render({...canvas,camera:{...canvas.camera,at:[1,1,0]}});
  const back=stage.view(canvas).project([2,0,10]).x;
  const backPan=stage.view({...canvas,camera:{...canvas.camera,at:[1,1,0]}}).project([2,0,10]).x;
  assert(Math.abs((first-frame.placements[0].anchor[0])-2*(back-backPan))<1e-10);
});

test('mirror samples follow floor coordinates through a camera pan and keep the floor as the depth owner', () => {
  const stage=create({layers:[
    ground({reflection:{strength:1,mask:paint('.0')}}),
    {id:'lantern',type:'upright',at:[-2,0,5],size:[4,2],paint:paint('2'),reflect:true}
  ]});
  for (const eye of [0,1.2]) {
    const settings={...canvas,camera:{...canvas.camera,at:[eye,1,0]}};
    const frame=stage.render(settings), off=stage.render({...settings,reflections:false});
    const {x,y}=stage.view(settings).project([1.5,-1,5]);
    const wet=R.pick(frame,x,y);
    assert.equal(wet.owner.id,'paving');
    assert(Math.abs(wet.position[1])<1e-10);
    assert(wet.depth<5);
    assert.deepEqual(wet.rgba,[242,174,110,255]);
    assert.deepEqual(rgba(off,Math.floor(x),Math.floor(y)),[24,37,45,255]);
    const dry=stage.view(settings).project([-1.5,-1,5]);
    assert.deepEqual(R.pick(frame,dry.x,dry.y).rgba,[24,37,45,255]);
    assert.deepEqual(frame.depth,off.depth);
    assert.deepEqual(frame.ids,off.ids);
    assert.deepEqual(frame.uv,off.uv);
  }
});

test('animated sprite paint mirrors around its registered foot while upper layers occlude the reflection', () => {
  const actor={id:'sentry',at:t=>[t,5],height:1.25,paint:{width:2,height:3,palette:colors,fps:2,frames:[
    {rows:['22','22','22']},{rows:['33','33','33']}
  ]}};
  const stage=create({layers:[ground({reflection:{strength:1}})],props:[actor]});
  const settings={...canvas,camera:{...canvas.camera,horizon:24.49},time:.5};
  const frame=stage.render(settings), pose=frame.placements[0], [left,top,,height]=pose.rect;
  const foot=Math.round(pose.anchor[1]), y=2*foot-top-1;
  assert.equal(R.pick(frame,left+1,top).owner.id,'sentry');
  const mirror=R.pick(frame,left+1,y);
  assert.equal(mirror.owner.id,'paving');
  assert.deepEqual(mirror.rgba,rgba(frame,left+1,top));
  assert.deepEqual(R.pick(frame,left+1,foot).rgba,rgba(frame,left+1,foot-1));
  assert.equal(height,6);
  const cover=create({layers:[ground({reflection:{strength:1}}),
    {id:'foreground',at:[-9,.25,0],size:[18,30],paint:paint('1')}],
    props:[{...actor,ground:'paving'}]});
  const obscured=R.pick(cover.render(settings),left+1,y);
  assert.equal(obscured.owner.id,'foreground');
  assert.deepEqual(obscured.rgba,[126,154,165,255]);
});

test('rotated and coplanar paint layers integrate as a shared camera feed', () => {
  const stage=create({layers:[
    ground(),
    {id:'wash',at:[0,0,4],yaw:Math.PI/2,size:[2,2],paint:paint('2.')},
    {id:'side',type:'upright',at:[3,0,7],yaw:Math.PI/2,size:[4,2],paint:paint('1')}
  ]});
  const frame=stage.render(canvas);
  assert(frame.ids.includes(frame.owners.findIndex(o=>o?.id==='wash')));
  const atlas=studio.createCameraAtlas({width:65,height:48,views:[{
    id:'court',rect:[0,0,65,48],source:()=>frame
  }]});
  atlas.capture({});
  assert.deepEqual(atlas.read('court').rgba,frame.data);
  assert.equal(atlas.pick('court',.5,.9).owner.kind,'ground');
  atlas.dispose();
});
