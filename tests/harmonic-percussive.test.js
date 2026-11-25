const test=require('node:test'), assert=require('node:assert/strict');
const studio=require('..'), P=studio.load().KIT.procedural, A=P.mediaGraph;
const {make}=require('../examples/harmonic-percussive/fixture.cjs');
const input=make(16000);
const sumPower=samples=>samples.reduce((sum,x)=>sum+x*x,0);
const difference=(a,b)=>a.map((n,i)=>n-b[i]);
const peak=samples=>samples.reduce((max,n)=>Math.max(max,Math.abs(n)),0);
const result=A.harmonicPercussive.session(input.source);

test('linked spectral masks separate a stereo break and sum on the original grid',()=>{
  const {assets:{harmonic,percussive},report}=result, {source,tonal,transient}=input;
  assert.equal(report.layerGain,1);
  assert.equal(harmonic.samples.length,source.samples.length);
  assert.equal(percussive.sampleRate,source.sampleRate);
  assert.equal(percussive.channels,2);
  const reconstruction=harmonic.samples.map((n,i)=>n+percussive.samples[i]);
  assert(peak(difference(reconstruction,source.samples))<2e-16);
  const overlap=sumPower(difference(harmonic.samples,tonal.samples));
  assert(10*Math.log10(sumPower(tonal.samples)/overlap)>9);
  assert(10*Math.log10(sumPower(transient.samples)/overlap)>5);
  assert(report.hits.filter(hit=>input.hits.some(row=>Math.abs(hit.sample-row.sample)<32)).length>=16);
  const printed=A.audioEditorial.render(result.value,result.assets);
  assert(peak(difference(printed.value.samples,source.samples))<2e-16,'the initial hit joins must sum at unity');
});

test('normalized layers preserve phase and restore a clipped-component split without a new timing offset',()=>{
  const sampleRate=8000, frames=8000, samples=new Float64Array(frames*2);
  for(let i=0;i<frames;i++){
    const sine=.95*Math.sin(2*Math.PI*440*i/sampleRate);
    const value=i===1932?-Math.abs(sine):sine;
    samples[i*2]=value;samples[i*2+1]=-value;
  }
  const project=A.harmonicPercussive.session({sampleRate,channels:2,samples},{detect:false});
  assert(project.report.layerGain<1);
  assert.equal(project.report.restoreGain,1/project.report.layerGain);
  for(const layer of Object.values(project.assets)){
    assert(peak(layer.samples)<=1);
    for(let i=0;i<frames;i++)assert(Math.abs(layer.samples[i*2]+layer.samples[i*2+1])<1e-14);
  }
  const rendered=A.audioEditorial.render(project.value,project.assets);
  assert(peak(difference(rendered.value.samples,samples))<1e-14);
  assert.equal(rendered.report.headroom,1);
});

test('one editorial session retunes while preserving length and moves only the selected hit',()=>{
  const {value,assets,report}=result, hz=440, frames=16000, sampleRate=16000;
  const tone={sampleRate,channels:1,
    samples:Float64Array.from({length:frames},(_,i)=>.16*Math.sin(2*Math.PI*hz*i/sampleRate))};
  const clean=A.harmonicPercussive.session(tone,{detect:false});
  const change={op:'transpose',clip:'harmonic',semitones:12};
  const tuned=A.audioEditorial.revise(clean.value,clean.assets,[change]);
  const tunePrint=A.audioEditorial.render(tuned.value,clean.assets,{stems:true});
  assert.equal(tunePrint.report.clips[0].source.transpose,12);
  assert.equal(tunePrint.report.clips[0].range.toSample,frames);
  function component(frequency){
    let x=0,y=0;
    for(let i=3000;i<13000;i++){
      const phase=2*Math.PI*frequency*i/sampleRate,n=tunePrint.stems.harmonic.samples[i*2];
      x+=n*Math.cos(phase);y+=n*Math.sin(phase);
    }
    return Math.hypot(x,y);
  }
  assert(component(880)>24*component(440));
  const reset=A.audioEditorial.revise(tuned.value,clean.assets,[{...change,semitones:0}]);
  assert.deepEqual(reset.value,clean.value);
  const hit=report.hits[2], shift=1600, before=A.audioEditorial.render(value,assets,{stems:true});
  const edit=A.audioEditorial.revise(value,assets,[{op:'transpose',clip:'harmonic',semitones:5},
    {op:'nudge',clip:hit.id,offsetSamples:shift}]);
  const after=A.audioEditorial.render(edit.value,assets,{stems:true});
  assert.equal(after.report.clips.find(row=>row.id===hit.id).spot.sample,hit.sample+shift);
  assert.equal(after.report.clips.find(row=>row.id===report.hits[3].id).spot.sample,report.hits[3].sample);
  assert.notDeepEqual(after.stems.harmonic.samples,before.stems.harmonic.samples);
  const onlyPitch=A.audioEditorial.revise(value,assets,[{op:'transpose',clip:'harmonic',semitones:5}]);
  assert.deepEqual(A.audioEditorial.render(onlyPitch.value,assets,{stems:true}).stems.percussive.samples,before.stems.percussive.samples);
});

test('tiny mono takes and dense hit joins retain coverage, and unsupported settings reject',()=>{
  const single={sampleRate:8000,channels:1,samples:new Float64Array([.25])};
  const tiny=A.harmonicPercussive.session(single);
  assert.equal(A.audioEditorial.render(tiny.value,tiny.assets).value.samples[0],.25);
  const tight=A.harmonicPercussive.session(input.source,{detect:{minGap:0,minStrength:.02}});
  assert(peak(difference(A.audioEditorial.render(tight.value,tight.assets).value.samples,input.source.samples))<2e-16);
  assert.throws(()=>A.harmonicPercussive.split(single,{frequencyMedian:10}),/median/);
  assert.throws(()=>A.audioEditorial.revise(tiny.value,tiny.assets,[{op:'transpose',clip:'harmonic',semitones:25}]),/transposition/);
  assert.equal(A.operations['audio.separateHarmonicPercussive'].run({source:single,options:{}}).harmonic.samples.length,1);
});
