/* Run: node examples/music-production/slice-composition-workshop.cjs output-directory */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(), A=kit.KIT.procedural.mediaGraph;
const {write,json}=require('../../cli/asset-files'), WAV=require('../../cli/wav');
const folder=path.resolve(process.argv[2] ?? 'slice-composition-workshop'), at=name=>path.join(folder,name);
const library=at('library'), catalog=ink.openSampleLibrary(library,{kit});
const sampleRate=32000,tempo=116, frame=time=>Math.round(time*sampleRate);
const beatFrame=beat=>frame(beat*60/tempo);
const cli=(...args)=>execFileSync(process.execPath,[path.join(__dirname,'../../cli/ink-studio.js'),'music',...args],
  {encoding:'utf8'});
const rawHits=[
  {id:'a',file:'metal-soft',beat:0,span:.235,peak:.57},
  {id:'b',file:'metal-alt',beat:.625,span:.295,peak:.53},
  {id:'c',file:'metal-hit',beat:1.375,span:.61,peak:.68}
];
const recording={sampleRate,channels:1,samples:new Float64Array(beatFrame(1.375)+frame(.61))};
for (const {file,beat,span,peak} of rawHits) {
  const {samples}=WAV.read(path.join(__dirname,'samples',file+'.wav'));
  const peakGain=peak/samples.reduce((max,x)=>Math.max(max,Math.abs(x)),0);
  const length=frame(span), start=beatFrame(beat);
  for (let i=0;i<length;i++)
    recording.samples[start+i]+=samples[i]*peakGain*Math.min(1,(length-i)/frame(.018));
}
const {entry:original}=catalog.add(A.sampleCatalog.capture(recording,{
  sample:{id:'three-strikes',label:'Three brake-drum strikes',material:'metal',license:{id:'CC0-1.0'}},
  source:{kind:'file',name:'Versilian Community Sample Library',reference:'examples/music-production/samples/CREDITS.md'}
}));
const {value:source}=catalog.load(original.id);
write(at('source.wav'),WAV.encode(source,{encoding:'pcm24'}));
const document=A.sampleEdit.create(source,{source:{id:original.id,asset:original.asset}});
const assets={};
function isolate(id,from,to,reverse=false) {
  const edit=A.sampleEdit.edit(document,[{op:'assemble',clips:[{id,from,to,reverse}]}]);
  const filename=id+'-edit.json';
  json(at(filename),edit);
  assets[id]={edit:filename};
  return edit;
}
const take=(asset,root)=>({asset,...(root && {root})});
for (const {id,beat,span} of rawHits) {
  const first=beatFrame(beat);
  isolate(id,first,first+frame(span));
  isolate('bell-'+id,first+frame(.007),first+frame(Math.min(.37,span)));
}
const tailEdit=isolate('ring-source',beatFrame(1.375)+frame(.136),beatFrame(1.375)+frame(.563),true);
const warp={mode:'tones',speed:.20};
const held=A.warpAudio(A.sampleEdit.render(source,tailEdit).value,warp);
json(at('ring-warp.json'),warp);
const {entry:ring}=catalog.add(A.sampleCatalog.capture(held.value,{
  sample:{id:'ring',label:'Reversed and stretched brake-drum tail',material:'metal',pitch:'C6',license:{id:'CC0-1.0'}},
  source:{kind:'graph',name:'audio.warp tones',reference:original.asset}
}));
assets.ring={sample:ring.id,asset:ring.asset};

const pad=(takes,properties)=>({...properties,articulations:{default:[{id:'metal',takes}]}});
const sampler={id:'split-ring',pads:{
  strike:pad(rawHits.map(({id})=>take(id)),{gain:-9,attack:0,release:.023,
    inserts:[{type:'highpass',hz:180}]}),
  bell:pad(rawHits.map(({id})=>take('bell-'+id,'C6')),{gain:-8,attack:.007,release:.083,
    inserts:[{type:'lowpass',hz:1930}],sends:{glass:.25}}),
  low:pad([take('bell-c','C6')],{gain:-7,attack:.012,release:.105,
    inserts:[{type:'lowpass',hz:450},{type:'drive',amount:1.63,mix:.26}]}),
  ring:pad([take('ring','C6')],{gain:-5,attack:.23,release:.58,
    inserts:[{type:'lowpass',hz:1620}],sends:{glass:.36}})
},buses:{
  glass:{gain:-4,pan:.23,inserts:[{type:'delay',seconds:.271,feedback:.49,mix:1},{type:'lowpass',hz:1910}]},
  passage:{gain:-8,pan:-.29,inserts:[{type:'delay',seconds:.399,feedback:.58,mix:1},{type:'lowpass',hz:1250}]}
}};
json(at('kit.json'),{kit:sampler,assets});
const bind=(pad,sample)=>({pad,play:{sample}});
const slices={...Object.fromEntries(rawHits.flatMap(({id})=>[[id,bind('strike',id)],['bell-'+id,bind('bell','bell-'+id)]])),
  low:bind('low','bell-c'),ring:bind('ring','ring')};
const hit=(id,beat,slice,rest={})=>({id,beat,slice,...rest});
const phrase=(length,...hits)=>({op:'phrase',length,hits});
const voice=(source,settings)=>({op:'voice',source,...settings});
const loop=(source,length,settings)=>({op:'loop',source,length,...settings});
const sequence=(...sources)=>({op:'sequence',sources});
const stack=layers=>({op:'stack',layers:Object.fromEntries(Object.entries(layers).map(([name,source])=>
  [name,typeof source==='string' ? {source} : source]))});
const makeCut=(source,length,rows)=>({op:'cut',source,length,slots:rows.map(([pick,beat,gate],i)=>({
  id:'splice-'+i,pick,beat,...(gate!==undefined && {gate})}))});
const pitched={a:'bell-a',b:'bell-b',c:'bell-c'};
const toLow={a:'low',b:'low',c:'low'};
const patterns={
  gesture:phrase(2,hit('a',0,'a',{velocity:.83}),hit('b',.625,'b',{velocity:.66}),hit('c',1.375,'c',{velocity:.79})),
  left:voice('gesture',{gain:.85,play:{pan:-.67}}),
  right:voice('gesture',{gain:.69,play:{pan:.67,filter:{type:'lowpass',hz:5900}}}),
  steady:loop('left',12),
  drifting:loop('right',12,{period:{numerator:67,denominator:32}}),
  phase:stack({steady:'steady',drifting:'drifting'}),

  additive:{op:'additive',source:'gesture',counts:[1,2,3,3]},
  lowcell:makeCut('gesture',3,[['c',.25,.44],['b',2.125,.30]]),
  lowThree:voice('lowcell',{slices:toLow,notes:['C3','G3'],gain:.74,play:{pan:-.07}}),
  unequal:loop('lowThree',8,{phase:.5}),
  build:stack({additive:'additive',unequal:'unequal'}),

  cut:makeCut('gesture',2,[['c',0,.23],['b',.375,.16],['a',.875,.13],['b',1.125,.19]]),
  call:voice('cut',{gain:.75,play:{pan:-.29,sends:{passage:.16}}}),
  response:voice('gesture',{slices:pitched,notes:['Eb4','G4','D4'],gate:.52,gain:.99,play:{pan:.36}}),
  responseHigh:voice('gesture',{slices:pitched,notes:['F4','Ab4','G4'],gate:.57,gain:.87,
    play:{pan:.23,sends:{passage:.21}}}),
  conversation:sequence('call','response','call','responseHigh'),
  entryLow:voice('gesture',{slices:toLow,notes:['C3','G3','Bb3'],gate:.27,gain:.59}),
  lowReturn:loop('entryLow',8,{period:4,phase:.125}),
  exchange:stack({front:'conversation',low:'lowReturn'}),
  caseClosed:voice('gesture',{slices:pitched,notes:['C4','Eb4','G4'],gate:.82,gain:.82,play:{pan:-.34}}),
  cutBright:voice('cut',{slices:pitched,notes:['C5','Bb4','G4','C5'],gain:.60,play:{pan:.55,sends:{passage:.55}}}),
  openAgain:sequence('caseClosed','cutBright','caseClosed','responseHigh'),
  back:stack({front:'openAgain',low:'lowReturn'}),

  tailCell:makeCut('gesture',8,[['a',0,4],['c',2.875,4.5]]),
  tailVoice:voice('tailCell',{slices:{a:'ring',c:'ring'},notes:['C4','G4'],gain:.72,play:{pan:-.25}}),
  tailSecond:voice('tailCell',{slices:{a:'ring',c:'ring'},notes:['Eb4','Bb3'],gain:.48,
    play:{pan:.50,sends:{passage:.27}}}),
  afterimage:stack({first:'tailVoice',second:{source:'tailSecond',at:1.5},
    last:{source:'caseClosed',at:4.5}}),
  finished:sequence('gesture','phase','build','exchange','back','afterimage')
};
const recipe={id:'split-ring',slices,patterns,output:'finished',tail:1.45,render:{sampleRate,map:{tempo}}};
json(at('score.json'),recipe);
cli('pads','compose',at('score.json'),'--out',at('performance.json'),'--report',at('trace.json'));
const rendered=JSON.parse(cli('samples','kit',library,at('kit.json'),at('performance.json'),'--out',at('mix')));
const report=JSON.parse(fs.readFileSync(rendered.report,'utf8'));
const trace=JSON.parse(fs.readFileSync(at('trace.json'),'utf8'));
const performed=JSON.parse(fs.readFileSync(at('performance.json'),'utf8'));
assert.equal(report.events.length,trace.events.length);
assert.deepEqual(report.events.map(row=>row.id),trace.events.map(row=>row.id));
const rowById=new Map(report.events.map(row=>[row.id,row]));
const controlById=new Map(performed.events.map(row=>[row.id,row]));
const mix=WAV.read(rendered.audio);
const peak=mix.samples.reduce((max,x)=>Math.max(max,Math.abs(x)),0);
assert(peak>.15 && peak<=1);
write(at('split-ring.wav'),WAV.encode(mix,{encoding:'pcm24'}));
json(at('demo.json'),{title:'Split Ring',tempo,sampleRate,duration:report.frames/sampleRate,peak,
  stages:[
    {beat:0,end:2,title:'The source',detail:'Three strikes from the same sample library.'},
    {beat:2,end:14,title:'Phasing',detail:'Identical hits repeat every 2 and 2 3/32 beats.'},
    {beat:14,end:22,title:'Additive rhythm',detail:'One, two, then three strikes. A low voice repeats every three beats.'},
    {beat:22,end:38,title:'Cut and answer',detail:'Reordered hits on the left. The same strikes repitched on the right.'},
    {beat:38,end:47.5,title:'The tail',detail:'A single recorded decay, reversed and stretched into a chord.'}
  ],
  events:trace.events.map(row=>{
    const performed=rowById.get(row.id), controls=controlById.get(row.id);
    return {...row,time:performed.at/sampleRate,pitch:performed.pitch,velocity:performed.velocity,
      end:performed.noteOff===undefined ? null : performed.noteOff/sampleRate,
      pan:controls.play.pan ?? 0};
  }),source:rawHits.map(({id,file,beat,span})=>({id,file,beat,span}))});
console.log(JSON.stringify({events:trace.events.length,peak,duration:report.frames/sampleRate}));
