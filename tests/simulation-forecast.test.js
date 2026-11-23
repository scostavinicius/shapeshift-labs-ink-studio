const assert=require('node:assert/strict');
const test=require('node:test');
const {KIT:K}=require('..').load();
const {world:W}=K;

const glide=()=>({
  initial:()=>({x:0,speed:0}),
  inputs:{speed:'number'},
  step:(state,{input})=>({x:state.x+input.speed,speed:input.speed}),
  fields:{
    position:{type:'vector',read:({state})=>W.query.ok([state.x,0,0])},
    flow:{type:'vec2',read:({state})=>W.query.ok([state.speed,0])}
  }
});
const world={id:'drift-test',dt:.25,systems:{boat:{kind:'glide'}}};
const runtime={implementations:{glide}};
const action={action:'world/input',args:{port:'boat/speed',value:2}};
const setup={
  steps:5,every:4,actions:[action],
  tracks:[{id:'float',field:'boat/position',tolerance:0}],
  flows:[{id:'current',field:'boat/flow',at:[1,0,2],seconds:1,maxLength:.75}]
};

test('forecast uses two independent forks and tests every tick even with sparse ghost samples',()=>{
  const source=W.runtime.create(world,runtime);
  source.schedule([{tick:6,action:'world/event',args:{kind:'buoy-relay'}}]);
  source.advance(2);
  const before=source.checkpoint(), seen=[];
  const image=new Uint8Array(20);
  const report=W.forecast.run(source,{...setup,compareView:{
    render({query,tick,branch}) {
      seen.push([tick,branch]);
      const [x]=query.probe('boat/position').value;
      image.fill(0);
      for (let i=3;i<image.length;i+=4) image[i]=255;
      image[Math.floor(x/3)*4]=200;
      return {width:5,height:1,data:image};
    },
    anchor:({x,y})=>[x,0,y]
  }});
  assert.equal(source.checkpoint(),before);
  assert.deepEqual(source.checkpoint().pending,before.pending);
  assert.deepEqual(report.samples.map(row=>row.tick),[2,6,7]);
  assert.equal(report.firstObserved.tick,3);
  assert.deepEqual(report.firstObserved.at,[2,0,0]);
  assert.equal(report.firstVisible.tick,4);
  assert.deepEqual(report.firstVisible,{pixel:[0,0],changed:2,peak:200,bounds:[0,0,2,1],viewport:[5,1],tick:4,time:1,at:[0,0,0]});
  assert.deepEqual(seen,[[3,'baseline'],[3,'proposal'],[4,'baseline'],[4,'proposal']]);
  assert.deepEqual(report.samples[1].proposal.tracks[0].at,[8,0,0]);
  assert.deepEqual(report.samples[1].baseline.tracks[0].at,[0,0,0]);
  assert.deepEqual(report.samples[1].proposal.flows[0].to,[1.75,0,2]);
  const beforeChange=W.forecast.commands(report,{tick:3,ghosts:0});
  assert.deepEqual(beforeChange,[]);
  const afterChange=W.forecast.layer(report,{tick:7});
  assert(afterChange.draw.some(row=>row.type==='arrow'&&row.space==='world'));
  assert(afterChange.draw.some(row=>row.closed&&row.width>1));
  assert(Object.isFrozen(report.samples[1].proposal.tracks[0].at));
});

test('deserialized checkpoints and active branch sessions forecast without publishing new branches',async()=>{
  const live=W.runtime.create(world,runtime);
  live.advance(3);
  const portable=JSON.parse(JSON.stringify(live.checkpoint()));
  const a=W.forecast.run(portable,{...setup,runtime});
  const b=await W.forecast.runAsync(live,setup);
  assert.deepEqual(a,b);
  const session=W.branches.create(live);
  const revisions=[];
  const off=session.subscribe(state=>revisions.push(state));
  assert.deepEqual(session.forecast(setup),b);
  assert.deepEqual(await session.forecastAsync(setup),b);
  assert.equal(session.status().tick,3);
  assert.equal(session.status().branches.length,1);
  assert.equal(revisions.length,1);
  off();
  assert.equal(session.checkpoint().pending.length,0);
});

test('pixel comparison ignores transparent colors and pins an uncalibrated marker only on the requested art grid',()=>{
  const live=W.runtime.create(world,runtime);
  const before=live.checkpoint();
  const render=({branch,tick})=>({width:2,height:1,channels:4,data:Uint8Array.from([
    branch==='baseline'?200:9,0,0,0, tick===2&&branch==='proposal'?90:0,0,0,255
  ])});
  const report=W.forecast.run(live,{steps:3,every:3,compareView:{render}});
  assert.equal(report.firstVisible.tick,2);
  assert.deepEqual(report.firstVisible.pixel,[1,0]);
  assert.equal(report.firstVisible.changed,1);
  assert.deepEqual(W.forecast.commands(report),[]);
  assert.deepEqual(W.forecast.commands(report,{screenMarker:[3,1]}),[]);
  assert.equal(W.forecast.commands(report,{screenMarker:[2,1]}).length,8);
  assert.throws(()=>W.forecast.run(live,{...setup,compareView:{render:()=>{throw new Error('capture failed');}}}),/capture failed/);
  assert.equal(live.checkpoint(),before);
});

test('the normal scene compositor projects an isolated forecast draw layer',()=>{
  const ink=require('..'), {makeBuilder}=ink.load();
  const source=W.runtime.create(world,runtime);
  const report=W.forecast.run(source,{...setup,actions:[{...action,args:{...action.args,value:.18}}],every:1});
  const current=makeBuilder(12,[0x23303a]).finish({radius:4,cam:{target:[.5,0,0],dist:5,pitch:.7,yaw:.18}});
  const options={w:80,h:60,px:1,raw:true};
  const clean=ink.render(current,options);
  const overlay=ink.render(current,{...options,composite:{layers:[W.forecast.layer(report,{branches:['proposal']})]}});
  assert.equal(clean.w,overlay.w);
  assert.notDeepEqual(clean.rgb,overlay.rgb);
  assert.equal(source.view().tick,0);
  assert.deepEqual(source.query().probe('boat/position').value,[0,0,0]);
});
