const assert=require('node:assert/strict'),{test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ink=require('..'),A=ink.load().KIT.procedural.mediaGraph,WAV=require('../cli/wav');
const rate=16000,tau=2*Math.PI;
const mono=(frames,sample)=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:frames},(_,i)=>sample(i))});
const tone=(frequency,amplitude=.1,frames=8192,phase=0)=>mono(frames,i=>amplitude*Math.sin(tau*frequency*i/rate+phase));
const at=(audio,i)=>audio.samples[i*audio.channels];
const near=(a,b,eps=1e-5)=>assert(Math.abs(a-b)<=eps,`${a} vs ${b}`);
const clip=source=>({id:source,source});
const patch=(processor,source,extra={})=>A.mixer.render({
  id:'test',sampleRate:rate,output:'out',strips:{out:{clips:[clip('source')],inserts:['fx']}},
  processors:{fx:processor},peakPolicy:'error',...extra
},{source});
function rms(audio,from,to) {
  let sum=0;
  for (let i=from;i<to;i++) sum+=at(audio,i)**2;
  return Math.sqrt(sum/(to-from));
}
function harmonic(audio,hz) {
  let sine=0,cosine=0;
  for (let i=4096;i<8192;i++) {
    const phase=tau*hz*i/rate, sample=at(audio,i);
    sine+=sample*Math.sin(phase); cosine+=sample*Math.cos(phase);
  }
  return Math.hypot(sine,cosine)/2048;
}

test('parametric bands place bell gain and notch depth at the authored frequency',()=>{
  const input=tone(1000);
  const bell=patch({type:'eq',bands:[{mode:'peak',hz:1000,q:1.2,gainDb:6}]},input);
  const notch=patch({type:'eq',bands:[{mode:'notch',hz:1000,q:2}]},input);
  near(rms(bell.value,4096,8192)/rms(input,4096,8192),10**(.3));
  assert(rms(notch.value,4096,8192)<1e-7);
  assert(bell.report.strips.out.inserts[0].tail>0);
  const shelf={type:'eq',bands:[{mode:'low-shelf',hz:600,gainDb:-9},{mode:'high-shelf',hz:2200,gainDb:6}]};
  const low=rms(patch(shelf,tone(100)).value,4096,8192), high=rms(patch(shelf,tone(3900)).value,4096,8192);
  assert(high/low>4);
  const ramp={unit:'samples',points:[{at:0,value:0},{at:6144,value:9}]};
  const automated=patch({type:'eq',bands:[{mode:'peak',hz:1000,gainDb:ramp}]},input).value;
  assert(rms(automated,6000,8000)>2*rms(automated,128,1152));
});

test('external gate key respects hold and an expander scales below threshold without muting',()=>{
  const source=mono(2400,()=>.1), key=mono(2400,i=>i>=700 && i<1200 ? .4 : 0);
  const gate=A.mixer.render({
    id:'keyed',sampleRate:rate,output:'out',strips:{
      trigger:{clips:[clip('key')],output:null},
      out:{clips:[clip('source')],inserts:[{processor:'open',sidechain:{strip:'trigger'}}]}
    },processors:{open:{type:'gate',thresholdDb:-25,rangeDb:40,attack:.001,hold:.012,release:.004}}
  },{source,key}).value;
  near(at(gate,600),.001);
  assert(at(gate,850)>.09);
  assert(at(gate,1370)>.09);
  assert(at(gate,2050)<.0011);
  const exp=patch({type:'expander',thresholdDb:20*Math.log10(.2),ratio:2,rangeDb:24},source).value;
  near(at(exp,1000),.05);
});

test('transient shaping changes attack and decay separately and saturation adds harmonics',()=>{
  const hit=mono(4096,i=>i<800 ? .07 : .023);
  const shaped=patch({type:'transient',attackDb:8,sustainDb:-6,fast:.003,slow:.04},hit).value;
  assert(at(shaped,0)>1.9*at(hit,0));
  assert(at(shaped,960)<.75*at(hit,960));
  const pure=tone(500,.27);
  const warm=patch({type:'saturation',driveDb:13,bias:.29,toneHz:6000,outputDb:-7},pure).value;
  assert(harmonic(warm,1000)>.007);
  assert(harmonic(warm,1500)>.01);
  const mean=Array.from({length:4096},(_,i)=>at(warm,4096+i)).reduce((a,b)=>a+b,0)/4096;
  assert(Math.abs(mean)<.001);
});

test('a true-peak limiter catches inter-sample overs, releases, and reports join compensation',()=>{
  const input=mono(4096,i=>(i<1000 ? .05 : i<2000 ? .96 : .05)*Math.sin(Math.PI*i/2+Math.PI/4));
  const {meter}=A.mixerMonitor, before=meter(input);
  assert(before.samplePeakDbFS< -3 && before.truePeakDbTP> -1);
  const limiter={type:'limiter',ceilingDbTP:-3,lookahead:.004,release:.02};
  const result=patch(limiter,input,{meter:true,taps:{pre:{strip:'out',tap:'input'}}});
  const post=result.report.meter, insert=result.report.strips.out.inserts[0];
  assert(post.truePeakDbTP<=-3 && post.truePeakDbTP>=-3.5);
  assert.equal(insert.latency,80);
  assert(insert.details.maximumReductionDb>2);
  near(at(result.value,320),at(input,320),.001);
  near(at(result.value,3950),at(input,3950),.001);
  assert.throws(()=>patch({...limiter,wet:.5},input),/fully wet/);
  const safe=mono(256,i=>i===40 ? .09 : 0);
  const parallel=A.mixer.render({id:'joined',sampleRate:rate,output:'sum',strips:{
    dry:{clips:[clip('hit')],sends:{limited:{level:1}}},
    limited:{inserts:['limit']},sum:{}
  },processors:{limit:limiter}},{hit:safe});
  assert.equal(parallel.report.routes.find(row=>row.from==='dry' && row.to==='sum').compensation,80);
  near(at(parallel.value,40),.18);
  assert.equal(parallel.value.samples.filter(x=>x!==0).length,2);
});

test('monitor folds phase, rolls off lows for small speakers and compares aligned focus energy',()=>{
  const hook=tone(1100,.14), bass=tone(65,.48);
  const stereo=(f,g)=>({sampleRate:rate,channels:2,
    samples:Float64Array.from({length:hook.samples.length*2},(_,i)=>(i%2 ? g : f)(i>>1))});
  const side=stereo(i=>hook.samples[i],i=>-hook.samples[i]);
  const folded=A.mixerMonitor.preview(side,{mode:'mono'});
  assert.equal(folded.report.source.correlation,-1);
  assert.equal(folded.report.source.monoSilent,true);
  assert.equal(folded.value.channels,1);
  assert(folded.value.samples.every(x=>x===0));
  const center=stereo(i=>hook.samples[i]+bass.samples[i],i=>hook.samples[i]+bass.samples[i]);
  const one=A.mixerMonitor.preview(center,{mode:'small-speaker'},hook);
  assert(one.report.monitor.rmsDbFS<one.report.source.rmsDbFS-8);
  assert(one.report.focus.changeDb>-.5);
  assert(one.report.focus.monitorRelativeDb>one.report.focus.originalRelativeDb+8);
  assert(Object.is(at(center,7),hook.samples[7]+bass.samples[7]));
});

test('meter and monitor CLI write inspection values and audio',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-mix-monitor-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'tone.wav'),WAV.encode(tone(700),{encoding:'pcm24'}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const call=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music','mix',...args],{cwd:dir,encoding:'utf8'}));
  const metered=call('meter','tone.wav','--from-sample','200','--to-sample','400');
  assert.equal(metered.frames,200);
  const {preview,report}=call('monitor','tone.wav','--mode','small-speaker','--focus','tone.wav','--out','check');
  assert.equal(WAV.read(preview).channels,1);
  const inspected=JSON.parse(fs.readFileSync(report,'utf8'));
  assert.equal(inspected.mode,'small-speaker');
  assert.equal(inspected.focus.monitorRelativeDb,0);
});
