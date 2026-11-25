const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {gzipSync}=require('node:zlib');
const ink=require('../..'), kit=ink.load(), K=kit.KIT, live=K.music.production.live;
const WAV=require('../../cli/wav.js'), {json,write}=require('../../cli/asset-files.js');

const out=process.argv[2];
if(!out)throw Error('Use node examples/harmonic-bridges/demo.cjs <output-directory>');
const rate=32000, tempo=100;
const patches={
  pad:{type:'subtractive',saw:.25,pulse:.46,sub:.09,pulseWidth:.34,pwm:{rate:.54,depth:.07},
    filter:{cutoff:790,resonance:.66,keyTrack:.31,envAmount:11},
    env:{attack:.08,decay:.23,sustain:.72,release:.26}},
  reed:{type:'fm',ratio:1.992,index:1.84,indexDecay:.13,body:.12,width:11,color:.57,
    env:{attack:.012,decay:.13,sustain:.39,release:.17},
    echo:{delay:.286,feedback:.27,send:.17,damping:.66,width:.68}},
  bass:{type:'subtractive',saw:.2,pulse:.29,sub:.51,filter:{cutoff:302,resonance:.58,keyTrack:.23},
    env:{attack:.014,decay:.16,sustain:.52,release:.19}},
  light:{type:'keys',tine:.43,bite:.23,dust:.04,wear:.18,color:.6,
    env:{attack:.014,decay:.29,sustain:.17,release:.26}}
};
const roles={pad:'pad',reed:'lead',bass:'bass',light:'pad'};
const desk={pad:{gain:-13,pan:-.26,send:.35},reed:{gain:-10,pan:.18,send:.38},
  bass:{gain:-14,pan:0,send:.08},light:{gain:-17,pan:.43,send:.43}};
const chords={
  crossing:{label:'Crossing',chord:'C major',root:'C3',quality:'major',parts:{
    pad:[[0,3.1,60,.66],[0,3.15,64,.47]],
    bass:[[0,1.24,36,.72],[1.73,.81,43,.54],[3.42,.43,43,.43]],
    reed:[[.22,.72,72,.57],[1.22,.37,64,.61],[1.69,1.50,67,.69],[3.35,.49,76,.49]],
    light:[[.72,.44,79,.53],[1.25,.44,84,.49],[3.38,.35,79,.42]]
  }},
  signal:{label:'Amber signal',chord:'D♭ major 7',root:'Db3',quality:'major7',parts:{
    pad:[[0,3.25,60,.63],[0,3.15,65,.48]],
    bass:[[0,1.25,37,.71],[1.87,.84,44,.59],[3.41,.38,37,.44]],
    reed:[[.04,.73,68,.69],[1.01,.48,72,.62],[1.76,1.21,73,.57],[3.29,.42,68,.49]],
    light:[[.72,.51,80,.57],[1.36,.41,85,.47],[2.12,.55,77,.51]]
  }},
  depot:{label:'Blue signal',chord:'F major 7',root:'F3',quality:'major7',parts:{
    pad:[[0,3.25,60,.61],[0,3.25,64,.46],[.17,2.91,65,.33]],
    bass:[[0,1.43,41,.68],[1.82,.63,36,.54],[3.38,.45,48,.44]],
    reed:[[.03,.82,69,.67],[1.04,.43,72,.61],[1.78,1.26,77,.64],[3.4,.42,76,.50]],
    light:[[.71,.41,81,.56],[1.28,.53,84,.47],[2.17,.61,81,.45]]
  }}
};
function source({root,quality,parts}){
  const tracks=Object.fromEntries(Object.entries(parts).map(([part,rows])=>[part,{patch:part,...desk[part],
    clips:[{id:part,beat:0,length:4,voices:rows.map(([beat,duration,midi,velocity],i)=>({id:'voice-'+i,
      notes:[{id:'tone-'+i,beat,duration,midi,velocity}]}))}]}]));
  return {seed:517,arrangement:{score:{key:{root:'C3'},tempoMap:{tempo},harmonies:{opening:{root,quality}}},motifs:{},
    parts:Object.fromEntries(Object.entries(roles).map(([part,role])=>[part,{role}])),
    sections:[{id:'cue',bars:1,harmony:'opening'}]},patches,tracks,room:{gain:-7,size:1.21,decay:.91,damping:.52}};
}
const sources=Object.fromEntries(Object.entries(chords).map(([name,chord])=>[name,source(chord)]));
const entry='crossing', names=Object.keys(sources);
const segments=Object.fromEntries(names.map(name=>[name,{source:name,end:{beat:4}}]));
const transition=(from,to)=>({from,to,exit:{beat:3},entry:{beat:0},tail:.045,
  harmonicBridge:{track:'reed',lead:.36,steps:2,velocity:.65,range:[58,81]}});
const transitions=names.flatMap(from=>names.filter(to=>from!==to).map(to=>transition(from,to)));
const timeline={entry,segments,transitions};
const hard={...timeline,transitions:transitions.map(({harmonicBridge,...edge})=>edge)};
const options={sampleRate:rate,foreground:['pad','bass'],reservedVoices:3,maxVoices:24,masterGain:-5};
const events=[['crossing','signal',.44],['signal','crossing',2.22],['crossing','depot',4.02]].map(([from,to,time])=>
  ({observedAt:time,intent:{kind:'music-transition',from,to,time,rule:'signal-'+to}}));
const route={events,end:8.45};

async function demo(){
  const bridged=await live.replay(sources,timeline,route,options), plain=await live.replay(sources,hard,route,options);
  assert.equal(bridged.report.joins.length,3);
  assert(bridged.report.joins.every(join=>join.carry.harmonicBridge.pickup?.notes.some(note=>note.status==='played')));
  assert(bridged.report.joins.every(join=>join.carry.harmonicBridge.held.some(note=>note.openingAttackReused)));
  assert.equal(bridged.report.profile.clippedFrames,0);
  json(path.join(out,'score.json'),{sources,timeline,live:{options}});
  json(path.join(out,'route.json'),route);
  json(path.join(out,'joins.json'),bridged.report.joins);
  for(const [name,take] of [['harmonic-bridges',bridged],['straight-cuts',plain]])
    write(path.join(out,name+'.wav'),WAV.encode(take.value,{encoding:'pcm24'}));
  const encode=wave=>WAV.encode(wave.value,{encoding:'pcm16'}).toString('base64');
  const data={sources,timeline,hard,options,labels:Object.fromEntries(Object.entries(chords).map(([id,{label,chord}])=>[id,{label,chord}])),
    takes:{bridged:encode(bridged),hard:encode(plain)},joins:bridged.report.joins};
  const template=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
  const script=fs.readFileSync(path.join(__dirname,'review.js'),'utf8');
  const engine=gzipSync(ink.bundle(),{level:9}).toString('base64');
  const page=template.replace('/*INK_DEMO_DATA*/',()=>JSON.stringify(data))
    .replace('/*INK_DEMO_ENGINE*/',()=>JSON.stringify(engine))
    .replace('/*INK_DEMO_SCRIPT*/',()=>script);
  write(path.join(out,'index.html'),page);
  console.log(bridged.report.joins.map(join=>({time:join.time,from:join.from,to:join.to,
    ...join.carry.harmonicBridge})));
}
demo().catch(error=>{console.error(error);process.exitCode=1;});
