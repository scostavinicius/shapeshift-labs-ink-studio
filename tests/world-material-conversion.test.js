const test=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..'), kit=ink.load(), {world:W}=kit.KIT;

const split=[[2,4,1],[3,4,1],[3,5,1]];
const materials={slag:{density:8,specificHeat:2,ramp:[0x263d4c,0xec994c]},ore:{density:4,specificHeat:3,ramp:[0x395871,0xee6241]}};
const built=[
  {at:split[0],material:'slag',temperature:650,wetness:.37,data:{vein:'copper-A'}},
  {at:split[1],material:'ore',temperature:475,wetness:.1},
  {at:split[2],material:'slag',temperature:410}
];
const action=(tick,key,args)=>({tick,action:'forge/'+key,args});
const lift=(tick,args={})=>action(tick,'lift',{body:'charge',cells:split,velocity:[2.4,2,0],angular:[0,0,1.2],...args});
const world=(extra={},commands=[])=>({id:'material-test',dt:.08,systems:{forge:{kind:'material-cells',
  config:{size:[14,12,4],origin:[-2,0,-1],cell:.5,materials,initial:built,...extra}}},
  visual:{volume:'forge',camera:{target:[0,1,0],dist:7,yaw:.25,pitch:.25},look:{pixel:true}},commands});
const read=(run,name,at)=>run.query().probe('forge/'+name,at);
const records=run=>read(run,'cells').value;
const piece=run=>read(run,'pieces').value.charge;
const close=(a,b)=>assert(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(a),Math.abs(b)),`${a} differs from ${b}`);
const json=value=>JSON.parse(JSON.stringify(value));
const parcel=row=>({id:row.id,material:row.material,wetness:row.wetness,data:row.data,energy:row.energy});
const sorted=rows=>rows.map(parcel).sort((a,b)=>a.id-b.id);

test('a mixed patch becomes one rotating rigid compound and returns each parcel without losing heat or wetness',()=>{
  const definition=world({gravity:[0,0,0]},[lift(2),action(9,'crumble',{body:'charge'})]);
  const run=W.runtime.create(definition), before=records(run), original=read(run,'balance').value;
  run.advance(3);
  const carried=piece(run), checkpoint=json(run.checkpoint());
  assert.equal(records(run).length,0);
  assert.equal(read(run,'cell',before[0].point).status,'empty');
  assert.equal(carried.body.collider.parts.length,3);
  assert.notDeepEqual(carried.body.rotation,kit.KIT.M.id());
  assert.deepEqual(sorted(carried.cells),sorted(before));
  assert.deepEqual(read(run,'bodies').value.charge.position,carried.body.position);
  assert(read(run,'clearance',carried.cells[0].point).value<0);
  const visible=W.visual(kit,run.view(),run.query());
  const scene=W.query.fromScene(visible);
  assert(scene.select({entity:'charge',material:'slag'}).length);
  assert(scene.select({entity:'charge',material:'ore'}).length);
  assert.equal(new Set(visible.splatIds).size,visible.count);

  run.advance(11);
  const deposited=records(run);
  assert.equal(piece(run),undefined);
  assert.deepEqual(sorted(deposited),sorted(before));
  assert(deposited.every(row=>!before.some(old=>old.id===row.id&&old.at.join()===row.at.join())));
  const events=run.history.filter(event=>event.kind==='material-lift'||event.kind==='material-crumble');
  assert.deepEqual(events.map(event=>event.kind),['material-lift','material-crumble']);
  close(events[1].energy,events[0].energy);
  close(read(run,'balance').value.mass,original.mass);
  close(read(run,'balance').value.energyError,0);
  const restored=W.runtime.create(definition,{checkpoint});
  restored.advance(11);
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('cooling and conduction continue in flight and a measured floor impact may deposit automatically',()=>{
  const source=world({cooling:.6,conduction:2},[lift(2,{breakSpeed:2.5,velocity:[2,0,0]}),
    action(3,'heat',{body:'charge',energy:18})]);
  const run=W.runtime.create(source);
  run.advance(4);
  const inFlight=piece(run);
  assert(inFlight);
  assert(inFlight.cells.some(row=>row.temperature<600));
  run.advance(25);
  const result=read(run,'balance').value, event=run.history.find(row=>row.kind==='material-crumble');
  assert(event.speed>=2.5);
  assert.equal(result.pieces,0);
  assert.equal(result.cells,built.length);
  assert.equal(result.appliedEnergy,18);
  assert(result.ambientEnergy<0);
  close(result.energyError,0);
  close(result.massError,0);
  assert(records(run).every(row=>row.temperature<650));
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('disconnected selections, out-of-grid deposits and corrupt inventories cannot partially publish',()=>{
  const source=world({gravity:[0,0,0]},[lift(1,{velocity:[50,0,0]}),action(4,'crumble',{body:'charge',spread:0})]);
  const run=W.runtime.create(source);
  assert.throws(()=>run.schedule([lift(2,{cells:[[2,4,1],[4,4,1]]})]),/face-connected/);
  run.advance(3);
  const checkpoint=run.checkpoint();
  assert.throws(()=>run.step(),/no free cell placement/);
  assert.deepEqual(run.checkpoint(),checkpoint);
  assert.equal(records(run).length,0);
  assert.equal(piece(run).cells.length,built.length);
  const invalid=json(checkpoint);
  invalid.states.forge.pieces.charge.cells[Object.keys(invalid.states.forge.pieces.charge.cells)[0]].mass=0;
  assert.throws(()=>W.runtime.create(source,{checkpoint:invalid}),/saved material parcel/);
});

test('a moving parcel collides with material still in the lattice',()=>{
  const blocker=[5,4,1];
  const source=world({gravity:[0,0,0],drag:0,initial:[built[0],{at:blocker,material:'ore'}]},[
    lift(1,{cells:[split[0]],velocity:[5,0,0],angular:[0,0,0],breakSpeed:1.2})
  ]);
  const run=W.runtime.create(source);
  run.advance(10);
  const event=run.history.find(row=>row.kind==='material-crumble');
  assert(event && event.speed>3);
  const atBlocker=records(run).find(row=>row.at.join()===blocker.join());
  assert.equal(atBlocker.material,'ore');
  assert.equal(records(run).length,2);
  assert.equal(read(run,'balance').value.carried,0);
});

test('optional loose parcels settle after deposition and preserve their thermal and material state',()=>{
  const source=world({settle:true,gravity:[0,0,0]},[
    lift(1,{velocity:[0,0,0],angular:[0,0,0]}),action(2,'crumble',{body:'charge'})
  ]);
  const run=W.runtime.create(source), original=sorted(records(run));
  run.advance(2);
  const snapshot=records(run), deposit=run.events.find(event=>event.kind==='material-crumble');
  assert.deepEqual(deposit.cells.map(row=>row.at),snapshot.map(row=>row.at));
  run.advance(11);
  assert.deepEqual(sorted(records(run)),original);
  assert(records(run).every(row=>row.at[1]<=1));
  assert(records(run).some(row=>row.at[1]===0));
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('an impact breaks the weak seam, deposits a single parcel and leaves the remaining body moving',()=>{
  const blocker={at:[5,4,1],material:'ore'};
  const source=world({gravity:[0,0,0],drag:0,settle:true,initial:[...built,blocker]},[
    lift(1,{velocity:[5,.25,0],angular:[0,0,0],fracture:{
      strength:1000,seams:[{cells:[split[1],split[2]],strength:.1}]}})
  ]);
  const run=W.runtime.create(source);
  let struck, survivingY;
  run.advance(10,{onTick(view){
    if(!run.events.some(event=>event.kind==='material-fracture'))return;
    struck=view.tick;
    survivingY=piece(run).body.position[1];
  }});
  assert(struck>1);
  const failure=run.history.find(event=>event.kind==='material-crack');
  assert.deepEqual(failure.seams.map(seam=>[seam.cells,seam.cause]),[[[split[1],split[2]],'impact']]);
  const closed=run.history.find(event=>event.kind==='material-fracture');
  assert.deepEqual(closed.fragments.map(item=>item.parcels.length),[2,1]);
  const loosened=run.history.find(event=>event.kind==='material-crumble');
  assert(loosened.detached && loosened.cells.length===1);
  assert.equal(loosened.cells[0].parcel,closed.fragments[1].parcels[0]);
  assert(piece(run).body.position[1]>survivingY);
  assert.equal(piece(run).cells.length,2);
  assert.equal(records(run).length,2);
  close(read(run,'balance').value.energyError,0);
  close(read(run,'balance').value.massError,0);
});

test('successive quenches open a hairline and then split two independently moving hot chunks',()=>{
  const a=[2,4,1],b=[3,4,1],c=[2,5,1],d=[3,5,1], cells=[a,b,c,d];
  const initial=cells.map((at,i)=>({at,material:i%2?'ore':'slag',temperature:540+i*10,wetness:i*.1}));
  const source=world({gravity:[0,0,0],drag:0,initial},[
    lift(1,{cells,velocity:[1,.4,0],angular:[0,0,2],fracture:{strength:1000,impact:0,
      thermal:1,minCoolingRate:10,seams:[{cells:[a,b],strength:1},{cells:[c,d],strength:1}]} }),
    action(2,'heat',{body:'charge',at:a,energy:-20})
  ]);
  const run=W.runtime.create(source);
  run.advance(2);
  const hairline=run.events.find(event=>event.kind==='material-crack');
  assert.equal(hairline.seams[0].cause,'cooling');
  assert.deepEqual(piece(run).bonds.filter(row=>row.broken).map(row=>row.cells),[[a,b]]);
  assert.equal(read(run,'balance').value.pieces,1);
  assert(kit.KIT.world.visual(kit,run.view(),run.query()).splatIds.some(id=>id?.includes('/crack/')));
  const saved=json(run.checkpoint()), control=W.runtime.create(source,{checkpoint:saved});
  const second=action(4,'heat',{body:'charge',at:c,energy:-20});
  run.schedule([second]);
  control.advance(4);
  run.advance(4);
  const after=Object.values(read(run,'pieces').value), event=run.events.find(row=>row.kind==='material-fracture');
  assert.deepEqual(event.fragments.map(item=>item.parcels.length),[2,2]);
  assert.equal(after.length,2);
  const carried=piece(control);
  const momentum=[0,0,0];
  for(const chunk of after){
    assert.deepEqual(chunk.body.angular,carried.body.angular);
    for(let i=0;i<3;i++)momentum[i]+=chunk.body.velocity[i]*chunk.body.mass;
    for(const row of chunk.cells){
      const previous=carried.cells.find(prior=>prior.id===row.id);
      row.point.forEach((n,i)=>close(n,previous.point[i]));
      assert.equal(row.wetness,previous.wetness);
      if(row.at.join()===c.join())close(row.energy,previous.energy-20);
      else close(row.energy,previous.energy);
    }
  }
  momentum.forEach((n,i)=>close(n,carried.body.mass*carried.body.velocity[i]));
  assert(after.some(chunk=>chunk.body.velocity.some((n,i)=>Math.abs(n-carried.body.velocity[i])>.1)));
  close(read(run,'balance').value.energyError,0);
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
  const restored=W.runtime.create(source,{checkpoint:saved});
  restored.schedule([second]);restored.advance(4);
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
  assert.throws(()=>run.schedule([lift(5,{cells,fracture:{seams:[{cells:[a,d],strength:1}]}})]),/shared faces/);
});

test('detached parcels retain rigid motion if there is no free lattice landing site',()=>{
  const cells=split.slice(0,2), source=world({gravity:[0,0,0],drag:0,initial:built.slice(0,2)},[
    lift(1,{cells,velocity:[50,0,0],angular:[0,0,0],fracture:{strength:1,impact:0,thermal:1}}),
    action(4,'heat',{body:'charge',at:cells[0],energy:-10})
  ]);
  const run=W.runtime.create(source);
  run.advance(5);
  assert(run.history.some(event=>event.kind==='material-fracture'));
  assert(!run.history.some(event=>event.kind==='material-crumble'));
  const pieces=Object.values(read(run,'pieces').value);
  assert.equal(pieces.length,2);
  assert(pieces.every(row=>row.cells.length===1&&row.body.velocity[0]===50));
  assert.equal(read(run,'balance').value.carried,2);
  close(read(run,'balance').value.energyError,0);
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
});
