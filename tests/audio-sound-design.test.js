const assert=require('node:assert/strict'), {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ink=require('..'), A=ink.load().KIT.procedural.mediaGraph, WAV=require('../cli/wav');
const rate=8000, tau=2*Math.PI;
const mono=(frames,fn,sampleRate=rate)=>({sampleRate,channels:1,samples:Float64Array.from({length:frames},(_,i)=>fn(i))});
const tone=(frequency,frames)=>mono(frames,i=>.23*Math.sin(tau*frequency*i/rate));
const impulse=(frames,where=0,value=.5)=>mono(frames,i=>i===where ? value : 0);
const at=(audio,i,ch=0)=>audio.samples[2*i+ch];
const near=(a,b,eps=1e-8)=>assert(Math.abs(a-b)<=eps,`${a} vs ${b}`);
const power=(audio,from,to)=>Math.sqrt(Array.from({length:to-from},(_,i)=>at(audio,i+from)**2)
  .reduce((a,b)=>a+b,0)/(to-from));
const desk=(processor,extra={})=>({id:'sound-design',sampleRate:rate,output:'out',
  strips:{out:{clips:[{id:'src',source:'src'}],inserts:['fx']}},processors:{fx:processor},...extra});
const render=(processor,src,extra,assets={})=>A.mixer.render(desk(processor,extra),{src,...assets});

test('tempo delay follows actual beat distances across tempo and swing, and saturates only repeats',()=>{
  const map={tempo:120,swing:.6,changes:[{beat:2,tempo:60,swing:.5}]};
  const main=impulse(6800,6400,.65);
  const dryLoop={type:'tempo-delay',beats:.75,feedback:.65,lowHz:150,highHz:1700};
  const plain=render(dryLoop,main,{map}), driven=render({...dryLoop,driveDb:20},main,{map});
  near(at(plain.value,9998),0);
  near(at(plain.value,10000),.65);
  near(at(driven.value,10000),.65);
  assert(Math.abs(at(plain.value,16000))>.2);
  assert(Math.abs(at(driven.value,16000))<Math.abs(at(plain.value,16000))*.4);
  const swapped=render({...dryLoop,crossfeed:1},{sampleRate:rate,channels:2,
    samples:Array.from(main.samples).flatMap(x=>[x,0])},{map});
  near(at(swapped.value,16000,0),0);
  near(at(swapped.value,16000,1),at(plain.value,16000));
});

test('convolution imports stereo impulse slices, retains their tails and aligns the dry part',()=>{
  const ir={sampleRate:rate,channels:2,samples:[0,0,.5,0,.1,.4,-.25,.15,0,0]};
  const effect={type:'convolution',impulse:'hall',fromSample:1,toSample:4,preDelayMs:.25,wet:.5};
  const result=render(effect,impulse(3,2),undefined,{hall:ir});
  assert.equal(result.report.frames,7);
  near(at(result.value,2),.25);
  near(at(result.value,4),.125);
  near(at(result.value,4,1),0);
  near(at(result.value,5),.025);
  near(at(result.value,5,1),.1);
  near(at(result.value,6),-.0625);
  const reversed=render({...effect,reverse:true,wet:1},impulse(3,2),undefined,{hall:ir});
  near(at(reversed.value,4),-.125);
  near(at(reversed.value,6),.25);
  const halfRate=mono(12,()=>.2,4000);
  const resampled=render({type:'convolution',impulse:'hall'},impulse(2),undefined,{hall:halfRate});
  assert.equal(resampled.report.strips.out.inserts[0].details.impulseFrames,24);
  near(at(resampled.value,16),.1);
  const long=mono(33000,i=>i===0 ? .17 : i===32770 ? -.2 : i===32999 ? .33 : 0);
  const partitioned=render({type:'convolution',impulse:'hall'},impulse(2),undefined,{hall:long});
  assert.equal(partitioned.report.strips.out.inserts[0].details.partitions,2);
  near(at(partitioned.value,32770),-.1);
  near(at(partitioned.value,32999),.165);
});

test('modulation uses a delayed voice and tape drift compensates its center delay',()=>{
  const source=impulse(200,20,.4);
  const chorus=render({type:'modulation',mode:'chorus',delayMs:4,depthMs:0,wet:.5},source).value;
  near(at(chorus,20),.2);
  near(at(chorus,52),.2);
  const neutral=render({type:'tape-drift',wowCents:0,flutterCents:0},source);
  assert.equal(neutral.report.latencySamples,3);
  near(at(neutral.value,20),.4);
  assert.equal(neutral.value.samples.filter(x=>x!==0).length,2);
  const sweep={type:'tape-drift',wowHz:.8,wowCents:55,flutterCents:14,seed:17}, steady=tone(600,4400);
  const first=render(sweep,steady).value, again=render(sweep,steady).value;
  assert.deepEqual(first,again);
  assert.notEqual(at(first,2600),steady.samples[2600]);
});

test('granular scanning is neutral at matched speed and can hold a seeded pitched region',()=>{
  const source=tone(338,4800), straight={type:'granular',grainMs:100,density:40,scanRate:1,spread:0,sprayMs:0,jitterCents:0};
  const neutral=render(straight,source).value;
  for (let i=1100;i<2500;i+=29) near(at(neutral,i),source.samples[i]);
  const frozen={...straight,start:{seconds:.21},scanRate:0,semitones:7,reverse:.5,sprayMs:15,
    jitterCents:75,extendSeconds:.55,seed:14};
  const result=render(frozen,source);
  assert(power(result.value,5200,7900)>.025);
  assert(result.report.strips.out.inserts[0].details.grains>30);
  assert.deepEqual(result.value,render(frozen,source).value);
  assert.notDeepEqual(result.value,render({...frozen,seed:15},source).value);
});

test('spectral freeze keeps energy and pitch beyond the capture and releases at the authored sample',()=>{
  const input=tone(343,3400);
  const effect={type:'spectral-freeze',at:{samples:2200},until:{samples:7600},size:1024,fadeMs:12};
  const result=render(effect,input,{end:{samples:8100}});
  assert.equal(result.report.latencySamples,512);
  assert.equal(result.report.strips.out.inserts[0].details.captureSample,2200);
  near(at(result.value,1000),input.samples[1000]);
  assert(power(result.value,5100,7100)>.12);
  const crossings=Array.from({length:1999},(_,i)=>at(result.value,5100+i)<=0&&at(result.value,5101+i)>0).filter(Boolean);
  assert(crossings.length>=84&&crossings.length<=87);
  near(at(result.value,7680),0);
});

test('retro rate, bit depth, reconstruction and repeated replay work independently',()=>{
  const x=[.03,.13,.26,.41,.64,.8,.49,.28], input=mono(x.length,i=>x[i]);
  const process=controls=>render({type:'retro-sampler',...controls},input,{tail:'cut'});
  const first=out=>x.map((_,i)=>at(out,i));
  assert.deepEqual(first(process({}).value),x);
  assert.deepEqual(first(process({rateHz:4000}).value),[.03,.03,.26,.26,.64,.64,.49,.49]);
  const interpolated=process({rateHz:4000,interpolation:'linear'});
  near(at(interpolated.value,1),.145);
  assert.equal(interpolated.report.latencySamples,3);
  assert.notEqual(at(process({rateHz:4000,interpolation:'cubic'}).value,1),at(interpolated.value,1));
  assert.deepEqual(first(process({bits:3}).value),[0,.25,.25,.5,.75,.75,.5,.25]);
  const replay=process({retriggers:[{at:{samples:3},from:{samples:1},length:{samples:2},every:{samples:3},count:2}]});
  assert.deepEqual(first(replay.value),[.03,.13,.26,.13,.26,.8,.13,.26]);
  assert.equal(replay.report.strips.out.inserts[0].details.retriggers,2);
});

test('mixer CLI resolves a WAV that is used exclusively as an imported impulse',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-convolve-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'source.wav'),WAV.encode(impulse(8),{encoding:'pcm24'}));
  fs.writeFileSync(path.join(dir,'ir.wav'),WAV.encode(impulse(5,3,.5),{encoding:'pcm24'}));
  const recipe={mixer:desk({type:'convolution',impulse:'room'}),assets:{src:'source.wav',room:'ir.wav'}};
  fs.writeFileSync(path.join(dir,'session.json'),JSON.stringify(recipe));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const files=JSON.parse(execFileSync(process.execPath,[cli,'music','mix','render','session.json','--out','mix'],
    {cwd:dir,encoding:'utf8'}));
  near(at(WAV.read(files.mix),3),.25);
});
