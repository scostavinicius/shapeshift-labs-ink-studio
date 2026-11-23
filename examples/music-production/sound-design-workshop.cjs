/* Run: node examples/music-production/sound-design-workshop.cjs output-directory */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {KIT:K}=require('../..').load(), P=K.procedural,A=K.music.production;
const {write,json}=require('../../cli/asset-files'),WAV=require('../../cli/wav');
const folder=path.resolve(process.argv[2] ?? 'sound-design-workshop'),at=file=>path.join(folder,file);
const sampleRate=24000,tempo=120,map={tempo},frame=seconds=>Math.round(seconds*sampleRate);
const files=Object.fromEntries(['metal-soft','metal-alt','snare-rim','hat-closed'].map(name=>
  [name,WAV.read(path.join(__dirname,'samples',name+'.wav'))]));
const notes=rows=>({length:4,events:rows.map(([beat,duration,velocity,midi])=>({beat,duration,velocity,midi}))});
const hits=rows=>({length:4,events:rows.map(([beat,velocity])=>({beat,velocity,duration:.09,degree:1}))});
const phrase={seed:785,arrangement:{
  score:{tempoMap:map,endFade:.075,key:{root:'D4',mode:'minor'},harmonies:{
    dusk:{root:'D3',quality:'minor7',voicing:{air:'F4'}}
  }},
  parts:{keys:{role:'lead',material:'glints'},air:{role:'pad',material:'air'},
    strike:{role:'percussion',material:'metal',voice:{instrument:'hat'}},
    tick:{role:'percussion',material:'tick',voice:{instrument:'snare'}}},
  motifs:{
    glints:notes([[.15,.30,.85,62],[.75,.25,.59,65],[1.26,.46,.84,69],[2.31,.24,.68,76],[2.89,.76,.85,72]]),
    air:notes([[2.75,1.11,.65,53]]),
    metal:hits([[0,.75],[1.03,.58],[2.64,.65]]),tick:hits([[.47,.36],[1.72,.57],[3.52,.37]])
  },
  sections:[{id:'letter',bars:1,harmony:'dusk'}]
},patches:{
  keys:{type:'keys',tine:.43,bite:.53,wear:.18,dust:.06,color:.61,drive:1.21,
    env:{attack:.004,decay:.21,sustain:.52,release:.13}},
  air:{type:'fm',ratio:1.999,index:1.31,indexDecay:.19,color:.5,body:.39,width:2.6,
    env:{attack:.042,decay:.23,sustain:.66,release:.172}},
  strike:{type:'sample',zones:[{samples:['metal-soft','metal-alt'],gain:4.3}]},
  tick:{type:'sample',zones:[{samples:['hat-closed','snare-rim'],gain:2.8}]}
},tracks:{
  keys:{patch:'keys',gain:-8.5,pan:.03,highpass:92},
  air:{patch:'air',gain:-14,pan:-.19,highpass:114},
  strike:{patch:'strike',gain:-9,pan:-.32,highpass:192},
  tick:{patch:'tick',gain:-12,pan:.38,highpass:570}
}};
const dry=A.render(phrase,files,{sampleRate}).value;
write(at('phrase.wav'),WAV.encode(dry,{encoding:'pcm24'}));
json(at('phrase.json'),phrase);

// Create a stereo response from an existing recorded brake-drum ring and discrete reflections.
const ring=files['metal-soft'], ringPeak=ring.samples.reduce((peak,x)=>Math.max(peak,Math.abs(x)),0);
const irFrames=frame(.82), response=new Float64Array(irFrames*2);
const taps=[
  [[.013,.52],[.038,-.19],[.067,.21],[.103,.105],[.17,-.073],[.29,.04]],
  [[.019,.48],[.046,.23],[.071,-.19],[.126,.117],[.19,.072],[.31,-.045]]
];
for (let ch=0;ch<2;ch++) {
  for (const [seconds,value] of taps[ch]) response[2*frame(seconds)+ch]=value;
  let previous=0;
  for (let i=0;i<frame(.51);i++) {
    const x=ring.samples[Math.floor(i*ring.sampleRate/sampleRate)] ?? 0;
    previous+=(x-previous)*.13;
    const index=frame(.025+ch*.014)+i;
    response[2*index+ch]+=(x-previous)/ringPeak*.036*Math.exp(-i/(sampleRate*.135));
  }
}
write(at('cabinet-ir.wav'),WAV.encode({sampleRate,channels:2,samples:response},{encoding:'pcm24'}));
const assetFiles={phrase:'phrase.wav',cabinet:'cabinet-ir.wav'};
const graph=(...inserts)=>Object.fromEntries(inserts.map((row,i)=>['insert-'+i,row]));
const echo={type:'tempo-delay',beats:{numerator:3,denominator:4},feedback:.70,
  lowHz:320,highHz:2800,driveDb:17,crossfeed:.82,wet:.56};
const hall={type:'convolution',impulse:'cabinet',preDelayMs:16,gainDb:-3.5,wet:.82};
const chorus={type:'modulation',mode:'chorus',delayMs:15,depthMs:5.1,rateHz:.85,spread:.37,wet:.62};
const drift={type:'tape-drift',wowHz:.65,wowCents:57,flutterHz:7.4,flutterCents:11,spread:.14,seed:810};
const grains={type:'granular',grainMs:143,density:31,start:{beat:.64},scanRate:.42,semitones:-7,
  sprayMs:53,jitterCents:65,reverse:.32,spread:.56,extendSeconds:1.55,seed:21,wet:.93};
const freeze={type:'spectral-freeze',at:{beat:3.48},until:{beat:7.85},size:2048,fadeMs:95};
const rateOnly={type:'retro-sampler',rateHz:3500};
const bitsOnly={type:'retro-sampler',bits:4};
const cubic={...rateOnly,interpolation:'cubic'};
const retrigger={type:'retro-sampler',retriggers:[
  {at:{beat:1.75},from:{beat:1.25},length:{beats:.20},every:{beats:.25},count:4},
  {at:{beat:3.4},from:{beat:0},length:{beats:.14},every:{beats:.20},count:3}
]};
const takes=[
  ['dry','The phrase','The same keys and metal hits feed every pass.',4,[],['DRY INPUT']],
  ['echo','Tempo echo','The first echo is clean. Later repeats are filtered and driven.',8,[echo],['3/4 BEAT','FILTERED FEEDBACK','SATURATION']],
  ['cabinet','Convolution','An imported stereo response made from a recorded brake drum and reflections.',6,[hall],['CABINET IR WAV','STEREO RESPONSE']],
  ['chorus','Modulation','A stereo chorus bends copies of the signal around the dry phrase.',4,[chorus],['CHORUS','STEREO LFO']],
  ['tape','Tape drift','Slow wow bends the notes while a faster flutter roughens the edges.',4,[drift],['WOW','FLUTTER']],
  ['granular','Granular scan','Short grains drift through the phrase independently of pitch.',7,[grains],['143 ms GRAINS','0.42x SCAN','−7 SEMITONES']],
  ['freeze','Spectral freeze','The last chord holds while the input ends, then fades out.',8,[freeze],['BIN MAGNITUDES HELD','PHASE ADVANCES']],
  ['rate','Retro · sample rate','A slower clock with the original bit depth and a held reconstruction.',4,[rateOnly],['3.5 kHz','FULL PRECISION','HOLD']],
  ['bits','Retro · quantization','Four-bit steps at the normal sample rate.',4,[bitsOnly],['24 kHz','4 BITS']],
  ['cubic','Retro · interpolation','The same reduced clock, now with cubic reconstruction.',4,[cubic],['3.5 kHz','FULL PRECISION','CUBIC']],
  ['retrigger','Retro · retrigger','Beat-timed resets replay earlier pieces at the original rate and depth.',4,[retrigger],['24 kHz','FULL PRECISION','7 REPLAYS']]
];
const cli=path.join(__dirname,'../../cli/ink-studio.js');
const results=[];
for (const [id,title,detail,end,effects,labels] of takes) {
  const processors=graph(...effects), clip={id:'letter',source:'phrase'};
  const session={id,sampleRate,map,end:{beat:end},tail:'cut',output:'master',
    strips:{master:{clips:[clip],inserts:Object.keys(processors)}},processors};
  json(at(id+'.json'),{mixer:session,assets:assetFiles});
  const output=JSON.parse(execFileSync(process.execPath,[cli,'music','mix','render',at(id+'.json'),'--out',at(id)],
    {encoding:'utf8'}));
  const report=JSON.parse(fs.readFileSync(output.report,'utf8'));
  const pcm=WAV.read(output.mix);
  const meter=P.mediaGraph.mixerMonitor.meter(pcm);
  assert(meter.samplePeakDbFS!==null && meter.samplePeakDbFS<0);
  results.push({id,title,detail,labels,wav:id+'/mix.wav',duration:report.frames/sampleRate,peak:meter.truePeakDbTP,
    latency:report.latencySamples,inserts:report.strips.master.inserts});
}
const held=WAV.read(at('freeze/mix.wav'));
const peak=(samples,first,end)=>samples.subarray(frame(first)*2,frame(end)*2)
  .reduce((max,x)=>Math.max(max,Math.abs(x)),0);
assert(peak(held.samples,2.5,3.6)>.025);
assert.equal(results.at(-1).inserts[0].details.retriggers,7);
json(at('demo.json'),{title:'Signal Cabinet',sampleRate,tempo,takes:results});
console.log(JSON.stringify(results.map(({id,peak,latency})=>({id,peak,latency}))));
