const assert=require('node:assert/strict'), {test}=require('node:test');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), {execFileSync}=require('node:child_process');
const ink=require('..'), kit=ink.load(), A=kit.KIT.procedural.mediaGraph, WAV=require('../cli/wav.js');
const rate=8000, time=samples=>({samples});
const mono=(frames,fn,sampleRate=rate)=>({sampleRate,channels:1,samples:Array.from({length:frames},(_,i)=>fn(i))});
const clip=(source,fields={})=>({id:source,source,...fields});
const mix=fields=>({id:'bench',sampleRate:rate,output:'master',...fields});
const at=(audio,sample,ch=0)=>audio.samples[2*sample+ch];
const near=(a,b,eps=1e-9)=>assert(Math.abs(a-b)<=eps,`${a} vs ${b}`);
const lane=(unit,points,curve)=>({unit,points:points.map(([at,value])=>({at,value})),...(curve && {curve})});

test('clip gain hits the insert before the fader, with independent pre and post sends through a group',()=>{
  const result=A.mixer.render(mix({strips:{
    track:{clips:[clip('tone',{gainDb:20*Math.log10(2)})],inserts:['color'],fader:.25,
      output:'group',sends:{pre:{tap:'pre',level:.7},post:{tap:'post',level:.7}}},
    pre:{output:null},post:{output:null},group:{fader:.5},master:{}
  },processors:{color:{type:'drive',amount:2}},taps:{
    input:{strip:'track',tap:'input'},pre:{strip:'pre'},post:{strip:'post'}
  }}),{tone:mono(16,()=>.18)});
  const shaped=Math.tanh(.72)/Math.tanh(2);
  near(at(result.taps.input,0),.36);
  near(at(result.taps.pre,0),shaped*.7);
  near(at(result.taps.post,0),shaped*.25*.7);
  near(at(result.value,0),shaped*.25*.5);
});

test('clip-local musical points and absolute second and sample lanes resolve on the export grid',()=>{
  const result=A.mixer.render(mix({tail:'cut',end:time(10200),
    map:{tempo:120,changes:[{beat:2,tempo:60}]},
    strips:{
      track:{clips:[clip('tone',{at:{beat:1.5},fromSample:8,toSample:8010,
        gainDb:lane('beats',[[0,0],[.5,0],[.75,-6.020599913279624]])})],
        fader:lane('seconds',[[0,1],[1,.5]],'hold'),sends:{aux:{level:lane('samples',[[0,0],[8100,1]],'hold')}}},
      aux:{output:null},master:{}
    },taps:{pre:{strip:'track',tap:'pre'},send:{strip:'aux'}}
  }),{tone:mono(8020,()=>.2,16000)});
  assert.equal(result.report.strips.track.clips[0].start,6000);
  assert.equal(result.report.strips.track.clips[0].end,10001);
  near(at(result.value,5999),0);
  near(at(result.value,7999),.2);
  near(at(result.value,8000),.1);
  near(at(result.taps.send,8099),0);
  near(at(result.taps.send,8100),at(result.value,8100));
  near(at(result.taps.pre,9000),.2/Math.sqrt(2));
  near(at(result.taps.pre,10000),.1);
});

test('parallel, dry/wet and sidechain paths compensate their own latency in samples',()=>{
  const assets={hit:mono(260,i=>i===30 ? .3 : 0)};
  const parallel=mix({strips:{
    dry:{clips:[clip('hit')],output:'group',sends:{wet:{tap:'pre'}}},
    wet:{output:'group',inserts:['slot']},group:{},master:{}
  },processors:{slot:{type:'compressor',ratio:1,lookahead:.02,
    wet:lane('samples',[[0,0],[30,.5],[100,1]])}},
  taps:{dry:{strip:'dry'},wet:{strip:'wet'}}});
  const result=A.mixer.render(parallel,assets);
  assert.equal(result.report.latencySamples,160);
  assert.equal(result.report.routes.find(row=>row.from==='dry' && row.to==='group').compensation,160);
  near(at(result.value,30),.6);
  assert.deepEqual(result.taps.wet.samples,result.taps.dry.samples);
  assert.equal(result.value.samples.filter(x=>x!==0).length,2);
  parallel.processors.slot={type:'gain',db:0};
  assert.deepEqual(A.mixer.render(parallel,assets).value,result.value);

  const duck=A.mixer.render(mix({strips:{
    key:{clips:[clip('click')],output:null,inserts:['key-latency']},
    bed:{clips:[clip('bed')],inserts:[{processor:'duck',sidechain:{strip:'key',tap:'pre'}}]},master:{}
  },processors:{
    'key-latency':{type:'compressor',ratio:1,lookahead:.03},
    duck:{type:'compressor',thresholdDb:-30,ratio:12,attack:.001,release:.02,lookahead:.02}
  }}),{click:mono(900,i=>i>=420 && i<510 ? .7 : 0),bed:mono(900,()=>.4)});
  assert.equal(duck.report.latencySamples,400);
  assert.equal(duck.report.strips.bed.inserts[0].mainDelay,240);
  near(at(duck.value,255),.4);
  assert(at(duck.value,295)<.1);
  assert(at(duck.value,420)<.1);
  assert(at(duck.value,850)>.35);
});

test('an edit stops source audio while its return keeps ringing, with an optional hard cut',()=>{
  const assets={hit:mono(900,i=>i===100 || i===400 ? .4 : 0)};
  const source=mix({end:time(128),strips:{shot:{clips:[clip('hit')],sends:{room:{tap:'pre'}}},
    room:{inserts:['space']},master:{}},
  processors:{space:{type:'reverb',decay:.21,size:.6,damping:.43}},taps:{dry:{strip:'shot'},wet:{strip:'room'}}});
  const keep=A.mixer.render(source,assets), cut=A.mixer.render({...source,tail:'cut'},assets);
  assert.equal(keep.report.sourceEnd,128);
  assert.equal(keep.report.strips.room.inserts[0].tail,keep.report.tailFrames);
  assert.equal(keep.report.latencySamples,0);
  assert.deepEqual(keep.value.samples.slice(0,256),cut.value.samples);
  assert(keep.taps.wet.samples.slice(256).some(value=>Math.abs(value)>.01));
  assert(keep.taps.dry.samples.slice(256).every(value=>value===0));
  assert.throws(()=>A.mixer.render({...source,strips:{...source.strips,room:{output:'shot'}}},assets),/cycle/);
});

test('CLI reads reusable WAV clips and prints a mixer and aligned taps',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-mixer-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const audio=mono(16,i=>i===4 ? .25 : 0);
  fs.writeFileSync(path.join(root,'clip.wav'),WAV.encode(audio,{encoding:'pcm24'}));
  fs.writeFileSync(path.join(root,'score.json'),JSON.stringify({assets:{clip:'clip.wav'},
    mixer:mix({strips:{master:{clips:[clip('clip')]}},taps:{before:{strip:'master',tap:'input'}}})}));
  const args=[path.resolve(__dirname,'../cli/ink-studio.js'),'music','mix','render','score.json','--out','take'];
  const files=JSON.parse(execFileSync(process.execPath,args,{cwd:root,encoding:'utf8'}));
  const master=WAV.read(files.mix), before=WAV.read(files.taps.before);
  assert.deepEqual(master,before);
  near(at(master,4),.25);
  assert.equal(JSON.parse(fs.readFileSync(files.report,'utf8')).frames,16);
});
