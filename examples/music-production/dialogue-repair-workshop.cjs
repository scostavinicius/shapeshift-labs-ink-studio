/* Run: node examples/music-production/dialogue-repair-workshop.cjs first.wav second.wav output-directory */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),T=kit.KIT.procedural.takeTime;
const WAV=require('../../cli/wav'),{write,json}=require('../../cli/asset-files');
const [a,b,folder]=process.argv.slice(2);
if (!a || !b || !folder) throw new Error('Provide two spoken WAV files and an output directory');
const voices=[a,b].map(name=>ink.readWav(name)), rate=voices[0].sampleRate;
assert(voices.every(sound=>sound.sampleRate===rate && sound.samples.length>0),'Use two recordings at the same sample rate');
const out=name=>path.resolve(folder,name);
const fps=30,tau=Math.PI*2, frame=t=>Math.round(t*rate);
const save=(name,channels,samples)=>write(out(name),WAV.encode({sampleRate:rate,channels,samples},{encoding:'pcm24'}));
const start=[frame(.65),0];
start[1]=start[0]+voices[0].samples.length/voices[0].channels+frame(.44);
const end=start[1]+voices[1].samples.length/voices[1].channels;
const pictureFrames=Math.ceil((end/rate+.78)*fps/3)*3, duration=pictureFrames/fps, frames=frame(duration);
const speech=new Float64Array(frames);
function peak(voice) {
  return voice.samples.reduce((highest,x)=>Math.max(highest,Math.abs(x)),1e-6);
}
for (const [phrase,{channels,samples}] of voices.entries()) {
  const length=samples.length/channels, gain=[.42,.245][phrase]/peak(voices[phrase]);
  let low=0;
  const pole=-Math.expm1(-tau*Math.min(4250,rate*.32)/rate);
  for (let i=0;i<length;i++) {
    let mono=0;
    for (let ch=0;ch<channels;ch++) mono+=samples[i*channels+ch]/channels;
    low+=(mono-low)*pole;
    speech[start[phrase]+i]=(mono+(mono-low)*.85)*gain;
  }
}
const pulse=[frame(.46),start[1]-frame(.22)];
const feedback={fromSample:start[0]+frame(.20),toSample:start[0]+frame(.59)};
assert(feedback.toSample<pulse[1],'Use a first spoken clip at least about one second long');
const feedbackHz=Math.min(2880,rate*.30);
const dirty=Float64Array.from(speech,(x,i)=>{
  const t=i/rate, whistle=(i-feedback.fromSample)/(feedback.toSample-feedback.fromSample);
  const bump=whistle>0 && whistle<1 ? Math.min(1,whistle*13,(1-whistle)*12) : 0;
  const ring=.115*Math.sin(tau*feedbackHz*t+.9*Math.sin(tau*2.2*t))*bump;
  const hum=.056*Math.sin(tau*60*t+.46)+.023*Math.cos(tau*120*t+1.1);
  const click=i===pulse[0] ? .81 : i>=pulse[1] && i<pulse[1]+3 ? [.76,-.48,.28][i-pulse[1]] : 0;
  return x+hum+ring+click;
});
save('dirty.wav',1,dirty);
const repair={
  gainDb:{unit:'samples',points:[{at:0,value:0},{at:start[1]-frame(.09),value:0},
    {at:start[1]-frame(.015),value:4.7}]},
  declick:{auto:true,ranges:[{fromSample:pulse[1],toSample:pulse[1]+3}]},
  hum:{harmonics:2,reference:{fromSample:frame(.055),toSample:frame(.395)}},
  spectral:[{...feedback,lowHz:feedbackHz-190,highHz:feedbackHz+190,size:1024,
    featherHz:55,amountDb:35,fadeSamples:frame(.008),mode:'interpolate'}],
  deess:{hz:Math.min(5900,rate*.37),q:1.15,thresholdDb:-34,ratio:6,rangeDb:6,release:.065}
};
json(out('repair.json'),repair);
const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
  'music',...args],{encoding:'utf8'}));
const compared=cli('repair',out('dirty.wav'),out('repair.json'),'--out',out('repair'));
const report=JSON.parse(fs.readFileSync(compared.report,'utf8'));
assert.equal(report.steps.hum.frequency,60);
assert(report.steps.declick.regions.some(row=>row.fromSample===pulse[0]));
assert(report.steps.declick.regions.some(row=>row.fromSample===pulse[1]));
assert(report.steps.deess.removedRms>1e-4);

json(out('repair-graph.json'),{format:'ink-studio/graph-project',version:1,
  assets:{original:{format:'wav',file:'dirty.wav'}},nodes:{
    original:{op:'audioAsset',inputs:{name:'original'}},
    repair:{op:'audio.repairDialogue',inputs:{source:{node:'original'},options:repair}}
  },outputs:{dialogue:{node:'repair'},removed:{node:'repair',port:'removed'}}});
const bed=new Float64Array(frames*2);
for (let i=0;i<frames;i++) {
  const t=i/rate, fade=Math.min(1,t*9,(duration-t)*8);
  const bow=.064*Math.sin(tau*58.27*t+.32*Math.sin(tau*.43*t))+.032*Math.sin(tau*87.31*t)+
    .024*Math.sin(tau*174.61*t)*( .56+.44*Math.sin(tau*.73*t));
  const middle=(.68+.32*Math.sin(tau*.54*t))*(.079*Math.sin(tau*1940*t+.45*Math.sin(tau*5.4*t))+
    .063*Math.sin(tau*2230*t+.62*Math.sin(tau*4.7*t))+.066*Math.sin(tau*2510*t+.79*Math.sin(tau*2.8*t)));
  const strike=(t+.13)%.41, alternation=Math.floor((t+.13)/.41)%4;
  const highs=(.013*Math.sin(tau*(5090+90*alternation)*strike)+
    .011*Math.sin(tau*(6220+140*alternation)*strike))*Math.exp(-strike*39)*Math.min(1,strike*850);
  for (let c=0;c<2;c++) {
    const color=.016*Math.sin(tau*(669+c*.9)*t+.24*Math.sin(tau*1.1*t));
    bed[2*i+c]=fade*(bow+middle+highs+color);
  }
}
save('bed.wav',2,bed);
const settings={type:'band-duck',hz:2200,q:1.15,keyHz:1100,keyQ:.63,thresholdDb:-43,
  ratio:8,attack:.006,release:.145,rangeDb:{unit:'seconds',points:[{at:0,value:0},
    {at:start[0]/rate-.075,value:10},{at:end/rate,value:10},{at:end/rate+.48,value:0}]}};
const t0=T.read(0),t1=T.div(T.read(pictureFrames),T.read(fps));
for (const name of ['full','keyed']) {
  const enabled=name==='keyed';
  const soundtrack={format:'ink-studio/scene-audio',version:1,sampleRate:rate,
    assets:{dialogue:{graph:'repair-graph.json',output:'dialogue'},bed:'bed.wav'},
    tracks:[{asset:'dialogue',bus:'dialogue',gain:.96},{asset:'bed',bus:'music',gain:1.32}],
    post:{strips:{dialogue:{},music:{inserts:enabled ? [
      {processor:'space',sidechain:{strip:'dialogue',tap:'pre'}}
    ] : []}},processors:enabled ? {space:settings} : {}}
  };
  const recipe=out('soundtrack-'+name+'.json');
  json(recipe,soundtrack);
  const result=ink.readSceneAudio(recipe,{kit}).render({startPoint:t0,endPoint:t1});
  for (const bus of ['mix','dialogue','music']) write(out(name+'/'+bus+'.wav'),result.waves[bus]);
  json(out(name+'/report.json'),result.report);
}
assert.deepEqual(fs.readFileSync(out('full/dialogue.wav')),fs.readFileSync(out('keyed/dialogue.wav')));
assert.notDeepEqual(fs.readFileSync(out('full/music.wav')),fs.readFileSync(out('keyed/music.wav')));
const [full,keyed]=['full','keyed'].map(name=>ink.readWav(out(name+'/music.wav')).samples);
assert.deepEqual(full.slice(0,frame(.50)*2),keyed.slice(0,frame(.50)*2));
assert.deepEqual(full.slice((end+frame(.49))*2),keyed.slice((end+frame(.49))*2));
json(out('demo.json'),{rate,fps,pictureFrames,duration,start,end,pulse,feedback,feedbackHz,
  duck:{hz:settings.hz,rangeDb:10},repair:report.steps});
console.log(JSON.stringify({directory:path.resolve(folder),duration,clicks:report.steps.declick.regions,
  hum:report.steps.hum.frequency}));
