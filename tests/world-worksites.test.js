const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const json=value=>JSON.parse(JSON.stringify(value));
const point=(x,z=0)=>[x,0,z];
const cmd=(tick,action,args)=>({tick,action,args});
const actor=(position,extras={})=>({species:'hand',position,...extras});
const bounds={min:[-3,-1,-1],max:[3,2,1]};
const agents=(roster,tasks={},config={})=>({kind:'agents',config:{bounds,
  species:{hand:{mode:'walk',speed:4,radius:.13}},agents:roster,
  ...(Object.keys(tasks).length&&{orders:{tasks}}),...config}});
const issue=(tick,system,agent,task,extras={})=>cmd(tick,system+'/issue-order',{agent,order:{task,...extras}});
const move=at=>({op:'move',at});
const post=(from,to,amount=1)=>({op:'transfer',from,to,amount,reach:.45});
const sample=(run,field,args)=>run.query().probe(field,undefined,args).value;
const site=(run,process)=>sample(run,'stock/worksite',{process});
const account=(run,account)=>sample(run,'world/account',{account});
const ledger=run=>sample(run,'stock/ledger');
const orders=(run,system,agent)=>sample(run,system+'/orders',{agent});
const data=position=>({position});
const inventory=(containers,recipes,processes,resources)=>({kind:'logistics',config:{
  resources:resources??{material:{type:'integer',units:'piece'}},containers,recipes,processes
}});
function constructionScene(){
  const depot=point(-2,.66), shop=point(1.1,.66);
  return {dt:.1,entities:{depot:data(depot),site:data(shop),courier:{sockets:{pack:[0,.2,0]}}},
    systems:{
      stock:inventory({
        depot:{at:{entity:'depot'},stocks:{material:{initial:2,max:2}}},
        carry:{at:{agent:{system:'carriers',id:'courier',generation:1},socket:'pack'},stocks:{material:{max:2,display:{offset:[0,.1,0],half:[.1,.1,.12]}}}},
        yard:{at:{entity:'site'},stocks:{material:{max:2},permit:{max:1}}}
      },{wall:{duration:.8,inputs:{material:2},outputs:{permit:1}}},{
        build:{recipe:'wall',inputs:{material:'yard'},outputs:{permit:'yard'},
          work:{at:{entity:'site'},radius:.45,minWorkers:2,maxWorkers:2,effect:{action:'wall/build'}}}
      },{material:{type:'integer',units:'piece'},permit:{type:'integer',units:'item'}}),
      wall:{kind:'construction',config:{initiallyBuilt:false,points:{center:{position:[0,.56,0]}},
        blocks:[{id:'wall',at:'center',half:[.22,.56,1.36]}]}},
      nav:{kind:'navigation',config:{bounds,clearance:'wall/clearance',cell:.2,tiles:{size:4}}},
      builders:agents({builder:actor(point(1.15,.6))},{build:{steps:[{op:'work',site:{param:'site'}}]}}),
      carriers:agents({courier:actor(point(-2.8,.66))},{assemble:{steps:[
        move({entity:'depot'}),post('stock/depot.material','stock/carry.material',2),
        move({entity:'site'}),post('stock/carry.material','stock/yard.material',2),{op:'work',site:'stock/build'}
      ]}}),
      visitors:agents({blocker:actor(point(0))})
    }};
}
const route=run=>run.query().trace('nav/route',point(-2),{to:point(2),radius:.13}).value.status;

test('physical hauling and two rosters build once after materials arrive and the solid footprint clears',()=>{
  const scene=constructionScene();
  const visitors=scene.systems.visitors.config.agents;
  for(let i=0;i<260;i++)visitors['spectator-'+i]=actor(point(2.7,-.76));
  const run=W.runtime.create(scene);
  assert.equal(route(run),'ok');
  assert.deepEqual(sample(run,'wall/bodies'),{});
  assert.equal(site(run,'build').materials[0].missing,2);
  assert.equal(site(run,'build').workersNeeded,2);
  run.schedule([issue(1,'builders','builder','build',{params:{site:'stock/build'}}),
    issue(1,'carriers','courier','assemble')]);
  run.advance(8);
  const carrier=sample(run,'carriers/agent',{agent:'courier'});
  const cargo=sample(run,'stock/stock-bodies')['carry.material'];
  assert.equal(account(run,'stock/carry.material').balance,2);
  assert.equal(cargo.position[0],carrier.position[0]);
  assert(cargo.position[1]>carrier.position[1]);
  assert.equal(site(run,'build').workersNeeded,1);
  assert.equal(site(run,'build').completed,0);
  run.advance(30);
  assert.equal(site(run,'build').reason,'footprint-occupied');
  assert.equal(site(run,'build').remaining,0);
  assert.equal(ledger(run).material.inProgress,2);
  assert.equal(account(run,'stock/yard.permit').balance,0);
  assert.equal(sample(run,'wall/built'),false);
  const checkpoint=json(run.checkpoint()), restored=W.runtime.create(checkpoint.world,{checkpoint});
  for(const next of [run,restored]){
    next.schedule([cmd(31,'visitors/seek',{agent:'blocker',to:point(2,.5)})]);
    next.advance(48);
    assert.equal(next.history.filter(row=>row.kind==='construction-built').length,1);
    assert(next.history.some(row=>row.kind==='work-completed'&&row.process==='build'&&row.workers.length===2));
  }
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
  assert.equal(sample(run,'wall/built'),true);
  assert.notEqual(route(run),'ok');
  assert.equal(account(run,'stock/yard.permit').balance,1);
  assert.equal(ledger(run).material.error,0);
  assert.equal(ledger(run).material.consumed,2);
  assert.equal(orders(run,'builders','builder').outcomes[0].phase,'succeeded');
  assert.equal(orders(run,'carriers','courier').outcomes[0].phase,'succeeded');
});

test('pickup and delivery recheck a moving transfer endpoint before either account changes',()=>{
  const scene=constructionScene();
  scene.systems.carriers.config.agents.courier.position=point(-2,.66);
  scene.systems.carriers.config.orders.tasks.take={steps:[post('stock/depot.material','stock/carry.material',1)]};
  const run=W.runtime.create(scene);
  run.schedule([issue(1,'carriers','courier','take'),
    cmd(2,'world/patch',{edits:[{op:'set',path:'/entities/depot/position',value:point(-3)}]}),
    cmd(4,'world/patch',{edits:[{op:'set',path:'/entities/depot/position',value:point(-2,.66)}]})]);
  run.advance(1);
  assert.equal(orders(run,'carriers','courier').active.phase,'settling');
  run.advance(3);
  assert.equal(orders(run,'carriers','courier').active.reason,'transfer-out-of-reach');
  assert.equal(account(run,'stock/carry.material').balance,0);
  run.advance(6);
  assert.equal(account(run,'stock/carry.material').balance,1);
  assert.equal(run.history.filter(row=>row.kind==='transfer').length,1);
  run.schedule([cmd(7,'carriers/despawn',{agent:'courier',generation:1}),
    cmd(8,'carriers/spawn',{agent:'courier',species:'hand',position:point(-2,.66)})]);
  run.advance(8);
  assert.equal(account(run,'stock/carry.material').position,null);
  assert.equal(account(run,'stock/carry.material').balance,1);
  assert.deepEqual(sample(run,'stock/stock-bodies'),{});
});

function training(){
  const stop=point(2), site=point(1,.6);
  return {dt:.1,systems:{
    stock:inventory({yard:{stocks:{material:{initial:2,max:2},permit:{max:2}}}},
      {train:{duration:.2,inputs:{material:1},outputs:{permit:1}}},
      {train:{recipe:'train',inputs:{material:'yard'},outputs:{permit:'yard'},
        work:{at:site,batches:2,effect:{action:'trainees/recruit',args:{prefix:'worker',species:'hand',at:stop}}}}},
      {material:{type:'integer',units:'piece'},permit:{type:'integer',units:'item'}}),
    teacher:agents({trainer:actor(site)},{first:{steps:[{op:'work',site:'stock/train'}]},
      second:{steps:[{op:'work',site:'stock/train',batch:2}]}}),
    trainees:agents({})
  }};
}

test('recruitment uses stable batch IDs and delays a second spawn and recipe output until its pin clears',()=>{
  const run=W.runtime.create(training());
  run.schedule([issue(1,'teacher','trainer','first'),issue(1,'teacher','trainer','second')]);
  run.advance(9);
  assert.equal(site(run,'train').completed,1);
  assert.equal(site(run,'train').reason,'recruit-site-occupied');
  assert.equal(ledger(run).material.inProgress,1);
  assert.equal(account(run,'stock/yard.permit').balance,1);
  assert.deepEqual(Object.keys(sample(run,'trainees/agents')),['worker.1']);
  run.schedule([cmd(10,'trainees/seek',{agent:'worker.1',to:point(2,-.9)})]);
  run.advance(21);
  assert.deepEqual(Object.keys(sample(run,'trainees/agents')),['worker.1','worker.2']);
  assert.equal(site(run,'train').completed,2);
  assert.equal(account(run,'stock/yard.permit').balance,2);
  assert.equal(ledger(run).material.error,0);
  assert.equal(run.history.filter(row=>row.kind==='agent-spawned').length,2);
});

test('a staffed repair recipe services a structural body and clears persisted wear and deformation',()=>{
  const source=training();
  source.systems.rig={kind:'mechanics',config:{bodies:{brace:{fixed:true,position:[1,.25,-.4],half:[.5,.12,.12],
    structure:{axis:0,sections:2,fatigue:{endurance:2,life:25,exponent:2}}}}}};
  Object.assign(source.systems.stock.config.processes.train.work,{batches:1,effect:{action:'rig/repair',args:{body:'brace'}}});
  delete source.systems.teacher.config.orders.tasks.second;
  const initial=W.runtime.create(source), checkpoint=json(initial.checkpoint());
  const rig=checkpoint.states.rig, beam=rig.beams.brace;
  beam.cells[1].channels[1].damage=.65;
  beam.cells[1].curvature=[0,.11,0];
  beam.yielded=true;
  rig.bodies.brace.bend={axis:0,offsets:[[0,0,0],[0,.11,0],[0,0,0]]};
  const run=W.runtime.create(checkpoint.world,{checkpoint});
  run.schedule([issue(1,'teacher','trainer','first')]);
  run.advance(8);
  const state=run.checkpoint().states.rig;
  assert.equal(state.beams.brace.cells[1].channels[1].damage,0);
  assert.equal(state.beams.brace.yielded,false);
  assert.equal(state.bodies.brace.bend,undefined);
  assert(run.history.some(row=>row.kind==='body-repaired'&&row.body==='brace'));
  assert.equal(site(run,'train').completed,1);
  assert.equal(ledger(run).material.error,0);
});

test('aggregate logistics preserves material escrow and labor resumes on detail wake',()=>{
  const scene=training();
  scene.systems.stock.config.recipes.train.duration=.8;
  scene.simulationChunks={grid:{size:16},levels:[
    {id:'detail',within:2,every:1},{id:'far',within:40,every:1,
      systems:{agents:{aggregate:{model:'cohorts',cell:4}},logistics:{aggregate:{model:'ledger'}}}},
    {id:'sleep',sleep:true}
  ],chunks:{yard:{index:[0,0],systems:['stock','teacher']}},focus:{camera:{at:[4,0,4]}}};
  const run=W.runtime.create(scene);
  run.schedule([issue(1,'teacher','trainer','first'),cmd(4,'world/chunk-focus',{id:'camera',at:[30,0,4]}),
    cmd(15,'world/chunk-focus',{id:'camera',at:[4,0,4]})]);
  run.advance(3);
  assert(site(run,'train').remaining>.5&&site(run,'train').remaining<.7);
  const before=site(run,'train').remaining;
  run.advance(12);
  assert.equal(run.checkpoint().states.stock.model,'ledger');
  assert.equal(site(run,'train').remaining,before);
  assert.equal(ledger(run).material.inProgress,1);
  assert.deepEqual(sample(run,'trainees/agents'),{});
  const checkpoint=json(run.checkpoint()), resumed=W.runtime.create(checkpoint.world,{checkpoint});
  for(const next of [run,resumed])next.advance(24);
  assert.deepEqual(run.checkpoint(),resumed.checkpoint());
  assert.equal(site(run,'train').completed,1);
});

test('a narrow work radius can draw a worker through its ordinary stopping distance',()=>{
  const scene=training();
  const worker=scene.systems.teacher.config.agents.trainer;
  worker.position=point(.945,.6);
  scene.systems.stock.config.processes.train.work.radius=.025;
  const run=W.runtime.create(scene);
  run.schedule([issue(1,'teacher','trainer','first')]);
  run.advance(12);
  assert.equal(site(run,'train').completed,1);
  assert.equal(orders(run,'teacher','trainer').outcomes[0].phase,'succeeded');
});

test('wrong worksite references and effects fail validation before any stocks are touched',()=>{
  const scene=training();
  const run=W.runtime.create(scene);
  assert.throws(()=>run.schedule([issue(1,'teacher','trainer','first',{params:{site:'wrong/site'}})]),/parameters/i);
  scene.systems.teacher.config.orders.tasks.first.steps[0].site='stock/missing';
  assert.throws(()=>W.runtime.validate(scene),/Unknown worksite/);
  scene.systems.teacher.config.orders.tasks.first.steps[0].site='stock/train';
  scene.systems.stock.config.processes.train.work.effect.action='trainees/despawn';
  assert.throws(()=>W.runtime.validate(scene),/Unsupported worksite effect/);
});
