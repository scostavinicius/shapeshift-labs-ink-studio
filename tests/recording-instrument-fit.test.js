const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), P=KIT.procedural, audio=P.mediaGraph, tool=audio.instrumentFit;
const WAV=require('../cli/wav');
const rate=16000, tau=2*Math.PI;
const pcm=(span,signal)=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:Math.round(span*rate)},
  (_,i)=>signal(i/rate,i))});
const tone=pcm(.7,t=>{
  if (t<.015 || t>.648) return 0;
  const age=t-.015, envelope=Math.min(1,age/.06,(.648-t)/.075);
  return envelope*(.32*Math.sin(tau*220*age)+(.18-.15*age)*Math.sin(tau*440*age)+.07*Math.sin(tau*880*age));
});
const metal=pcm(.88,t=>{
  if (t<.019) return 0;
  const age=t-.019, hit=Math.min(1,age/.002);
  return hit*(.39*Math.sin(tau*695*age)*Math.exp(-10*age)+.24*Math.sin(tau*1191*age)*Math.exp(-21*age)+
    .12*Math.sin(tau*1619*age)*Math.exp(-16*age));
});
const near=(a,b,tol)=>assert(Math.abs(a-b)<=tol,a+' expected within '+tol+' of '+b);
const auditionLead=(report,clip)=>report.clips.find(row=>row.id===clip);
const spectrum=(result,id)=>{
  const {startSample,endSample}=auditionLead(result.report,id), source=result.value;
  const start=startSample+Math.round((endSample-startSample)*.36);
  return audio.fft(source,{channel:0,time:start/source.sampleRate,fps:source.sampleRate/2048,size:2048});
};

test('fitting voiced audio derives a reference root, editable harmonics and an exact source range',()=>{
  const {value,assets,reference,report}=tool.fit(tone,{partials:5,attackMs:41});
  assert.equal(value.root,57);
  assert.equal(value.preferred,'synth');
  near(report.particulars.root.hz,220,1);
  assert(report.particulars.harmonics.some(row=>row.harmonic===2));
  assert(report.particulars.harmonics.some(row=>row.harmonic===4));
  assert(report.particulars.amplitude.some(([phase,level])=>phase>.45 && level>.7));
  assert.equal(report.particulars.attackSamples,656);
  const [first,last]=report.rangeSamples;
  assert(first>0 && last<tone.samples.length);
  assert.deepEqual(reference.samples,tone.samples.slice(first,last));
  assert.deepEqual(Object.keys(assets),['fitted-attack']);
  assert.equal(assets['fitted-attack'].samples.length,656);
  assert.deepEqual(tool.fit(tone,{partials:5,attackMs:41}).value,value);
  assert.equal(value.patches.hybrid.nodes.attack.zones[0].samples[0],'fitted-attack');
  assert(value.patches.synth.nodes['harmonic-1-level'].points.length>2);
});

test('ring modes recover inharmonic frequencies and individual decay times',()=>{
  const {value,report}=tool.fit(metal,{root:'F3'});
  assert.equal(value.root,53);
  assert.equal(value.preferred,'modal');
  assert.equal(report.particulars.modalExciter,'strike');
  for (const [hz,t60] of [[695,.691],[1191,.329],[1619,.432]]) {
    const mode=report.particulars.modes.find(row=>Math.abs(row.hz-hz)<13);
    assert(mode,'missing '+hz+' Hz mode');
    near(mode.decayT60,t60,.11);
  }
  assert.equal(value.patches.hybrid.nodes.ring.type,'resonator');
  assert(value.patches.modal.nodes.ring.modes.length>=3);
});

test('replaying edited fits preserves level steps, renders new pitches and stretches the note gate',()=>{
  const {value,assets,reference}=tool.fit(tone), candidates=['synth'];
  const cases=[{id:'match',midi:57,velocity:.85,gate:.42},{id:'octave',midi:69,velocity:.85,gate:.42},
    {id:'soft',midi:57,velocity:.24,gate:.42},{id:'long',midi:57,velocity:.85,gate:1.08}];
  const result=tool.audition(value,assets,{candidates,cases,sampleRate:rate},reference), report=result.report;
  const match=auditionLead(report,'synth-match'), octave=auditionLead(report,'synth-octave');
  assert.equal(match.adjustment,octave.adjustment);
  assert(auditionLead(report,'synth-soft').rms<match.rms*.5);
  assert(auditionLead(report,'synth-long').endSample-auditionLead(report,'synth-long').startSample>
    (match.endSample-match.startSample)*2);
  near(spectrum(result,match.id).value.channels[0].dominantHz,220,10);
  near(spectrum(result,octave.id).value.channels[0].dominantHz,440,10);
  const edit=structuredClone(value);
  edit.patches.synth.nodes['harmonic-1'].ratio=1.5;
  const changed=tool.audition(edit,assets,{candidates,cases:[cases[0]],sampleRate:rate},reference);
  near(spectrum(changed,match.id).value.channels[0].dominantHz,330,11);
  assert(result.value.samples.every(Number.isFinite) && report.clips.every(row=>row.peak<.72));
});

test('unvoiced sounds produce shaped noise and a captured attack without inventing a root',()=>{
  const breath=pcm(.51,(t,i)=>P.musicInstruments.noise(i,83)*.55*Math.sin(Math.PI*t/.51)**2);
  const {value,report}=tool.fit(breath);
  assert.equal(report.particulars.root,null);
  assert.equal(report.particulars.harmonics.length,0);
  assert.equal(report.particulars.modes.length,0);
  assert(report.particulars.noiseBands.length>=3);
  assert.equal(value.patches.synth.nodes.noise.type,'noise');
  assert.equal(value.patches.modal,undefined);
  assert.throws(()=>tool.fit(pcm(.15,()=>0)),/audible recording/);
});

test('CLI round-trips a fitted attack and replays edited portable graph patches',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-recording-fit-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const write=(file,body)=>fs.writeFileSync(path.join(dir,file),body);
  const cli=(...args)=>JSON.parse(execFileSync(process.execPath,
    [path.resolve(__dirname,'../cli/ink-studio.js'),'music','instrument',...args],{cwd:dir,encoding:'utf8'}));
  write('strike.wav',WAV.encode(metal,{encoding:'float32'}));
  write('fit.json',JSON.stringify({assets:{strike:'strike.wav'},options:{root:60}}));
  const paths=cli('fit','fit.json','--out','fit');
  const manifest=JSON.parse(fs.readFileSync(paths.instrument,'utf8'));
  assert.equal(manifest.fit.root,60);
  assert.equal(manifest.assets['fitted-attack'],'samples/fitted-attack.wav');
  manifest.fit.patches.hybrid.nodes.attack.zones[0].gain=-9;
  manifest.audition={candidates:['hybrid'],sampleRate:16000,cases:[{id:'match',midi:53,velocity:.6,gate:.26}]};
  write('fit/edit.json',JSON.stringify(manifest));
  const played=cli('audition-fit','fit/edit.json','--out','audition');
  assert(WAV.read(played.audio).samples.some(sample=>Math.abs(sample)>.02));
  const {clips}=JSON.parse(fs.readFileSync(played.report,'utf8'));
  assert.deepEqual(clips.map(row=>row.id),['source','hybrid-match']);
  assert.equal(clips[1].midi,53);
});
