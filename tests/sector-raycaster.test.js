const assert=require('node:assert/strict');
const test=require('node:test');
const {KIT:K}=require('..').load();

const palette=['#111922','#916957','#64a691','#e9b668','#254b69','#bc8095','#e2f2cf'];
const sectors=[
  {id:'foyer',polygon:[[-3,0],[3,0],[3,4],[-3,4]],floor:0,ceiling:4,wall:1,floorPaint:1,ceilingPaint:4},
  {id:'arcade',polygon:[[-2,4],[-2,8],[2,8],[2,4]],floor:1,ceiling:3,wall:2,floorPaint:2,ceilingPaint:5,
    lightBand:1,shade:{distances:[20],ramps:{2:[2,4]}}}
];
const portal={id:'threshold',between:['foyer','arcade'],segment:[[-1.4,4],[1.4,4]],sill:1.1,lintel:2.6,trim:3};
const camera={at:[0,1.5,2],fov:Math.PI/2};
const render=(scene,options={})=>scene.render({width:101,height:100,camera,...options});
const pick=(frame,x,y)=>K.renderOutputs.pick(frame,x,y);

test('the sector option renders independent planes, palette ramps, jambs, sills and lintels',()=>{
  const hall=K.tileRaycaster.create({mode:'sectors',palette,sectors,portals:[portal]});
  const frame=render(hall);
  assert.equal(frame.sector,'foyer');
  assert.equal(hall.locate([0,7]).id,'arcade');
  assert.equal(hall.locate([3,7]),null);
  assert.deepEqual([6,32,50,55,75,97].map(y=>pick(frame,50,y).owner.kind),
    ['lintel','ceiling','wall','floor','sill','floor']);
  assert.equal(pick(frame,50,50).owner.id,'arcade:wall:1');
  assert.deepEqual(pick(frame,50,50).rgba,[37,75,105,255]);
  assert.equal(pick(frame,50,50).depth,6);
  assert.equal(pick(frame,50,55).position[1],1);
  assert.equal(pick(frame,50,32).position[1],3);
  assert.equal(pick(frame,50,75).owner.id,'threshold:sill');
  assert.equal(pick(frame,90,49).owner.id,'foyer:wall:2');
  assert.equal(hall.cast({at:[0,.75,2],direction:[0,3]}).owner.kind,'sill');
  assert.equal(hall.cast({at:[0,3.1,2],direction:[0,1]}).owner.kind,'lintel');
  assert.equal(hall.cast({at:camera.at,direction:[0,1],far:4}),null);
});

test('an open sliver clips sprites and room visibility from either side of a sliding door',()=>{
  const shutter={...portal,door:{paint:5,open:t=>t,slide:'positive'}};
  const scene=K.sectorRaycaster.create({palette,sectors,portals:[shutter],sprites:[{
    id:'lamp',at:[0,1.2,5],height:1.35,views:[{paint:{width:5,height:5,rows:['66666','66666','66666','66666','66666']}}]
  }]});
  const closed=render(scene);
  const half=render(scene,{time:.5});
  const open=render(scene,{doors:{threshold:1}});
  assert.equal(pick(closed,50,47).owner.kind,'door');
  assert.equal(closed.placements[0].visiblePixels,0);
  assert.equal(pick(half,45,47).owner.id,'lamp');
  assert.equal(pick(half,55,47).owner.kind,'door');
  assert(open.placements[0].visiblePixels>half.placements[0].visiblePixels);
  assert.equal(pick(open,55,47).owner.id,'lamp');
  assert.equal(scene.cast({at:[.5,1.5,5],direction:[0,-1],doors:{threshold:.5}}).owner.kind,'door');
  assert.equal(scene.cast({at:[-.5,1.5,5],direction:[0,-1],doors:{threshold:.5}}).sector,'foyer');
});

test('angled boundaries and nested portals keep rays in their entered rooms',()=>{
  const rooms=[
    {id:'outer',polygon:[[-3,0],[3,0],[2,4],[-2,4]],floor:0,ceiling:4,wall:1},
    {id:'neck',polygon:[[-2,4],[2,4],[1.6,6],[-.9,7]],floor:.4,ceiling:2.8,wall:2},
    {id:'inner',polygon:[[-.9,7],[1.6,6],[3,10],[0,11],[-2.3,9]],floor:.2,ceiling:4,wall:5}
  ];
  const scene=K.sectorRaycaster.create({palette,sectors:rooms,portals:[
    {id:'first',between:['outer','neck'],segment:[[-1,4],[1,4]],lintel:2.4},
    {id:'second',between:['neck','inner'],segment:[[-.6,6.88],[.9,6.28]],lintel:2.25}
  ]});
  const result=render(scene);
  assert.equal(pick(result,49,49).owner.id,'inner:wall:3');
  assert.equal(scene.cast({at:camera.at,direction:[0,1]}).sector,'inner');
  assert.equal(scene.cast({at:[1.15,1.6,2],direction:[0,1]}).sector,'outer');
  for (let i=0;i<result.ids.length;i++) assert(result.ids[i]>0,'closed connected rooms cover every art pixel');
});

test('floor-plan validation rejects overlap, crossings, invalid portals and eye heights',()=>{
  const create=(rooms=sectors,portals=[])=>K.sectorRaycaster.create({palette,sectors:rooms,portals});
  assert.throws(()=>create([...sectors,{...sectors[0],id:'duplicate'}]),/interiors overlap/);
  assert.throws(()=>create([{...sectors[0],polygon:[[0,0],[4,4],[0,3],[4,0],[4,-2]]}]),/intersects itself/);
  assert.throws(()=>create(sectors,[{...portal,segment:[[-1,3], [1,3]]}]),/boundary edge/);
  assert.throws(()=>create(sectors,[{...portal,lintel:1}]),/vertical height/);
  assert.throws(()=>create(sectors,[portal,{...portal,id:'double'}]),/overlap on an edge/);
  assert.throws(()=>render(create(),{camera:{...camera,at:[0,1,6]}}),/between the floor and ceiling/);
});

test('concave sector walls and planes meet on exact native pixel centers',()=>{
  const plan=K.sectorRaycaster.create({palette,sectors:[{
    id:'crook',polygon:[[-3,0],[3,0],[3,4],[1,4],[1,6],[-3,6]],floor:0,ceiling:3,wall:1,floorPaint:2
  }]});
  const fov=Math.PI/2,focal=65/2/Math.tan(fov/2),y=16*2/focal;
  const frame=plan.render({width:65,height:65,camera:{at:[2,y,2],fov}});
  assert.equal(pick(frame,32,48).owner.kind,'floor');
  assert.equal(plan.cast({at:[2,y,2],direction:[0,1]}).depth,2);
  assert.equal(plan.cast({at:[-1,y,2],direction:[0,1]}).depth,4);
});
