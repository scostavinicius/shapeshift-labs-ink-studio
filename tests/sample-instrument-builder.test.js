const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ink=require('..'),kit=ink.load(),A=kit.KIT.procedural.mediaGraph,WAV=require('../cli/wav');
const tau=Math.PI*2,rate=16000;
const audio=(frames,signal,channels=1)=>({sampleRate:rate,channels,
  samples:Float64Array.from({length:frames*channels},(_,i)=>signal(Math.floor(i/channels),i%channels))});
function vowel(f0=175,center=1400) {
  const amplitudes=Array.from({length:22},(_,i)=>.02/(i+1)+.105*Math.exp(-.5*(((i+1)*f0-center)/150)**2));
  return audio(12800,(i,ch)=>{
    let sum=0;
    for (let k=0;k<amplitudes.length;k++) sum+=amplitudes[k]*Math.sin(tau*(k+1)*f0*i/rate+ch*.31);
    return sum*Math.min(1,i/96,(12799-i)/200)+(i===180 ? .26 : 0);
  },2);
}
function energy(pcm,f,from=3200,to=8000) {
  let a=0,b=0;
  for (let i=from;i<to;i++) {
    a+=pcm.samples[i*pcm.channels]*Math.cos(i*tau*f/rate);
    b+=pcm.samples[i*pcm.channels]*Math.sin(i*tau*f/rate);
  }
  return Math.hypot(a,b)/(to-from)*2;
}

test('YIN bank proposes pitched roots and separates aperiodic or silent gestures',()=>{
  const tone=audio(8000,i=>.38*Math.sin(tau*233.08*i/rate));
  let seed=0x92de9173;
  const breath=audio(8000,i=>{
    seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
    return .20*Math.sin(Math.PI*i/8000)*((seed>>>0)/2147483648-1);
  });
  const silent=audio(8000,()=>0);
  const {takes}=A.sampleInstrument.analyze({tone,breath,silent});
  assert(Math.abs(takes.tone.root.hz-233.08)<1);
  assert(takes.tone.root.confidence>.96);
  assert.equal(takes.tone.root.suggestedNote,58);
  assert.equal(takes.breath.root,null);
  assert(takes.breath.noisy.some(row=>row.toSample-row.fromSample>1500));
  assert.equal(takes.silent.root,null);
  assert.deepEqual(takes.silent.noisy,[]);
  assert(takes.tone.attacks.every(row=>row.sample>=0 && row.sample<8000));
});

test('shaping sets independent length and pitch with a byte-identical stereo attack',()=>{
  const input=vowel(220), attackFrames=450;
  const {value,report}=A.shapeInstrumentSample(input,{pitchCents:700,duration:.8,formantCents:0,attackFrames});
  assert.equal(report.targetFrames,10240);
  assert.equal(value.samples.length,20480);
  assert.deepEqual(value.samples.slice(0,attackFrames*2),input.samples.slice(0,attackFrames*2));
  const {takes:{shaped}}=A.sampleInstrument.analyze({shaped:value});
  assert(Math.abs(shaped.root.hz-220*2**(7/12))<4,JSON.stringify(shaped.root));
  assert.deepEqual(A.shapeInstrumentSample(input).value.samples,input.samples);
  assert.throws(()=>A.shapeInstrumentSample(input,{duration:.5,attackFrames:8000}),/Attack and join/);
});

test('formant-only changes redistribute the body spectrum on the original pitch and clock',()=>{
  const input=vowel(175);
  const shifted=A.shapeInstrumentSample(input,{formantCents:-500,attackFrames:320}).value;
  const {takes:{shifted:report}}=A.sampleInstrument.analyze({shifted});
  assert(Math.abs(report.root.hz-175)<2);
  assert.equal(shifted.samples.length,input.samples.length);
  assert.deepEqual(shifted.samples.slice(0,640),input.samples.slice(0,640));
  const weight=(source)=>energy(source,1050)/energy(source,1400);
  assert(weight(shifted)>weight(input)*2.5,weight(shifted)+' vs '+weight(input));
});

test('audition and multi-take zone bake retain durations across keys and produce a standard sampler patch',()=>{
  const a=vowel(220),b=vowel(233.08), assets={a,b};
  const preview=A.sampleInstrument.audition(assets,{sampleRate:rate,offsets:[-3,3],gap:.03});
  assert.deepEqual(preview.report.rows.map(row=>[row.take,row.offset]),[['a',-3],['a',3],['b',-3],['b',3]]);
  assert.equal(preview.report.rows[1].firstSample,12800+480);
  const {value,assets:pcm,report}=A.sampleInstrument.build(assets,{zones:[
    {id:'close',label:'Close vowel',low:'A3',high:'B3',takes:['a','b'],shape:{duration:.75,formantCents:0}}
  ]});
  assert.equal(value.zones.length,3);
  assert.equal(report.zones[0].label,'Close vowel');
  assert.deepEqual(value.zones.map(row=>[row.low,row.high,row.root,row.samples.length]),[[57,57,57,2],[58,58,58,2],[59,59,59,2]]);
  for (const item of report.files) {
    assert.equal(item.processing.targetFrames,9600);
    const {takes:{key}}=A.sampleInstrument.analyze({key:pcm[item.asset]});
    assert(Math.abs(key.root.hz-440*2**((item.key-69)/12))<4,JSON.stringify({item,key:key.root,roots:report.zones[0].roots}));
  }
  const playback=kit.KIT.procedural.musicInstruments.compile(value,pcm);
  const played=playback.prepare({midi:59,frequency:246.942,roundRobin:1,velocity:.8,play:{}},rate,.4);
  assert(Math.abs(played.duration-.6)<1e-5);
  assert(played.stereo && Math.abs(played.signal(.22,0,1))>1e-4);
});

test('CLI reads an explicit slice and returns a portable instrument with normal production audio assets',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-instrument-')),at=name=>path.join(dir,name);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(at('source.wav'),WAV.encode(vowel(220),{encoding:'pcm24'}));
  fs.writeFileSync(at('recipe.json'),JSON.stringify({
    assets:{vowel:{wav:'source.wav',fromSample:120,toSample:10800}},
    audition:{sampleRate:rate,offsets:[0,4]},zones:[{id:'lead',label:'Lead',low:57,high:58,takes:['vowel']}]
  }));
  const run=(mode,dir)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','instrument',mode,at('recipe.json'),'--out',at(dir)],{encoding:'utf8'}));
  const analysis=run('analyze','analysis.json');
  assert.equal(analysis.takes.vowel.frames,10680);
  assert.equal(analysis.sources.vowel.fromSample,120);
  const review=run('audition','review');
  assert(WAV.read(review.audio).samples.length>40000);
  const built=run('build','bank'), patch=JSON.parse(fs.readFileSync(built.instrument,'utf8'));
  assert.equal(patch.patch.zones.length,2);
  for (const file of Object.values(patch.assets)) assert.equal(WAV.read(at('bank/'+file)).samples.length,10680*2);
});
