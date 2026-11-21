const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const estuary=require('../examples/world-aggregate-estuary.json');

const query=(op,at,radius,options={})=>({op,at,radius,...options});
const batch=(snapshot,...queries)=>snapshot.spatialBatch({queries}).results;
const bounds={min:[-16,-2,-16],max:[24,12,24]};
const birds=agents=>({kind:'agents',config:{bounds,species:{
  bird:{mode:'fly',radius:.25,speed:1}, walker:{mode:'walk',radius:.3,height:1.8},
  giant:{mode:'fly',radius:4}
},agents}});
const command=(tick,action,args)=>({tick,action,args});
const json=value=>JSON.parse(JSON.stringify(value));

test('one ordered batch sees packed agents, stable handles and non-authored poses',()=>{
  const run=W.runtime.create({dt:.25,systems:{flock:birds({
    b:{species:'bird',position:[1,1,0]},
    a:{species:'bird',position:[-1,1,0]},
    w:{species:'walker',position:[4,0,0]},
    g:{species:'giant',position:[12,4,0]}
  })}});
  const before=run.query(), near=query('nearby',[0,1,0],1,{id:'neighbors',limit:1});
  const a={kind:'agent',system:'flock',id:'a',generation:1};
  const results=before.spatialBatch({queries:[near,query('nearby',{agent:a},3,{exclude:[a]}),
    query('occupancy',[4,1.5,0],0),query('occupancy',[8,4,0],.01),
    query('occupancy',[4.31,1,0],0),query('nearby',{agent:{...a,generation:99}},2)]});
  assert.equal(results.tick,0);
  const [closest,others,head,big,free,missing]=results.results;
  assert.equal(closest.id,'neighbors');
  assert.equal(closest.matched,2);
  assert.deepEqual(closest.hits.map(hit=>hit.id),['a']);
  assert.deepEqual(others.hits.map(hit=>hit.id),['b']);
  assert.equal(head.blockers[0].id,'w');
  assert.equal(big.blockers[0].id,'g');
  assert.equal(free.state,'free');
  assert.equal(missing.status,'missing');

  run.schedule([
    command(1,'flock/despawn',{agent:'a',generation:1}),
    command(1,'flock/spawn',{agent:'a',species:'bird',position:[0,1,0],goal:[3,1,0]})
  ]);
  run.step();
  const [after,stale]=batch(run.query(),near,query('nearby',{agent:a},3));
  assert.equal(after.hits[0].id,'a');
  assert.equal(after.hits[0].generation,5);
  assert.deepEqual(after.hits[0].position,[.25,1,0]);
  assert.equal(stale.status,'missing');
  assert.equal(batch(before,near)[0].hits[0].generation,1);
  const restored=run.checkpoint();
  const resumed=W.runtime.create(restored.world,{checkpoint:json(restored)});
  assert.deepEqual(batch(run.query(),near),batch(resumed.query(),near));
});

test('solid occupancy uses actual collider distances, live cuts and dynamic fracture fragments',()=>{
  const run=W.runtime.create({dt:.1,systems:{
    rig:{kind:'mechanics',config:{gravity:[0,0,0],ground:-2,bodies:{
      wall:{fixed:true,position:[0,1,0],half:[1,.5,.5]},
      post:{fixed:true,position:[4,1,4],collider:{kind:'capsule',radius:.3,a:[0,-.2,0],b:[0,.2,0]}}
    }}},
    rock:{kind:'volume',config:{bounds:{min:[3,-1,-2],max:[7,3,2]},cell:.5,
      materials:{stone:[1,2,3,4]},initial:[{op:'fill',material:'stone',shape:{kind:'box',at:[5,1,0],half:[1,1,1]}}]}}
  }});
  const initial=run.query();
  const wall=query('occupancy',[0,1,0],.12);
  const rock=query('occupancy',[5,1,0],.2);
  const aboveFloor=query('occupancy',[3,-1.9,0],.2);
  const capsuleCorner=query('occupancy',[4.25,1,4.25],.01);
  const [solid,terrain,floor,corner]=batch(initial,wall,rock,aboveFloor,capsuleCorner);
  assert.equal(solid.blockers[0].id,'wall');
  assert.equal(terrain.blockers[0].field,'rock/clearance');
  assert.equal(floor.blockers[0].field,'rig/ground-clearance');
  assert.equal(corner.state,'free');
  run.schedule([
    command(1,'rig/fracture',{body:'wall',parts:2}),
    command(1,'rock/cut',{shape:{kind:'box',at:[5,1,0],half:[.5,.5,.5]}})
  ]);
  run.step();
  const [fragments,cut]=batch(run.query(),wall,rock);
  assert(fragments.blockers.length>0);
  assert(fragments.blockers.every(hit=>hit.id.startsWith('wall.')));
  assert.equal(cut.state,'free');
  assert.equal(batch(initial,wall)[0].blockers[0].id,'wall');
});

test('interaction points respect socket poses, blockers, exclusions and authored eligibility',()=>{
  const run=W.runtime.create({dt:.1,entities:{
    station:{kind:'workbench',tags:['work'],sockets:{back:[-1,0,0],front:[1,0,0],side:[0,0,1]}}
  },systems:{
    rig:{kind:'mechanics',config:{gravity:[0,0,0],drag:0,bodies:{
      station:{position:[0,1,0],half:[1,.5,1],velocity:[1,0,0]},
      obstacle:{fixed:true,position:[-1,1,0],half:[.2,.3,.2]}
    }}},
    gate:{kind:'test-gate'}
  }},{implementations:{'test-gate':()=>({initial:()=>null,fields:{
    eligible:{type:'boolean',read:({target})=>W.query.ok(target.socket!=='side')}
  }})}});
  const request=query('interactions',[0,1,0],2,{fitRadius:.05,
    where:{path:['tags',0],value:'work'},require:[{field:'gate/eligible',when:{value:true}}]});
  const [available,strict]=batch(run.query(),request,{...request,ignoreOwner:false});
  assert.deepEqual(available.hits.map(hit=>hit.socket),['front']);
  assert.deepEqual(available.rejected,{occupied:1,unknown:0,conditions:1});
  assert.equal(strict.hits.length,0);
  const [filtered]=batch(run.query(),{...request,exclude:['station/back','station/front']});
  assert.equal(filtered.matched,0);
  const uncertain=query('occupancy',[10,6,10],.1,{clearance:[{field:'missing/clearance'}]});
  const [unknown]=batch(run.query(),uncertain);
  assert.equal(unknown.state,'unknown');
  assert.equal(unknown.unavailable[0].field,'missing/clearance');
});

test('cohort occupancy follows reconstructed positions through a portable checkpoint',()=>{
  const run=W.runtime.create(estuary);
  run.advance(16);
  assert.equal(run.checkpoint().states.flock.model,'cohorts');
  const position=run.query().probe('flock/position',{agent:'bird-1'}).value;
  const request=query('nearby',position,1e-8);
  const matches=batch(run.query(),request)[0].hits;
  assert.deepEqual(matches.map(hit=>hit.id),['bird-1']);
  const saved=json(run.checkpoint()), restored=W.runtime.create(saved.world,{checkpoint:saved});
  assert.deepEqual(batch(restored.query(),request),batch(run.query(),request));
});

test('solver-provided occupant indexes are reused between batches and read-only ticks',()=>{
  let builds=0;
  const run=W.runtime.create({systems:{test:{kind:'test-provider'}}},{implementations:{
    'test-provider':()=>({initial:()=>({position:[1,0,0]}),occupancy:{
      kind:'sample',rows(state){builds++;return [{id:'source',position:state.position,shape:state.position}];},
      distance:(position,point)=>Math.hypot(...position.map((n,i)=>n-point[i]))
    }})
  }});
  const near=query('nearby',[0,0,0],1,{kinds:['sample']});
  for(let i=0;i<3;i++){
    const snapshot=run.query();
    assert.equal(batch(snapshot,near,near)[0].matched,1);
    assert.equal(batch(snapshot,query('occupancy',[1,0,0],0))[0].state,'occupied');
    run.step();
  }
  assert.equal(builds,1);
  assert.throws(()=>batch(run.query(),{...near,radius:-1}),/Invalid spatial batch query/);
});
