const {test} = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const {KIT:K} = studio.load();
const {create}=K.heightmapFlyover, R=K.renderOutputs;
const view={width:55,height:48,camera:{at:[1.5,2,-1],horizon:24,fov:Math.PI/2}};
const approximate=(actual,expected)=>assert(Math.abs(actual-expected)<1e-10,`${actual} ≠ ${expected}`);

function strip(values,rows,options={}) {
  return create({
    bounds:[0,3,0,values.length*2],
    heights:{width:1,height:values.length,data:values},
    paint:{width:1,height:values.length,rows,palette:['#152635','#885649','#8ea99b','#a47f89']},
    ...options
  });
}

test('an individual ridge cell hides the basin until the camera climbs above it',()=>{
  const basin=strip([0,0,3,0,0,2],['0','0','1','2','2','3'],{
    regions:{names:['foreground','ridge','basin','far mesa'],data:[0,0,1,2,2,3]}
  });
  const low=basin.render(view);
  const ridge=R.pick(low,27,20);
  assert.equal(ridge.owner.id,'ridge');
  assert.equal(ridge.depth,5);
  assert.deepEqual(ridge.rgba,[136,86,73,255]);
  approximate(ridge.position[2],4);
  assert(!low.ids.includes(3));
  assert.equal(R.pick(low,27,10),null);
  const high=basin.render({...view,camera:{...view.camera,at:[1.5,12,-1],horizon:13}});
  assert(high.ids.includes(3));
  assert(high.ids.includes(4));
});

test('visible cap depth, UV, position and owner remain aligned through the camera atlas',()=>{
  const terrain=strip([0,0,0,0,0],['0','0','0','0','0'],{id:'salt'});
  const frame=terrain.render(view);
  const cap=R.pick(frame,27,36);
  approximate(cap.depth,3.84);
  approximate(cap.position[1],0);
  approximate(cap.position[2],2.84);
  approximate(cap.uv[0],.5);
  approximate(cap.uv[1],.284);
  assert.deepEqual(cap.owner,{id:'salt',kind:'terrain'});
  const atlas=studio.createCameraAtlas({width:55,height:48,views:[{
    id:'survey',rect:[0,0,55,48],source:()=>frame
  }]});
  atlas.capture({});
  assert.deepEqual(atlas.read('survey').rgba,frame.data);
  assert.deepEqual(atlas.pick('survey',27.5/55,36.5/48),cap);
  atlas.dispose();
});

test('altitude and distance bands draw exact swatches independently of geometry',()=>{
  const terrain=strip([3,3,3,3,3],['0','0','0','0','0'],{
    altitude:{thresholds:[2],swatches:{'#152635':['#152635','#865749']}},
    distance:{thresholds:[3],swatches:{
      '#152635':['#152635','#374264'],'#865749':['#865749','#93778a']
    }}
  });
  const settings={...view,camera:{...view.camera,at:[1.5,5,-1]}};
  const palette=[
    [false,false,[21,38,53,255]],[true,false,[134,87,73,255]],
    [false,true,[55,66,100,255]],[true,true,[147,119,138,255]]
  ];
  const base=terrain.render(settings);
  for (const [altitudeBands,distanceBands,color] of palette) {
    const frame=terrain.render({...settings,altitudeBands,distanceBands});
    assert.deepEqual(R.pick(frame,27,36).rgba,color);
    assert.deepEqual(frame.ids,base.ids);
    assert.deepEqual(frame.depth,base.depth);
    assert.deepEqual(frame.uv,base.uv);
  }
  assert.deepEqual(R.pick(base,27,44).rgba,[134,87,73,255]);
});

test('reversed map rows keep coverage, world height, and paint addresses registered',()=>{
  const terrain=strip([1,127],['3','.'],{
    rowDirection:'negative',heightScale:2,heightOffset:-1,
    regions:{names:['far','void'],data:[0,1]}
  });
  assert.equal(terrain.sample(1.5,.5),null);
  assert.equal(terrain.sample(1.5,4),null);
  assert.deepEqual(terrain.sample(1.5,2.5),{
    point:[1.5,1,2.5],uv:[.5,.375],color:0xa47f89,owner:{id:'far',kind:'terrain'}
  });
  const frame=terrain.render({...view,background:'#5b4d63'});
  assert.equal(frame.depth[27],Infinity);
  assert.deepEqual([...frame.data.slice(27*4,28*4)],[91,77,99,255]);
  const hit=R.pick(frame,27,29);
  assert.equal(hit.owner.id,'far');
  approximate(hit.uv[1],1-hit.position[2]/4);
});

test('a ray crossing a grid corner does not catch a phantom edge from either neighboring cell',()=>{
  const terrain=create({
    bounds:[0,3,0,3],
    heights:{width:3,height:3,data:[0,100,0,100,0,100,0,100,0]},
    paint:{width:3,height:3,rows:['010','101','010'],palette:['#152635','#885649']},
    regions:{names:['ground','spikes'],data:[0,1,0,1,0,1,0,1,0]}
  });
  const frame=terrain.render({...view,camera:{...view.camera,at:[.5,.5,.5],yaw:Math.PI/4}});
  assert.equal(R.pick(frame,27,12),null);
  assert.equal(R.pick(frame,27,34).owner.id,'ground');
});

test('misaligned map dimensions, nonfinite elevation, and incomplete ramps are rejected',()=>{
  assert.throws(()=>strip([0,1],[],{paint:{width:1,height:1,rows:['0'],palette:['#152635']}}),/same grid/);
  assert.throws(()=>strip([0,NaN],['0','1']),/finite/);
  assert.throws(()=>strip([0,1],['0','1'],{
    distance:{thresholds:[4],swatches:{'#152635':['#152635']}}
  }),/one swatch per band/);
});
