/* Low Beam. Three synth voices and repeatable oscillator/filter listening tests. */
const path=require('node:path');
const ink=require('../..'), {KIT:K}=ink.load(), P=K.procedural, A=P.mediaGraph;
const {write,json}=require('../../cli/asset-files.js');
const root=path.resolve(process.argv[2] ?? 'low-beam');
const sampleRate=32000, tempo=112, map={tempo,swing:.518};
const at=name=>path.join(root,name);
const save=(name,value)=>write(at(name),ink.encodeWav(value,{encoding:'pcm24'}));
const envelope=(attack,decay,sustain,release)=>({attack,decay,sustain,release});
const testEnv=envelope(.026,.3,.84,.21);
function voice(patch,midi,gate) {
  const instrument=P.musicInstruments.compile({type:'subtractive',env:testEnv,...patch});
  const note={midi,frequency:P.musicInstruments.hz(midi),velocity:.89,play:{}};
  const sound=instrument.prepare(note,sampleRate,gate);
  return {sampleRate,channels:1,samples:Float64Array.from({length:Math.ceil(sound.duration*sampleRate)},
    (_,i)=>sound.signal(i/sampleRate,i))};
}
function compare(name,rows) {
  const {value,report}=A.gestureBank.audition(rows,{sampleRate,gapSeconds:.44,targetRmsDb:-19,peakDb:-3});
  save(name+'.wav',value);
  return report;
}
const square={saw:0,pulse:.9,sub:.10,pulseWidth:.43,filter:{bypass:true}};
const pwm={depth:.28,rate:.75,phase:.06};
const modulation=compare('pwm',[
  {id:'fixed',value:voice(square,57,2.15)},{id:'moving',value:voice({...square,pwm},57,2.15)}
]);
const filter={cutoff:290,resonance:2.1,keyTrack:0,envAmount:0,velocity:0,env:envelope(.36,.48,.28,.28)};
const saw={saw:1,pulse:0,sub:.09};
const sweep=compare('filter',[
  {id:'held',value:voice({...saw,filter},57,1.65)},
  {id:'swept',value:voice({...saw,filter:{...filter,envAmount:41}},57,1.65)}
]);
const keyFilter={...filter,cutoff:700,resonance:1.15};
const tracking=compare('key-follow',[0,1].flatMap(keyTrack=>[48,72].map(midi=>({
  id:(keyTrack ? 'tracked-' : 'fixed-')+midi,value:voice({...saw,filter:{...keyFilter,keyTrack}},midi,1.15)
}))));

const roots=[42,38,40,40,42,38,35,37];
const harmony={
  minor:{root:'F#3',quality:'minor7',notes:[54,57,61,64,68]},
  d:{root:'D3',quality:'major7',notes:[50,54,57,61,64]},
  a:{root:'A3',quality:'major7',notes:[57,61,64,68,71]},
  e:{root:'E3',quality:'major',notes:[52,59,66,68]},
  b:{root:'B2',quality:'minor7',notes:[47,54,57,61,62]},
  pickup:{root:'C#3',quality:'dominant7',notes:[49,53,59,62,68]},
  close:{root:'F#3',quality:'minor',notes:[54,57,61,68]}
};
const changes=['minor','d','a','e','minor','d','b','pickup','close'];
const chordVoicings=[[54,57,64,68],[54,57,61,64],[52,57,61,71],[52,59,66,68],[54,57,64,68],
  [54,57,61,64],[50,54,61,69],[53,56,59,62],[54,57,61,68]];
const lines={bass:[],lead:[],kick:[],snare:[],hat:[]};
function note(part,bar,beat,duration,midi,velocity,play) {
  const notes=lines[part];
  notes.push({id:part+'-'+notes.length,beat:4*bar+beat,duration,midi,velocity,...(play && {play})});
}
for (const [bar,root] of roots.entries()) {
  const accents=bar===0 ? [[0,0,.61,.81],[1.51,0,.43,.61],[2.73,7,.38,.67],[3.5,0,.33,.73]] :
    [[0,0,.42,.92],[.75,0,.28,.65],[1.51,12,.28,.74],[2,0,.35,.84],[2.76,7,.41,.75],[3.57,0,.25,.62]];
  for (const [i,[beat,offset,len,v]] of accents.entries()) note('bass',bar,beat,len,root+offset,v,
    {delay:[0,.008,-.004,.010,.004,.002][i],brightness:[.59,.30,.49,.43,.52,.37][i],
      ...(bar===4 && i===0 && {articulation:'open',glide:.045})});
  for (const [i,beat] of (bar===3 || bar===7 ? [0,1.48,2.29,3.63] : [0,1.51,2.76]).entries())
    note('kick',bar,beat,.12,36,[.96,.71,.85,.58][i]);
  if (bar) for (const [i,beat] of [1,3].entries())
    note('snare',bar,beat,.12,38,(i===1 ? .82 : .69)*(bar===4 ? 1.15 : 1),{delay:.012});
  for (const [i,beat] of [.50,.77,1.47,2.25,2.51,3.49,3.74].entries()) note('hat',bar,beat,.06,42,
    ([.48,.26,.42,.30,.52,.38,.28][i])*(bar===0 ? .72 : .91),{delay:[.005,-.006,.006,0,.008][i%5]});
}
note('bass',8,0,2.7,42,.81,{articulation:'open',brightness:.44});
note('kick',8,0,.16,36,.73);
const motif=[
  [0,2.64,.42,69,.60],[0,3.27,.48,73,.69],
  [1,.25,.62,76,.88],[1,1.18,.38,73,.73],[1,1.78,1.12,69,.77],[1,3.26,.51,68,.67],
  [2,.54,.36,69,.74],[2,1.27,.31,73,.78],[2,1.79,1.34,76,.91],[2,3.34,.45,71,.63],
  [3,.17,.62,68,.69],[3,1.27,.77,66,.60],[3,2.40,.82,64,.53],
  [4,.46,.39,69,.80],[4,1.21,.42,73,.80],[4,1.81,.58,76,.87],[4,2.57,1.12,81,.97],
  [5,.28,.62,78,.83],[5,1.12,.41,76,.73],[5,1.76,.66,73,.80],[5,2.72,.83,69,.71],
  [6,.51,.42,71,.76],[6,1.31,.48,73,.79],[6,2.06,1.45,78,.91],
  [7,.34,.56,76,.78],[7,1.15,.43,74,.63],[7,1.88,.86,73,.77],[7,3.14,.32,68,.60],
  [8,.49,.72,69,.69],[8,1.61,1.10,66,.62]
];
for (const [i,[bar,beat,len,midi,v]] of motif.entries())
  note('lead',bar,beat,len,midi,v,{delay:[0,.008,-.006,.004][i%4],glide:len>.66 ? .069 : .023,
    vibrato:len>.66 ? 18 : 2,brightness:.35+.45*v,...(len>1 && bar>=4 && {articulation:'bloom'})});
const padVoices=Array.from({length:4},(_,voice)=>{
  const notes=[];
  for (const [bar,chord] of chordVoicings.entries()) {
    const old=notes.at(-1), midi=chord[voice];
    if (old?.midi===midi && old.beat+old.duration===bar*4) old.duration+=4;
    else notes.push({id:'chord-'+bar,beat:bar*4,duration:4,midi,
      velocity:[.51,.60,.59,.56,.71,.68,.65,.62,.45][bar]*(1-.09*voice),play:{delay:.022*voice}});
  }
  return {id:'voice-'+voice,notes};
});
const roles={bass:'bass',lead:'lead',pad:'pad',kick:'percussion',snare:'percussion',hat:'percussion'};
const arrangement={score:{key:{root:'F#4',mode:'minor'},tempoMap:map,endFade:.45,harmonies:harmony,
  changes:changes.map((harmony,bar)=>({id:'bar-'+bar,time:{bar},harmony}))},
  motifs:Object.fromEntries(Object.entries(lines).map(([name,events])=>[name,{length:36,events}])),
  parts:Object.fromEntries(Object.entries(roles).map(([name,role])=>[name,{role,...(name!=='pad' && {material:name})}])),
  sections:[{id:'approach',bars:4},{id:'arrival',bars:4},{id:'tail',bars:1}]};
const subtractive=(mix,width,lfo,amp,filter)=>({type:'subtractive',saw:mix[0],pulse:mix[1],sub:mix[2],
  pulseWidth:width,pwm:lfo,env:amp,filter});
const bass=subtractive([.66,.32,.38],.31,{depth:.065,rate:.32},
  envelope(.008,.19,.65,.115),{cutoff:230,resonance:.99,keyTrack:.32,envAmount:32,velocity:10,
    env:envelope(.013,.26,.15,.13)});
const lead=subtractive([.48,.66,.035],.45,{depth:.155,rate:.65,phase:.11},
  envelope(.018,.31,.58,.26),{cutoff:520,resonance:1.48,keyTrack:.72,envAmount:36,velocity:13,
    env:envelope(.035,.29,.27,.24)});
const pad=subtractive([.41,.72,.065],.41,{depth:.18,rate:.33,phase:.18},
  envelope(.30,.62,.75,.66),{cutoff:470,resonance:.87,keyTrack:.77,envAmount:26,velocity:8,
    env:envelope(.39,.84,.45,.65)});
const production={seed:22771,arrangement,patches:{
  bass:{...bass,articulations:{open:{filter:{envAmount:40},env:{release:.24}}}},
  lead:{...lead,articulations:{bloom:{filter:{envAmount:42,env:{attack:.105,decay:.62}},pwm:{rate:.52}}},
    echo:{delay:.285,feedback:.42,damping:.63,wow:.21,width:.73,send:.18}},
  pad,
  kick:{type:'drum',kind:'kick',tune:48,decay:.27,click:.22,sweep:84},
  snare:{type:'drum',kind:'snare',tune:183,decay:.29,click:.65,color:.64,sweep:23},
  hat:{type:'drum',kind:'hat',tune:654,decay:.108,click:.55,color:.64}
},tracks:{
  bass:{patch:'bass',gain:-9.4,highpass:23,duck:{from:'kick',depth:2.3,release:.105}},
  lead:{patch:'lead',gain:-11.8,highpass:150,lowpass:8000,pan:.04,send:.22},
  pad:{patch:'pad',gain:-15,highpass:155,lowpass:6300,send:.48,clips:[{id:'voicings',beat:0,length:36,voices:padVoices}]},
  kick:{patch:'kick',gain:-10.2,lowpass:4400},
  snare:{patch:'snare',gain:-14.7,highpass:121,lowpass:7900,send:.17},
  hat:{patch:'hat',gain:-25.7,highpass:3900,lowpass:9900,pan:.28,send:.2}
},room:{size:1.17,decay:.67,damping:.61,gain:-15.4}};
const options={sampleRate,tail:1,stems:true};
json(at('production.json'),{production,options});
const rendered=K.music.production.render(production,{},options);
const clip=id=>[{id:'source',source:id}];
const desk={id:'low-beam',sampleRate,map,tail:'cut',output:'master',strips:{
  bass:{clips:clip('bass')},lead:{clips:clip('lead')},pad:{clips:clip('pad'),inserts:['chorus']},
  kick:{clips:clip('kick')},hat:{clips:clip('hat')},room:{clips:clip('room')},
  snare:{clips:clip('snare'),sends:{gated:{tap:'post',level:.85}}},
  gated:{inserts:['chamber',{processor:'gate',sidechain:{strip:'snare',tap:'pre'}}],fader:.82},
  master:{}
},processors:{
  chorus:{type:'modulation',mode:'chorus',delayMs:16.2,depthMs:3.2,rateHz:.41,spread:.31,wet:.49},
  chamber:{type:'reverb',size:.88,decay:.62,damping:.56,wet:1},
  gate:{type:'gate',thresholdDb:-42,rangeDb:60,hysteresisDb:4,attack:.001,hold:.112,release:.046}
}};
const {value}=A.mixer.render(desk,rendered.stems);
const meter=A.mixerMonitor.meter(value), gain=10**(Math.min(-1.6-meter.truePeakDbTP,-15-meter.integratedLufs)/20);
save('low-beam.wav',{...value,samples:value.samples.map(x=>x*gain)});
const mixAssets=Object.fromEntries(Object.entries(rendered.stems).map(([id,pcm])=>{
  const name='stems/'+id+'.wav';
  save(name,pcm,'float64');
  return [id,name];
}));
json(at('mix.json'),{mixer:desk,assets:mixAssets});
const {events}=K.music.production.inspect(production);
json(at('demo.json'),{sampleRate,tempo,modulation,sweep,tracking,pwm,width:square.pulseWidth,
  cutoff:filter.cutoff,cutoffPeak:filter.cutoff*2**(41/12),patches:{bass,lead,pad},master:{gain},
  events:Object.fromEntries(Object.entries(events).map(([id,notes])=>[id,notes.map(({time,gate,midi})=>({time,gate,midi}))]))});
console.log(at('demo.json'));
