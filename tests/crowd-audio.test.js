const test=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const budget=require('../src/world-voice-budget.js');
const WAV=require('../cli/wav.js');
const {renderPreview}=require('../examples/pinned-binaural/preview.cjs');
const rate=48000, dt=.032;
const listener=[0,0,0], aggregation={groups:['crowd','debris'],sectors:2,grain:.125,gain:.85,bus:'foley'};
const policy={maxVoices:3,reservedVoices:0,stealFade:0,aggregation};
const low=id=>({id,group:'crowd',position:[1,0,0],mode:'cue',gain:.1,priority:-10});
const guard=id=>({id,mode:'cue',gain:.5,priority:90,protected:true});

test('overflow shares the ceiling and never replaces foreground winners',()=>{
  const config=budget.compile(policy);
  const small=budget.selectWithTextures([guard('g'),low('x')],config);
  assert.deepEqual([...small.selected],['g','x']);
  assert.equal(small.seats,0);
  const sounds=[guard('g'),...Array.from({length:6},(_,i)=>low('step'+i))];
  const large=budget.selectWithTextures(sounds,config);
  assert.deepEqual([...large.selected],['g']);
  assert.equal(large.seats,2);
  assert.equal(large.overflow.size,6);
  const incoming=budget.selectWithTextures([...sounds,guard('g2')],config,true);
  assert.equal(incoming.seats,0);
  assert(incoming.selected.has('g')&&incoming.selected.has('g2'));
  const previous=budget.selectWithTextures([guard('g'),...sounds.slice(1).map(row=>({...row,incumbent:true}))],config,true);
  assert.equal(previous.overflow.size,0,'already heard strikes should never be replayed as grains');
  assert.throws(()=>budget.compile({...policy,aggregation:{...aggregation,groups:['crowd','crowd']}}),/aggregation/);
});

const spatial={voiceBudget:policy,cues:{
  shoe:{asset:'shoe',group:'crowd',priority:-20,distance:{rolloff:0}},
  debris:{asset:'debris',group:'debris',priority:-30,distance:{rolloff:0}},
  signal:{asset:'signal',protected:true,priority:90,distance:{rolloff:0}}
}};
const event=(tick,cue,at,gain=1)=>({tick,action:'world/event',args:{kind:'audio-cue',cue,at,gain}});
const world={dt,commands:[event(2,'signal',[0,0,-1]),
  ...Array.from({length:7},(_,i)=>event(2,'shoe',[3+i*.1,0,0],.24)),
  ...Array.from({length:5},(_,i)=>event(2,'debris',[-3-i*.1,0,0],.19))]};
const sources=Object.fromEntries([['shoe',170],['debris',470],['signal',800]].map(([id,hz])=>[id,{
  sampleRate:rate,channels:1,samples:Float32Array.from({length:id==='signal'?rate/64:rate/8},(_,i)=>
    .13*Math.sin(2*Math.PI*hz*i/rate)*Math.exp(-i/(rate*.055)))
}]));
const sequence=(from,to)=>({startPoint:T.read(from),endPoint:T.read(to)});
const open=(config=spatial,manifest=world)=>ink.createSceneAudio({format:'ink-studio/scene-audio',version:1,
  sampleRate:rate,spatial:config,listener},{kit,resolveAsset:id=>sources[id],runtime:()=>W.runtime.create(manifest)});
function rms(samples,channel,begin,end){
  let sum=0;
  const a=Math.round(begin*rate), b=Math.round(end*rate);
  for(let i=a;i<b;i++)sum+=samples[i*2+channel]**2;
  return Math.sqrt(sum/(b-a));
}

test('offline overflow preserves both directions and the foreground under a three-voice cap',()=>{
  const scene=open(), range=sequence(0,.32), {waves,report}=scene.render(range,{trace:true});
  const samples=WAV.decode(waves.mix).samples;
  assert.equal(report.voiceBudget.aggregated,12);
  assert.equal(report.voiceBudget.peakVoices,3);
  assert.equal(report.voiceBudget.peakDirectVoices,1);
  assert.equal(report.voiceBudget.aggregationStreams,2);
  const aggregated=report.storyAudio.cues.filter(row=>row.voiceBudget?.action==='aggregated');
  assert.equal(aggregated.length,12);
  assert(aggregated.every(row=>row.playback.outcome==='played'&&Math.abs(row.playback.spatialSource.actualPosition[0])===2));
  assert(rms(samples,0,.10,.16)>.01&&rms(samples,1,.10,.16)>.01);
  assert(rms(samples,1,.1,.16)>rms(samples,0,.1,.16));
  const crop=scene.render(sequence(.105,.165));
  assert.deepEqual(WAV.decode(crop.waves.mix).samples,samples.slice(.105*rate*2,.165*rate*2));
  const {aggregation,...noTexture}=policy;
  const dry=open({...spatial,voiceBudget:noTexture}).render(range);
  const original=WAV.decode(dry.waves.mix).samples;
  assert.equal(rms(original,0,.10,.16),0);
  const isolated=scene.capture(range,{source:{kind:'world',by:'cue',name:'signal'}}).value;
  const baseline=open({cues:{signal:spatial.cues.signal}},{dt,commands:[world.commands[0]]}).render(range);
  const alone=WAV.decode(baseline.waves.mix).samples;
  assert(Math.max(...isolated.samples.map((n,i)=>Math.abs(n-alone[i])))<1e-7);
});

test('Chrome emits overflow through worklet sectors without starting each rejected voice',
  {skip:!process.env.INK_TEST_CHROME,timeout:35000},async()=>{
  const later=world.commands.map(command=>({...command,tick:5}));
  const run=W.runtime.create({...world,commands:[...world.commands,...later]}), mixer=W.spatialAudio.create(spatial);
  const frames=[mixer.frame({query:run.query(),listener,time:0})];
  for(const tick of [2,5]){
    run.advance(tick);
    frames.push(mixer.frame({query:run.query(),listener,time:(Math.round(tick*dt*rate)+.25)/rate,events:run.events}));
  }
  const sample=.38*rate;
  const samples=await renderPreview(process.env.INK_TEST_CHROME,{rate,length:sample,frames,panning:'equalpower',expectedStarts:2,
    sources:Object.fromEntries(Object.entries(sources).map(([name,row])=>[name,{samples:[...row.samples]}]))});
  const left=rms(samples,0,.14,.20), right=rms(samples,1,.14,.20);
  assert(left>.012&&right>.02, JSON.stringify({left,right,first: samples.findIndex((n,i)=>i%2===0&&Math.abs(n)>.00001)/2/rate,
    last: samples.findLastIndex(n=>Math.abs(n)>.00001)/2/rate}));
  assert(right>left);
  assert(rms(samples,0,.27,.32)>.01&&rms(samples,1,.27,.32)>.02,
    'later grains should reach the existing worklet sectors');
});
