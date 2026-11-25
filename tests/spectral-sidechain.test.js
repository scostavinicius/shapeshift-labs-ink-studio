const assert=require('node:assert/strict'), {test}=require('node:test');
const A=require('..').load().KIT.procedural.mediaGraph;
const rate=16000,frames=rate*3,tau=2*Math.PI;
const tone=(i,hz)=>Math.sin(tau*hz*i/rate);
function pcm(sample) {
  const samples=new Float64Array(frames*2);
  for (let i=0;i<frames;i++) samples.set(sample(i),2*i);
  return {sampleRate:rate,channels:2,samples};
}
const dry=pcm(i=>{
  const value=.13*tone(i,250)+.19*tone(i,875)+.19*tone(i,2250);
  return [value,.61*value];
});
const key=pcm(i=>{
  const t=i/rate;
  const value=t>=.15 && t<.7 ? .22*tone(i,875) : t>=1 && t<1.55 ? .22*tone(i,2250) :
    t>=2 && t<2.8 ? .22*tone(i,3750) : 0;
  return [value,-value];
});
const assets={key,dry};
const route={processor:'room',sidechain:{strip:'lead',tap:'post'}};
function recipe(options={}) {
  return {id:'spectral-competition',sampleRate:rate,output:'master',peakPolicy:'error',
    strips:{lead:{clips:[{id:'main',source:'key'}]},rival:{clips:[{id:'main',source:'dry'}],inserts:[route]},master:{}},
    processors:{room:{type:'spectral-sidechain',size:1024,attackMs:10,releaseMs:45,maxCutDb:8,...options}},
    taps:{key:{strip:'lead'},dry:{strip:'rival',tap:'input'},processed:{strip:'rival',tap:'pre'}}};
}
function measuredCut(result,hz,start,end,channel=0) {
  let before=0,after=0;
  for (let i=Math.round(start*rate);i<Math.round(end*rate);i++) {
    const reference=tone(i,hz), at=2*i+channel;
    before+=reference*result.taps.dry.samples[at];
    after+=reference*result.taps.processed.samples[at];
  }
  return -20*Math.log10(Math.abs(after/before));
}
const insert=result=>result.report.strips.rival.inserts.at(-1);

test('overlap moves between frequencies, leaving the rest of the rival and the foreground intact',()=>{
  const result=A.mixer.render(recipe(),assets), {details}=insert(result);
  for (const [active,protectedHz,start,end] of [[875,2250,.35,.6],[2250,875,1.25,1.5]]) {
    const cut=measuredCut(result,active,start,end);
    assert(cut>7.8 && cut<=8.01,`expected an 8 dB cut at ${active} Hz, got ${cut}`);
    assert(Math.abs(measuredCut(result,protectedHz,start,end))<.015);
    assert(Math.abs(measuredCut(result,250,start,end))<.015);
    assert(Math.abs(cut-measuredCut(result,active,start,end,1))<1e-9);
  }
  assert(result.taps.key.samples.every((sample,i)=>sample===key.samples[i]));
  for (const hz of [250,875,2250]) assert(Math.abs(measuredCut(result,hz,2.35,2.65))<.015);
  assert(details.peakCutDb>7.9 && details.peakCutDb<=8);
  assert(details.overlapFrames>0);
  assert(details.trace.length<=64);
  const maskAt=time=>details.trace[Math.floor(time*rate/details.traceStepSamples)];
  assert(maskAt(.5)[3]>7.8 && maskAt(.5)[5]<.015);
  assert(maskAt(1.35)[5]>7.8 && maskAt(1.35)[3]<.015);
  assert(maskAt(2.5).every(cut=>cut<.015));
});

test('the ceiling, frequency range, attack, release and bypass control the native insert',()=>{
  const options={maxCutDb:3,lowHz:500,highHz:1200};
  const result=A.mixer.render(recipe(options),assets);
  assert(Math.abs(measuredCut(result,875,.35,.6)-3)<.01);
  assert(Math.abs(measuredCut(result,2250,1.25,1.5))<.01);
  const slower=A.mixer.render(recipe({...options,attackMs:150,releaseMs:150}),assets);
  assert(measuredCut(slower,875,.2,.25)<measuredCut(result,875,.2,.25)-1);
  assert(measuredCut(slower,875,.8,.85)>measuredCut(result,875,.8,.85)+.5);
  for (const bypass of [{maxCutDb:0},{wet:0},{thresholdDb:-6}]) {
    const rendered=A.mixer.render(recipe(bypass),assets);
    assert.deepEqual(rendered.taps.processed,rendered.taps.dry);
    assert.equal(insert(rendered).details.peakCutDb,0);
  }
  const automated=A.mixer.render(recipe({wet:{unit:'seconds',curve:'hold',points:[{at:0,value:0},{at:.9,value:1}]}}),assets);
  assert.deepEqual(automated.taps.processed.samples.slice(0,rate),automated.taps.dry.samples.slice(0,rate));
  assert(measuredCut(automated,2250,1.25,1.5)>7.8);
});

test('mixer tap dependencies align dry and key timing without a printed delay or tail',()=>{
  const source=recipe(), original=A.mixer.render(source,assets);
  const delayed=structuredClone(source);
  delayed.strips.lead.inserts=['lead-lookahead'];
  delayed.strips.rival.inserts.unshift('rival-lookahead');
  delayed.processors['lead-lookahead']={type:'compressor',ratio:1,lookahead:.03};
  delayed.processors['rival-lookahead']={type:'compressor',ratio:1,lookahead:.01};
  const result=A.mixer.render(delayed,assets);
  assert.equal(insert(result).mainDelay,320);
  assert.equal(insert(result).latency,512);
  assert.equal(result.report.latencySamples,992);
  assert.equal(result.report.tailFrames,0);
  assert.deepEqual(result.value,original.value);
  assert.deepEqual(result.taps,original.taps);
  assert.deepEqual(insert(result).details,insert(original).details);
  delayed.processors['lead-lookahead'].lookahead=.001;
  const earlyKey=A.mixer.render(delayed,assets);
  assert.equal(insert(earlyKey).sidechain.compensation,144);
  assert.deepEqual(earlyKey.value,original.value);
});

test('the spectral sidechain requires a valid foreground tap and bounded settings',()=>{
  const source=recipe();
  source.strips.rival.inserts=['room'];
  assert.throws(()=>A.mixer.render(source,assets),/needs a foreground sidechain tap/);
  source.strips.rival.inserts=[{...route,sidechain:{strip:'rival',tap:'post'}}];
  assert.throws(()=>A.mixer.render(source,assets),/cycle/);
  for (const options of [{size:1000},{maxCutDb:25},{attackMs:-1},{lowHz:200,highHz:100},{highHz:8800}]) {
    assert.throws(()=>A.mixer.render(recipe(options),assets),/Invalid spectral sidechain settings/);
  }
});
