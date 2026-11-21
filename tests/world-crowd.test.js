const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const example=require('../examples/world-crowd-bridge.json');
const json=value=>JSON.parse(JSON.stringify(value));
const bridge=run=>run.query().probe('crew/bottlenecks').value.bridge;
const crew=run=>run.query().probe('crew/agents').value;
const command=(tick,action,args)=>({tick,action,args});
const bounds={min:[0,-1,-3],max:[12,2,3]};
const walker=(x,goal)=>({species:'walk',position:[x,0,0],goal:[goal,0,0]});
const plan=(agents,crowd)=>({dt:.1,systems:{nav:{kind:'navigation',config:{bounds,cell:.3,tiles:{}}},
  crew:{kind:'agents',config:{navigation:'nav',crowd,
    species:{walk:{mode:'walk',radius:.21,speed:1.5}},agents}}}});

test('opposing groups drain and alternate across a shared bridge without overlaps',()=>{
  const run=W.runtime.create(example), directions=[];
  let peak=0, queued=0, checkpoint;
  for(let tick=1;tick<=218;tick++){
    run.step();
    const row=bridge(run), agents=Object.values(crew(run));
    assert(row.holders.length<=2);
    assert(new Set(row.holders.map(item=>item.side)).size<=1);
    peak=Math.max(peak,row.holders.length); queued=Math.max(queued,row.waiting.length);
    if(row.turn&&directions.at(-1)!==row.turn)directions.push(row.turn);
    for(let i=0;i<agents.length;i++)for(let j=0;j<i;j++){
      const a=agents[i].position,b=agents[j].position;
      assert(Math.hypot(a[0]-b[0],a[2]-b[2])>=.42-1e-6);
    }
    if(tick===65)checkpoint=json(run.checkpoint());
  }
  assert.equal(peak,2);
  assert(queued>=4);
  assert.equal(directions.length,4);
  assert.notEqual(directions[0],directions[1]);
  assert.equal(directions[0],directions[2]);
  assert.equal(directions[1],directions[3]);
  assert.deepEqual(bridge(run).completed,{a:4,b:4});
  assert.deepEqual(bridge(run).waiting,[]);
  for(const [id,agent] of Object.entries(crew(run)))assert(id.startsWith('east')?agent.position[0]>8:agent.position[0]<4);
  const restored=W.runtime.create(checkpoint.world,{checkpoint});
  const fork=restored.fork();
  for(const replay of [restored,fork])replay.advance(218);
  assert.deepEqual(restored.checkpoint(),run.checkpoint());
  assert.deepEqual(fork.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('local avoidance passes opposing walkers with a swept spacing check',()=>{
  const run=W.runtime.create(plan({east:walker(2,10),west:walker(10,2)},{lookAhead:.6}));
  let turned=false;
  for(let i=0;i<100;i++){
    run.step();
    const {east,west}=crew(run), [a,,z]=east.position,[b,,w]=west.position;
    turned ||= east.crowd.status==='avoiding'||west.crowd.status==='avoiding';
    assert(Math.hypot(a-b,z-w)>=.42-1e-6);
  }
  assert(turned);
  assert(crew(run).east.position[0]>9.5);
  assert(crew(run).west.position[0]<2.5);
});

test('directional availability can close a landing while an admitted walker clears it',()=>{
  const scene=plan({east:walker(2.85,9),west:walker(6,1)},{avoidance:false,bottlenecks:{
    bridge:{from:[4,0,0],to:[5,0,0],width:1,capacity:1,open:{a:false,b:true}}
  }});
  const run=W.runtime.create(scene);
  run.advance(10);
  assert.equal(bridge(run).holders[0].agent,'west');
  assert.equal(bridge(run).holders[0].entered,true);
  run.schedule([command(11,'world/input',{port:'crew/open.bridge.b',value:false})]);
  run.advance(31);
  assert.deepEqual(bridge(run).open,{a:false,b:false});
  assert.deepEqual(bridge(run).completed,{a:0,b:1});
  assert.equal(bridge(run).waiting[0].agent,'east');
  assert.equal(crew(run).east.crowd.status,'queued');
  run.schedule([command(32,'world/input',{port:'crew/open.bridge.a',value:true})]);
  run.advance(75);
  assert.deepEqual(bridge(run).completed,{a:1,b:1});
  assert.equal(bridge(run).holders.length,0);
});

test('despawning releases a crossing reservation and generation reuse keeps capacity bounded',()=>{
  const run=W.runtime.create(plan({first:walker(3.65,9),second:walker(2.8,9)},{bottlenecks:{
    bridge:{from:[4,0,0],to:[7,0,0],width:1,capacity:1}
  }}));
  run.advance(10);
  const old=bridge(run).holders[0];
  assert(old.entered);
  run.schedule([
    command(11,'crew/despawn',{agent:old.agent,generation:old.generation}),
    command(11,'crew/spawn',{agent:old.agent,...walker(1,9)})
  ]);
  run.step();
  assert(bridge(run).holders.every(row=>row.agent!==old.agent||row.generation!==old.generation));
  assert(bridge(run).holders.length<=1);
  run.advance(125);
  assert.deepEqual(bridge(run).completed,{a:2,b:0});
});

test('spatial grid movement and removal are visible at bucket boundaries',()=>{
  const grid=W.spatial.grid(1);
  const slot=grid.add([0,0,0],'mover');
  const read=x=>{const rows=[];grid.overlap([x,0,0],[x,0,0],row=>rows.push(row));return rows;};
  assert.deepEqual(read(0),['mover']);
  grid.move(slot,[2,0,0]);
  assert.deepEqual(read(0),[]);
  assert.deepEqual(read(2),['mover']);
  grid.remove(slot);
  assert.deepEqual(read(2),[]);
});

test('coarse movement holds at a crossing and restores its queue on wake',()=>{
  const scene=plan({walker:walker(3.2,9)},{bottlenecks:{
    bridge:{from:[4,0,0],to:[6,0,0],width:1.1,capacity:1}
  }});
  scene.simulationChunks={grid:{size:16},levels:[
    {id:'near',within:1,every:1},
    {id:'far',within:40,every:1,systems:{agents:{aggregate:{model:'cohorts',cell:4}}}},
    {id:'sleep',sleep:true}
  ],chunks:{yard:{index:[0,0],systems:['crew']}},focus:{viewer:{at:[4,0,4]}}};
  scene.commands=[
    command(2,'world/chunk-focus',{id:'viewer',at:[30,0,4]}),
    command(12,'world/chunk-focus',{id:'viewer',at:[4,0,4]})
  ];
  const run=W.runtime.create(scene);
  run.advance(11);
  assert.equal(run.checkpoint().states.crew.model,'cohorts');
  assert(crew(run).walker.position[0]<3.8);
  assert.equal(bridge(run).waiting[0].agent,'walker');
  const saved=json(run.checkpoint()), resumed=W.runtime.create(saved.world,{checkpoint:saved});
  for(const next of [run,resumed]){
    next.advance(45);
    assert.deepEqual(bridge(next).completed,{a:1,b:0});
  }
  assert.deepEqual(run.checkpoint(),resumed.checkpoint());
});
