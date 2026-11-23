/* Run with output-dir [breath.wav laugh.wav [signalsmith-probe]]. External fixtures are optional. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{execFileSync,spawnSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),{mediaGraph:A}=kit.KIT.procedural;
const WAV=require('../../cli/wav'),{write,json}=require('../../cli/asset-files');
const [dir='sample-instrument-workshop',breathFile,laughFile,worker]=process.argv.slice(2);
const at=name=>path.resolve(dir,name), rate=32000,tau=Math.PI*2, frame=t=>Math.round(t*rate);
const clamp=x=>Math.max(0,Math.min(1,x));
const envelope=(t,len,head=.03,tail=.068)=>Math.sin(Math.PI*.5*clamp(t/head))**2*
  Math.sin(Math.PI*.5*clamp((len-t)/tail))**2;
const pcm=samples=>({sampleRate:rate,channels:1,samples});
const save=(file,value)=>write(at(file),WAV.encode(value,{encoding:'pcm24'}));
function noiseBank(seed) {
  return ()=>{
    seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
    return (seed>>>0)/2147483648-1;
  };
}
function gesture({length,f0,kind,variant=0}) {
  const noise=noiseBank(987213+variant*517), samples=new Float64Array(frame(length));
  let phase=0, low=0, soft=0;
  for (let i=0;i<samples.length;i++) {
    const t=i/rate, u=t/length, white=noise();
    low+=(white-low)*.061;soft+=(white-soft)*.22;
    const breath=.38*(soft-low)+.04*white;
    const move=kind==='gliss' ? 130*Math.sin(Math.PI*u)**2-120*clamp((u-.55)/.42) : -270*u;
    const hz=f0*2**((move+19*Math.sin(tau*5.4*t+variant*.2))/1200);
    phase+=tau*hz/rate;
    let voice=0;
    const vowel=610+180*Math.sin(Math.PI*u), front=1410+variant*70-300*u;
    for (let k=1;k<=19;k++) {
      const freq=hz*k, near=(center,width)=>Math.exp(-.5*((freq-center)/width)**2);
      const gain=(.20+.88*near(vowel,115)+.45*near(front,205)+.13*near(2670,230))/k**.64;
      voice+=gain*Math.sin(k*phase+.08*k*k);
    }
    const pulse=kind==='laugh' ? Math.max(0,Math.sin(tau*3.6*t+.55))**1.4 : 1;
    const air=kind==='breath' ? 1 : .24+.60*Math.exp(-t*28);
    const voiced=kind==='breath' ? 0 : clamp((t-.037)/.042);
    samples[i]=envelope(t,length)*pulse*(.27*voiced*voice+breath*air);
  }
  return pcm(samples);
}
function external(file,from,end,fallback) {
  if (!file) return fallback;
  const input=ink.readWav(file);
  assert.equal(input.sampleRate,rate,'Pass demo recordings at 32000 Hz');
  assert.equal(input.channels,1,'Pass mono demo recordings');
  const samples=input.samples.slice(frame(from),frame(end));
  assert(samples.length>frame(.3),'Recording needs the indicated demo excerpt');
  let peak=0;
  for (const x of samples) peak=Math.max(peak,Math.abs(x));
  assert(peak>0,'Demo excerpt needs sound');
  return pcm(Float64Array.from(samples,(x,i)=>.63*x/peak*envelope(i/rate,samples.length/rate,.022,.035)));
}
const takes={
  breath:external(breathFile,8.05,8.95,gesture({length:.9,f0:120,kind:'breath'})),
  laugh:external(laughFile,.18,1.23,gesture({length:1.05,f0:263,kind:'laugh'})),
  gliss:gesture({length:.96,f0:220,kind:'gliss'}),
  'gliss-b':gesture({length:.96,f0:233.08,kind:'gliss',variant:1})
};
for (const [name,value] of Object.entries(takes)) save(name+'.wav',value);
function serial(name,segments,gap=.13) {
  const channels=2, padding=frame(gap), length=segments.reduce((n,row)=>n+row.value.samples.length/row.value.channels+padding,0);
  const samples=new Float64Array(length*channels), timelines=[];
  let writeAt=0;
  for (const row of segments) {
    const source=row.value, frames=source.samples.length/source.channels;
    let peak=0;
    for (const x of source.samples) peak=Math.max(peak,Math.abs(x));
    const gain=peak>0 ? Math.min(5,.66/peak) : 1;
    for (let i=0;i<frames;i++) for (let ch=0;ch<2;ch++)
      samples[(writeAt+i)*2+ch]=source.samples[i*source.channels+(source.channels===1 ? 0 : ch)]*gain;
    timelines.push({label:row.label,firstSample:writeAt,endSample:writeAt+frames});
    writeAt+=frames+padding;
  }
  save(name,{sampleRate:rate,channels,samples});
  return timelines;
}
const reloaded=Object.fromEntries(Object.keys(takes).map(name=>[name,ink.readWav(at(name+'.wav'))]));
const sampleReport=A.sampleInstrument.analyze(reloaded);
const sourceReel=serial('sources.wav',['breath','laugh','gliss'].map(name=>({label:name,value:reloaded[name]})));
const rangeRecipe={assets:{gliss:'gliss.wav'},audition:{offsets:[-5,-2,0,3,7],sampleRate:rate,gap:.15,
  shape:{duration:.69,formantCents:0,attackFrames:1240}}};
const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),...args],
  {encoding:'utf8',maxBuffer:4e6}));
json(at('range.json'),rangeRecipe);
const range=cli('music','instrument','audition',at('range.json'),'--out',at('range'));
const rangeReport=JSON.parse(fs.readFileSync(range.report,'utf8'));
const timbreShapes=[
  {label:'Vowel held',options:{pitchCents:300,duration:.82,formantCents:0,attackFrames:1240}},
  {label:'Larger vowel',options:{pitchCents:300,duration:.82,formantCents:-650,attackFrames:1240}},
  {label:'Shorter, same pitch',options:{pitchCents:300,duration:.53,formantCents:0,attackFrames:1240}}
];
const shaped=timbreShapes.map(({label,options})=>({label,...A.shapeInstrumentSample(reloaded.gliss,options)}));
assert(shaped.every(row=>row.value.samples.slice(0,1240).every((x,i)=>x===reloaded.gliss.samples[i])));
const shaping=serial('shaping.wav',shaped,.22);
const configuration={assets:Object.fromEntries(Object.keys(takes).map(name=>[name,name+'.wav'])),zones:[
  {id:'air',label:'Hollow air',low:48,high:48,takes:['breath'],root:null,shape:{duration:.58,formantCents:-420}},
  {id:'laugh',label:'Dry pulse',low:52,high:52,takes:['laugh'],root:null,shape:{pitchCents:-500,duration:.5,formantCents:-300}},
  {id:'glide',label:'Answer',low:57,high:64,takes:['gliss','gliss-b'],roots:{gliss:'A3','gliss-b':'Bb3'},
    shape:{duration:.66,formantCents:-190,attackFrames:1240}}
]};
json(at('instrument-recipe.json'),configuration);
const built=cli('music','instrument','build',at('instrument-recipe.json'),'--out',at('bank'));
const manifest=JSON.parse(fs.readFileSync(built.instrument,'utf8'));
const lines={
  lead:[[.25,.45,57,.89],[1.5,.33,60,.70],[2.25,.32,59,.80],[4,.42,57,.66],
    [5.5,.38,62,.86],[6.2,.42,64,.78],[7.36,.31,61,.61]],
  air:[[0,.26,48,.80],[2.93,.3,48,.55],[4.8,.25,48,.56],[7.0,.24,48,.45]],
  teeth:[[1.89,.24,52,.58],[2.79,.28,52,.70],[3.52,.25,52,.40],[5.13,.25,52,.53],[6.94,.25,52,.46]],
  bass:[[0,.83,38,.82],[.91,.39,38,.46],[1.7,.45,41,.68],[2.68,.37,36,.62],
    [4,.78,38,.72],[5.31,.48,43,.57],[6.3,.73,33,.69]],
  tap:[[0,.2,38,.74],[.75,.1,41,.43],[1.76,.14,40,.53],[3.15,.08,39,.44],
    [3.74,.08,41,.39],[4.59,.12,39,.46],[5.29,.11,39,.46],[6.83,.12,41,.55],[7.66,.08,38,.36]]
};
const names=Object.keys(lines), motif=(rows)=>({length:8,events:rows.map(([beat,duration,midi,velocity])=>
  ({beat,duration,midi,velocity}))});
const arrangement={score:{key:{root:'D3',mode:'dorian'},tempoMap:{tempo:86},
  harmonies:{home:{root:'D3',quality:'minor'}}},sections:[{id:'glass',bars:2,harmony:'home'}],
  parts:Object.fromEntries(names.map(name=>[name,{role:name==='bass' ? 'bass' : 'lead',material:name}])),
  motifs:Object.fromEntries(names.map(name=>[name,motif(lines[name])]))};
const production={arrangement,seed:57,patches:{gesture:manifest.patch,
  bass:{type:'analog',grain:.018,body:.25,width:6,color:.35,env:{attack:.021,decay:.4,sustain:.49,release:.19}},
  tap:{type:'drum',kind:'metal',tune:194,decay:.13,click:.28,color:.34}},
  tracks:{lead:{patch:'gesture',gain:-4,send:.31,pan:.07},air:{patch:'gesture',gain:-10,send:.70,pan:-.32},
    teeth:{patch:'gesture',gain:-13,send:.22,pan:.27,highpass:165},
    bass:{patch:'bass',gain:-13,send:.06,pan:-.06,lowpass:700},tap:{patch:'tap',gain:-21,send:.29,pan:-.37}},
  room:{gain:-14,size:1,decay:1.05,damping:.49}};
json(at('phrase.json'),{production,options:{sampleRate:rate},
  assets:Object.fromEntries(Object.entries(manifest.assets).map(([id,file])=>[id,'bank/'+file]))});
const take=cli('music','production','render',at('phrase.json'),'--out',at('performed'));
const comparison=[];
if (worker) {
  const compareReel=[];
  for (const name of ['breath','laugh','gliss']) {
    const input=reloaded[name], frames=input.samples.length, target=Math.round(frames*.8), attack=1024, join=416;
    const options={duration:.8,pitchCents:-500,formantCents:-300,attackFrames:attack,joinFrames:join,
      mode:name==='breath' ? 'speech' : 'tones',fundamentalHz:sampleReport.takes[name].root?.hz ?? 180};
    const native=A.shapeInstrumentSample(input,options).value;
    const f32=Float32Array.from(input.samples);
    const inFile=at(name+'.f32'),outFile=at(name+'-signalsmith.f32');
    write(inFile,Buffer.from(f32.buffer));
    const args=[inFile,outFile,rate,target,attack,join,-5,-3,options.fundamentalHz].map(String);
    const result=JSON.parse(execFileSync(worker,args,{encoding:'utf8'}));
    const raw=fs.readFileSync(outFile), script=pcm(Float64Array.from({length:raw.length/4},(_,i)=>raw.readFloatLE(i*4)));
    assert.equal(script.samples.length,native.samples.length);
    assert(script.samples.slice(0,attack).every((x,i)=>x===f32[i]));
    const peakRms=value=>{
      let p=0,s=0;
      for (const x of value.samples) {assert(Number.isFinite(x));p=Math.max(p,Math.abs(x));s+=x*x;}
      return {peak:p,rms:Math.sqrt(s/value.samples.length)};
    };
    comparison.push({take:name,settings:options,native:peakRms(native),signalsmith:{...result,...peakRms(script)}});
    compareReel.push({label:name+' / Native',value:native},{label:name+' / Signalsmith',value:script});
  }
  const short=pcm(reloaded.gliss.samples.slice(0,frame(.065))), values=Float32Array.from(short.samples);
  write(at('short.f32'),Buffer.from(values.buffer));
  const stats=spawnSync(worker,[at('short.f32'),at('short-out.f32'),rate,frame(.052),160,64,3,0,220].map(String));
  const shortNative=A.shapeInstrumentSample(short,{duration:.8,pitchCents:300,attackFrames:160,joinFrames:64});
  comparison.push({take:'65 ms one-shot',nativeFrames:shortNative.value.samples.length,signalsmithStatus:stats.status});
  serial('backend-comparison.wav',compareReel,.24);
}
json(at('demo.json'),{rate,sourceReel,shaping,shaped:shaped.map(row=>row.report),range:rangeReport.rows,
  analysis:sampleReport.takes,phrase:take,events:lines,comparison,zones:configuration.zones.length});
console.log(JSON.stringify({instrument:built.instrument,phrase:take.mix,comparison}));
