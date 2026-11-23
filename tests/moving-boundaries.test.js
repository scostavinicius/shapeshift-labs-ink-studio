const {test}=require('node:test'), assert=require('node:assert/strict');
const {KIT:K}=require('..').load(), W=K.world;
const {prepare}=W.movingBoundaries;
const points=[[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1]];
const triangles=[[0,2,1],[0,3,2]];
const seat={points,triangles,normal:[0,1,0]};
const raised=h=>points.map(([x,,z])=>[x,h,z]);
const close=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol,`${a} differs from ${b}`);

test('poppet curtain keeps microscopic positive gaps open and measures displaced volume',()=>{
  const valve=prepare({seat,moving:raised(0.25),referenceVolume:1});
  const open=valve.evaluate(raised(0.25));
  assert.equal(open.status,'open');
  close(open.aperture,2);
  close(open.opening,0.5);
  close(open.displacedVolume,0);
  const near=valve.evaluate(raised(1e-11));
  assert.equal(near.status,'open');
  assert.ok(near.opening>0);
  close(near.aperture,8e-11,1e-21);
  close(near.maxGap,1e-11,1e-21);
  const sealed=valve.evaluate(raised(0));
  assert.equal(sealed.status,'sealed');
  assert.equal(sealed.aperture,0);
  assert.equal(sealed.displacedVolume,1);
});

test('tilted surface and an explicit gasket clip aperture independently from pocket volume',()=>{
  const tilted=points.map(([x,,z])=>[x,x,z]);
  const projected=prepare({seat,moving:tilted,mode:'projected'}).evaluate(tilted);
  close(projected.aperture,2);
  close(projected.pocketVolume,1);
  close(projected.penetration,1);
  const valve=prepare({seat,moving:tilted,sealGap:0.1});
  close(valve.evaluate(tilted).aperture,2.61);
  const closed=valve.evaluate(raised(0.1));
  assert.equal(closed.status,'sealed');
  close(closed.pocketVolume,0.4);
  const slipping=prepare({seat,moving:tilted,maxSlip:0.05});
  assert.equal(slipping.evaluate(tilted.map(p=>K.V.add(p,[0.06,0,0]))).status,'unavailable');
  assert.throws(()=>prepare({...valve,seat:{...seat,points:[...points,points[0]]},moving:raised(0)}),/Moving boundary|seat/);
});

test('optional seat socket follows a rigid frame and supports transformed boundary sampling',()=>{
  const rotation=K.M.rot([0,0,1],Math.PI/2), position=[9,2,3], moving=points.map(p=>({entity:'plug',offset:p}));
  const plan=prepare({seat:{...seat,frame:{entity:'base',socket:'seat'}},moving});
  const query={frame({entity,socket}){return entity==='base'&&socket==='seat'?{point:position,rotation}:
    entity==='plug'?{point:K.V.add(position,K.M.app(rotation,[0,0.04,0])),rotation}:null;}};
  const result=plan.sample(query);
  assert.equal(result.status,'open');
  close(result.aperture,0.32);
  close(result.pocketVolume,0.16);
  assert.equal(plan.sample({frame(){return null;}}).status,'unavailable');
});

function mechanicalWorld(){
  return {id:'valve-test',dt:0.1,entities:{plug:{position:[0,0.25,0]}},
    systems:{
      actuator:{kind:'mechanics',config:{gravity:[0,0,0],bodies:{plug:{half:[1,0.025,1],position:[0,0.25,0]}},
        joints:{lift:{kind:'slider',mode:'position',child:'plug',anchor:[0,0,0],axis:[0,1,0],range:[0,0.25],at:0.25,speed:50}}}},
      gauge:{kind:'moving-boundaries',config:{boundaries:{valve:{seat,moving:points.map(offset=>({entity:'plug',offset}))}}}},
      network:{kind:'pipe-network',config:{nodes:{up:{initial:5,capacity:10,area:1},down:{capacity:10,area:1}},
        pipes:{valve:{from:'up',to:'down',conductance:0.2}}}}
    },
    connections:[{from:'gauge/opening.valve',to:'network/valve.valve'}],
    commands:[{tick:2,action:'world/input',args:{port:'actuator/drive.lift',value:0.00001}},
      {tick:5,action:'world/input',args:{port:'actuator/drive.lift',value:0}},
      {tick:8,action:'world/input',args:{port:'actuator/drive.lift',value:0.1}}]};
}

test('world valve drives native pipe flow, emits closure and reopening, and replays',()=>{
  const world=mechanicalWorld(), run=W.runtime.create(world), rows=[];
  run.advance(10,{onTick(view){
    const state=view.states.gauge.valve, signals=view.signals;
    rows[view.tick]={status:state.status,area:state.aperture,flow:signals['network/flow.valve'],
      drive:signals['network/valve.valve'],volume:state.volumeChange};
  }});
  assert.equal(rows[3].status,'open');
  close(rows[3].area,8e-5);
  assert.ok(rows[3].flow>0);
  assert.equal(rows[6].status,'sealed');
  assert.equal(rows[6].drive,0);
  assert.equal(rows[6].flow,0);
  close(rows[6].volume,4e-5);
  assert.equal(rows[9].status,'open');
  assert.ok(rows[9].flow>0);
  const history=run.history.filter(row=>row.kind==='boundary-sealed'||row.kind==='boundary-opened');
  assert.deepEqual(Array.from(history,row=>[row.tick,row.kind]),[[6,'boundary-sealed'],[9,'boundary-opened']]);
  const replay=W.runtime.create(world,{checkpoint:JSON.parse(JSON.stringify(W.runtime.create(world).checkpoint()))});
  replay.advance(10);
  assert.deepEqual(replay.checkpoint(),run.checkpoint());
});

test('a native cloth patch measures its live nodes and reports a torn surface as unavailable',()=>{
  const cloth={at:[-1,0.1,-1],u:[2,0,0],v:[0,0,2],nu:2,nv:2,kind:'cloth'};
  const grid=K.xpbd.clothGrid(cloth), local=grid.points.map(([x,,z])=>[x,0,z]);
  const model={id:'cloth-boundary',systems:{
    fabric:{kind:'deformables',config:{gravity:[0,0,0],ground:-2,shapes:{lid:cloth}}},
    gauge:{kind:'moving-boundaries',config:{boundaries:{lid:{
      seat:{points:local,triangles:grid.faces.map(face=>face.nodes),normal:[0,1,0]},
      moving:{field:'fabric/surfaces',shape:'lid',nodes:[0,1,2,3]}
    }}}}
  }};
  const run=W.runtime.create(model);
  const query=()=>run.query().probe('gauge/boundaries',{}, {boundary:'lid'}).value;
  assert.equal(query().status,'open');
  close(query().maxGap,0.1,2e-9);
  run.schedule([{tick:1,action:'fabric/cut',args:{shape:'lid',point:[0,0.1,-1],radius:0.03}}]);
  run.step();
  assert.equal(query().status,'unavailable');
  assert.match(query().reason,/torn/);
  assert.equal(run.view().signals['gauge/sealed.lid'],false);
  assert.equal(run.view().signals['gauge/available.lid'],false);
});
