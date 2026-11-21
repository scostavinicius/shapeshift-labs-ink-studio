const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const estuary=require('../examples/world-aggregate-estuary.json');
const clone=value=>JSON.parse(JSON.stringify(value));
const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const detail=(run,system)=>run.query().probe('world/representation',{}, {system}).value;
const focus=(tick,x)=>({tick,action:'world/chunk-focus',args:{id:'player',at:[x,0,4]}});
const aggregate=(systems,focusAt=5,every=1)=>({grid:{size:16},levels:[
  {id:'near',within:1,every:1},{id:'far',within:40,every,systems},{id:'sleep',sleep:true}
],chunks:{reach:{index:[0,0],systems:[]}},focus:{player:{at:[focusAt,0,4]}}});
function define(systems,options,commands=[]){
  return {dt:.05,systems,commands,simulationChunks:{...options,
    chunks:{reach:{index:[0,0],systems:Object.keys(systems).filter(key=>key!=='nav'&&key!=='source')}}}};
}

test('all native representations survive a dormant checkpoint and reconstruct in a deterministic replay',()=>{
  const run=W.runtime.create(estuary,{profile:true});
  run.advance(4);
  const volume=detail(run,'lagoon').quantities.volume.value;
  const ids=Object.keys(run.view().states.flock.agents);
  run.advance(17);
  assert.deepEqual(detail(run,'lagoon').work,{cells:24,detailCells:384});
  assert.deepEqual(detail(run,'flock').work,{cohorts:1,individuals:6});
  close(detail(run,'lagoon').quantities.volume.value,volume);
  assert.equal(detail(run,'flock').quantities.population.value,ids.length);
  const millBefore=run.query().probe('mill/ledger').value.flour.total;
  assert(millBefore>1);
  assert(Object.values(run.checkpoint().states).every(row=>row.format==='ink-studio/aggregate-state'));
  run.advance(24);
  const saved=clone(run.checkpoint());
  assert.equal(saved.simulationChunks.entries.estuary.level,'sleep');
  assert.equal(run.query().probe('mill/ledger').value.flour.total,millBefore);
  const branch=W.runtime.create(saved.world,{checkpoint:saved});
  const fork=run.fork();
  for(const continuation of [run,branch,fork]){
    continuation.advance(31);
    assert(Object.values(continuation.query().probe('world/representation').value).every(row=>row.representation==='detail'));
    assert.deepEqual(Object.keys(continuation.view().states.flock.agents),ids);
    close(continuation.query().probe('lagoon/mass').value.volume,volume);
    for(const stock of Object.values(continuation.query().probe('mill/ledger').value))close(stock.error,0);
  }
  assert(W.data.equal(branch.checkpoint(),run.checkpoint()));
  assert(W.data.equal(fork.checkpoint(),run.checkpoint()));
  assert(W.data.equal(W.runtime.replay(clone(run.recording())).checkpoint(),run.checkpoint()));
  const transitions=run.history.filter(row=>row.kind==='simulation-representation');
  assert.equal(transitions.length,6);
  assert(transitions.every(row=>['flock','lagoon','mill'].includes(row.solver)));
});

test('water blocks conserve volume and momentum across conversion and rebuild depth over the retained bed',()=>{
  const pond=estuary.systems.lagoon;
  const scene=define({pond},aggregate({water:{aggregate:{model:'blocks',factor:4}}},5,8),[focus(4,29)]);
  const run=W.runtime.create(scene);
  run.advance(3);
  const before=detail(run,'pond').quantities, original=run.view().states.pond.fluid;
  assert(original.mx.some(n=>Math.abs(n)>.001));
  run.advance(4);
  const far=detail(run,'pond');
  close(far.quantities.volume.value,before.volume.value);
  far.quantities.momentum.value.forEach((value,i)=>close(value,before.momentum.value[i]));
  const sample=run.query().probe('pond/depth',[5,0,1],{explain:true});
  assert.equal(sample.source.kind,'water-block');
  const restored=run.view().states.pond.fluid;
  assert.deepEqual(restored.bed,original.bed);
  const sum=list=>list.reduce((a,b)=>a+b,0);
  close(sum(restored.depth),sum(original.depth));
  close(sum(restored.mx),sum(original.mx));
  assert.equal(run.checkpoint().states.pond.data.fluid.depth.length,24);
  assert(restored.depth.some((n,i)=>n!==original.depth[i]));
  const saved=clone(run.checkpoint());
  saved.states.pond.data.fluid.depth.pop();
  assert.throws(()=>W.runtime.create(saved.world,{checkpoint:saved}),/Invalid shallow-water checkpoint/);
});

test('failed conservation rolls back the transition, command queue and solver clocks',()=>{
  const options=aggregate({work:{aggregate:{model:'sum',preserve:['stock']}}});
  const scene=define({factory:{kind:'work'}},options,[focus(3,30)]);
  const implementations={work:()=>({initial:()=>({stock:5}),step:state=>state,
    simulationAggregate:()=>({quantities:{stock:{units:'items',exact:true}},reduce:state=>({stock:state.stock-1}),
      expand:state=>state,measure:state=>state,step:state=>state,validate(){}})
  })};
  const run=W.runtime.create(scene,{implementations});
  run.advance(2);
  const before=clone(run.checkpoint());
  assert.throws(()=>run.step(),/Simulation representation changed stock for factory/);
  assert.deepEqual(run.checkpoint(),before);
  assert.equal(run.view().tick,2);
});

test('aggregate steps, output signals and native query projections avoid reconstructing the detail state',()=>{
  let expanded=0, steps=0;
  const implementations={work:()=>({initial:()=>({stock:3}),step:state=>state,outputs:{stock:'number'},
    output:state=>state,fields:{stock:{type:'number',read:({state})=>W.query.ok(state.stock)},
      fine:{type:'record',read:({state})=>W.query.ok(state)}},
    simulationAggregate:()=>({quantities:{stock:{units:'kg'}},
      reduce:state=>({total:state.stock}),expand:state=>{expanded++;return {stock:state.total};},
      measure:(state,coarse)=>({stock:coarse?state.total:state.stock}),validate(){},
      step:state=>{steps++;return {total:state.total+1};},output:state=>({stock:state.total}),
      fields:{stock:({state})=>W.query.ok(state.total)}})})};
  const run=W.runtime.create(define({factory:{kind:'work'}},aggregate({work:{aggregate:{model:'sum'}}},30)),{implementations});
  run.advance(80);
  assert.equal(steps,80);
  assert.equal(expanded,0);
  assert.equal(run.query().probe('factory/stock').value,83);
  assert.equal(run.view().signals['factory/stock'],83);
  assert.equal(expanded,0);
  assert.equal(run.query().probe('factory/fine').value.stock,83);
  assert.equal(run.view().states.factory.stock,83);
  assert.equal(expanded,1);
});

test('moving between cadences that share an aggregate profile reuses its state',()=>{
  let reductions=0,expansions=0;
  const implementations={work:()=>({initial:()=>({stock:3}),step:state=>state,
    simulationAggregate:()=>({quantities:{stock:{units:'kg'}},
      reduce:state=>{reductions++;return state;},expand:state=>{expansions++;return state;},
      measure:state=>state,step:state=>state,validate(){}})
  })};
  const profiles={work:{aggregate:{model:'sum'}}}, options=aggregate(profiles,29);
  options.levels.splice(2,0,{id:'distant',within:80,every:4,systems:clone(profiles)});
  const run=W.runtime.create(define({factory:{kind:'work'}},options,[focus(3,75)]),{implementations});
  const data=run.checkpoint().states.factory.data;
  run.advance(3);
  assert.equal(detail(run,'factory').level,'distant');
  assert.equal(run.checkpoint().states.factory.data,data);
  assert.equal(reductions,1);
  assert.equal(expansions,0);
  const saved=clone(run.checkpoint());
  saved.states.factory.level='far';
  assert.throws(()=>W.runtime.create(saved.world,{checkpoint:saved,implementations}),/Saved representation does not match/);
});

test('logistics retains route eligibility offscreen and accepts a conservative transfer without expanding its ledger',()=>{
  let routeChecks=0, open=true;
  const implementations={navigator:()=>({initial:()=>null,traces:{road:{run(){
    routeChecks++;return W.query.ok({status:open?'ok':'blocked'});
  }}}})};
  const systems={nav:{kind:'navigator'},source:{kind:'store',config:{accounts:{stock:{initial:3,max:8,resource:'flour',units:'kg'}}}},
    mill:clone(estuary.systems.mill)};
  const route=systems.mill.config.links.belt;
  route.route={trace:'nav/road',at:[1,0,0],to:[2,0,0]};
  systems.mill.config.containers.hopper.stocks.flour.initial=1;
  const commands=[focus(3,30),focus(9,5),{tick:5,action:'world/transfer',
    args:{from:'source/stock',to:'mill/hopper.flour',amount:1}}];
  const scene=define(systems,aggregate({logistics:{aggregate:{model:'ledger'}}}),commands);
  scene.simulationChunks.chunks.reach.wake={commands:false};
  const run=W.runtime.create(scene,{implementations});
  run.advance(2);
  assert(routeChecks>0);
  const checked=routeChecks;
  open=false;
  run.advance(8);
  assert.equal(routeChecks,checked);
  assert.equal(detail(run,'mill').representation,'aggregate');
  close(run.query().probe('world/account',{}, {account:'source/stock'}).value.balance,2);
  close(run.query().probe('mill/ledger').value.flour.error,0);
  run.advance(9);
  assert(routeChecks>checked);
  assert.equal(detail(run,'mill').representation,'detail');
  assert.equal(run.query().probe('mill/links',{}, {link:'belt'}).value.reason,'route-closed');
});

test('an instance can select a different block factor or keep a coupled water solver detailed',()=>{
  const coarse=aggregate({water:{aggregate:{model:'blocks',factor:4}}},29);
  coarse.levels[1].instances={left:{aggregate:{model:'blocks',factor:2}},right:{aggregate:false}};
  const coupled={kind:'water',config:{width:8,height:8,sediment:{erodibleDepth:0,capacity:.1}}};
  const source=define({left:estuary.systems.lagoon,right:coupled},coarse);
  const run=W.runtime.create(source);
  assert.equal(detail(run,'left').work.cells,96);
  assert.equal(detail(run,'right'),undefined);
  const invalid=clone(source);
  delete invalid.simulationChunks.levels[1].instances.right;
  assert.throws(()=>W.runtime.validate(invalid),/Water blocks require a closed grid/);
});
