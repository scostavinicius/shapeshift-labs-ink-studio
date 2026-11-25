const test=require('node:test'), assert=require('node:assert/strict');
const ink=require('..'),kit=ink.load(), {KIT:K,makeBuilder}=kit, W=K.world, T=K.procedural.takeTime;
const priority=require('../src/joint-priority.js'), WAV=require('../cli/wav.js');
const rate=48000, range={startPoint:T.read(0),endPoint:T.read(.28)};
const packet={id:'rainfall',windows:[{id:'land',from:.089,to:.175,
  picture:{subjects:[{object:'action'}],particleRetain:.18},
  sound:{cues:['impact'],backgroundVoices:1,groups:{rain:0}}}]};

test('the same half-open priority window keeps the action rows and spends fewer draw rows on particles',()=>{
  const B=makeBuilder(118,[0x243448,0xc17f49,0xf1c778,0x6b8f9d]), first=B.count();
  for(let y=-5;y<=5;y++)for(let x=-7;x<=7;x++)B.disc(x*.046,y*.043,0,[0,0,1],.053,.02,B.P[1+(Math.abs(x+y)%2)],2);
  B.describeSplats(first,B.count(),{object:'action'});
  for(let i=0;i<280;i++){
    const x=(i%22-11)*.08,z=.5+(i%3)*.143,y=(i%19-10)*.052;
    B.stick(x,y,z,[0,1,0],.12,.018,B.P[3],.66,{k:2,ph:(i%13)/13,sp:2,rg:2,nd:true});
  }
  const world=B.finish({cam:{target:[0,0,0],dist:5.1,yaw:0,pitch:0},radius:4,dither:0,look:{
    jointPriority:packet,passQuality:{background:{select:[{object:'action'}],retain:.125}}}});
  const opts={w:96,h:72,px:1,raw:true,renderStats:true,passes:['objectId']};
  const on=ink.render(world,{...opts,t:.1}),off=ink.render(world,{...opts,t:.1,jointPriority:false});
  assert.equal(on.jointPriority.window,'land');
  assert(on.renderStats.omittedParticleRows>180);
  assert.equal(on.renderStats.omittedBackgroundRows,0);
  assert(on.renderStats.splatRows<off.renderStats.splatRows);
  assert(off.renderStats.omittedBackgroundRows>100);
  for(const t of [.08899,.175]){
    const ordinary=ink.render(world,{...opts,t});
    assert.equal(ordinary.jointPriority,undefined);
    assert.deepEqual(ordinary.rgb,ink.render(world,{...opts,t,jointPriority:false}).rgb);
  }
  const phase=priority.prepare(packet);
  assert.equal(priority.at(phase.windows,.089).id,'land');
  assert.equal(priority.at(phase.windows,.175),undefined);
  const fractional={...packet,windows:[{...packet.windows[0],from:.089001,to:.175001}]};
  const [projected]=priority.forSamples(priority.prepare(fractional),rate,T);
  assert.deepEqual([projected.from,projected.to],[4273,8401]);
});

const source=hz=>({sampleRate:rate,channels:1,samples:Float32Array.from({length:rate*.155},(_,i)=>
  .28*Math.cos(2*Math.PI*hz*i/rate)*Math.exp(-i/(rate*.035)))});
const assets={rain:source(293),footsteps:source(157),impact:source(967)};
const event=(tick,cue,x)=>({tick,action:'world/event',args:{kind:'audio-cue',cue,at:[x,0,-1]}});
const world={id:'storm',dt:.025,commands:[
  event(2,'rain',-1),event(2,'steps',1),event(4,'impact',0),event(8,'rain',-1)
]};
const distance={rolloff:0};
const spatial={jointPriority:packet,voiceBudget:{maxVoices:2,reservedVoices:0,stealFade:0},cues:{
  rain:{asset:'rain',priority:20,group:'rain',distance},
  steps:{asset:'footsteps',priority:15,group:'crowd',distance},
  impact:{asset:'impact',priority:-10,group:'rain',distance}
}};
function open(settings){
  return ink.createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate:rate,spatial:settings},
    {kit,resolveAsset:id=>assets[id],runtime:()=>W.runtime.create(world)});
}
test('the recorded allocator applies priority at a sample boundary and preserves the masked strike as a direct voice',()=>{
  const scene=open(spatial);
  const on=scene.render(range,{trace:true}), off=open({...spatial,jointPriority:false}).render(range,{trace:true});
  const grant=on.report.voiceBudget.decisions.find(row=>row.cue==='impact');
  assert.equal(grant.action,'admitted');
  assert.equal(grant.promoted,true);
  assert.equal(grant.sample,4800);
  assert.equal(grant.priorityWindow,'land');
  assert.equal(grant.protected,true);
  const ordinary=off.report.voiceBudget.decisions.find(row=>row.cue==='impact');
  assert.equal(ordinary.action,'dropped');
  const displaced=on.report.voiceBudget.decisions.find(row=>row.cue==='rain' && row.action==='stolen');
  assert.equal(displaced.sample,4272);
  assert.equal(displaced.reason,'priority-group-limit');
  assert(on.report.voiceBudget.decisions.some(row=>row.cue==='rain' && row.sample===9600 && row.action==='admitted'));
  assert.deepEqual(on.report.voiceBudget.priorityWindows,[{id:'land',fromSample:4272,toSample:8400,
    backgroundVoices:1,cues:['impact']}]);
  const a=WAV.decode(on.waves.mix).samples,b=WAV.decode(off.waves.mix).samples;
  assert.deepEqual(a.slice(0,4272*2),b.slice(0,4272*2));
  const protectedCue=scene.capture(range,{source:{kind:'world',by:'cue',name:'impact'}}).value;
  assert(Math.abs(protectedCue.samples[9600])>.12);
});

test('spatial frames publish the active policy for a live player and validate its cue names',()=>{
  const mixer=W.spatialAudio.create(spatial), run=W.runtime.create(world);
  const at=time=>mixer.frame({time,query:run.query(),listener:[0,0,0]});
  assert.equal(at(.03).jointPriority,undefined);
  assert.deepEqual(at(.09).jointPriority,{id:'land',sound:{cues:['impact'],backgroundVoices:1,groups:{rain:0}}});
  assert.equal(at(.175).jointPriority,undefined);
  const {voiceBudget,...withoutBudget}=spatial;
  assert.throws(()=>W.spatialAudio.create(withoutBudget),/spatial voice budget/);
  assert.throws(()=>W.spatialAudio.create({...spatial,jointPriority:{...packet,windows:[
    {...packet.windows[0],sound:{cues:['missing'],backgroundVoices:0}}
  ]}}),/Unknown spatial cue/);
});

test('WebGL lowers instance work inside the window and restores its normal selection afterward',
  {skip:!process.env.INK_TEST_CHROME},()=>{
    const runWebGL=require('../cli/look-webgl.js');
    const result=runWebGL({},kit=>{
      const B=kit.makeBuilder(81,[0x25445b,0xdd9b43,0x7ab5c6]);
      const first=B.count();
      for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++)
        B.disc(x*.07,y*.07,0,[0,0,1],.071,.03,B.P[1],2);
      B.describeSplats(first,B.count(),{object:'action'});
      for(let i=0;i<220;i++)B.stick((i%20-10)*.09,(i%14-7)*.052,.38,[0,1,0],
        .11,.016,B.P[2],.48,{k:2,ph:(i%7)/7,sp:1,rg:1});
      return B.finish({radius:4,cam:{target:[0,0,0],dist:5,yaw:0,pitch:0}});
    },(kit,build,backend,inputs)=>{
      const world=build(kit), view=backend(112,72,{raw:true,offscreen:true});
      const proto=WebGL2RenderingContext.prototype, draw=proto.drawArraysInstanced, counts=[];
      proto.drawArraysInstanced=function(...args){counts.push(args[3]);return draw.apply(this,args);};
      const order=Int32Array.from({length:world.count},(_,i)=>i);
      function render(time){
        view.draw(world,{order,time,jointPriority:inputs});
        return Math.max(...counts.splice(0));
      }
      try{return [render(.08),render(.1),render(.18)];}
      finally{proto.drawArraysInstanced=draw;}
    },packet);
    assert.equal(result[0],result[2]);
    assert(result[1]<result[0]-120,JSON.stringify(result));
  });

test('the Web Audio player selects the strike as a direct voice during the same window',
  {skip:!process.env.INK_TEST_CHROME,timeout:35000},async()=>{
    const {renderPreview}=require('../examples/pinned-binaural/preview.cjs');
    const run=W.runtime.create(world), mixer=W.spatialAudio.create(spatial);
    const frame=(time,events=[])=>mixer.frame({time,events,query:run.query(),listener:[0,0,0]});
    const frames=[frame(0)];
    run.advance(2);
    frames.push(frame(.053,run.events),frame(.092));
    run.advance(4);
    frames.push(frame(.105,run.events));
    const samples=await renderPreview(process.env.INK_TEST_CHROME,{rate,length:rate*.22,frames,
      panning:'equalpower',expectedStarts:3,
      sources:Object.fromEntries(Object.entries(assets).map(([id,row])=>[id,{samples:[...row.samples]}]))});
    const strike=Array.from(samples.subarray(Math.round(.107*rate)*2,Math.round(.12*rate)*2));
    assert(Math.max(...strike.map(Math.abs))>.14);
  });
