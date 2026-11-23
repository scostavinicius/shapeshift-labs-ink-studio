/* Run: node examples/music-production/delivery-workshop.cjs dialogue.wav output-directory */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),T=kit.KIT.procedural.takeTime;
const WAV=require('../../cli/wav'),{write,json}=require('../../cli/asset-files');
const [voiceFile,folder]=process.argv.slice(2);
if (!voiceFile || !folder) throw new Error('Provide a spoken WAV and an output directory');
const at=name=>path.resolve(folder,name), fsRate=48000,duration=6,fps=30,tau=Math.PI*2;
const sample=seconds=>Math.round(seconds*fsRate);
function render(seconds,channels,signal) {
  const n=sample(seconds);
  return {sampleRate:fsRate,channels,samples:Float64Array.from({length:n*channels},(_,i)=>
    signal(Math.floor(i/channels)/fsRate,i%channels,Math.floor(i/channels)))};
}
const save=(file,audio)=>write(at(file),WAV.encode(audio,{encoding:'pcm24'}));
const studioVoice=ink.readWav(voiceFile);
const maxVoice=studioVoice.samples.reduce((n,x)=>Math.max(Math.abs(x),n),1e-6);
assert(studioVoice.samples.length>0,'Use a nonempty spoken WAV');
save('voice.wav',{...studioVoice,samples:Float64Array.from(studioVoice.samples,x=>x*.48/maxVoice)});
const steel=ink.readWav(path.join(__dirname,'samples','metal-alt.wav'));
const noise=i=>{
  const x=Math.imul(i^28471,0x9e3779b1);
  return ((x^(x>>>15))>>>0)/2147483648-1;
};
const tail=(seconds,hz,decay,gain)=>gain*Math.cos(tau*hz*seconds)*Math.exp(-seconds*decay);
save('latch.wav',render(.52,1,t=>.26*(steel.samples[Math.round(t*steel.sampleRate)] ?? 0)+
  tail(t,164,20,.25)+tail(t,414,45,.075)+tail(t,721,73,.095)));
save('beacon.wav',render(.49,1,t=>tail(t,538,15,.29)+tail(t,807,22,.073)+tail(t,1171,31,.055)));
save('boot.wav',render(.34,1,(t,c,i)=>tail(t,112,52,.28)+tail(t,284,58,.10)+
  noise(i)*Math.exp(-t*48)*.044));
save('vent.wav',render(duration,2,(t,c,i)=>{
  const shade=(.3+.7*Math.sin(tau*.75*t+c*.45)**2)*.008;
  return Math.min(1,t*8,(duration-t)*8)*(.021*Math.sin(tau*(42+c*.45)*t)+
    shade*(noise(i+c*717)+noise(i-1+c*717))+.014*Math.sin(tau*83*t+c*.2));
}));
save('score.wav',render(duration,2,(t,c)=>{
  const swell=Math.min(1,t*6,(duration-t)*4);
  const rhythm=(t+.11)%.6;
  const base=.034*Math.sin(tau*49*t+.30*Math.sin(tau*.11*t))+
    .013*Math.sin(tau*(97.99+c*.30)*t)+.012*Math.sin(tau*146.83*t+.18*Math.sin(tau*.45*t));
  const wire=(.6+.4*Math.sin(tau*.31*t+c*.6))*(.039*Math.sin(tau*(804+c*.85)*t+.25*Math.sin(tau*2.6*t))+
    .019*Math.sin(tau*2065*t+.4*Math.sin(tau*3.15*t)));
  const note=Math.floor((t+.11)/.6)%4;
  const shimmer=Math.sin(tau*[587.33,659.25,783.99,440][note]*rhythm+c*.2)*
    Math.min(1,rhythm*24)*Math.exp(-rhythm*5.4)*.027;
  return swell*(base+wire+shimmer);
}));

const sounds=[{id:'gate-contact',cue:'latch',time:3.22},{id:'transit-beacon',cue:'beacon',time:4.51},
  {id:'downstream-lock',cue:'latch',time:5.23}];
json(at('world.json'),{format:'ink-studio/world',id:'inner-gate',dt:1/120,timeline:{duration,audio:sounds}});
json(at('take.json'),{format:'ink-studio/take',version:1,world:'world.json',audio:'soundtrack.json',
  clock:{fps,simulationRate:120,sampleRate:fsRate}});
const soundtrack={format:'ink-studio/scene-audio',version:1,sampleRate:fsRate,
  assets:{voice:'voice.wav',latch:'latch.wav',beacon:'beacon.wav',boot:'boot.wav',vent:'vent.wav',score:'score.wav'},
  tracks:[{asset:'voice',time:.82,bus:'dialogue',gain:.57},{asset:'boot',time:2.83,bus:'foley',gain:.84},
    {asset:'boot',time:3.41,bus:'foley',gain:.75},{asset:'vent',bus:'ambience'},{asset:'score',bus:'music'}],
  post:{strips:{
    dialogue:{inserts:['radio'],sends:{room:{level:.19}}},
    music:{inserts:[{processor:'space',sidechain:{strip:'dialogue',tap:'pre'}}]},
    effects:{sends:{room:{level:.53}},pan:.14},foley:{sends:{room:{level:.16}},pan:-.20},
    room:{inserts:['verb'],fader:.64},master:{inserts:['glue','finish']}
  },processors:{
    radio:{type:'highpass',hz:150},
    space:{type:'band-duck',hz:1830,q:1.0,keyHz:980,thresholdDb:-42,ratio:6,rangeDb:7},
    verb:{type:'reverb',size:.72,decay:1.26,damping:.43,wet:1},
    glue:{type:'compressor',thresholdDb:-24,ratio:2.35,lookahead:.007,attack:.014,release:.12,wet:.85},
    finish:{type:'saturation',driveDb:2.1,bias:.13,toneHz:9700,outputDb:-1,wet:.37}
  }}
};
const from=.4, to=duration, native=require('../../cli/scene-export-world.js').readExportWorld(at('take.json'),kit);
json(at('soundtrack.json'),soundtrack);
const {value:samplePrint}=ink.readSceneAudio(at('soundtrack.json'),{kit}).capture({startPoint:T.read(from),endPoint:T.read(to)},
  {source:{kind:'stem',name:'mix'},runtime:native.runtime});
const prelim=kit.KIT.procedural.mediaGraph.mixerMonitor.meter(samplePrint);
assert(prelim.integratedLufs!==null);
soundtrack.post.strips.master.fader=10**((-23-prelim.integratedLufs)/20);
json(at('soundtrack.json'),soundtrack);
const settings={id:'inner-gate',title:'Inner Gate',from:{frame:12},profile:'ebu-r128',
  bwf:{timeReference:172800000,originator:'Ink Studio'},
  cues:[{id:'voice-window',label:'Pressure hold / dialogue',at:{frame:25},until:{frame:82},role:'dialogue'},
    {id:'wide-shot',label:'Cut to inside gate',at:{frame:87}}],
  loops:[{id:'hold',label:'Gate hold',from:{frame:87},to:{frame:141}}]};
json(at('recipe.json'),{take:'take.json',delivery:settings});
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const result=JSON.parse(execFileSync(process.execPath,[cli,'music','deliver',at('recipe.json'),'--strict','--out',at('package')],
  {encoding:'utf8'}));
const manifest=JSON.parse(fs.readFileSync(result.manifest,'utf8')), quality=JSON.parse(fs.readFileSync(result.quality,'utf8'));
assert.equal(manifest.timeReference,'172819200');
assert.equal(quality.passed,true);
assert.equal(manifest.loops[0].bodyFrames,86400);
assert(manifest.loops[0].tailFrames>fsRate);
const published=name=>WAV.read(at('package/'+name),{metadata:true});
const ref=published(manifest.premaster), stems=Object.values(manifest.stems).map(published);
assert(stems.every(stem=>stem.bwf.timeReference===ref.bwf.timeReference && stem.samples.length===ref.samples.length));
for (let i=0;i<ref.samples.length;i++) assert.equal(stems.reduce((total,stem)=>total+stem.samples[i],0),ref.samples[i]);
assert.notDeepEqual(published(manifest.master).samples,ref.samples);
const loop=manifest.loops[0];
json(at('demo.json'),{from,to,fps,sounds,manifest,quality,body:loop.bodyFrames/fsRate,tail:loop.tailFrames/fsRate});
console.log(JSON.stringify({manifest:result.manifest,quality:quality.files[manifest.master],tail:loop.tailFrames/fsRate}));
