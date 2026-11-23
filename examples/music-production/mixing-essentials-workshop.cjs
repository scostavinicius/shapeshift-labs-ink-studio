/* Run: node examples/music-production/mixing-essentials-workshop.cjs output-directory */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {KIT:K}=require('../..').load(),A=K.music.production, M=K.procedural.mediaGraph.mixerMonitor;
const {write,json}=require('../../cli/asset-files'),WAV=require('../../cli/wav');
const at=file=>path.join(path.resolve(process.argv[2] ?? 'mixing-essentials-workshop'),file);
const sampleRate=24000, tempo=115, span=16*60/tempo, map={tempo};
const samples=Object.fromEntries(['snare-rim','snare-ghost','hat-closed','hat-closed-alt','metal-alt','metal-soft']
  .map(name=>[name,WAV.read(path.join(__dirname,'samples',name+'.wav'))]));
const hits=(length,rows)=>({length,events:rows.map(([beat,velocity,duration=.10])=>({beat,duration,velocity,degree:1}))});
const notes=(length,rows)=>({length,events:rows.map(([beat,duration,velocity,midi])=>({beat,duration,velocity,midi}))});
const harmony=(root,quality,voicing)=>({root,quality,voicing:{pad:voicing}});
const source={seed:1988,arrangement:{
  score:{tempoMap:map,endFade:.12,key:{root:'C4',mode:'minor'},harmonies:{
    low:harmony('C3','minor7','Eb4'),glass:harmony('Ab2','major7','G4'),
    violet:harmony('F2','minor7','Ab4'),turn:harmony('G2','dominant7','F4')
  }},
  motifs:{
    hook:notes(16,[[.61,.47,.81,67],[1.31,.23,.56,70],[1.78,.64,.87,74],[3.16,.43,.67,72],
      [4.77,.39,.75,67],[5.43,.27,.58,65],[6.30,.62,.85,63],[7.56,.31,.52,67],
      [8.61,.40,.81,67],[9.31,.22,.57,70],[9.78,.75,.88,74],[11.16,.32,.58,75],
      [12.66,.37,.72,74],[13.39,.32,.62,70],[14.11,.57,.78,67],[15.05,.60,.70,72]]),
    bass:notes(16,[[0,.88,.88,36],[1.54,.30,.68,43],[2.66,.55,.76,34],[3.46,.21,.63,36],
      [4,.92,.87,32],[5.62,.38,.70,39],[6.53,.52,.76,36],[7.58,.21,.60,39],
      [8,.87,.86,29],[9.54,.31,.65,36],[10.68,.62,.81,41],[11.48,.25,.61,39],
      [12,.69,.79,31],[13.58,.38,.73,38],[14.48,.42,.77,35],[15.2,.56,.67,36]]),
    pad:hits(4,[[.16,.51,1.46],[2.38,.55,1.32]]),
    kick:hits(8,[[0,.94],[1.47,.75],[2.69,.84],[3.47,.53],[4,.91],[5.58,.74],[6.52,.81],[7.21,.49]]),
    snare:hits(4,[[1.027,.81],[2.72,.31,.07],[3.031,.85]]),
    hat:hits(4,[[.43,.42],[.78,.26],[1.48,.58],[1.85,.27],[2.45,.51],[3.48,.60],[3.73,.31]]),
    metal:hits(8,[[.18,.67],[2.29,.38],[3.77,.71],[5.31,.52],[7.24,.72]])
  },
  parts:{
    hook:{role:'lead',material:'hook'},bass:{role:'bass',material:'bass'},pad:{role:'pad',material:'pad'},
    kick:{role:'percussion',material:'kick',voice:{instrument:'kick'}},
    snare:{role:'percussion',material:'snare',voice:{instrument:'snare'}},
    hat:{role:'percussion',material:'hat',voice:{instrument:'hat'}},
    metal:{role:'percussion',material:'metal',voice:{instrument:'hat'}}
  },
  sections:['low','glass','violet','turn'].map((harmony,i)=>({id:'bar-'+i,bars:1,harmony}))
},patches:{
  hook:{type:'keys',tine:.39,bite:.44,wear:.25,dust:.08,color:.63,drive:1.28,
    env:{attack:.005,decay:.19,sustain:.43,release:.19}},
  bass:{type:'analog',body:.31,color:.32,width:2.1,drive:1.16,
    env:{attack:.005,decay:.17,sustain:.66,release:.08}},
  pad:{type:'fm',ratio:2.002,index:1.1,indexDecay:.40,color:.55,width:7,body:.30,
    env:{attack:.053,decay:.37,sustain:.61,release:.28}},
  kick:{type:'drum',kind:'kick',tune:43,decay:.207,click:.19,sweep:104},
  snare:{type:'sample',zones:[{samples:['snare-ghost'],velocity:[0,.42],gain:3},
    {samples:['snare-rim'],velocity:[.42,1],gain:3.7}]},
  hat:{type:'sample',zones:[{samples:['hat-closed','hat-closed-alt'],gain:7}]},
  metal:{type:'sample',zones:[{samples:['metal-alt','metal-soft'],gain:3}]}
},tracks:{
  hook:{patch:'hook',gain:-10,pan:.01,highpass:70},
  bass:{patch:'bass',gain:-13,lowpass:2100},
  pad:{patch:'pad',gain:-15,pan:-.2,highpass:110,lowpass:4600},
  kick:{patch:'kick',gain:-9},snare:{patch:'snare',gain:-5,highpass:145},
  hat:{patch:'hat',gain:-10,pan:.38,highpass:700},
  metal:{patch:'metal',gain:-10,pan:-.36,highpass:250}
}};
const session=A.render(source,samples,{sampleRate,stems:true});
const assets=Object.fromEntries(Object.entries(source.tracks).map(([name])=>{
  const file='sources/'+name+'.wav';
  write(at(file),WAV.encode(session.stems[name],{encoding:'pcm24'}));
  return [name,file];
}));
const pad=session.stems.pad, delay=Math.round(.064*sampleRate), halo=new Float64Array(pad.samples.length);
for (let i=delay;i<halo.length/2;i++) {
  const at=2*(i-delay), side=(pad.samples[at]+pad.samples[at+1])*.27;
  halo[2*i]=side; halo[2*i+1]=-side;
}
assets.halo='sources/halo.wav';
write(at(assets.halo),WAV.encode({sampleRate,channels:2,samples:halo},{encoding:'pcm24'}));
json(at('score.json'),source);
const hit=name=>({id:name,source:name});
const masterDrive=9;
const processors={
  'de-box':{type:'eq',bands:[{mode:'highpass',hz:105,q:.707},{mode:'peak',hz:670,q:1.05,gainDb:2.6},
    {mode:'high-shelf',hz:3800,gainDb:1.2}]},
  'low-color':{type:'saturation',driveDb:15,bias:.24,outputDb:-11,toneHz:3200,wet:.69},
  'low-shape':{type:'eq',bands:[{mode:'low-shelf',hz:104,gainDb:-3.7},
    {mode:'peak',hz:416,q:.84,gainDb:2.8}]},
  'kick-key':{type:'compressor',thresholdDb:-32,ratio:5.2,attack:.006,release:.125,lookahead:.012,wet:.74},
  'metal-gate':{type:'gate',thresholdDb:-37,rangeDb:32,hysteresisDb:3,attack:.0005,hold:.016,release:.047},
  'hat-expander':{type:'expander',thresholdDb:-30,ratio:1.7,rangeDb:12,release:.044},
  'rim-shape':{type:'transient',attackDb:5.2,sustainDb:-5.8,fast:.0028,slow:.051,wet:.83},
  smear:{type:'delay',seconds:.391,feedback:.37,wet:1},
  'echo-tone':{type:'eq',bands:[{mode:'highpass',hz:510},{mode:'lowpass',hz:2850}]},
  ceiling:{type:'limiter',inputDb:masterDrive,ceilingDbTP:-1.1,lookahead:.005,release:.078}
};
const base={id:'pocket-radio',sampleRate,map,end:{beat:16},tail:'cut',output:'master',meter:true};
const wet={...base,processors,strips:{
  kick:{clips:[hit('kick')],fader:.88,output:'drums'},
  snare:{clips:[hit('snare')],inserts:['rim-shape'],fader:.82,output:'drums'},
  hat:{clips:[hit('hat')],inserts:['hat-expander'],fader:.79,output:'drums'},
  metal:{clips:[hit('metal')],inserts:['metal-gate'],fader:.86,output:'drums',
    sends:{echo:{tap:'post',level:.22}}},
  drums:{fader:.85},
  bass:{clips:[hit('bass')],inserts:['low-color','low-shape'],fader:1.13},
  hook:{clips:[hit('hook')],inserts:['de-box'],fader:1.17,sends:{echo:{tap:'post',level:.25}}},
  pad:{clips:[hit('pad')],inserts:[{processor:'kick-key',sidechain:{strip:'kick',tap:'pre'}}],fader:.87},
  halo:{clips:[hit('halo')],fader:.82},
  echo:{inserts:['smear','echo-tone'],fader:.78,pan:.31},
  master:{inserts:['ceiling']}
}};
wet.taps={hook:{strip:'hook'}};
const raw={...base,id:'unprocessed',strips:{...Object.fromEntries(Object.keys(assets).map(name=>
  [name,{clips:[hit(name)]}])),master:{}}};
const cli=path.join(__dirname,'../../cli/ink-studio.js');
const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music','mix',...args],{encoding:'utf8'}));
for (const [id,mixer] of [['raw',raw],['mix',wet]]) json(at(id+'.json'),{mixer,assets});
const rawTake=run('render',at('raw.json'),'--out',at('raw'));
const mixed=run('render',at('mix.json'),'--out',at('mix'));
const details=JSON.parse(fs.readFileSync(mixed.report,'utf8'));
const limited=details.strips.master.inserts[0].details;
assert(limited.outputDbTP<=limited.ceilingDbTP && limited.maximumReductionDb>.25);
const reference=WAV.read(rawTake.mix), polished=WAV.read(mixed.mix);
const rawMeasure=M.meter(reference);
const mixLoudness=details.meter.integratedLufs;
const boost=10**(Math.min(mixLoudness-rawMeasure.integratedLufs,-1.1-rawMeasure.truePeakDbTP)/20);
const balanced={...reference,samples:reference.samples.map(x=>x*boost)};
write(at('reference.wav'),WAV.encode(balanced,{encoding:'pcm24'}));
const referenceMeter=M.meter(balanced), auditionTrim=Math.min(0,referenceMeter.integratedLufs-mixLoudness);
const hook=WAV.read(mixed.taps.hook);
// Share the master's static gain with the reference stem before checking its energy.
write(at('focus.wav'),WAV.encode({...hook,samples:hook.samples.map(x=>x*10**(masterDrive/20))},{encoding:'pcm24'}));
const takes=[
  {id:'reference',title:'Balance only',wav:'reference.wav',meter:referenceMeter,playbackDb:0},
  {id:'mix',title:'Mixed stereo',wav:'mix/mix.wav',meter:details.meter,limiter:limited,playbackDb:auditionTrim}
];
for (const [id,title] of [['mono','Mono fold'],['small-speaker','Small speaker']]) {
  const result=run('monitor',mixed.mix,'--mode',id,'--focus',at('focus.wav'),'--out',at(id));
  const report=JSON.parse(fs.readFileSync(result.report,'utf8'));
  takes.push({id,title,wav:id+'/preview.wav',meter:report.monitor,focus:report.focus,bandwidth:report.bandwidth,
    playbackDb:auditionTrim});
}
assert.equal(polished.samples.length,reference.samples.length);
assert(takes[3].focus.changeDb>-3);
json(at('demo.json'),{title:'Pocket Radio',tempo,sampleRate,duration:Math.floor(span*sampleRate)/sampleRate,takes});
console.log(JSON.stringify({limiter:limited,monitor:takes.slice(2).map(take=>take.focus)}));
