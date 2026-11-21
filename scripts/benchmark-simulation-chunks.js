#!/usr/bin/env node
const {performance}=require('node:perf_hooks');
const os=require('node:os');
const {KIT:{world:W}}=require('..').load();

const systems={}, chunks={}, cols=6, size=16, ticks=80;
for(let z=0;z<cols;z++)for(let x=0;x<cols;x++){
  const id='pond-'+x+'-'+z, origin=[size*x,size*z];
  systems[id]={kind:'water',config:{width:12,height:12,cell:1,origin,base:0,
    initial:[{bounds:{min:origin,max:[origin[0]+5,origin[1]+5]},value:.6}]}};
  chunks[id]={index:[x,z],systems:[id]};
}
const baseline={dt:.05,systems,history:{enabled:false}};
const paged={...baseline,simulationChunks:{grid:{size},levels:[
  {id:'full',within:1,every:1},
  {id:'coarse',within:14,every:4,systems:{water:{tuning:{cfl:.46,maxDt:.09}}}},
  {id:'sleep',sleep:true}
],chunks,focus:{observer:{at:[40,0,40]}}}};
const cases=[{id:'always-active',world:baseline},{id:'simulation-chunks',world:paged}];
const times=new Map(cases.map(({id})=>[id,[]]));
for(let round=0;round<9;round++){
  for(const {id,world} of round%2?cases.slice().reverse():cases){
    const run=W.runtime.create(world), start=performance.now();
    run.advance(ticks);
    if(round>=2)times.get(id).push((performance.now()-start)/ticks);
  }
}
const measured=cases.map(({id,world})=>{
  const run=W.runtime.create(world,{profile:true});
  run.advance(ticks);
  const rows=run.view().simulationChunks?.entries??{}, levels={};
  for(const row of Object.values(rows))levels[row.level]=(levels[row.level]??0)+1;
  const calls=Object.values(run.profile()).reduce((total,row)=>total+row.calls,0);
  const sorted=times.get(id).slice().sort((a,b)=>a-b);
  return {id,medianMsPerTick:sorted[Math.floor(sorted.length/2)],p95MsPerTick:sorted[Math.ceil(sorted.length*.95)-1],
    solverCalls:calls,levels,samplesMsPerTick:times.get(id)};
});
console.log(JSON.stringify({machine:{cpu:os.cpus()[0]?.model,node:process.version},
  scene:{chunks:cols*cols,cellsPerChunk:144,ticks},cases:measured},null,2));
