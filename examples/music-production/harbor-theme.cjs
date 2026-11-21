/* Run: node examples/music-production/harbor-theme.cjs output-directory */
const fs=require('node:fs');
const path=require('node:path');
const WAV=require('../../cli/wav.js');
const {KIT:K}=require('../..').load();
const palette=require('./relay-glass.json');
const A=K.music.production;
const target=path.resolve(process.argv[2] ?? 'harbor-theme-audition');
const source=structuredClone(palette.production);
const {arrangement}=source;
delete arrangement.parts.lead.material;
delete arrangement.parts.metal.material;
delete arrangement.parts.pad.material;
source.tracks.pad.pad.sections={lights:source.tracks.pad.pad.sections.clear};
arrangement.score.changes=[{id:'hold',time:{bar:7},harmony:'turn'},{id:'answer',time:{bar:10},harmony:'lift'}];
arrangement.sections=[
  {id:'quay',bars:2,harmony:'home'},
  {id:'channel',bars:4,harmony:'sub',parts:{pad:{sustain:true},snare:'backbeat'}},
  {id:'approach',bars:2,harmony:'lift',parts:{snare:'cross-stick'}},
  {id:'lights',bars:4,harmony:'clear',parts:{metal:'metal-clear'}}
];

const notes=[
  ['tap',0,.18,66,.92],['up',.5,.20,69,.78],['reach',1.25,.44,73,.92],
  ['hanging',2.5,.49,76,.79],['answer',3.25,.53,73,.85],
  ['turn',4.5,.28,71,.72],['settle',5.25,1.21,66,.92]
];
const themes={beacon:{root:'F#4',motif:{length:7,events:notes.map(([id,beat,duration,midi,velocity])=>
  ({id,beat,duration,midi,velocity}))},fragments:{call:['tap','up','reach']}}};
const prelude=[
  {id:'machine',theme:'beacon',section:'quay',beat:4.25,stage:'fragment',fragment:'call',
    targets:[{part:'metal',pitch:'rhythm',level:.88}]},
  {id:'bass-remembers',theme:'beacon',section:'channel',beat:12,stage:'development',fragment:'call',
    targets:[{part:'bass',pitch:'chord-tone',stretch:1.5,level:.95,play:{glide:.03}}]}
];
const early={id:'echo',theme:'beacon',section:'lights',beat:1,stage:'fragment',fragment:'call',
  targets:[{part:'lead',pitch:'chord',transpose:12,stretch:1.25,level:.8,play:{articulation:'pluck'}}]};
const late={id:'the-lights',theme:'beacon',section:'lights',beat:.5,stage:'statement',
  targets:[{part:'lead',pitch:'chord',transpose:12,play:{articulation:'hold',vibrato:11}},
    {part:'metal',pitch:'rhythm',offset:.125,gate:.5,level:.61}]};
const assets=Object.fromEntries(Object.entries(palette.assets).map(([name,file])=>[name,WAV.read(path.join(__dirname,file))]));
const fragment=A.developThemes(source,{themes,appearances:[...prelude,early]},assets);
const statement=A.developThemes(source,{themes,appearances:[...prelude,late]},assets);
const bank={fragment:fragment.production,statement:statement.production};
const timing=K.procedural.musicTiming.compile(arrangement.score.tempoMap);
const adaptive=K.music.create({entry:'search',tempo:116,sections:{search:{resource:'search'},reveal:{resource:'reveal'}},
  parameters:{lights:{}},transitions:[{id:'lights-on',from:'search',to:'reveal',quantize:'bar',
    when:{path:'/parameters/lights',op:'gte',value:1}}]});
const stamp=pathName=>path.join(target,pathName);
const write=(file,value)=>fs.writeFileSync(stamp(file),JSON.stringify(value,null,2)+'\n');
fs.mkdirSync(target,{recursive:true});
for (const [name,authored] of Object.entries({fragment,statement}))
  write(name+'.json',{...authored,assets:Object.fromEntries(Object.entries(palette.assets).map(([name,file])=>
    [name,path.resolve(__dirname,file)]))});
for (const [name,request,boundary] of [['early',6.9,4],['late',15.25,8]]) {
  const end=timing.timeAt({bar:boundary+4});
  const timeline={entry:'search',end,segments:{
    search:{source:'fragment',start:{bar:0},end:{bar:8},loop:false},
    reveal:{source:'fragment',start:{bar:8},loop:false}
  },transitions:[{from:'search',to:'reveal',tail:.13,fadeIn:.05}],
  thematic:{maps:{fragment:fragment.themeMap,statement:statement.themeMap},
    routes:{reveal:[{source:'statement',when:{theme:'beacon',stage:'development'}}]}}};
  const queued=adaptive.advance(adaptive.initial(),{time:request,parameters:{lights:1}});
  const ready=adaptive.advance(queued.state,{time:end});
  const intents=[...queued.intents,...ready.intents];
  const take=A.renderTimeline(bank,timeline,intents,assets,{sampleRate:32000});
  const {peak,lufs,truePeak}=A.meters(take.value,true);
  const level=lufs===null ? 1 : Math.min(10**((-17-lufs)/20),10**(-1/20)/truePeak);
  fs.writeFileSync(stamp(name+'.wav'),WAV.encode({...take.value,samples:take.value.samples.map(value=>value*level)},{encoding:'pcm24'}));
  write(name+'-report.json',{...take.report,peak,lufs,outputGain:level});
  const {maps,...thematic}=timeline.thematic;
  write(name+'-timeline.json',{sources:{fragment:'fragment.json',statement:'statement.json'},
    timeline:{...timeline,thematic},intents,options:{sampleRate:32000}});
  console.log(name,take.report.themes.decisions[0]);
}
