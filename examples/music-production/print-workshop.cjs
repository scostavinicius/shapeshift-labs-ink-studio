/* Run: node examples/music-production/print-workshop.cjs output-directory */
const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), kit=ink.load(), {takeTime:T,mediaGraph:A}=kit.KIT.procedural;
const WAV=require('../../cli/wav'),{write,json}=require('../../cli/asset-files');
const folder=path.resolve(process.argv[2] ?? 'print-workshop'), at=name=>path.join(folder,name);
const library=ink.openSampleLibrary(at('library'),{kit});
const sampleRate=32000, tau=Math.PI*2, frame=seconds=>Math.round(seconds*sampleRate);
const wave=(seconds,signal)=>({sampleRate,channels:1,
  samples:Float64Array.from({length:frame(seconds)},(_,i)=>signal(i/sampleRate,i))});
const save=(file,value)=>write(at(file),WAV.encode(value,{encoding:'pcm24'}));
const mark=frame(.20), delay=.16, answer=mark+frame(delay);
const metal=ink.readWav(path.join(__dirname,'samples','metal-soft.wav')).samples;
const dry=wave(1.55,(time,i)=>{
  const at=i-mark;
  if (at<0) return 0;
  const t=at/sampleRate;
  const motor=.28*Math.cos(tau*(533*t+.018*Math.sin(tau*20*t)))*Math.exp(-t*19)+
    .14*Math.cos(tau*827*t)*Math.exp(-t*13)*Math.sin(tau*7*t+.45);
  const click=.14*Math.cos(tau*1970*t)*Math.exp(-t*65);
  return (metal[at] ?? 0)*.59+motor+click;
});
save('relay-source.wav',dry);

const layer=(id,asset)=>({id,takes:[{asset}]});
const rack={id:'signal-rack',pads:{strike:{
  attack:0,pan:-.26,inserts:[{type:'drive',amount:2.1,mix:.58},{type:'highpass',hz:140}],sends:{echo:.91},
  articulations:{default:[layer('latch','input')]}
}},buses:{echo:{gain:-2,pan:.37,inserts:[
  {type:'delay',seconds:delay,mix:1,feedback:.61},{type:'lowpass',hz:3150}
]}}};
const graph={format:'ink-studio/graph-project',version:1,
  assets:{latch:{format:'wav',file:'relay-source.wav'}},
  nodes:{
    clean:{op:'audioAsset',inputs:{name:'latch'}},
    bank:{op:'data.record',inputs:{input:{node:'clean'}}},
    rack:{op:'music.renderSampleKit',inputs:{source:rack,assets:{node:'bank'},
      events:[{pad:'strike',time:0,velocity:1}],options:{duration:1.55,sampleRate}}}
  },outputs:{dry:{node:'clean'},processed:{node:'rack'}}};
json(at('graph.json'),graph);
const recipe={graph:'graph.json',seed:538,
  taps:{dry:{node:'clean'},wet:{node:'rack',port:'stems',field:['echo']}},
  sample:{id:'relay-print',label:'Relay latch',material:'metal',tags:['relay','printed'],
    license:{id:'CC0-1.0',credit:'Versilian Studios percussion with original synthesis'}},
  range:{firstSample:frame(.10),endSample:frame(1.42)},markers:[
    {id:'strike',at:mark,kind:'attack',label:'Contact'},
    {id:'answer',at:answer,kind:'attack',label:'First echo'}
  ]};
json(at('recipe.json'),recipe);
const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
  'music','samples',...args],{encoding:'utf8'}));
const printed=cli('print',at('library'),at('recipe.json'),'--out',at('print'));

const kick=wave(.34,(t,i)=>Math.min(1,t*2000)*.82*Math.sin(tau*(51*t+1.58*(1-Math.exp(-t*45))))*Math.exp(-t*15)+
  .048*Math.cos(i*2.13)*Math.exp(-t*105));
const kickEntry=library.add(A.sampleCatalog.capture(kick,{sample:{id:'kick',label:'Relay kick'},
  source:{kind:'instrument',name:'Synthesized kick'}})).entry;
const hat=ink.readWav(path.join(__dirname,'samples','hat-closed-alt.wav'));
const hatEntry=library.add(A.sampleCatalog.capture(hat,{sample:{id:'hat',label:'Closed hat'},
  source:{kind:'file',name:'hat-closed-alt.wav',reference:'examples/music-production/samples/CREDITS.md'}})).entry;
const kitRecipe={kit:{id:'print-drums',pads:{
  kick:{gain:-4,attack:0,articulations:{default:[layer('low','kick')]}},
  hat:{gain:-9,pan:-.33,attack:0,articulations:{default:[layer('metal','hat')]}},
  cut:{gain:-3,pan:.08,attack:0,release:.023,inserts:[{type:'highpass',hz:90}],
    articulations:{default:[layer('contact','clean')]}},
  echo:{gain:-3,attack:.001,release:.045,articulations:{default:[layer('resampled','echo')]}}
}},assets:{
  kick:{sample:'kick',asset:kickEntry.asset},hat:{sample:'hat',asset:hatEntry.asset},
  clean:{print:'print/print.json',take:'dry',slice:'strike'},
  echo:{print:'print/print.json',take:'wet',slice:'answer'}
}};
json(at('kit.json'),kitRecipe);
const tempo=108, swing=.565, events=[];
function hit(pad,beat,velocity,extra={}) {events.push({pad,time:{beat},velocity,...extra});}
function echo(beat,velocity,tune,pan,gate) {
  hit('echo',beat,velocity,{until:{beat:beat+gate},play:{gate:true,tune,pan}});
}
for (let bar=0;bar<3;bar++) {
  const b=bar*4;
  hit('kick',b,.97);
  hit('kick',b+1.78,.58);
  if (bar!==2) hit('kick',b+2.53,.77);
  hit('cut',b+1,.87);
  hit('cut',b+3,.8,{play:{tune:bar===1 ? -460 : -100}});
  for (const [i,beat] of [.51,1.48,2.24,2.5,3.517].entries())
    hit('hat',b+beat,[.58,.45,.34,.64,.53][i],{play:{tune:i%2 ? 160 : -180}});
  echo(b+.74,.82,-760,-.34,.31);
  echo(b+2.22,.69,bar%2 ? -140 : 390,.25,.22);
  echo(b+3.70,.56,700,.57,.13);
}
echo(11.8,.67,-1180,.13,.75);
json(at('performance.json'),{events,options:{sampleRate,map:{tempo,swing},duration:7.35}});
const reuse=cli('kit',at('library'),at('kit.json'),at('performance.json'),'--out',at('sampler'));

const pictureFrame=47, fps=30, pictureSeconds=3.25;
json(at('soundtrack.json'),{format:'ink-studio/scene-audio',version:1,sampleRate,
  assets:{relay:{print:'print/print.json',take:'wet'}},
  tracks:[{asset:'relay',frame:pictureFrame,fps,marker:'answer'}]});
const scene=ink.readSceneAudio(at('soundtrack.json'),{kit});
const {value}=scene.capture({startPoint:T.read(0),endPoint:T.read(pictureSeconds)},{source:{kind:'stem',name:'tracks'}});
const atPicture=Math.floor(pictureFrame*sampleRate/fps);
assert.equal(value.samples[atPicture*2-2],0);
assert.notEqual(value.samples[atPicture*2],0);
save('picture.wav',value);
json(at('demo.json'),{sampleRate,mark,answer,pictureFrame,fps,atPicture,tempo,
  print:{firstSample:printed.firstSample,endSample:printed.endSample,seed:printed.seed},bars:3});
console.log(JSON.stringify({print:printed.manifest,sampler:reuse.audio,picture:at('picture.wav'),atPicture}));
