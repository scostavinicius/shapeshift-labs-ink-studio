const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..'),kit=ink.load(),W=kit.KIT.world,P=kit.KIT.procedural,S=W.pictureSignals;
const AV=require('../cli/audiovisual-take.js'), WAV=require('../cli/wav.js');
const clock={fps:{numerator:30000,denominator:1001},sampleRate:48000};
const pcm=(samples,sampleRate=48000)=>({sampleRate,channels:1,samples});
const binding=(source,input=[0,1],output=[0,1],fallback)=>({source,input,output,...(fallback!==undefined&&{fallback})});
const link=(node,port='value')=>({node,port});
const near=(a,b,e=1e-10)=>assert.ok(Math.abs(a-b)<=e,a+' differs from '+b);

function picture(){
  return {format:'ink-studio/graph-project',version:1,inputs:{controls:{type:'record'}},nodes:{
    box:{op:'geo.box',inputs:{options:{half:[.65,.65,.3],color:'#f49870'}}},
    transform:{op:'scene.bindControls',inputs:{template:{position:[0,0,0]},controls:{input:'controls'},
      targets:[{control:'shift',path:'/position/0'}]}},
    moved:{op:'geo.transform',inputs:{source:link('box'),options:link('transform')}},
    object:{op:'scene.object',inputs:{source:link('moved'),options:{id:'marker',facets:true,emissive:true}}},
    group:{op:'data.record',inputs:{marker:link('object')}},
    objects:{op:'data.collect',inputs:{source:link('group'),keys:['marker']}},
    scene:{op:'scene.world',inputs:{objects:link('objects'),options:{camera:{target:[0,0,0],dist:4,yaw:0,pitch:0}}}},
    render:{op:'scene.bindControls',inputs:{template:{width:64,height:40,raw:true,
      cutaway:{planes:[{normal:[0,0,1],offset:0,keep:'negative'}]},
      renderGraph:{passes:[{id:'glow',type:'bloom',threshold:.1,intensity:.25,radius:4}]}},
      controls:{input:'controls'},targets:[{control:'section',path:'/cutaway/planes/0/offset'},
        {control:'gain',path:'/renderGraph/passes/0/intensity'}]}},
    captured:{op:'scene.render',inputs:{source:link('scene'),options:link('render')}}
  },outputs:{picture:link('captured')}};
}

test('native-rate picture measurements use exact spans, silence outside PCM, and missing physical values',()=>{
  const take=kit.KIT.timeDomains.take(clock), audio={mix:{audio:pcm([.25,.5]),startSample:1601}};
  const pressure={format:W.physicalSignals.format,version:1,kind:'pressure',quantity:{unit:'kPa'},
    sampleRate:24000,startSample:800,samples:[.1,-.2,.3]};
  const signals=S.prepare({
    rms:binding({kind:'audio',name:'mix'}),
    previous:binding({kind:'audio',name:'mix',window:'previous',stat:'peak'}),
    physical:binding({kind:'physical',name:'p',stat:'peak'},[0,300],[0,1],.125)
  },{audio,signals:{p:pressure}});
  const measured=signals.sample(take.at(1));
  assert.equal(measured.report.rms.firstSample,1601);
  assert.equal(measured.report.rms.endSample,3203);
  assert.equal(measured.report.rms.used,2);
  near(measured.report.rms.raw,Math.sqrt((.25**2+.5**2)/(3203-1601)));
  assert.equal(measured.values.previous,0);
  assert.equal(measured.report.physical.firstSample,800);
  assert.equal(measured.report.physical.endSample,1601);
  assert.equal(measured.report.physical.raw,300);
  assert.equal(measured.report.physical.unit,'Pa');
  assert.equal(measured.values.physical,1);
  const absent=signals.sample(take.at(2));
  assert.equal(absent.report.physical.raw,null);
  assert.equal(absent.values.physical,.125);
  assert.equal(absent.values.previous,.5);
});

test('picture bindings target only existing numeric options and preserve source data',()=>{
  const base=Object.freeze({options:Object.freeze({scale:Object.freeze([1,1,1]),offset:null})});
  const value=S.bind(base,{size:.5},[{control:'size',path:'/options/scale/1'},{control:'size',path:'/options/offset'}]);
  assert.deepEqual(value,{options:{scale:[1,.5,1],offset:.5}});
  assert.deepEqual(base.options.scale,[1,1,1]);
  assert.throws(()=>S.bind(base,{v:2},[{control:'v',path:'/options/scale/length'}]),/existing numeric/);
  assert.throws(()=>S.bind(base,{v:2},[{control:'v',path:'/options/scale/1'},{control:'v',path:['options','scale',1]}]),
    /Duplicate picture target/);
});

test('one take drives real cutaway, mesh and effect nodes and writes the same PCM on a cropped clock',()=>{
  const graph=ink.createGraphProject(picture(),{kit}), takeClock={...clock,simulationRate:60,cuts:[{frame:2,id:'inside'}]};
  const world={dt:1/60,systems:{gate:{kind:'control',config:{op:'scale',scale:0,offset:.5}}}};
  const source=Float64Array.from({length:3210},(_,i)=>i<1603?.125:.5);
  const settings={clock:takeClock,from:1,to:3,warmup:1,picture:{output:'picture',format:'both'},
    bindings:{
      shift:binding({kind:'audio',name:'mix',stat:'peak'},[0,.5],[-.4,.4]),
      section:binding({kind:'world',signal:'gate/value'},[0,1],[-.28,.2]),
      gain:binding({kind:'audio',name:'mix',stat:'peak'},[0,.5],[0,1.5])
    }};
  const audio={mix:{audio:pcm(source),startSample:1601}};
  const result=ink.renderAudiovisualTake(settings,{kit,graph,world,audio});
  const rows=result.report.picture.frames;
  assert.deepEqual(rows.map(({firstSample,endSample,worldTick})=>[firstSample,endSample,worldTick]),
    [[1601,3203,2],[3203,4804,4]]);
  assert.equal(rows[1].cut,true);
  assert.notEqual(rows[0].sha256,rows[1].sha256);
  assert.equal(rows[0].controls.shift,-.2);
  assert.equal(rows[1].controls.shift,.4);
  const bytes=result.artifacts.find(item=>item.file==='sound.wav').bytes,native=WAV.decode(bytes,{metadata:true});
  assert.equal(native.bwf.timeReference,'1601');
  assert.equal(native.samples.length,4804-1601);
  assert.deepEqual(native.samples,source.slice(0,native.samples.length));
  assert.equal(result.report.audio.presentSamples,native.samples.length);
  assert.ok(result.artifacts.some(item=>item.file==='clip.png'));
});

test('a normal take checkpoint keeps its graph identity while the audiovisual graph receives measured inputs',()=>{
  const doc=picture();
  doc.inputs.controls.default={shift:0,section:0,gain:0};
  const graph=ink.createGraphProject(doc,{kit});
  const world={dt:1/60,systems:{gate:{kind:'control',config:{op:'scale',scale:0,offset:.4}}}};
  const take=ink.createTake({clock,world,graph},{kit});
  take.seek(1);
  const saved=take.checkpoint(), settings={clock,from:2,to:3,picture:{output:'picture',format:'frames'},
    bindings:{shift:binding({kind:'world',signal:'gate/value'}),section:binding({kind:'world',signal:'gate/value'}),
      gain:binding({kind:'audio',name:'mix'})}};
  const audio={mix:{audio:pcm(Array(6000).fill(.2))}};
  const first=AV.render(settings,{kit,graph,world,checkpoint:saved,audio});
  const second=AV.render(settings,{kit,graph,world,audio});
  assert.deepEqual(first.report,second.report);
});

test('CLI publishes one native wave run into picture evidence and WAV',t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ink-av-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const save=(file,value)=>fs.writeFileSync(path.join(temporary,file),JSON.stringify(value));
  save('picture.json',picture());
  save('take.json',{format:'ink-studio/take',version:1,id:'wave',graph:'picture.json',clock});
  save('wave.json',{format:W.waveNetworks.runFormat,version:1,samples:2400,network:{
    format:W.waveNetworks.format,version:1,id:'test-pipe',nodes:{inlet:{},outlet:{}},
    tubes:{bore:{from:'inlet',to:'outlet',sections:[{length:1,area:.004}]}},observations:{tap:{tube:'bore',t:.45}}
  },settings:{method:'delay',sampleRate:24000,sources:{impulse:{kind:'flow',node:'inlet'}}},
  inputs:{impulse:{impulses:[{sample:200,value:.00001},{sample:1000,value:.000025}]}}});
  save('physical.json',{format:'ink-studio/physical-audio-run',version:1,
    plan:{format:W.physicalAudio.format,version:1,id:'pipe',sampleRate:48000,frames:4800,
      sources:{pipe:{signal:'tap',pcmPerUnit:.05}}},
    inputs:{tap:{trace:'wave.json',selection:{name:'tap'}}}});
  save('av.json',{format:AV.format,version:1,take:'take.json',from:0,to:2,picture:{output:'picture'},audio:{physical:'physical.json'},
    bindings:{shift:binding({kind:'physical',name:'tap',stat:'peak'},[0,1],[-.2,.2]),
      section:binding({kind:'physical',name:'tap',stat:'rms'},[0,1],[0,.3]),
      gain:binding({kind:'audio',name:'mix',stat:'peak'})}});
  const exe=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=spawnSync(process.execPath,[exe,'take','render-av','av.json','--out','out'],{cwd:temporary,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const out=path.join(temporary,'out'), report=JSON.parse(fs.readFileSync(path.join(out,'export.json'),'utf8'));
  const sound=WAV.read(path.join(out,'sound.wav'));
  for(const row of report.picture.frames){
    const window=sound.samples.slice(row.firstSample*sound.channels,row.endSample*sound.channels);
    const measured=Math.max(...window.map(Math.abs));
    near(row.measurements.gain.raw,measured,1/2**23);
    assert.ok(row.measurements.shift.raw>0);
    assert.equal(row.measurements.shift.sampleRate,24000);
    assert.ok(fs.existsSync(path.join(out,row.file)));
  }
});

test('a graph can export PCM and physical tracks to picture from one evaluation',t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ink-av-graph-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const save=(name,value)=>fs.writeFileSync(path.join(temporary,name),JSON.stringify(value));
  save('picture.json',picture());
  save('take.json',{format:'ink-studio/take',version:1,graph:'picture.json',clock:{fps:20,sampleRate:8000}});
  const trace={format:W.waveNetworks.traceFormat,version:1,start:0,end:800,info:{sampleRate:8000},
    pressure:{end:[...Array(400).fill(.125),...Array(400).fill(.5)]}};
  save('audio.json',{format:'ink-studio/graph-project',version:1,nodes:{
    measured:{op:'audio.physicalSignal',inputs:{trace,selection:{name:'end'}}},
    inputs:{op:'data.record',inputs:{bell:link('measured')}},
    mix:{op:'audio.physical',inputs:{plan:{format:W.physicalAudio.format,version:1,id:'graph-sound',sampleRate:8000,
      frames:800,channels:1,sources:{out:{signal:'bell',pcmPerUnit:.5}}},signals:link('inputs')}}
  },outputs:{master:link('mix'),nativePressure:link('measured')}});
  save('av.json',{format:AV.format,version:1,take:'take.json',to:2,picture:{output:'picture',format:'frames'},
    audio:{graph:'audio.json',output:'master',signals:{bell:'nativePressure'}},
    bindings:{shift:binding({kind:'physical',name:'bell',stat:'first'}),
      section:binding({kind:'physical',name:'bell',stat:'first'}),gain:binding({kind:'audio',name:'mix',stat:'first'})}});
  const result=ink.readAudiovisualTake(path.join(temporary,'av.json'),{kit});
  assert.deepEqual(result.report.picture.frames.map(({controls})=>controls),[
    {shift:.125,section:.125,gain:.0625},{shift:.5,section:.5,gain:.25}
  ]);
  const decoded=WAV.decode(result.artifacts.find(item=>item.file==='sound.wav').bytes);
  assert.deepEqual([decoded.samples[0],decoded.samples[400]],[.0625,.25]);
});
