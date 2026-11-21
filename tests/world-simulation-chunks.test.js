const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const valley=require('../examples/world-persistent-valley.json');
const focus=(tick,at,id='person')=>({tick,action:'world/chunk-focus',args:{id,at}});
const level=(tick,chunk,detail,ticks)=>({tick,action:'world/chunk-level',
  args:{chunk,level:detail,...(ticks!==undefined&&{ticks})}});
const input=(tick,port,value)=>({tick,action:'world/input',args:{port,value}});
const query=(run,chunk)=>run.query().probe('world/chunks',{},chunk&&{chunk}).value;
const plain=rows=>JSON.parse(JSON.stringify(rows));
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('sleeping chunks retain moved props, biomass and deposited sediment through save and return',()=>{
  const run=W.runtime.create(valley,{profile:true});
  run.advance(8);
  assert.equal(query(run,'valley').level,'full');
  assert.equal(run.profile().props.calls,16);
  run.advance(16);
  assert.equal(query(run,'valley').level,'coarse');
  const before=run.view().states;
  assert(before.props.bodies.cart.position[0]>1.9);
  assert(before.meadow.stocks[0]>.3);
  assert(run.query().probe('ford/sediment').value.deposited>.3);
  assert.equal(run.profile().ford.calls,10);
  run.advance(25);
  assert.equal(query(run,'valley').level,'sleep');
  assert.equal(query(run,'lookout').level,'full');
  for(const name of ['props','ford','meadow'])assert.equal(run.view().states[name],before[name]);
  const saved=plain(run.checkpoint());
  const restored=W.runtime.create(saved.world,{checkpoint:saved});
  const fork=run.fork();
  for(const branch of [run,restored,fork]){
    branch.advance(33);
    assert.deepEqual(plain(branch.view().states.ford),plain(before.ford));
    branch.advance(41);
    assert.equal(query(branch,'valley').level,'full');
    assert(branch.view().states.props.bodies.cart.position[0]>before.props.bodies.cart.position[0]);
    assert(branch.view().states.meadow.stocks[0]>before.meadow.stocks[0]);
  }
  assert.deepEqual(plain(restored.checkpoint()),plain(run.checkpoint()));
  assert.deepEqual(plain(fork.checkpoint()),plain(run.checkpoint()));
  assert.deepEqual(W.runtime.replay(plain(run.recording())).checkpoint(),run.checkpoint());
});

test('an impulse wakes an unloaded chunk for its authored hold and preserves the changed bodies',()=>{
  const run=W.runtime.create({...valley,commands:[...valley.commands,
    {tick:22,action:'props/impulse',args:{body:'cart',linear:[.75,0,0]}}]});
  run.advance(21);
  const previous=run.view().states.props.bodies.cart;
  assert.equal(query(run,'valley').sleeping,true);
  run.advance(22);
  assert.equal(query(run,'valley').reason,'command');
  assert.equal(query(run,'valley').wakeUntil,23);
  run.advance(24);
  const after=run.view().states.props.bodies.cart;
  assert.equal(query(run,'valley').sleeping,true);
  assert(after.position[0]>previous.position[0]);
  assert(after.velocity[0]>previous.velocity[0]);
});

test('a chunk can sleep after its own sediment changes without waking itself',()=>{
  const config=valley.simulationChunks;
  const run=W.runtime.create({...valley,simulationChunks:{...config,chunks:{...config.chunks,
    valley:{...config.chunks.valley,wake:{spatial:true}}}}});
  run.advance(16);
  const state=run.view().states.ford;
  assert(run.dependencies().pending.some(row=>row.writer==='ford'));
  run.advance(17);
  assert.equal(query(run,'valley').sleeping,true);
  assert.equal(run.view().states.ford,state);
});

const levels=[{id:'full',within:1,substeps:2},{id:'coarse',within:12,every:4},{id:'sleep',sleep:true}];
const shelf={grid:{size:8},levels,chunks:{valley:{index:[0,0],systems:['sink']}}};

test('a stalled average window and local clock are conserved across sleep and a substep change',()=>{
  const implementations={
    driver:()=>({inputs:{value:{type:'number',default:2}},outputs:{value:'number'},initial:()=>2,
      output:state=>({value:state}),step:(_,ctx)=>ctx.input.value}),
    receiver:()=>({inputs:{value:'number'},initial:()=>[],
      step:(state,ctx)=>[...state,{dt:ctx.dt,value:ctx.input.value,time:ctx.simulationLOD.time,
        tuning:ctx.simulationLOD.tuning.quality}],
      checkSimulationLOD:quality=>assert(['low','high'].includes(quality.quality))})
  };
  const configuration={...shelf,levels:levels.map((row,i)=>i===2?row:
    {...row,systems:{receiver:{tuning:{quality:i===0?'high':'low'}}}}),focus:{person:{at:[12,0,2]}}};
  const scene={dt:1,systems:{source:{kind:'driver'},sink:{kind:'receiver'}},simulationChunks:configuration,
    connections:[{from:'source/value',to:'sink/value',sample:'average'}],
    commands:[focus(2,[50,0,2]),input(2,'source/value',50),focus(4,[2,0,2])]};
  const run=W.runtime.create(scene,{implementations});
  run.advance(3);
  const saved=plain(run.checkpoint());
  assert.deepEqual(saved.sampling['sink/value'],{value:4,quanta:2});
  assert.equal(saved.simulationChunks.clocks.sink.activeTicks,1);
  const resumed=W.runtime.create(saved.world,{checkpoint:saved,implementations});
  for(const branch of [run,resumed])branch.advance(4);
  const [first,second]=run.view().states.sink;
  near(first.dt,1.5); near(first.value*first.dt,27);
  near(second.dt,.5); near(second.value*second.dt,25);
  assert.equal(first.tuning,'high');
  assert.equal(second.time,2);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
});

test('event gates wake next tick, and a pinned sleeper retains queued inputs in its checkpoint',()=>{
  const implementations={
    emitter:()=>({inputs:{events:'event'},outputs:{events:'event'},initial:()=>[],
      step:(_,ctx)=>ctx.input.events,output:value=>({events:value})}),
    receiver:()=>({inputs:{events:'event'},initial:()=>[],step:(state,ctx)=>state.concat(ctx.input.events)})
  };
  const source={systems:{source:{kind:'emitter'},sink:{kind:'receiver'}},
    simulationChunks:shelf,connections:[{from:'source/events',to:'sink/events'}],
    commands:[input(1,'source/events',[{id:'one'}]),level(3,'valley','sleep',3),
      input(3,'source/events',[{id:'two'}]),input(5,'source/events',[{id:'three'}])]};
  const run=W.runtime.create(source,{implementations});
  run.advance(1);
  assert.equal(query(run,'valley').sleeping,true);
  run.advance(2);
  assert.equal(query(run,'valley').reason,'event');
  assert.deepEqual(run.view().states.sink,[{id:'one'}]);
  run.advance(5);
  assert.equal(query(run,'valley').reason,'override');
  const saved=plain(run.checkpoint());
  assert.deepEqual(saved.sampling['sink/events'],[{id:'two'},{id:'three'}]);
  const resumed=W.runtime.create(saved.world,{checkpoint:saved,implementations});
  resumed.advance(7);
  assert.deepEqual(resumed.view().states.sink,[{id:'one'},{id:'two'},{id:'three'}]);
  assert.equal(query(resumed,'valley').sleeping,true);
  assert.deepEqual(W.runtime.replay(plain(resumed.recording()),{implementations}).checkpoint(),resumed.checkpoint());
});

test('distance hysteresis, entity focus, place IDs and explicit overrides choose stable levels',()=>{
  const implementations={receiver:()=>({initial:()=>0,step:value=>value+1})};
  const sim={...shelf,hysteresis:2,focus:{person:{at:{entity:'player'},place:'camp'}},chunks:{
    valley:{...shelf.chunks.valley,place:'camp'},
    remote:{...shelf.chunks.valley,systems:['other'],place:'outpost'},
    spare:{index:[-10,0],systems:['spare']}
  }};
  const position=(tick,x)=>({tick,action:'world/patch',args:{edits:[{op:'set',path:['entities','player','position'],value:[x,0,2]}]}});
  const run=W.runtime.create({simulationChunks:sim,entities:{player:{position:[8.5,0,2]}},
    systems:Object.fromEntries(['sink','other','spare'].map(id=>[id,{kind:'receiver'}])),
    commands:[position(2,10.5),position(3,11.5),level(4,'remote','full',2),level(6,'valley','sleep'),
      level(7,'valley',null)]},{implementations});
  assert.equal(query(run,'valley').level,'full');
  run.advance(2);
  assert.equal(query(run,'valley').level,'full');
  run.advance(3);
  assert.equal(query(run,'valley').level,'coarse');
  assert.equal(query(run,'remote').level,'sleep');
  run.advance(5);
  assert.equal(query(run,'remote').level,'full');
  run.advance(6);
  assert.equal(query(run,'remote').level,'sleep');
  assert.equal(query(run,'valley').reason,'override');
  run.advance(7);
  assert.equal(query(run,'valley').level,'coarse');
});

test('spatial dependency wakeups and coalesced notices survive an unloaded checkpoint',()=>{
  const area={min:[0,0,0],max:[6,2,6]};
  const implementations={
    reader:()=>({initial:()=>[],dependencies:{reads:[{field:'writer/edit',bounds:area}]},
      step:(_,ctx)=>ctx.spatial.changes().map(row=>row.bounds)}),
    writer:()=>({initial:()=>0,dependencies:{writes:['edit']},
      actions:{edit:(state,{bounds},ctx)=>{ctx.spatial.write('edit',bounds,'edited');return state+1;}}})
  };
  const simulationChunks={...shelf,chunks:{
    valley:{...shelf.chunks.valley,wake:{spatial:true}}, hidden:{index:[1,0],systems:['hidden'],wake:{spatial:false}}
  }};
  const edit=(tick,x)=>({tick,action:'writer/edit',args:{bounds:{min:[x,0,1],max:[x+1,1,2]}}});
  const run=W.runtime.create({systems:{writer:{kind:'writer'},sink:{kind:'reader'},hidden:{kind:'reader'}},
    simulationChunks,commands:[edit(1,1),edit(2,3),level(4,'hidden','full',1)]},{implementations});
  run.advance(2);
  assert.equal(query(run,'valley').reason,'spatial');
  assert.equal(query(run,'hidden').sleeping,true);
  const saved=plain(run.checkpoint()), pending=saved.spatialSampling.hidden;
  assert.equal(pending.length,1);
  assert.deepEqual(pending[0].bounds.min,[1,0,1]);
  assert.deepEqual(pending[0].bounds.max,[4,1,2]);
  const restored=W.runtime.create(saved.world,{checkpoint:saved,implementations});
  restored.advance(4);
  assert(restored.view().states.hidden.some(row=>row.max[0]===4));
  assert.equal(restored.checkpoint().spatialSampling,undefined);
});

test('cross-chunk transfers keep stock conserved and automatic requests only run on due ticks',()=>{
  const store=value=>({kind:'store',config:{accounts:{stock:{resource:'water',units:'m3',initial:value,max:100}}}});
  const exchange={kind:'exchange',config:{links:{pipe:{from:'supply/stock',to:'tank/stock',rate:1}}}};
  const sim={...shelf,levels:[{id:'full',within:1,every:1},levels[1],levels[2]],focus:{person:{at:[12,0,2]}},
    chunks:{...shelf.chunks,remote:{index:[7,0],systems:['tank']}}};
  const run=W.runtime.create({dt:1,systems:{sink:exchange,supply:store(20),tank:store(0)},
    simulationChunks:sim,commands:[focus(3,[80,0,2]),focus(8,[2,0,2])]});
  run.advance(7);
  assert.equal(run.view().simulationChunks.clocks.sink.calls,0);
  assert.equal(run.query().probe('world/account',{}, {account:'supply/stock'}).value.balance,20);
  run.advance(8);
  const ledger=run.query().probe('world/transfers').value;
  assert.equal(ledger.receipts[0].applied,3);
  assert.equal(query(run,'remote').sleeping,true);
  assert.equal(run.query().probe('world/account',{},{account:'tank/stock'}).value.balance,3);
});

test('chunk validation rejects ambiguous owners, bad tier tuning, commands and clock data',()=>{
  const invalid=changes=>({...valley,simulationChunks:{...valley.simulationChunks,...changes}});
  assert.throws(()=>W.runtime.validate(invalid({chunks:{...valley.simulationChunks.chunks,
    duplicate:{index:[3,0],systems:['ford']}}})),/exactly one chunk/);
  assert.throws(()=>W.runtime.validate(invalid({levels:[{id:'full',within:1,systems:{water:{tuning:{cfl:.8}}}},
    levels[2]]})),/Invalid water simulation detail/);
  const run=W.runtime.create(valley);
  assert.throws(()=>run.schedule([level(1,'valley','missing')]),/Invalid chunk detail override/);
  const saved=plain(run.checkpoint());
  saved.simulationChunks.clocks.ford.pending=100;
  assert.throws(()=>W.runtime.create(saved.world,{checkpoint:saved}),/Invalid saved simulation clock/);
});
