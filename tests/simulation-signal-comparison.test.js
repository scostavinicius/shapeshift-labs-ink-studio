const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const W=require('..').load().KIT.world,M=W.simulationMeasurements,WAV=require('../cli/wav.js');
const rate=24000, tau=2*Math.PI;
const wave=(hz,t)=>Math.sin(tau*hz*t);
const pcm=(sample,count=rate)=>Float64Array.from({length:count},(_,i)=>sample(i/rate));
const spec=(metric,band,options)=>({kind:'signal-compare',source:'input',metric,band,...options});
const plan=(measurements,assertions)=>({format:M.format,version:1,id:'two-estimators',measurements,...(assertions&&{assertions})});
const close=(actual,expected,tolerance)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);

test('ring-down checks agree on a non-bin pole and an independently resolved half-power width',()=>{
  const hz=437.3, decay=28, startSample=800;
  const samples=pcm(time=>.4+.5*Math.exp(-time*decay)*wave(hz,time+.0004));
  const measurements={
    resonance:spec('resonance',[380,495]),
    width:spec('bandwidth',[385,490]),
    clipped:spec('bandwidth',[435,440]),
    short:spec('bandwidth',[385,490],{window:{from:startSample,to:startSample+2400}})
  };
  const source={sampleRate:rate,startSample,channels:{pickup:{samples,unit:'Pa'}}};
  const {measurements:out,passed}=M.run(plan(measurements,{
    agree:{measurement:'width',unit:'Hz',max:.025}
  }),{input:source});
  assert.equal(passed,true);
  assert.equal(out.resonance.evidence.firstSample,startSample);
  close(out.resonance.evidence.time.value,hz,1e-7);
  close(out.resonance.evidence.frequency.value,hz,.01);
  const {time,frequency}=out.width.evidence;
  close(time.value,decay/Math.PI,1e-7);
  close(frequency.value,decay/Math.PI,.025);
  assert.ok(frequency.evidence.lowerHz<hz&&frequency.evidence.upperHz>hz);
  assert.equal(out.clipped.evidence.frequency.reason,'half-power-crossing-outside-band');
  assert.equal(out.short.evidence.time.status,'ok');
  assert.equal(out.short.evidence.frequency.reason,'linewidth-below-window-resolution');
});

test('pitch can infer a missing fundamental and preserves each answer when they disagree',()=>{
  const fundamental=196.3;
  const partials=pcm(t=>.71*wave(2*fundamental,t)+.28*wave(3*fundamental,t+.01));
  const analysis=plan({f0:spec('pitch',[165,260])},{agreement:{measurement:'f0',max:.1}});
  const analyze=samples=>M.run(analysis,{input:{sampleRate:rate,channels:1,samples}});
  const harmonic=analyze(partials);
  assert.equal(harmonic.passed,true);
  const {time,frequency}=harmonic.measurements.f0.evidence;
  close(time.value,fundamental,.02);
  close(frequency.value,fundamental,.005);
  close(frequency.evidence.strongestPartialHz,2*fundamental,.005);
  assert.deepEqual(frequency.evidence.matchedHarmonics.map(row=>row.harmonic),[2,3]);

  const high=Array.from({length:128},(_,i)=>.5*Math.sin(i*Math.PI/4));
  const highPitch=M.run(plan({f0:spec('pitch',[800,1200])}),{input:{sampleRate:8000,channels:{tone:high}}});
  close(highPitch.measurements.f0.evidence.time.value,1000,.01);
  close(highPitch.measurements.f0.evidence.frequency.value,1000,.1);

  const burst=analyze(pcm(t=>Math.abs(t-.5)<.045?.25*wave(244,t):.66*wave(fundamental,t)));
  assert.equal(burst.passed,false);
  assert.equal(burst.assertions.agreement.status,'out-of-bounds');
  const row=burst.measurements.f0;
  close(row.evidence.time.value,244,.03);
  close(row.evidence.frequency.value,fundamental,.05);
  close(row.value,244-fundamental,.06);
});

test('constant signals, sustained tones, and broadband noise report insufficient evidence',()=>{
  const run=(metric,samples)=>M.run(plan({result:spec(metric,[150,500])}),
    {input:{sampleRate:rate,channels:{probe:samples}}}).measurements.result;
  assert.equal(run('pitch',pcm(()=>.25)).reason,'no-ac-signal');
  assert.equal(run('bandwidth',pcm(t=>wave(300,t))).evidence.time.reason,'pole-does-not-decay');
  let seed=117;
  const noise=pcm(()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**31-1));
  const row=run('pitch',noise);
  assert.equal(row.status,'unavailable');
  assert.equal(row.evidence.time.reason,'no-periodic-lag-in-band');
  assert.equal(row.evidence.frequency.status,'unavailable');
});

test('CLI accepts owned WAV paths, selects a stereo channel, and reports disagreement for CI',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-independent-signal-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name);
  const samples=new Float64Array(rate*2);
  for(let i=0;i<rate;i++){
    samples[i*2]=.3;
    samples[i*2+1]=.8*wave(281.25,i/rate);
  }
  fs.writeFileSync(file('probe.wav'),WAV.encode({sampleRate:rate,channels:2,samples},{encoding:'pcm24'}));
  const measurement=spec('pitch',[220,340],{channel:'ch2'});
  const request={format:'ink-studio/simulation-measurement-run',version:1,sources:{input:{file:'probe.wav'}},
    plan:plan({tuned:measurement,silent:{...measurement,channel:'ch1'}},
      {agreement:{measurement:'tuned',max:.05},'require-both':{measurement:'silent',max:.05}})};
  fs.writeFileSync(file('bench.json'),JSON.stringify(request));
  const run=spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'sim','measure',file('bench.json'),'--out',file('report.json')],{cwd:os.tmpdir(),encoding:'utf8'});
  assert.equal(run.status,2,run.stderr);
  const result=JSON.parse(fs.readFileSync(file('report.json'),'utf8'));
  assert.equal(result.assertions.agreement.passed,true);
  assert.equal(result.assertions['require-both'].status,'unavailable');
  assert.equal(result.measurements.tuned.evidence.inputUnit,'FS');
  close(result.measurements.tuned.evidence.frequency.value,281.25,.005);
});
