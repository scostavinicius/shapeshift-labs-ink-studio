const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const ink=require('..'), capture=ink.roomImpulseCapture;
const {stairwell}=require('../examples/room-impulse-capture/fixture.js');
const {load,save}=require('../cli/room-impulse-capture.js');
const WAV=require('../cli/wav.js');
const {json,write}=require('../cli/asset-files.js');
const rate=8000, fixture=stairwell(capture,{sampleRate:rate});
const {room,loopback,expected,sweep}=fixture;
const measurement=capture.measure(room,{sweep:sweep.settings,loopback});
const near=(a,b,by=1e-6)=>assert(Math.abs(a-b)<=by,`${a} differs from ${b}`);
const peak=(pcm,a,b,ch=0)=>{
  let max=0;
  for(let i=a;i<b;i++)max=Math.max(max,Math.abs(pcm.samples[i*pcm.channels+ch]??0));
  return max;
};

test('sine sweep removes electrical delay and keeps acoustic arrival, stereo taps and level',()=>{
  const {report,response,edit}=measurement;
  assert.equal(report.latencySamples,expected.latency);
  assert.equal(report.directSample,expected.arrival);
  assert.equal(report.calibration,'loopback');
  assert.equal(report.scale,1);
  assert.equal(response.channels,2);
  const known=capture.measure(room,{sweep:sweep.settings,latencySamples:expected.latency});
  assert.deepEqual(known.response,response);
  const {early,tail,wet}=capture.split(response,edit);
  for(let n=0;n<wet.samples.length;n++)near((early.samples[n]??0)+tail.samples[n],wet.samples[n],3e-8);
  assert.equal(peak(wet,0,expected.arrival+1),0);
  const firstReflection=expected.arrival+Math.round(.017*rate);
  assert(peak(early,firstReflection-1,firstReflection+2,0)>.26);
  assert(peak(early,firstReflection-1,firstReflection+2,1)<.1);
  const later=expected.arrival+Math.round(.084*rate);
  assert.equal(peak(early,later-1,later+2),0);
  assert(peak(tail,later-1,later+2,1)>.13);
  const moved=capture.split(response,{...edit,splitMs:90});
  assert(peak(moved.early,later-1,later+2,1)>.12);
  assert.equal(peak(moved.tail,later-1,later+2),0);
  assert.deepEqual(moved.wet,wet);
});

test('capture validates source calibration, clipping, recording length and edit bounds',()=>{
  const opts={sweep:sweep.settings,loopback};
  assert.throws(()=>capture.measure(room,{sweep:sweep.settings}),/loopback.*latency/);
  assert.throws(()=>capture.measure(room,{...opts,latencySamples:1}),/loopback.*latency/);
  assert.throws(()=>capture.measure(room,{...opts,maxLatencyMs:10}),/No clear loopback/);
  assert.throws(()=>capture.measure({...room,samples:room.samples.subarray(0,rate*2) },opts),/missing the sweep/);
  const bad={...loopback,samples:loopback.samples.slice()};
  bad.samples[0]=1;
  assert.throws(()=>capture.measure(room,{...opts,loopback:bad}),/clipped/);
  assert.throws(()=>capture.split(measurement.response,{...measurement.edit,splitMs:6,crossfadeMs:20}),/crossfade/);
});

test('scene consumes an editable capture and separate room probe levels',t=>{
  const folder=mkdtempSync(path.join(os.tmpdir(),'ink-room-ir-'));
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const {response,edit}=measurement, assets={strike:'strike.wav',
    reflections:{roomImpulse:'room-impulse.json',layer:'early'},
    reverb:{roomImpulse:'room-impulse.json',layer:'tail'}};
  const file=path.join(folder,'room-impulse.json'), manifest=save(folder,measurement);
  assert.deepEqual(load(file).response.samples,Float64Array.from(response.samples));
  write(path.join(folder,'strike.wav'),WAV.encode({sampleRate:rate,channels:1,samples:[.5]},{encoding:'float32'}));
  json(path.join(folder,'world.json'),{dt:.05,commands:[
    {tick:1,action:'world/event',args:{kind:'audio-cue',cue:'strike',at:[0,1,-1]}}
  ]});
  const soundtrack=path.join(folder,'soundtrack.json'), probe={at:[0,1,0],impulse:{early:'reflections',tail:'reverb'}};
  const kit=ink.load(), T=kit.KIT.procedural.takeTime;
  const interval={startPoint:T.read(0),endPoint:T.read(.4)};
  function print(earlyGain=1,tailGain=1){
    const {world}=kit.KIT, roomResponse={wet:1,smoothing:0,
      rooms:{room:{min:[-1,0,-2],max:[1,2,1],probes:[{...probe,impulse:{...probe.impulse,earlyGain,tailGain}}]}}};
    assert.equal(world.roomResponse.compile(roomResponse).definition.assets.length,2);
    json(soundtrack,{format:'ink-studio/scene-audio',version:1,world:'world.json',assets,
      sampleRate:rate,listener:probe.at,spatial:{cues:{strike:{asset:'strike',distance:{rolloff:0}}},roomResponse}});
    const files=[];
    const {waves}=ink.readSceneAudio(soundtrack,{kit,onFile:file=>files.push(path.basename(file))}).render(interval);
    assert(files.includes('room-impulse.json')&&files.includes('response.wav'));
    return WAV.decode(waves.mix);
  }
  const full=print(), early=print(1,0), late=print(0,1);
  const start=Math.round(.05*rate), reflection=start+expected.arrival+Math.round(.017*rate),
    tail=start+expected.arrival+Math.round(.084*rate);
  assert(peak(full,reflection-1,reflection+2)>.08);
  assert.equal(peak(late,reflection-1,reflection+2),0);
  assert(peak(full,tail-1,tail+2,1)>.04);
  assert.equal(peak(early,tail-1,tail+2),0);
  json(file,{...manifest,edit:{...edit,splitMs:90},probeMix:{earlyGain:.4,tailGain:.2}});
  const changed=print(1,0), split=load(file);
  assert(peak(changed,tail-1,tail+2,1)>.016);
  near(peak(changed,reflection-1,reflection+2),.4*peak(full,reflection-1,reflection+2),1e-6);
  assert.equal(peak(split.tail,expected.arrival,expected.arrival+Math.round(.084*rate)+1),0);
});
