const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ink=require('../..'),kit=ink.load(),{KIT:K}=kit;
const WAV=require('../../cli/wav.js');
const {write,json}=require('../../cli/asset-files.js');
const out=process.argv[2];
if(!out)throw Error('Use node examples/early-reflections/demo.cjs <output directory>');

const sampleRate=48000, T=K.procedural.takeTime;
const source=[2.05,1.1,-1.8];
const listener={at:[2.65,1.68,1.45],forward:[0,0,-1],up:[0,1,0]};
const bounds={min:[0,0,-4.8],max:[7.2,4.7,4.8]};
const labels={floor:'Concrete floor',west:'Side wall',ceiling:'Timber ceiling'};
const materials={
  concrete:{gain:.71,cutoff:6700},
  brick:{gain:.94,cutoff:4100},
  timber:{gain:.76,cutoff:2900}
};
const definitions=[
  {id:'dry',label:'Dry strike',faces:{}},
  {id:'open',label:'Open floor',faces:{floor:'concrete'}},
  {id:'wall',label:'Beside a wall',faces:{floor:'concrete',west:'brick'}},
  {id:'bay',label:'Covered bay',faces:{floor:'concrete',west:'brick',ceiling:'timber'}}
];
const tone=K.procedural.mediaGraph.synthesizeGesture({model:'metal',seed:52,duration:.17,sampleRate,
  parameters:{body:370,hardness:.84,decay:.085,strike:.44}}).value;
const strikeTimes=[.10,.40];
const definition={id:'loading-bay',dt:.05,commands:strikeTimes.map((time,i)=>({
  tick:i?8:2,action:'world/event',args:K.world.timedEvents.at(time,{kind:'audio-cue',cue:'strike',at:source})
}))};
const sequence={startPoint:T.read(0),endPoint:T.read(.67)};
const options=faces=>{
  const all=Object.fromEntries(['west','east','north','south','floor','ceiling'].map(id=>[id,faces[id]??false]));
  return {room:{...bounds,faces:all},materials,gain:.94,order:2,maxTaps:6,maxDelay:.065};
};
const embedAudio=bytes=>'data:audio/wav;base64,'+bytes.toString('base64');
const waves={}, clips={}, cases=[];
let dry;
for(const {id,label,faces} of definitions){
  const spatial={cues:{strike:{asset:'mallet',gain:.86,bus:'foley',distance:{reference:2.4,max:30,fade:0}}},
    earlyReflections:options(faces)};
  const engine=ink.createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate,spatial,listener},
    {kit,resolveAsset:()=>tone,runtime:()=>K.world.runtime.create(definition)});
  const {waves:rendered,report}=engine.render(sequence,{trace:true});
  const [shot,second]=report.storyAudio.cues;
  assert.equal(shot.arrivalSample,Math.round(strikeTimes[0]*sampleRate));
  assert.equal(second.arrivalSample,Math.round(strikeTimes[1]*sampleRate));
  assert.equal(report.headroom,1,'keep identical gain across audition clips');
  const audio=WAV.decode(rendered.mix);
  if(id==='dry')dry=audio.samples;
  const samps=audio.samples, at=shot.arrivalSample, duration=.065, bins=320;
  const peaks=Array.from({length:bins},(_,i)=>{
    const first=at+Math.floor(sampleRate*duration*i/bins);
    const last=at+Math.floor(sampleRate*duration*(i+1)/bins);
    let dryPeak=0, echoPeak=0;
    for(let n=2*first;n<2*last;n++){
      dryPeak=Math.max(dryPeak,Math.abs(dry[n]));
      echoPeak=Math.max(echoPeak,Math.abs(samps[n]-dry[n]));
    }
    return [dryPeak,echoPeak].map(n=>Number(n.toFixed(5)));
  });
  const taps=shot.reflections??[];
  cases.push({id,label,faces,peaks,duration,directGain:shot.gain,taps,recipe:spatial.earlyReflections});
  waves[id]=rendered.mix;
  clips[id]=embedAudio(rendered.mix);
  write(path.join(out,id+'.wav'),rendered.mix);
}
assert.equal(cases[0].taps.length,0);
assert.deepEqual(cases[1].taps.map(tap=>tap.surfaces),[['floor']]);
assert(cases[2].taps.some(tap=>tap.surfaces.join(',')==='west'));
assert(cases[3].taps.some(tap=>tap.surfaces.join(',')==='ceiling'));
assert(cases[3].taps.some(tap=>tap.surfaces.length===2));
for(const row of cases)assert.equal(row.directGain,cases[0].directGain);

const sequenceAudio=['open','wall','open','wall','bay'].map(id=>WAV.decode(waves[id]).samples);
const gap=sampleRate*.20*2, total=sequenceAudio.reduce((n,a)=>n+a.length,0)+gap*(sequenceAudio.length-1);
const comparison=new Float32Array(total);
let cursor=0;
for(const samples of sequenceAudio){
  comparison.set(samples,cursor);
  cursor+=samples.length+gap;
}
const mixed=WAV.encode({samples:comparison,channels:2,sampleRate},{encoding:'pcm24'});
clips.compare=embedAudio(mixed);
write(path.join(out,'comparison.wav'),mixed);
write(path.join(out,'dry-strike-mono.wav'),WAV.encode(tone,{encoding:'pcm24'}));
const report={title:'The Loading Bay',sampleRate,source,listener,bounds,labels,cases,
  sequence:['open','wall','open','wall','bay'],sequenceStep:(sequenceAudio[0].length+gap)/(sampleRate*2)};
json(path.join(out,'reflection-paths.json'),report);
const template=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
write(path.join(out,'index.html'),template.replace('/*EARLY_REFLECTION_DATA*/',()=>JSON.stringify({report,clips}).replaceAll('<','\\u003c')));
console.log(cases.map(({label,taps})=>({label,taps:taps.map(tap=>[tap.surfaces,1000*tap.delay,tap.gain])})));
