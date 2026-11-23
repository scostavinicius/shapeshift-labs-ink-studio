const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('..').load(), W=K.world, N=W.waveNetworks, WAV=require('../cli/wav.js');
const close=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} differs from ${b}`);
const area=.002, soundSpeed=200,density=1.2,sampleRate=8000, Y=area/(density*soundSpeed);
const match={kind:'matched'};
const options={soundSpeed,density,sampleRate,terminations:{a:match,b:match},sources:{hit:{node:'a',kind:'flow'}}};
const impulse=count=>[2*Y,...Array(count-1).fill(0)];
const tube=(length=1,sections=[{length,area}])=>({format:N.format,version:1,id:'test-tube',nodes:{a:{},b:{}},
  tubes:{bore:{from:'a',to:'b',sections}},observations:{a:{node:'a'},b:{node:'b'},inside:{tube:'bore',t:.5}}});
const peak=signal=>signal.reduce((index,value,i)=>Math.abs(value)>Math.abs(signal[index])?i:index,0);

test('delay lines have the expected propagation, flow, loss and reflection sign',()=>{
  for(const [kind,sign] of [['matched',0],['sealed',1],['open',-1]]){
    const wave=N.prepare(tube(),{...options,method:'delay',terminations:{a:match,b:{kind}},loss:.3});
    const result=wave.process(105,{inputs:{hit:impulse(105)}});
    close(result.pressure.a[0],1);
    close(result.pressure.inside[20],Math.exp(-.15));
    close(result.pressure.b[40],(1+sign)*Math.exp(-.3));
    close(result.flow.b[40],(sign-1)*Y*Math.exp(-.3));
    close(result.pressure.a[80],sign*Math.exp(-.6));
    assert.equal(wave.info.ringSamples,80);
  }
});

test('resistive impedance and reflection coefficients specify the same termination',()=>{
  const coefficient=.4, impedance=(1+coefficient)/(Y*(1-coefficient));
  const capture=termination=>N.prepare(tube(),{...options,method:'delay',terminations:{a:match,b:termination}})
    .process(85,{inputs:{hit:impulse(85)}});
  const reflect=capture({kind:'reflect',coefficient}), load=capture({kind:'impedance',impedance});
  close(reflect.pressure.a[80],coefficient);
  close(load.pressure.b[40],reflect.pressure.b[40]);
  const pressure=N.prepare(tube(),{...options,method:'delay',terminations:{b:match},
    sources:{press:{node:'a',kind:'pressure'}}});
  close(pressure.process(1,{inputs:{press:2}}).pressure.a[0],2);
});

test('a branched area step scatters pressure and conserves outward junction flow',()=>{
  const domain={format:N.format,version:1,id:'tee',nodes:{a:{},tee:{},b:{},c:{}},
    tubes:{stem:{from:'a',to:'tee',sections:[{length:1,area}]},
      branch:{from:'tee',to:'b',sections:[{length:.5,area:area/2},{length:.5,area:area*1.5}]},
      side:{from:'tee',to:'c',sections:[{length:.5,area}]}},
    observations:{a:{node:'a'},tee:{node:'tee'},b:{node:'b'},c:{node:'c'}}};
  const wave=N.prepare(domain,{...options,method:'delay',terminations:{a:match,b:match,c:match}});
  const r=wave.process(100,{inputs:{hit:impulse(100)}});
  close(r.pressure.tee[40],.8);
  close(r.flow.tee[40],0);
  close(r.pressure.c[60],.8);
  close(r.pressure.b[80],.4);
  close(r.pressure.a[80],-.2);
});

test('fractional propagation uses a stable all-pass history and reports clamped short sections',()=>{
  const wave=N.prepare(tube(.04375),{...options,method:'delay'});
  const r=wave.process(24,{inputs:{hit:impulse(24)}});
  assert.equal(wave.info.fractionalSegments,1);
  close(r.pressure.b[1],1/7);
  close(r.pressure.b[2],1-1/49);
  close(r.pressure.b.reduce((sum,x)=>sum+x*x,0),1);
  const tooShort=N.prepare(tube(.0125),{...options,method:'delay'});
  assert.equal(tooShort.info.clampedSegments,1);
  close(tooShort.info.maxSegmentTravelErrorSamples,.5);
});

test('distributed pressure and flow propagate a smooth pulse with a CFL bound and damping',()=>{
  const input=Float64Array.from({length:180},(_,i)=>2*Y*Math.exp(-.5*((i-18)/5)**2));
  const wave=N.prepare(tube(),{...options,cellLength:.018}), ideal=wave.process(input.length,{inputs:{hit:input}});
  assert.ok(wave.info.substeps>1&&wave.info.dt<1/sampleRate);
  assert.ok(Math.abs(peak(ideal.pressure.b)-(18+40))<=2);
  close(ideal.pressure.b[peak(ideal.pressure.b)],1,.07);
  const absorbed=N.prepare(tube(),{...options,loss:.8,cellLength:.018}).process(input.length,{inputs:{hit:input}});
  close(absorbed.pressure.b[peak(absorbed.pressure.b)]/ideal.pressure.b[peak(ideal.pressure.b)],Math.exp(-.8),.06);
  const seal=N.prepare(tube(),{...options,terminations:{a:match,b:{kind:'sealed'}}})
    .process(input.length,{inputs:{hit:input}});
  assert.ok(Array.from(seal.flow.b).every(q=>Math.abs(q)<1e-15));
  assert.ok(seal.pressure.b[peak(seal.pressure.b)]>1.5);
});

test('both engines checkpoint and continue byte-for-byte across different block sizes',()=>{
  const domain=tube(0,[{length:.731,area},{length:.45,area:.0012}]);
  const input=Float64Array.from({length:290},(_,i)=>i<70?2*Y*Math.sin(i*.1):0);
  for(const method of ['distributed','delay']){
    const settings={...options,method};
    const one=N.prepare(domain,settings), full=one.process(input.length,{inputs:{hit:input}});
    const split=N.prepare(domain,settings);
    split.process(63,{inputs:{hit:input.subarray(0,63)}});
    const saved=JSON.parse(JSON.stringify(split.snapshot())), reopened=N.prepare(domain,settings);
    reopened.restore(saved);
    const result=reopened.process(227,{inputs:{hit:input.subarray(63)}});
    assert.deepEqual(result.pressure.b,full.pressure.b.subarray(63));
    assert.deepEqual(result.flow.inside,full.flow.inside.subarray(63));
    assert.deepEqual(reopened.snapshot(),one.snapshot());
    assert.throws(()=>reopened.process(1,{inputs:{hit:[NaN]}}),/finite/);
    assert.deepEqual(reopened.snapshot(),one.snapshot());
    assert.throws(()=>N.prepare(domain,{...settings,loss:.4}).restore(saved),/Incompatible/);
  }
});

test('compiled branched domains retain named ports and tube observations',()=>{
  const requireBench=name=>require(path.join(__dirname,'../examples/simulation-branched-domains',name));
  const run=W.runtime.create(requireBench('bench.world.json'));
  const domain=W.domains.compile(requireBench('bench.domain.json'),{query:run.query()});
  const waves=N.prepare(domain,{method:'delay',sources:{ping:{port:'feed-in',kind:'flow'}},
    terminations:{'upper-exhaust':match,'return-exhaust':match}});
  assert.deepEqual(Array.from(waves.info.probes).sort(),Object.keys(domain.observations).sort());
  const r=waves.process(10,{inputs:{ping:.00001}});
  assert.equal(r.pressure['outlet-throat'].length,10);
  assert.throws(()=>N.prepare(tube(1,[{length:1,area:0}]),options),/positive length and area/);
  assert.throws(()=>N.prepare(tube(),{...options,maxWork:10}).process(20),/work limit/);
});

test('the native block kernel publishes the selected probe and preserves delay state on restore',()=>{
  const settings={...options,method:'delay'}, config={domain:tube(),settings,source:'hit',probe:'b'};
  const kernel=W.kernels.prepare('acoustic-wave-network',1,config,{dt:1/sampleRate});
  kernel.advanceBlock({start:0,end:1,input:{drive:2*Y}});
  kernel.advanceBlock({start:1,end:30,input:{drive:0}});
  const state=JSON.parse(JSON.stringify(kernel.snapshot()));
  const replay=W.kernels.prepare('acoustic-wave-network',1,config,{dt:1/sampleRate});
  replay.restore(state);
  const a=kernel.advanceBlock({start:30,end:41,input:{drive:0}});
  assert.deepEqual(a,replay.advanceBlock({start:30,end:41,input:{drive:0}}));
  close(a.pressure,1);
});

test('sim waves writes an independently auditable WAV and portable trace',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-waves-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'network.json'),JSON.stringify(tube()));
  fs.writeFileSync(path.join(root,'run.json'),JSON.stringify({format:N.runFormat,version:1,network:'network.json',
    settings:{...options,method:'delay'},samples:95,inputs:{hit:{impulses:[{sample:0,value:2*Y}]}},audio:{probe:'b',gain:.4}}));
  execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'sim','waves','run.json',
    '--out','trace.json','--wav','bore.wav'],{cwd:root});
  const trace=JSON.parse(fs.readFileSync(path.join(root,'trace.json')));
  assert.equal(trace.format,N.traceFormat);
  close(trace.pressure.b[40],1);
  close(WAV.read(path.join(root,'bore.wav')).samples[40],.4,1/32768);
});
