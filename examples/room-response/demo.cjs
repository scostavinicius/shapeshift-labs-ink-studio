const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ink=require('../..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const WAV=require('../../cli/wav.js');
const {write,json}=require('../../cli/asset-files.js');
const out=process.argv[2];
if(!out)throw Error('Use node examples/room-response/demo.cjs <output directory>');

const sampleRate=32000, dt=.025, duration=7;
const impulseNames=['vault-center','vault-door','booth-center','booth-door'];
const labels=['Vault center','Vault threshold','Booth center','Booth threshold'];
const roomResponse={wet:.82,smoothing:.042,rooms:{
  vault:{min:[-5,0,-3],max:[0,4,3],probes:[{at:[-3.1,1.6,0],impulse:impulseNames[0]},{at:[-1,1.6,0],impulse:impulseNames[1]}]},
  booth:{min:[0,0,-2],max:[5,3,2],probes:[{at:[2.8,1.6,0],impulse:impulseNames[2]},{at:[1,1.6,0],impulse:impulseNames[3]}]}
},doorways:{passage:{from:'vault',to:'booth',axis:'x',min:[-1,0,-.65],max:[1,2.4,.65]}}};

// A repeatable wet-only stereo bake for each location. Keep tap levels on the same scale.
function bake({seed,seconds,decay,taps,damping,diffuse}){
  const samples=new Float32Array(Math.ceil(seconds*sampleRate)*2);
  const low=[0,0];
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
  for(let i=0;i<samples.length/2;i++){
    const t=i/sampleRate, envelope=Math.min(1,t/.09)**2*Math.exp(-6.9*t/decay)*Math.min(1,(seconds-t)/.11);
    for(let channel=0;channel<2;channel++){
      const noise=random();
      low[channel]+=damping*(noise-low[channel]);
      samples[2*i+channel]=low[channel]*envelope*diffuse;
    }
  }
  for(const [ms,left,right] of taps){
    const at=Math.round(ms*sampleRate/1000);
    samples[at*2]+=left;
    samples[(at+Math.round(sampleRate*.0015))*2+1]+=right;
  }
  return {samples,sampleRate,channels:2};
}
const tones=[
  {seed:123,seconds:3.15,decay:4.1,diffuse:.16,damping:.29,taps:[[31,.21,.14],[81,.10,-.16],[146,-.12,.09],[233,.08,.13],[346,-.06,.07]]},
  {seed:276,seconds:2.8,decay:3.7,diffuse:.15,damping:.37,taps:[[22,.16,.22],[68,-.14,.12],[128,.11,.07],[196,.09,-.10],[312,.035,.06]]},
  {seed:332,seconds:.52,decay:.46,diffuse:.15,damping:.57,taps:[[11,.105,.09],[22,-.065,.043],[53,.03,-.025]]},
  {seed:408,seconds:.72,decay:.64,diffuse:.17,damping:.42,taps:[[16,.11,.15],[28,.08,-.075],[62,-.04,.035],[91,.022,.028]]}
];
const mallet=K.procedural.mediaGraph.synthesizeGesture({model:'metal',seed:52,duration:.18,sampleRate,
  parameters:{body:348,hardness:.83,decay:.085,strike:.49}}).value;
const audio=Object.fromEntries(impulseNames.map((name,i)=>[name,bake(tones[i])]));
audio.strike=mallet;
const assets=Object.fromEntries(Object.entries(audio).map(([name,pcm])=>{
  const file=name+'.wav';
  const bytes=WAV.encode(pcm,{encoding:'pcm24'});
  write(path.join(out,file),bytes);
  audio[name]=WAV.decode(bytes);
  return [name,file];
}));
const travel={start:1.25,end:3.70,from:-3.35,to:2.9};
function listenerX(t){
  const u=Math.max(0,Math.min(1,(t-travel.start)/(travel.end-travel.start)));
  return travel.from+(travel.to-travel.from)*u*u*(3-2*u);
}
const strikes=[.45,1.98,4.07,4.62,5.48];
const after=3.05, before=4.02;
const commands=[];
for(let tick=1;tick<=Math.round(travel.end/dt);tick++){
  const x=listenerX(tick*dt);
  if(x!==travel.from)commands.push({tick,action:'world/patch',args:{edits:[{op:'set',path:'/entities/ear/position',value:[x,1.6,0]}]}});
}
for(const time of strikes){
  const tick=Math.ceil(time/dt-1e-9);
  commands.push({tick,action:'world/event',args:W.timedEvents.at(time,{kind:'audio-cue',cue:'strike',at:[listenerX(tick*dt)+.38,1.6,-1.3]})});
}
commands.sort((a,b)=>a.tick-b.tick);
const world={id:'service-passage',dt,entities:{ear:{position:[travel.from,1.6,0]}},commands};
const scene={format:'ink-studio/scene-audio',version:1,sampleRate,
  listener:{entity:'ear'},spatial:{cues:{strike:{asset:'strike',bus:'foley',gain:.77,distance:{rolloff:0}}},roomResponse}};
json(path.join(out,'world.json'),world);
json(path.join(out,'soundtrack.json'),{...scene,world:'world.json',assets});
const sequence={startPoint:T.read(0),endPoint:T.read(duration)};
const wet=ink.readSceneAudio(path.join(out,'soundtrack.json'),{kit}).render(sequence,{trace:true});
function rerender(response,impulses=audio){
  return ink.createSceneAudio({...scene,spatial:{...scene.spatial,roomResponse:response}},
    {kit,resolveAsset:name=>impulses[name],runtime:()=>W.runtime.create(world)}).render(sequence);
}
const dry=rerender(false);
const vault=rerender(roomResponse,{...audio,...Object.fromEntries(impulseNames.slice(2).map(id=>
  [id,{sampleRate,channels:1,samples:new Float32Array(1)}]))});
for(const render of [wet,dry,vault])assert.equal(render.report.headroom,1);
const [crossing,clean,old]=[wet,dry,vault].map(render=>WAV.decode(render.waves.mix).samples);
const bins=550, peaks=Array.from({length:bins},(_,i)=>{
  let original=0, wet=0, vault=0;
  for(let j=Math.floor(i*crossing.length/bins);j<Math.floor((i+1)*crossing.length/bins);j++){
    original=Math.max(original,Math.abs(clean[j]));
    wet=Math.max(wet,Math.abs(crossing[j]-clean[j]));
    vault=Math.max(vault,Math.abs(old[j]-clean[j]));
  }
  return [original,wet,vault].map(n=>+n.toFixed(5));
});
let energy=0;
for(let i=2*Math.round(after*sampleRate);i<2*Math.round(before*sampleRate);i++){
  assert.equal(clean[i],0,'no dry strike after the doorway');
  energy+=old[i]**2;
}
const carriedDb=20*Math.log10(Math.sqrt(energy/(2*(before-after)*sampleRate)));
assert(carriedDb>-52,'the tail should remain easy to hear after the crossing');
const pathRows=wet.report.storyAudio.roomResponse.path;
const lastDoor=pathRows.findLast(row=>row.doorway);
assert(lastDoor.sample/sampleRate<after,'the tail window starts after the listener leaves the door');
const trace={sampleRate,duration,strikes,travel,roomResponse,labels,impulseNames,tailWindow:[after,before],carriedDb,path:pathRows,peaks};
json(path.join(out,'trace.json'),trace);
const wav16=samples=>WAV.encode({samples,channels:2,sampleRate},{encoding:'pcm16'});
const wetBytes=wav16(crossing), dryBytes=wav16(clean);
write(path.join(out,'doorway-walk.wav'),wetBytes);
write(path.join(out,'dry-reference.wav'),dryBytes);
const clip=bytes=>'data:audio/wav;base64,'+bytes.toString('base64');
const template=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
write(path.join(out,'index.html'),template.replace('/*INK_ROOM_RESPONSE_DEMO*/',()=>JSON.stringify({trace,wet:clip(wetBytes),dry:clip(dryBytes)}).replaceAll('<','\\u003c')));
console.log('Old room alone after the doorway: '+carriedDb.toFixed(1)+' dBFS RMS.');
