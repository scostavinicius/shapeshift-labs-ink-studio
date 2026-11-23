const test=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const WAV=require('../cli/wav.js');
const response={wet:.8,smoothing:0,rooms:{
  booth:{min:[-4,0,-3],max:[0,3,3],probes:[{at:[-2,1,0],impulse:'booth'}]},
  stairs:{min:[0,0,-3],max:[4,3,3],probes:[{at:[2,1,0],impulse:'stairs'}]}
},doorways:{opening:{from:'booth',to:'stairs',min:[-1,0,-.5],max:[1,2,.5],axis:'x'}}};
const near=(a,b,epsilon=1e-6)=>assert(Math.abs(a-b)<epsilon,`${a} differs from ${b}`);

test('probe weighting is exact at probes, continuous at door ends, and bounded to the doorway',()=>{
  const setup=structuredClone(response);
  setup.rooms.booth.probes.push({at:[-1,1,0],impulse:'threshold'});
  const api=W.roomResponse.compile(setup), sample=(x,z=0)=>api.sample([x,1,z]);
  assert.deepEqual(api.definition.assets,['booth','stairs','threshold']);
  assert.deepEqual(sample(-2).sends,[{asset:'booth',gain:.8}]);
  const mid=sample(-1.5).sends;
  near(mid[0].gain,.4); near(mid[1].gain,.4);
  assert.deepEqual(sample(-1).sends,[{asset:'threshold',gain:.8}]);
  const across=sample(0);
  assert.equal(across.doorway,'opening');
  near(across.sends.find(send=>send.asset==='stairs').gain,.4);
  near(across.sends.reduce((sum,send)=>sum+send.gain,0),.8);
  assert.deepEqual(sample(1).sends,[{asset:'stairs',gain:.8}]);
  assert.equal(sample(0,1).doorway,null);
  assert.deepEqual(sample(5).sends,[]);
  assert.throws(()=>W.roomResponse.compile({...setup,doorways:{opening:{...setup.doorways.opening,axis:'z'}}}),/room response doorway/i);
  const shared=structuredClone(setup);
  shared.rooms.booth.probes[1].impulse='booth';
  const send=W.roomResponse.compile(shared).sample([-1.5,1,0]).sends;
  assert.equal(send.length,1);
  near(send[0].gain,.8);
});

const rate=8000;
const sample=(at,values)=>{
  const channels=values.length, samples=new Float32Array((at+1)*channels);
  samples.set(values,at*channels);
  return {sampleRate:rate,channels,samples};
};
const source={hit:sample(0,[.5]),booth:sample(2400,[.6,.3]),stairs:sample(160,[.5])};
const byTime=[[1,-2],[3,0],[5,2]];
const world={dt:.05,entities:{ear:{position:[-2,1,0]}},commands:byTime.flatMap(([tick,x])=>[
  {tick,action:'world/patch',args:{edits:[{op:'set',path:'/entities/ear/position',value:[x,1,0]}]}},
  {tick,action:'world/event',args:{kind:'audio-cue',cue:'hit',at:[x,1,-1]}}
])};
const spatial={cues:{hit:{asset:'hit',bus:'foley',distance:{rolloff:0}},
  timelineHit:{asset:'hit',at:[-2,1,-1],distance:{rolloff:0}}}};
const open=(settings=response,resolveAsset=name=>source[name],extra={})=>ink.createSceneAudio({
  format:'ink-studio/scene-audio',version:1,sampleRate:rate,spatial:{...spatial,roomResponse:settings},
  listener:{entity:'ear'},...extra
},{kit,resolveAsset,runtime:()=>W.runtime.create(world)});
const interval=(start,end)=>({startPoint:T.read(start),endPoint:T.read(end)});
const probe=(audio,at,side=0)=>audio.samples[2*Math.round(at*rate)+side];

test('scene audio feeds both responses at the threshold and retains the old return in a cropped export',()=>{
  const scene=open(), full=scene.render(interval(0,.65),{trace:true}), wave=WAV.decode(full.waves.mix);
  const dry=WAV.decode(open(false).render(interval(0,.65)).waves.mix);
  const hit=probe(dry,.05);
  for(const time of [.05,.15,.25])near(probe(wave,time),probe(dry,time));
  near(probe(wave,.17),hit*.4*.5);
  near(probe(wave,.27),hit*.8*.5);
  near(probe(wave,.35),hit*.8*.6);
  near(probe(wave,.35,1),hit*.8*.3);
  near(probe(wave,.45),hit*.4*.6);
  near(probe(wave,.55),0);
  const crop=scene.render(interval(.30,.42));
  assert.deepEqual(WAV.decode(crop.waves.mix).samples,wave.samples.slice(.30*rate*2,.42*rate*2));
  assert.equal(crop.report.stems.spatial.voices,0);
  assert.equal(crop.report.stems.spatial.roomResponse.assets,1);
  assert.deepEqual(full.report.storyAudio.roomResponse.path.map(({room,doorway})=>room??doorway),['booth','opening','stairs']);
  const post=open(response,undefined,{post:{}}).render(interval(.30,.42));
  const effects=WAV.decode(post.waves.effects);
  near(probe(effects,.05),hit*.8*.6);
  assert.equal(post.report.stems.effects.voices,0);
  assert.equal(post.report.stems.effects.roomResponse.assets,2);
  assert.throws(()=>open(response,name=>name==='stairs'?sample(160,[.5,.5,.5]):source[name]).render(interval(0,.65)),/mono or stereo impulse/);
});


test('positioned timeline cues feed the room stem while their own stem stays dry',()=>{
  const timeline=K.timeline.compile({duration:.65,
    sequences:{beat:{duration:.5,audio:[{id:'strike',cue:'timelineHit',time:.1}]}},
    clips:[{id:'beat',sequence:'beat',time:0}]},{exact:true});
  const scene=open(), range=interval(0,.65);
  const full=scene.render(range,{timeline});
  const capture=scene.capture(range,{timeline,source:{kind:'stem',name:'timeline'}});
  near(probe(capture.value,.1),probe(WAV.decode(full.waves.timeline),.1));
  near(probe(capture.value,.4),0);
  assert(probe(WAV.decode(full.waves.spatial),.4)>.1);
});
