#!/usr/bin/env node
const {performance}=require('node:perf_hooks');
const os=require('node:os');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();

const ticks=48, trials=7;
const point=(tick,at)=>({tick,action:'world/chunk-focus',args:{id:'viewer',at}});
const near=[3,0,3], far=[82,0,3];
const flock=Object.fromEntries(Array.from({length:192},(_,i)=>['bird-'+i,{
  species:'shorebird',position:[4+(i%16)*.32,0,3+Math.floor(i/16)*.30],
  goal:[20+(i%16)*.32,0,3+Math.floor(i/16)*.30]
}]));
const marsh={water:{kind:'water',config:{width:80,height:64,cell:.5,
  initial:[{bounds:{min:[3,3],max:[28,22]},value:.6}]}},flock:{kind:'agents',config:{
    bounds:{min:[0,-1,0],max:[40,3,32]},cell:.5,
    species:{shorebird:{mode:'walk',speed:.8,radius:.12}},agents:flock
  }}};
const marshProfiles={water:{aggregate:{model:'blocks',factor:4}},agents:{aggregate:{model:'cohorts',cell:64}}};
const graphArea={min:[0,-1,0],max:[31,3,31]};
const containers={source:{position:[2,0,2],stocks:{ore:{initial:500,max:700}}}}, links={};
for(let i=0;i<24;i++){
  const key='bay-'+i;
  containers[key]={position:[20+(i%4),0,7+i*.62],stocks:{ore:{initial:0,max:40}}};
  links[key]={from:'source',to:key,resource:'ore',rate:1,travel:.1,
    route:{trace:'nav/route',at:containers.source.position,to:containers[key].position}};
}
const works={nav:{kind:'navigation',config:{bounds:graphArea,cell:.55}},
  mill:{kind:'logistics',config:{resources:{ore:{units:'kg'}},containers,links}}};

function world(systems,managed,profiles){
  return {dt:.05,history:{enabled:false},systems,commands:[point(4,far)],simulationChunks:{grid:{size:64},
    levels:[{id:'near',within:1,every:1},{id:'far',within:50,every:1,...(profiles&&{systems:profiles})},
      {id:'sleep',sleep:true}],chunks:{yard:{index:[0,0],systems:managed}},focus:{viewer:{at:near}}}};
}
function stats(samples){
  const sorted=samples.slice().sort((a,b)=>a-b);
  return {medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1]};
}
function bench(id,systems,managed,profiles,workload){
  const modes={detail:world(systems,managed),aggregate:world(systems,managed,profiles)};
  const times={detail:[],aggregate:[]}, wake=[];
  let work,calls;
  for(let trial=0;trial<trials+2;trial++){
    for(const mode of trial%2?['aggregate','detail']:['detail','aggregate']){
      const run=W.runtime.create(modes[mode]);
      run.advance(9);
      const before=performance.now();
      run.advance(9+ticks);
      const elapsed=(performance.now()-before)/ticks;
      if(trial>=2)times[mode].push(elapsed);
      const total=managed.reduce((sum,name)=>sum+run.view().simulationChunks.clocks[name].calls,0);
      if(calls===undefined)calls=total;
      else assert.equal(total,calls);
      if(mode==='aggregate'){
        work=Object.fromEntries(Object.entries(run.query().probe('world/representation').value)
          .map(([key,row])=>[key,row.work]));
        run.schedule([point(10+ticks,near)]);
        const start=performance.now();
        run.step();
        if(trial>=2)wake.push(performance.now()-start);
      }
    }
  }
  return {id,workload,aggregateWork:work,ticks,trials,solverCallsThroughSample:calls,
    perTick:Object.fromEntries(Object.entries(times).map(([mode,samples])=>[mode,stats(samples)])),
    wakeAndStep:stats(wake)};
}
console.log(JSON.stringify({machine:{cpu:os.cpus()[0]?.model,node:process.version},cases:[
  bench('marsh',marsh,['water','flock'],marshProfiles,{cells:5120,agents:192}),
  bench('worksite',works,['mill'],{logistics:{aggregate:{model:'ledger'}}},{routes:24})
]},null,2));
