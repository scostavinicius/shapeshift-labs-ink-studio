const assert=require('node:assert/strict'), {test}=require('node:test');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const kit=require('..').load(), PNG=require('../cli/png.js'), WAV=require('../cli/wav.js');
const {analyze}=require('../cli/delivered-sync.js');

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-delivery-sync-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name), rate=48000;
  function wave(name,hits,bwf={timeReference:42000}) {
    const samples=new Float64Array(24500);
    for (const start of hits) for (let i=0;i<277;i++) samples[start+i]=.57*Math.cos(i*.64)*Math.exp(-i/70);
    fs.writeFileSync(file(name),WAV.encode({samples,sampleRate:rate,channels:1},{encoding:'pcm24',bwf}));
    return {file:name};
  }
  function image(name,kind) {
    const rgb=Uint8Array.from({length:16*12*3},(_,i)=>i%3===0 ? 24 : 34);
    for (let y=3;y<9;y++) for (let x=5;x<9;x++) {
      const offset=(y*16+x)*3, contact=kind==='contact';
      rgb.set(kind==='unreadable' ? [30,250,180] : contact ? [238,164,71] : [55,64,102],offset);
    }
    PNG.write(file(name),16,12,rgb);
  }
  for (const state of ['separated','contact','unreadable']) image(state+'.png',state);
  const sequence=['separated','separated','unreadable','contact','contact','contact','contact','contact','contact','contact']
    .map(state=>state+'.png');
  const picture={fps:{numerator:30000,denominator:1001},firstFrame:27,frames:sequence};
  const stems={late:wave('late.wav',[10248]),early:wave('early.wav',[2850]),same:wave('same.wav',[6048]),
    silence:wave('silent.wav',[]),multiple:wave('twice.wav',[2950,10248])};
  const check=(stem)=>({id:stem,window:{from:27,to:37},scheduled:{frame:30,sample:48048},
    picture:{region:[5,3,4,6],separated:'separated.png',contact:'contact.png',holdFrames:2},
    audio:{stem},toleranceMs:25});
  const job={format:'ink-studio/delivered-sync-check',version:1,picture,stems,checks:Object.keys(stems).map(check)};
  const save=spec=>{fs.writeFileSync(file('check.json'),JSON.stringify(spec));return file('check.json');};
  return {job,file,save};
}

test('measure early, late and in-sync delivery independent of scheduled agreement',t=>{
  const {job,save}=fixture(t);
  const {report}=analyze(save(job),kit);
  const [late,early,same,silent,twice]=report.checks;
  assert.equal(report.passed,false);
  assert.equal(late.scheduled.deltaMs,0);
  assert.equal(late.picture.hit.frame,30);
  assert.equal(late.picture.hit.confirmedAt,31);
  assert.deepEqual(late.picture.hit.timecode,{numerator:1001,denominator:1000});
  assert.equal(late.audio.startSample,42000);
  assert.equal(late.audio.hit.sample,52248);
  assert.equal(late.deltaMs,87.5);
  assert.equal(late.status,'audio-late');
  assert.equal(early.status,'audio-early');
  assert.equal(same.deltaMs,0);
  assert.equal(same.status,'in-sync');
  assert.equal(silent.status,'needs-review');
  assert.equal(silent.audio.status,'unobserved');
  assert.equal(twice.audio.status,'ambiguous');
  assert.equal(twice.deltaMs,null);
});

test('do not invent visible timings when picture is unbracketed, obscured or contains repeated contacts',t=>{
  const {job,save}=fixture(t), row=job.checks[2];
  for (const [sequence,status] of [
    [['contact','contact','contact','contact'],'unbracketed'],
    [['separated','unreadable','unreadable','unreadable'],'unobserved'],
    [['separated','contact','contact','separated','contact','contact'],'ambiguous']
  ]) {
    const file=save({...job,picture:{...job.picture,frames:sequence.map(state=>state+'.png')},
      checks:[{...row,window:{from:27,to:27+sequence.length}}]});
    const evidence=analyze(file,kit).report.checks[0];
    assert.equal(evidence.picture.status,status);
    assert.equal(evidence.status,'needs-review');
    assert.equal(evidence.deltaMs,null);
  }
});

test('the CLI reads a numbered audiovisual export, reports flags, and protects source files',t=>{
  const {file,save,job}=fixture(t), {fps,firstFrame,frames}=job.picture;
  fs.writeFileSync(file('export.json'),JSON.stringify({format:'ink-studio/audiovisual-export',version:1,
    picture:{format:'ink-studio/graph-clip',fps,from:firstFrame,to:firstFrame+frames.length,
      frames:frames.map((file,i)=>({frame:firstFrame+i,file}))},audio:{file:'late.wav',startSample:42000}}));
  const recipe=save({...job,picture:'export.json',stems:{},checks:[{...job.checks[0],audio:{stem:'export'}}]});
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  function run(out) {
    return spawnSync(process.execPath,[cli,'take','check-sync',recipe,'--out',out,'--fail-on-flags'],{encoding:'utf8'});
  }
  const result=run(file('report.json'));
  assert.equal(result.status,2,result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(file('report.json'))).checks[0].status,'audio-late');
  const protectedInput=run(file('late.wav'));
  assert.equal(protectedInput.status,1);
  assert.match(protectedInput.stderr,/separate file/);
  assert.equal(WAV.read(file('late.wav')).sampleRate,48000);
});
