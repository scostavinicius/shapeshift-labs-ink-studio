const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..'),kit=ink.load(),W=kit.KIT.world,A=W.physicalAudio,S=W.physicalSignals;
const WAV=require('../cli/wav.js'),cli=require('../cli/physical-audio.js');
const signal=(samples,options={})=>({format:S.format,version:1,kind:'pressure',quantity:{unit:'Pa'},
  sampleRate:24000,startSample:0,samples,...options});
const plan=options=>({format:A.format,version:1,id:'route-check',sampleRate:24000,frames:12,channels:1,
  sources:{pipe:{signal:'tap',pcmPerUnit:1}},...options});
const samples=audio=>Array.from(audio.samples);
const near=(a,b,epsilon=1e-10)=>assert.ok(Math.abs(a-b)<=epsilon,a+' differs from '+b);

test('source, propagation and final mix keep exact addresses and fractional arrivals',()=>{
  const input={tap:signal([.5,0,0,0],{startSample:26})};
  const recipe=plan({startSample:23,monitorGain:.8,channels:2,
    sources:{pipe:{signal:'tap',pcmPerUnit:1,offsetSamples:1,pan:-1}},
    paths:{wall:{source:'pipe',delaySamples:2.5,pan:1,gain:.5},
      sealed:{source:'pipe',acoustic:{audible:false,delaySeconds:null},pan:-1}},
    mix:{dry:.25,wet:1}});
  const result=A.render(recipe,input);
  assert.deepEqual(samples(result.source).slice(6,12),[0,0,.4,0,0,0]);
  const propagated=samples(result.propagation);
  assert.deepEqual(propagated.slice(10,18),[0,0,0,.1,0,.1,0,0]);
  assert.ok(result.paths.sealed.samples.every(value=>value===0));
  assert.equal(result.report.startSample,23);
  assert.equal(result.report.endSample,35);
  assert.equal(result.report.paths.sealed.gain,0);
  assert.equal(result.report.paths.wall.delaySamples,2.5);
  const mixed=samples(result.mix);
  for(const [i,dry] of result.source.samples.entries())near(mixed[i],.25*dry+propagated[i]);
  const cropped=A.render({...recipe,startSample:27,frames:6},input);
  for(const bus of ['source','propagation','mix'])assert.deepEqual(samples(cropped[bus]),samples(result[bus]).slice(8,20));
  const room=A.render(plan({startSample:26,paths:{open:{source:'pipe',gain:.5,delaySamples:1.5,
    acoustic:{audible:true,gain:.4,delaySeconds:3/24000}}}}),input);
  near(room.report.paths.open.delaySamples,4.5);
  near(room.report.paths.open.gain,.2);
  near(room.propagation.samples[4],.05);
  near(room.propagation.samples[5],.05);
});

test('native sample rate conversion preserves the absolute phase and filters aliasing',()=>{
  const origin=300000000001, markers={tap:signal([.3,0,0,0,0],{sampleRate:12000,startSample:origin})};
  const settings=plan({startSample:2*origin-2,paths:{direct:{source:'pipe',delaySamples:2}}});
  const whole=A.render(settings,markers);
  assert.deepEqual(samples(whole.source).slice(0,3),[0,0,.3]);
  near(whole.propagation.samples[4],.3);
  const cropped=A.render({...settings,startSample:2*origin+1,frames:6},markers);
  for(const bus of ['source','propagation','mix'])assert.deepEqual(samples(cropped[bus]),samples(whole[bus]).slice(3,9));

  const recipe=plan({sampleRate:8000,frames:2000});
  function tone(frequency){
    const tap=signal(Array.from({length:6000},(_,n)=>.5*Math.sin(2*Math.PI*frequency*n/24000)));
    const sound=A.render(recipe,{tap}).mix.samples.subarray(100,1900);
    return Math.sqrt(sound.reduce((sum,value)=>sum+value*value,0)/sound.length);
  }
  assert.ok(tone(1000)>.34);
  assert.ok(tone(6100)<.005);
});

test('pressure sensors, vibration and volume flow retain their physical units',()=>{
  const trace={format:W.waveNetworks.traceFormat,version:1,info:{sampleRate:24000},start:0,end:4,
    pressure:{end:[0,250,-125,0]},flow:{end:[0,.001,-.001,0]}};
  const rig={format:W.virtualSensors.format,version:1,id:'fixture',revision:1,sensors:{
    tap:{kind:'pressure-tap',quantity:{unit:'kPa',sampleRate:24000},source:{kind:'wave',probe:'end'}}
  }};
  const tap=S.fromTrace(W.virtualSensors.wave(rig,trace),{name:'tap'});
  assert.equal(tap.quantity.unit,'kPa');
  const flow=S.fromTrace(trace,{name:'end',channel:'flow'});
  const modal={format:W.resonantModes.traceFormat,version:1,info:{sampleRate:24000},start:0,end:4,
    pickups:{body:[2,3,5,8]}};
  assert.throws(()=>S.fromTrace(modal,{name:'body'}),/metersPerUnit/);
  const body=S.fromTrace(modal,{name:'body',metersPerUnit:.001,previous:2,beforePrevious:3});
  const radiation=signal([0,.5,0,0],{kind:'radiated-pressure'});
  const result=A.render(plan({frames:4,sources:{
    meter:{signal:'tap',pcmPerUnit:.001},cone:{signal:'flow',pickup:'flow-derivative',pcmPerUnit:.005},
    body:{signal:'body',pickup:'acceleration',pcmPerUnit:.0000001},field:{signal:'radiation',pcmPerUnit:.5}
  }}),{tap,flow,body,radiation});
  assert.deepEqual(samples(result.sources.meter),[0,.25,-.125,0]);
  assert.deepEqual(samples(result.sources.field),[0,.25,0,0]);
  [0,.12,-.24,.12].forEach((value,i)=>near(result.sources.cone.samples[i],value));
  for(const value of result.sources.body.samples)near(value,.0576);
  assert.equal(result.report.sources.cone.pickupUnit,'m^3/s^2');
  assert.throws(()=>A.render(plan({sources:{pipe:{signal:'tap',pcmPerUnit:1,pickup:'velocity'}}}),{tap}),
    /cannot read pressure/);
  assert.throws(()=>A.render(plan(),{tap:signal([0],{quantity:{unit:'L/s'}})}),/incompatible physical ports/i);
  assert.throws(()=>A.render(plan(),{tap:signal([0],{quantity:{unit:'Pa',sampleRate:12000}})}),/cadence/);
  assert.throws(()=>A.render(plan(),{tap:signal([4])}),/monitorGain/);
  assert.throws(()=>A.render(plan(),{tap:signal([NaN])}),/finite numeric/);
});

test('simulation adapter and typed buses connect to ordinary graph audio analysis',()=>{
  const trace={format:W.waveNetworks.traceFormat,version:1,info:{sampleRate:24000},start:2,end:5,
    pressure:{end:[0,.4,0]}};
  const route=plan({paths:{direct:{source:'pipe',delaySamples:2}}});
  const manifest={format:'ink-studio/graph-project',version:1,nodes:{
    measure:{op:'audio.physicalSignal',inputs:{trace,selection:{name:'end'}}},
    pack:{op:'data.record',inputs:{tap:{node:'measure',port:'value'}}},
    route:{op:'audio.physical',inputs:{plan:route,signals:{node:'pack',port:'value'}}},
    analysis:{op:'audio.analyze',inputs:{source:{node:'route',port:'mix'},options:{fps:24}}}
  },outputs:{source:{node:'route',port:'source'},propagation:{node:'route',port:'propagation'},
    mix:{node:'route',port:'mix'},peak:{node:'analysis',port:'peak'}}};
  const result=ink.createGraphProject(manifest,{kit}).run().outputs;
  near(result.peak,.4);
  near(result.source.samples[3],.4);
  near(result.propagation.samples[5],.4);
  assert.deepEqual(result.mix,result.propagation);
});

test('the CLI renders a native simulation with identically stamped 24-bit WAV stems',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-physical-audio-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=name=>path.join(directory,name);
  const write=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  write('instrument.json',{format:W.waveNetworks.format,version:1,id:'tube',nodes:{mouth:{},end:{}},
    tubes:{bore:{from:'mouth',to:'end',sections:[{length:.343,area:.02}]}},
    observations:{mic:{tube:'bore',t:.5}}});
  write('instrument-run.json',{format:W.waveNetworks.runFormat,version:1,network:'instrument.json',samples:128,
    settings:{method:'delay',sampleRate:24000,sources:{strike:{kind:'flow',node:'mouth'}}},
    inputs:{strike:{impulses:[{sample:24,value:.00001}]}}});
  write('take-plan.json',plan({startSample:20,frames:100,sources:{pipe:{signal:'tap',pcmPerUnit:.1}},
    paths:{direct:{source:'pipe',delaySamples:2}}}));
  write('run.json',{format:cli.runFormat,version:1,plan:'take-plan.json',
    inputs:{tap:{trace:'instrument-run.json',selection:{name:'mic'}}}});
  const cmd=path.resolve(__dirname,'../cli/ink-studio.js');
  const child=spawnSync(process.execPath,[cmd,'sim','physical-audio',file('run.json'),'--out',file('report.json'),
    '--stems',file('stems')],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  const report=JSON.parse(fs.readFileSync(file('report.json'),'utf8'));
  assert.equal(report.startSample,20);
  assert.deepEqual(Object.keys(report.files),['source','propagation','mix','source-pipe','path-direct']);
  const decoded=Object.fromEntries(Object.entries(report.files).map(([name,file])=>[name,WAV.read(file,{metadata:true})]));
  for(const audio of Object.values(decoded)){
    assert.equal(audio.sampleRate,24000);
    assert.equal(audio.channels,1);
    assert.equal(audio.samples.length,100);
    assert.equal(audio.bwf.timeReference,'20');
  }
  const onset=name=>decoded[name].samples.findIndex(value=>value!==0);
  assert.ok(onset('source')>=0);
  assert.equal(onset('propagation'),onset('source')+2);
  assert.deepEqual(samples(decoded.mix),samples(decoded.propagation));
});
