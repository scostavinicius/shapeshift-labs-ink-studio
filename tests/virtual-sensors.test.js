const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {KIT:K}=require('..').load(), W=K.world,S=W.virtualSensors;
const rig=sensors=>({format:S.format,version:1,id:'sensor-bench',revision:1,sensors});
const near=(a,b,epsilon=1e-12)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} differs from ${b}`);
const packed=x=>JSON.parse(JSON.stringify(x));

test('geometry gauges tare, scale displacement, preserve signed strain, and report missing endpoints',()=>{
  const input=rig({
    displacement:{kind:'displacement-probe',quantity:{unit:'mm'},source:{kind:'geometry',from:[0,0,0],to:{entity:'p'},axis:[0,2,0]}},
    strain:{kind:'strain-gauge',source:{kind:'geometry',from:[0,0,0],to:{entity:'p'}}},
    static:{kind:'strain-gauge',reference:2,source:{kind:'geometry',from:[0,0,0],to:[0,1,0]}}
  });
  const model=S.prepare(input), player=model.open(), query=point=>({target:()=>point&&{point}});
  near(player.sample({query:query([0,2,0])}).sensors.strain.value,0);
  const compressed=player.step(.1,{query:query([0,1.5,0])}).sensors;
  near(compressed.displacement.value,-500);
  near(compressed.strain.value,-.25);
  near(compressed.static.value,-.5);
  const lost=player.step(.1,{query:query(null)}).sensors.displacement;
  assert.equal(lost.status,'missing');
  assert.equal(lost.raw,null);
  assert.equal(lost.valid,false);
  near(lost.value,-500);
  const rebound=model.open(packed(player.snapshot())).step(.1,{query:query([0,2.2,0])});
  near(rebound.sensors.strain.value,.1);
});

test('flow meters integrate the signed interval before display response and resume exactly',()=>{
  const model=S.prepare(rig({meter:{kind:'flow-meter',quantity:{unit:'L/s'},responseTime:.3,source:{kind:'input',port:'flow'}}}));
  const run=model.open();
  near(run.step(.25,{inputs:{flow:2}}).sensors.meter.value,2000);
  const saved=packed(run.snapshot());
  const visit=run.step(.5,{inputs:{flow:-1}}), alternate=model.open(saved);
  assert.deepEqual(alternate.step(.5,{inputs:{flow:-1}}),visit);
  const meter=visit.sensors.meter;
  near(meter.forward,.5);near(meter.reverse,.5);near(meter.total,0);
  assert.ok(meter.value>-1000);
  const missing=run.step(1,{}).sensors.meter;
  assert.equal(missing.valid,false);
  assert.equal(missing.total,0);
});

test('event counters select timed occurrences and retain the last occurrence across batches',()=>{
  const model=S.prepare(rig({hits:{kind:'event-counter',source:{kind:'input',port:'events'},filter:{kind:'hit',phase:'start'}}}));
  const accumulator=model.open();
  const cases=[W.timedEvents.at(.008,{kind:'hit',phase:'start'}),W.timedEvents.at(.014,{kind:'hit',phase:'end'}),
    W.timedEvents.at(.017,{kind:'hit',phase:'start'})];
  const first=accumulator.step(.02,{inputs:{events:cases}}).sensors.hits;
  assert.equal(first.delta,2);
  assert.equal(first.count,2);
  near(first.lastEventTime,.017);
  const second=accumulator.step(.02,{inputs:{events:[]}}).sensors.hits;
  assert.equal(second.delta,0);
  assert.equal(second.lastEventTime,.017);
  assert.equal(second.count,2);
});

test('wave microphones retain calibration and filtering across block boundaries',()=>{
  const input=rig({mic:{kind:'microphone',responseTime:.001,source:{kind:'wave',probe:'ear'}},
    tap:{kind:'pressure-tap',quantity:{unit:'kPa',sampleRate:1000},source:{kind:'wave',probe:'ear'}},
    meter:{kind:'flow-meter',source:{kind:'wave',probe:'ear'}}});
  const trace={format:W.waveNetworks.traceFormat,version:1,info:{sampleRate:1000},start:0,end:6,
    pressure:{ear:[100,-200,100,300,0,100]},flow:{ear:[1,-1,1,1,1,-1]}};
  const full=S.wave(input,trace);
  assert.deepEqual(full.readings.tap,[.1,-.2,.1,.3,0,.1]);
  assert.notEqual(full.readings.mic[1],-200);
  near(full.endpoint.sensors.meter.total,.002);
  const half=(a,b)=>({...trace,start:a,end:b,pressure:{ear:trace.pressure.ear.slice(a,b)},flow:{ear:trace.flow.ear.slice(a,b)}});
  const first=S.wave(input,half(0,2)),last=S.wave(input,half(2,6),{checkpoint:packed(first.checkpoint)});
  assert.deepEqual([...first.readings.mic,...last.readings.mic],full.readings.mic);
  assert.deepEqual(last.checkpoint,full.checkpoint);
  assert.throws(()=>S.wave(input,half(2,6),{checkpoint:full.checkpoint}),/sample clock/);
});

test('completed-world recording and native counters preserve events through resume and observation strides',()=>{
  const input=rig({taps:{kind:'event-counter',source:{kind:'world-events'},filter:{kind:'tap'}},
    draw:{kind:'flow-meter',source:{kind:'input',port:'flow'}}});
  const world={dt:.025,systems:{drive:{kind:'control',config:{op:'scale',scale:0,offset:2}},
    gauge:{kind:'virtual-sensors',config:{rig:input}}},
    connections:[{from:'drive/value',to:'gauge/flow'}],
    commands:[2,3,4].map(tick=>({tick,action:'world/event',args:{kind:'tap'}}))};
  world.systems.drive.portQuantities={outputs:{value:{unit:'m^3/s'}}};
  const native=W.runtime.create(world);
  native.advance(4);
  const detail=native.query().probe('gauge/readings').value;
  assert.equal(detail.sensors.taps.count,3);
  const first=S.world(input,W.runtime.create(world),{steps:3,every:2,bindings:{flow:'drive/value'},includeWorldCheckpoint:true});
  const source=W.runtime.create(first.worldCheckpoint.world,{checkpoint:packed(first.worldCheckpoint)});
  const resumed=S.world(input,source,{steps:3,bindings:{flow:'drive/value'},checkpoint:packed(first.checkpoint)});
  const full=S.world(input,W.runtime.create(world),{steps:6,every:5,bindings:{flow:'drive/value'}});
  assert.deepEqual(resumed.checkpoint,full.checkpoint);
  assert.equal(full.frames.at(-1).sensors.taps.count,3);
  near(full.frames.at(-1).sensors.draw.total,.3);
  assert.equal(native.view().signals['gauge/taps'],2);
});

test('a room microphone records acoustic path gain and distinguishes unavailable endpoints',()=>{
  const world=require('../examples/world-acoustic-hatch.json'), run=W.runtime.create(world);
  const source={kind:'acoustic',field:'acoustics/audible',listener:{entity:'listen-post'},
    emitter:{entity:'beacon',socket:'speaker'},band:'high'};
  const report=S.world(rig({
    live:{kind:'microphone',source},missing:{kind:'microphone',source:{...source,listener:{entity:'unknown'}}}
  }),run,{steps:8,every:8});
  const [open,closed]=report.frames.map(frame=>frame.sensors);
  assert.ok(open.live.value>20*closed.live.value);
  assert.equal(open.live.status,'audible');
  assert.ok(open.live.detail.delaySeconds>0);
  assert.equal(closed.missing.status,'missing');
  assert.equal(closed.missing.valid,false);
});

test('CLI resolves a wave run and exports stereo microphones in authored order',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-virtual-sensors-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const write=(file,data)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(data));
  const network={format:W.waveNetworks.format,version:1,id:'guide',nodes:{a:{},b:{}},tubes:{
    guide:{from:'a',to:'b',sections:[{length:1.2,area:.02}]}
  }};
  write('guide.json',network);
  write('source.wave.json',{format:W.waveNetworks.runFormat,version:1,network:'guide.json',samples:20,settings:{
    method:'delay',sampleRate:1000,soundSpeed:200,sources:{strike:{kind:'flow',node:'a'}},
    probes:{near:{node:'a'},far:{node:'b'}},terminations:{a:{kind:'matched'},b:{kind:'matched'}}
  },inputs:{strike:{impulses:[{sample:0,value:.00001}]}}});
  write('rig.json',rig({left:{kind:'microphone',source:{kind:'wave',probe:'near'}},right:{kind:'microphone',source:{kind:'wave',probe:'far'}}}));
  write('sensor.json',{format:S.runFormat,version:1,rig:'rig.json',source:{kind:'wave',run:'source.wave.json'},
    audio:{channels:['right','left'],gain:1}});
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const result=spawnSync(process.execPath,[cli,'sim','sensors','sensor.json','--wav','take.wav'],{cwd:dir,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout), wav=require('../cli/wav.js').decode(fs.readFileSync(path.join(dir,'take.wav')));
  assert.equal(wav.channels,2);
  assert.equal(wav.samples[0],0);
  assert.ok(wav.samples[1]>0);
  assert.ok(report.readings.right[6]>0);
});
