/* Run: node examples/music-production/cue-map-workshop.cjs output-directory */
const assert=require('node:assert/strict'), path=require('node:path');
const ink=require('../..'), K=ink.load().KIT, A=K.music.production;
const WAV=require('../../cli/wav'), {write,json}=require('../../cli/asset-files');
const palette=require('./relay-glass.json');
const folder=path.resolve(process.argv[2] ?? 'cue-map-workshop'), at=file=>path.join(folder,file);
const assetsPaths=Object.fromEntries(Object.entries(palette.assets).map(([id,file])=>[id,path.join(__dirname,file)]));
const assets=Object.fromEntries(Object.entries(assetsPaths).map(([id,file])=>[id,WAV.read(file)]));
const source=structuredClone(palette.production);
const motif=(length,rows)=>({length,events:rows.map(([beat,duration,velocity,degree=1,play])=>
  ({beat,duration,velocity,degree,...(play && {play})}))});
const harmony=(root,quality,voicing)=>({root,quality,voicing:{pad:voicing}});
source.seed=719;
source.arrangement={
  score:{tempoMap:{tempo:100,swing:.55},key:{root:'D3',mode:'minor'},endFade:.31,harmonies:{
    home:harmony('D3','minor7','F4'),blue:harmony('Bb2','major7','A4'),undertow:harmony('G2','minor7','Bb4'),
    hinge:harmony('A2','dominant7','G4'),after:harmony('F3','major7','A4')
  }},
  motifs:{
    kick:motif(4,[[0,.12,.93],[1.72,.1,.5],[2.52,.12,.81]]),
    snare:motif(4,[[1,.11,.81],[2.83,.07,.33,1,{articulation:'ghost'}],[3,.12,.91]]),
    hat:motif(4,[[.51,.08,.53],[.76,.07,.31],[1.49,.08,.62],[2.23,.08,.28],[2.51,.1,.71],
      [2.76,.07,.35],[3.5,.14,.78,1,{articulation:'open'}],[3.76,.07,.43]]),
    latch:motif(8,[[.25,.15,.43],[2.75,.19,.35],[5.25,.12,.41],[7.24,.17,.29]]),
    bass:motif(4,[[0,.79,.92,1],[1.46,.3,.63,5,{glide:.06}],[2.17,.61,.83,3],[3.34,.5,.71,7]]),
    longBass:motif(8,[[0,1.34,.88,1],[1.72,.33,.64,5],[2.4,1.02,.8,1],
      [4,.94,.84,1],[5.65,.26,.62,5],[6.43,1.34,.79,1]])
  },
  parts:{
    kick:{role:'percussion',material:'kick',voice:{instrument:'kick'}},
    snare:{role:'percussion',material:'snare',voice:{instrument:'snare'}},
    hat:{role:'percussion',material:'hat',voice:{instrument:'hat'}},
    metal:{role:'percussion',material:'latch',voice:{instrument:'hat'}},
    bass:{role:'bass',material:'bass',register:-12},lead:{role:'lead',pitch:'key'},
    pad:{role:'pad',material:{sustain:true}}
  },
  sections:[
    {id:'foyer',bars:2,harmony:'home'},{id:'pull',bars:2,harmony:'blue'},
    {id:'narrows',bars:2,harmony:'undertow'},{id:'return',bars:2,harmony:'home'},
    {id:'ebb',bars:2,harmony:'after',parts:{bass:'longBass'}}
  ]
};
source.tracks.kick.gain=-7.5;
source.tracks.snare.gain=-1.8;
source.tracks.hat.gain=-7.8;
source.tracks.bass.gain=-11.5;
source.tracks.lead.gain=-13;
source.tracks.lead.pan=-.06;
source.tracks.metal.gain=-11.2;
source.tracks.pad.gain=-19.5;
source.tracks.pad.pad={...source.tracks.pad.pad,low:'F3',high:'E5',anchor:'C5',sections:{
  narrows:{tie:false,rhythm:{every:2,length:1.8,offset:.03,velocity:.64}},
  return:{rhythm:{every:4,length:3.72,offset:.025,velocity:.76},anchor:'D5',brightness:.56}
}};
source.room={gain:-.5,size:1.41,decay:.88,damping:.46};
source.patches.glass.echo={delay:.355,feedback:.39,send:.23,damping:.62,width:.68};
const others=['kick','snare','hat','metal','bass','pad'];
const common={
  groups:[
    {id:'cue',label:'Night Weir',from:0,to:40},
    {id:'foyer',label:'Gather',from:0,to:8,parent:'cue'},
    {id:'pressure',label:'Pull',from:8,to:24,parent:'cue'},
    {id:'narrows',label:'Narrow',from:16,to:24,parent:'pressure'},
    {id:'return',label:'Return',from:24,to:40,parent:'cue'}
  ],
  landmarks:[
    {id:'pulse',kind:'pulse',beat:4,label:'The kick makes the pulse explicit',parts:['kick','hat']},
    {id:'fragment',kind:'fragment',beat:8.5,label:'Two notes of the theme',parts:['lead']},
    {id:'gap',kind:'silence',beat:22.5,label:'A clean gap before the pickup'},
    {id:'pickup',kind:'fragment',beat:23.375,label:'One exposed pickup',parts:['lead']},
    {id:'arrival',kind:'return',beat:24,label:'The bass arrives and the room opens',parts:['bass','lead','pad']}
  ],
  density:[
    {from:0,to:4,parts:['kick','snare'],value:0},
    {from:0,to:8,parts:['hat'],value:.27,keep:[2.51,6.51]},
    {from:4,to:8,parts:['kick'],value:.45,keep:[4]},
    {from:4,to:16,parts:['snare'],value:.55},
    {from:8,to:16,parts:['hat'],value:.57},
    {from:16,to:22.5,parts:['hat','snare'],value:.83},
    {from:32,to:40,parts:['kick','hat'],value:.53}
  ],
  register:[{from:24,to:32,parts:['lead'],semitones:12}],
  harmony:[
    {from:16,to:24,chords:['undertow','blue','undertow','hinge'],every:2},
    {from:24,to:32,chords:['home','blue'],every:4},
    {from:36,to:40,chords:['home'],every:4}
  ],
  silence:[
    {from:0,to:22.5,parts:['bass']},{from:22.5,to:23.25,mode:'cut'},
    {from:23.25,to:24,parts:others}
  ],
  room:[
    {from:0,to:24,parts:['lead','pad'],send:.16},
    {from:24,to:36,parts:['lead','pad','snare'],send:[.55,.96]},
    {from:36,to:40,parts:['lead','pad','snare'],send:[.80,.37]}
  ]
};
const exposed={...common,
  landmarks:common.landmarks.map(row=>row.id==='arrival' ?
    {...row,label:'The theme returns alone',parts:['lead']} : row),
  silence:[...common.silence,{from:24,to:28,parts:others,mode:'cut'}],
  room:[common.room[0],{from:24,to:28,parts:['lead','pad','snare'],send:.16},
    {from:28,to:36,parts:['lead','pad','snare'],send:[.55,.96]},common.room[2]]
};
const themeNotes=[
  ['signal',0,.27,62,.9],['rise',.62,.31,65,.85],['hang',1.28,.57,64,.75],
  ['reach',2.48,.76,69,.91],['turn',3.68,.29,67,.73],['answer',4.20,.43,65,.87],['land',5.52,1.0,62,.84]
];
const plan={themes:{signal:{root:'D4',motif:{length:6.75,events:themeNotes.map(([id,beat,duration,midi,velocity])=>
  ({id,beat,duration,midi,velocity}))},fragments:{call:['signal','rise'],pickup:['signal']}}},appearances:[
  {id:'first-call',theme:'signal',stage:'fragment',fragment:'call',section:'pull',beat:.5,
    targets:[{part:'lead',level:.8,play:{articulation:'pluck',brightness:.54}}]},
  {id:'breath',theme:'signal',stage:'fragment',fragment:'pickup',section:'narrows',beat:7.375,
    targets:[{part:'lead',level:.89,stretch:1.82,play:{articulation:'hold',brightness:.4}}]},
  {id:'signal-return',theme:'signal',stage:'statement',section:'return',beat:.375,
    targets:[{part:'lead',level:1,play:{articulation:'hold',brightness:.77,vibrato:6}}]},
  {id:'after-call',theme:'signal',stage:'development',fragment:'call',section:'ebb',beat:1.25,
    targets:[{part:'lead',pitch:'chord-tone',stretch:1.46,gate:.85,level:.74,play:{brightness:.42}}]}
]};
const sampleRate=32000;
let prior, lead;
for (const [name,cueMap] of Object.entries({opening:common,exposed})) {
  const mapped=A.mapCue(source,cueMap,assets);
  const result=A.developThemes(mapped.production,plan,assets);
  const inspected=A.inspect(result.production,assets);
  const {value,stems}=A.render(result.production,assets,{sampleRate,stems:true});
  const peak=A.meters(value).peak;
  assert(peak<1);
  assert.equal(inspected.cueMap.tracks.bass.firstBeat,name==='opening'?24:28);
  const [gap]=inspected.cueMap.roomCuts;
  const cut=value.samples.slice(Math.ceil(gap.startTime*sampleRate)*2,Math.ceil(gap.endTime*sampleRate)*2);
  assert(cut.every(sample=>sample===0));
  if (prior) assert.deepEqual(prior.slice(0,24*.6*sampleRate*2),value.samples.slice(0,24*.6*sampleRate*2));
  if (lead) assert.deepEqual(lead,inspected.events.lead);
  prior=value.samples;
  lead=inspected.events.lead;
  write(at(name+'.wav'),WAV.encode(value,{encoding:'pcm24'}));
  write(at(name+'-room.wav'),WAV.encode(stems.room,{encoding:'pcm24'}));
  json(at(name+'-report.json'),{...inspected.cueMap,events:inspected.events,themeMap:result.themeMap,peak});
  json(at(name+'.json'),{production:result.production,themeMap:result.themeMap,assets:assetsPaths,
    options:{sampleRate}});
}
console.log(JSON.stringify({cue:at('opening.wav'),alternate:at('exposed.wav')}));
