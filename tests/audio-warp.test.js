const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'), kit=ink.load(), A=kit.KIT.procedural.mediaGraph;
const sampleRate=16000, tau=2*Math.PI;
const mono=(frames,signal)=>({sampleRate,channels:1,samples:Float64Array.from({length:frames},(_,i)=>signal(i))});
const hz=(samples,first,last)=>{
  let count=0;
  for (let i=first+1;i<last;i++) if (samples[i-1]<0 && samples[i]>=0) count++;
  return count*sampleRate/(last-first);
};

test('tempo warping detects break onsets and lays their original attacks onto the new grid',()=>{
  const hits=[1600,6200,10900];
  const source=mono(16000,i=>hits.reduce((level,start)=>{
    const t=i-start;
    return level+(t>=0 && t<400 ? .8*Math.cos(t*2.6)*Math.exp(-t*.016) : 0);
  },0));
  const {value,report}=A.warpAudio(source,{mode:'beats',tempo:{from:100,to:140},detect:{minGap:.16}});
  assert.equal(report.targetFrames,11429);
  const found=report.markers.filter(row=>row.kind==='transient');
  assert.equal(found.length,3);
  for (const [i,hit] of found.entries()) {
    assert(Math.abs(hit.sourceSample-hits[i])<24);
    assert.equal(hit.targetSample,Math.round(hit.sourceSample*11429/16000));
    assert.deepEqual(value.samples.slice(hit.targetSample,hit.targetSample+96),
      source.samples.slice(hit.sourceSample,hit.sourceSample+96));
  }
  const pin=found[0].sourceSample-12, target=1600;
  const pinned=A.warpAudio(source,{mode:'beats',tempo:{from:100,to:140},detect:{minGap:.16},
    markers:[{sourceSample:pin,targetSample:target}]});
  assert(!pinned.report.markers.some(row=>row.kind==='transient' && Math.abs(row.sourceSample-pin)<192));
  assert.deepEqual(pinned.value.samples.slice(target,target+96),source.samples.slice(pin,pin+96));
});

test('authored picture and rational-time pins land on exact sample indices with their stereo attacks intact',()=>{
  const samples=new Float64Array(20000*2), channels=2;
  samples.set([.8,-.6,.3,-.2],4000*2);
  samples.set([.7,-.55,.4,-.21],15000*2);
  const source={sampleRate,channels,samples};
  const settings={mode:'beats',detect:false,fps:{numerator:30000,denominator:1001},targetFrames:19000,
    markers:[{id:'first',sourceSample:4000,targetFrame:9},
      {id:'second',sourceSample:15000,targetTime:{numerator:7,denominator:8}}]};
  const {value,report}=A.warpAudio(source,settings);
  assert.equal(value.samples.length,38000);
  for (const [index,target] of [4804,14000].entries()) {
    const marker=report.markers[index+1], at=marker.sourceSample;
    assert.equal(marker.targetSample,target);
    assert.deepEqual(value.samples.slice(target*2,target*2+4),source.samples.slice(at*2,at*2+4));
    assert.equal(value.samples[(target-1)*2],0);
  }
  assert.throws(()=>A.warpAudio(source,{...settings,markers:[
    {sourceSample:4000,targetSample:6000},{sourceSample:11000,targetSample:5000}]}),/increase/);
  assert.throws(()=>A.warpAudio(source,{targetFrames:12000,speed:2}),/duration control/);
  assert.throws(()=>A.warpAudio(source,{markers:[{sourceSample:4000,targetFrame:9}]}),/fps/);
});

test('tones and speech preserve a voiced pitch while repitch follows speed and filters foldover',()=>{
  const pure=mono(sampleRate,i=>.5*Math.sin(tau*440*i/sampleRate));
  for (const mode of ['tones','speech','repitch']) {
    const {value,report}=A.warpAudio(pure,{mode,speed:.8});
    assert.equal(report.targetFrames,20000);
    assert.equal(value.samples.length,20000);
    assert(Math.abs(hz(value.samples,4500,16500)-(mode==='repitch'?352:440))<4,mode);
    assert(value.samples.slice(4500,16500).some(v=>Math.abs(v)>.4));
    assert.deepEqual(A.warpAudio(pure,{mode}).value.samples,pure.samples);
  }
  const high=mono(sampleRate,i=>.8*Math.sin(tau*.42*i));
  const {samples}=A.warpAudio(high,{mode:'repitch',speed:2}).value;
  assert(Math.max(...samples.slice(1000,6000).map(Math.abs))<.02);
  const stereo={sampleRate,channels:2,samples:Float64Array.from({length:pure.samples.length*2},
    (_,i)=>(i%2?-1:1)*pure.samples[i>>1])};
  const result=A.warpAudio(stereo,{mode:'tones',speed:1.18}).value.samples;
  assert(result.every((value,i)=>i%2 || Math.abs(value+result[i+1])<1e-9));
});

test('music samples warp reads a catalog item or edited project and publishes the resolved mapping',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-warp-test-')), libraryPath=path.join(root,'library');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const library=ink.openSampleLibrary(libraryPath,{kit});
  const source=mono(1200,i=>.3*Math.sin(tau*380*i/sampleRate));
  const {entry}=library.add(A.sampleCatalog.capture(source,{sample:{id:'tone',label:'Tone'},
    source:{kind:'file',name:'tone.wav'}}));
  const at=(file,value)=>{
    const location=path.join(root,file);
    if (value!==undefined) fs.writeFileSync(location,JSON.stringify(value));
    return location;
  };
  const edit=A.sampleEdit.edit(A.sampleEdit.create(source,{source:{id:entry.id,asset:entry.asset}}),[
    {op:'trim',id:'original',head:100,tail:100},{op:'reverse',id:'original'}
  ]);
  const config=at('settings.json',{mode:'repitch',speed:.8});
  const run=(input,out)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','samples','warp',libraryPath,input,config,'--out',at(out)],{encoding:'utf8'}));
  const original=run('tone','raw'), edited=run(at('edit.json',edit),'edited');
  const report=JSON.parse(fs.readFileSync(edited.report,'utf8'));
  assert.equal(report.source.asset,entry.asset);
  assert.equal(report.sourceFrames,1000);
  assert.equal(report.targetFrames,1250);
  assert.equal(ink.readWav(original.audio).samples.length,1500);
  assert.deepEqual(ink.readWav(edited.audio).samples,
    A.warpAudio(A.sampleEdit.render(source,edit).value,{mode:'repitch',speed:.8}).value.samples);
  assert.deepEqual(library.load(entry.id).value.samples,source.samples);
});
