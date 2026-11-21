const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const example=require('../examples/world-agent-orders.json');
const json=value=>JSON.parse(JSON.stringify(value));
const command=(tick,action,args)=>({tick,action,args});
const issue=(tick,order,mode,agent='walker')=>command(tick,'crew/issue-order',{agent,...(mode&&{mode}),order});
const cancel=(tick,order,agent='walker')=>command(tick,'crew/cancel-order',{agent,order});
const at=x=>[x,0,0];
const move=(id,destination,options)=>({id,task:'move',targets:{destination},...options});
const orders=(run,agent='walker')=>run.query().probe('crew/orders',undefined,{agent}).value;
const actor=(run,agent='walker')=>run.query().probe('crew/agent',undefined,{agent}).value;
const balance=(run,account)=>run.query().probe('world/account',undefined,{account}).value.balance;
const bounds={min:[-3,-1,-3],max:[13,2,3]};
function ground(){
  return {dt:.1,systems:{crew:{kind:'agents',config:{bounds,
    species:{walker:{mode:'walk',speed:2}},
    agents:{walker:{species:'walker',position:at(0),task:'patrol'}},
    orders:{tasks:{move:{steps:[{op:'move',at:{target:'destination'}}]}, hold:{steps:[{op:'wait',ticks:4}]}}}
  }}}};
}
function shipment(){
  const scene=ground(), crew=scene.systems.crew.config;
  scene.systems.inventory={kind:'store',config:{accounts:{
    supply:{initial:5,max:5,units:'sack',resource:'grain',type:'integer'},
    cargo:{initial:0,max:2,units:'sack',resource:'grain',type:'integer'}
  }}};
  crew.orders.tasks.load={steps:[{op:'transfer',from:'inventory/supply',to:'inventory/cargo',amount:{param:'amount'}}]};
  return scene;
}

test('a queued move is cancelled while the courier retains picked-up cargo through interruption and resumes delivery',()=>{
  const run=W.runtime.create(example);
  assert.deepEqual(run.query().probe('crew/order-tasks').value.deliver.targets,['dropoff','pickup']);
  run.advance(13);
  assert.equal(orders(run,'scout').queue[0].id,'return-to-depot');
  run.advance(37);
  const courier=orders(run,'courier');
  assert.equal(courier.active.reason,'condition');
  assert.equal(courier.paused[0].id,'market-delivery');
  assert.equal(courier.paused[0].step,2);
  assert.equal(balance(run,'logistics/courier.grain'),2);
  assert.equal(balance(run,'logistics/market.grain'),0);
  assert.equal(orders(run,'scout').outcomes[0].phase,'cancelled');
  const checkpoint=json(run.checkpoint()), restored=W.runtime.create(checkpoint.world,{checkpoint});
  restored.advance(82);
  run.advance(82);
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
  assert.deepEqual(orders(run,'courier').outcomes.map(row=>[row.id,row.phase]),
    [['wait-out-rain','succeeded'],['market-delivery','succeeded']]);
  assert.deepEqual(orders(run,'courier').outcomes[1].results.map(row=>row.op),['move','transfer','move','transfer','emit']);
  assert.equal(balance(run,'logistics/depot.grain'),4);
  assert.equal(balance(run,'logistics/courier.grain'),0);
  assert.equal(balance(run,'logistics/market.grain'),2);
  assert.deepEqual(run.history.filter(row=>row.agent==='courier'&&['order-interrupted','order-resumed'].includes(row.kind))
    .map(row=>row.kind),['order-interrupted','order-resumed']);
  assert.equal(run.history.filter(row=>row.kind==='delivery-confirmed').length,1);
});

test('nested interruptions resume in stack order ahead of the queue, and replace clears all pending orders',()=>{
  const run=W.runtime.create(ground());
  run.schedule([issue(1,move('main',at(8))),issue(1,move('later',at(-2))),
    issue(2,{id:'pause',task:'hold'},'interrupt'),issue(3,move('urgent',at(.2)),'interrupt')]);
  run.advance(3);
  assert.deepEqual(orders(run).paused.map(row=>row.id),['pause','main']);
  assert.equal(orders(run).outcomes[0].id,'urgent');
  const fork=run.fork();
  fork.schedule([issue(4,move('replacement',at(2)),'replace')]);
  fork.advance(80);
  assert.deepEqual(orders(fork).outcomes.map(row=>[row.id,row.phase,row.reason]),
    [['urgent','succeeded',null],['pause','cancelled','replaced'],['main','cancelled','replaced'],
      ['later','cancelled','replaced'],['replacement','succeeded',null]]);
  assert.equal(actor(fork).task,'patrol');
  run.advance(100);
  assert.deepEqual(orders(run).outcomes.map(row=>row.id),['urgent','pause','main','later']);
  assert.deepEqual(run.history.filter(row=>row.kind==='order-resumed').map(row=>row.order),['pause','main']);
  assert(actor(run).position[0]<-1.9);
  assert(actor(fork).position[0]>1.9);
});

test('a moving socket is resolved on each step, and a missing target times out without a false arrival',()=>{
  const scene=ground();
  scene.entities={pin:{position:at(2),sockets:{dock:at(1)}}};
  const run=W.runtime.create(scene);
  run.schedule([issue(1,move('follow',{entity:'pin',socket:'dock'})),
    command(7,'world/patch',{edits:[{op:'set',path:'/entities/pin/position',value:at(5)}]}),
    issue(1,move('missing',{entity:'removed'},{timeout:2}))]);
  run.advance(9);
  assert(actor(run).position[0]>1);
  run.advance(40);
  const [arrival,missing]=orders(run).outcomes;
  assert(arrival.results[0].at[0]>5.9);
  assert.equal(missing.phase,'failed');
  assert.equal(missing.reason,'timeout');
  assert.equal(missing.lastBlocker,'target-missing');
  assert.equal(missing.results.length,0);
  assert(actor(run).position[0]>5.9);
});

test('settlement is exactly once across restore, skipped solver ticks and cancellation before commit',()=>{
  const scene=shipment();
  scene.systems.crew.schedule={every:4};
  const run=W.runtime.create(scene);
  run.schedule([issue(1,{id:'load',task:'load',params:{amount:2}})]);
  run.advance(4);
  assert.equal(orders(run).active.phase,'settling');
  const checkpoint=json(run.checkpoint()), restored=W.runtime.create(checkpoint.world,{checkpoint});
  const fork=run.fork();
  fork.schedule([cancel(5,'load')]);
  run.advance(16);
  restored.advance(16);
  fork.advance(16);
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
  assert.equal(balance(run,'inventory/cargo'),2);
  assert.equal(balance(run,'inventory/supply'),3);
  assert.equal(orders(run).outcomes[0].ended,5);
  assert.equal(run.history.filter(row=>row.kind==='transfer').length,1);
  assert.equal(balance(fork,'inventory/cargo'),0);
  assert.equal(orders(fork).outcomes[0].phase,'cancelled');

  const blocked=W.runtime.create(scene);
  blocked.schedule([issue(1,{task:'load',params:{amount:3}})]);
  blocked.advance(8);
  const [failure]=orders(blocked).outcomes;
  assert.equal(failure.reason,'transfer-blocked');
  assert.deepEqual(failure.results[0].receipt.limitedBy,['destination']);
  assert.equal(balance(blocked,'inventory/supply'),5);
  assert.equal(balance(blocked,'inventory/cargo'),0);

  scene.systems.crew.config.orders.tasks.load.steps[0].mode='partial';
  const partial=W.runtime.create(scene);
  partial.schedule([issue(1,{task:'load',params:{amount:3}})]);
  partial.advance(8);
  const [delivery]=orders(partial).outcomes;
  assert.equal(delivery.phase,'succeeded');
  assert.equal(delivery.results[0].receipt.status,'partial');
  assert.equal(delivery.results[0].receipt.applied,2);
  assert.equal(balance(partial,'inventory/supply'),3);
});

test('cohort LOD pauses prepared transfers and leaves unrelated cohort walkers moving',()=>{
  const scene=shipment(), {config}=scene.systems.crew;
  config.agents.other={species:'walker',position:[0,0,1],goal:[6,0,1]};
  scene.simulationChunks={grid:{size:16},levels:[
    {id:'near',within:1,every:1},{id:'far',within:40,every:1,systems:{agents:{aggregate:{model:'cohorts',cell:4}}}},
    {id:'sleep',sleep:true}
  ],chunks:{yard:{index:[0,0],systems:['crew']}},focus:{viewer:{at:[4,0,4]}}};
  const run=W.runtime.create(scene);
  run.schedule([issue(1,{task:'load',params:{amount:2}}),
    command(2,'world/chunk-focus',{id:'viewer',at:[30,0,4]}),
    command(8,'world/chunk-focus',{id:'viewer',at:[4,0,4]})]);
  run.advance(7);
  assert.equal(run.checkpoint().states.crew.model,'cohorts');
  assert.equal(orders(run).active.phase,'settling');
  assert.equal(balance(run,'inventory/cargo'),0);
  assert(actor(run,'other').position[0]>1);
  const checkpoint=json(run.checkpoint()), resumed=W.runtime.create(checkpoint.world,{checkpoint});
  resumed.advance(12);
  run.advance(12);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.equal(balance(run,'inventory/cargo'),2);
  assert.equal(orders(run).outcomes[0].phase,'succeeded');
});

test('a cancellation clears a shared crossing before stopping and restores the legacy route priority',()=>{
  const scene=ground(), {config}=scene.systems.crew;
  delete config.bounds;
  scene.systems.nav={kind:'navigation',config:{bounds,cell:.22,tiles:{}}};
  config.navigation='nav';
  config.routeQueue={maxRequestsPerTick:1};
  config.crowd={bottlenecks:{bridge:{from:at(3),to:at(5),width:.9}}};
  config.agents.walker={...config.agents.walker,position:at(1),routePriority:4};
  const run=W.runtime.create(scene);
  run.schedule([issue(1,move('cross',at(10),{priority:20}))]);
  const bridge=()=>run.query().probe('crew/bottlenecks').value.bridge;
  for(let tick=1;tick<=40&&!bridge().holders[0]?.entered;tick++)run.step();
  assert(bridge().holders[0]?.entered);
  assert.equal(orders(run).active.id,'cross');
  assert.equal(actor(run).routePriority,20);
  run.schedule([cancel(run.view().tick+1,'cross')]);
  run.advance(80);
  assert.deepEqual(bridge().completed,{a:1,b:0});
  assert.equal(bridge().holders.length,0);
  assert.equal(orders(run).outcomes[0].phase,'cancelled');
  assert(actor(run).position[0]>5&&actor(run).position[0]<5.7);
  assert.equal(actor(run).routePriority,4);
  assert.equal(actor(run).task,'patrol');
});

test('interrupting a move supersedes its pending route before the planner spends a slot',()=>{
  const scene=ground(), {config}=scene.systems.crew;
  delete config.bounds;
  scene.systems.nav={kind:'navigation',config:{bounds,cell:.22,tiles:{}}};
  config.navigation='nav';
  config.routeQueue={maxRequestsPerTick:1};
  const run=W.runtime.create(scene);
  run.schedule([issue(1,move('old',at(9))),issue(2,move('new',at(3)),'interrupt')]);
  run.advance(2);
  const routing=run.query().probe('crew/route-queue').value;
  assert.deepEqual(routing.served,[]);
  assert.deepEqual(routing.pending.map(row=>row.to),[at(3)]);
  assert.equal(orders(run).paused[0].id,'old');
  run.advance(65);
  assert.deepEqual(orders(run).outcomes.map(row=>row.id),['new','old']);
});

test('invalid tasks, overfilled queues and stale owner generations do not mutate the roster',()=>{
  const scene=ground();
  scene.systems.crew.config.orders.maxQueued=1;
  const run=W.runtime.create(scene);
  assert.throws(()=>run.schedule([issue(1,{task:'move',targets:{destination:{entity:'site',point:at(0)}}})]),
    /Invalid targets/);
  assert.throws(()=>run.schedule([issue(1,{task:'unknown'})]),/Invalid agent order/);
  const busy=run.fork();
  busy.schedule([issue(1,{task:'hold'}),issue(1,move('first',at(1))),issue(1,move('overflow',at(2)))]);
  const before=busy.checkpoint();
  assert.throws(()=>busy.step(),/order queue capacity/);
  assert.deepEqual(busy.checkpoint(),before);

  run.schedule([issue(1,move('go',at(10))),command(2,'crew/despawn',{agent:'walker',generation:1}),
    command(2,'crew/spawn',{agent:'walker',species:'walker',position:at(0)})]);
  run.advance(2);
  assert.equal(actor(run).generation,2);
  assert.equal(orders(run).serial,0);
  assert.equal(run.history.find(row=>row.kind==='order-cancelled').reason,'despawned');
  run.schedule([command(3,'crew/cancel-order',{agent:'walker',generation:1,order:1})]);
  const current=run.checkpoint();
  assert.throws(()=>run.step(),/Stale agent generation/);
  assert.deepEqual(run.checkpoint(),current);
});

test('explicit orders temporarily take movement ownership from the activity policy',()=>{
  const scene=ground();
  scene.systems.crew.config.decisions={interval:1,members:{walker:['work']},
    activities:{work:{destinations:{home:{at:at(0)}}}}};
  const run=W.runtime.create(scene);
  run.schedule([issue(2,move('detour',at(3)))]);
  run.advance(13);
  assert.equal(actor(run).task,'move');
  assert(actor(run).position[0]>2);
  assert.equal(run.query().trace('crew/why',{}, {agent:'walker'}).value.phase,'idle');
  run.advance(40);
  assert.equal(orders(run).outcomes[0].phase,'succeeded');
  assert.equal(actor(run).task,'work');
  assert(actor(run).position[0]<.1);
});
