const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {test}=require('node:test');
const WAV=require('../cli/wav.js');

const rate=48000, count=15107, onset=6200;
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const root=t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-audio-round-trip-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
};
function usable(t) {
  if (['ffmpeg','ffprobe'].every(name=>spawnSync(name,['-version'],{stdio:'ignore'}).status===0)) return true;
  t.skip('FFmpeg and FFprobe are unavailable');
  return false;
}
function encode(dir,args) {
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin',...args],{cwd:dir,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.error?.message);
}
function source(shift=0) {
  return Float64Array.from({length:count},(_,index)=>{
    const n=index-onset-shift;
    return n>=0&&n<997 ? Math.exp(-n/115)*(.48*Math.cos(n*.77)+.23*Math.sin(n*.19)) : 0;
  });
}
function wav(dir,name,samples,bwf) {
  fs.writeFileSync(path.join(dir,name),WAV.encode({sampleRate:rate,channels:1,samples},{encoding:'pcm24',bwf}));
}
function plan(delivery,overrides={}) {
  return {format:'ink-studio/audio-round-trip',version:1,source:'source.wav',delivery,
    transients:[{id:'strike',window:{from:onset-200,to:onset+1700},toleranceMs:3}],
    loops:[{id:'loop'}],...overrides};
}
function run(dir,recipe,output='report.json') {
  fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(recipe));
  const result=spawnSync(process.execPath,[cli,'take','approve-audio','plan.json','--out',output],{
    cwd:dir,encoding:'utf8',timeout:30000
  });
  const file=path.join(dir,output);
  return {result,report:result.status===1?null:read(file)};
}

test('native AAC, MP3 and Opus reach the same odd-length sample grid after metadata trim',t=>{
  if (!usable(t)) return;
  const dir=root(t);
  wav(dir,'source.wav',source(),{timeReference:123456});
  const cases=[
    ['programme.m4a','aac','192k'],['programme.mp3','libmp3lame','192k'],['programme.opus','libopus','96k']
  ];
  for (const [file,codec,bitrate] of cases) {
    encode(dir,['-i','source.wav','-c:a',codec,'-b:a',bitrate,file]);
    const {result,report}=run(dir,plan(file));
    assert.equal(result.status,0,result.stderr||JSON.stringify(report?.flags));
    assert.equal(report.status,'approved');
    assert.equal(report.source.timeReference,'123456');
    assert.equal(report.delivery.playableFrames,count);
    assert(report.delivery.packetSkipSamples>0);
    assert.equal(report.frameDelta,0);
    assert(Math.abs(report.transients[0].deltaMs)<=3);
    assert.equal(report.loops[0].status,'passed');
    if (codec==='aac') {
      assert.equal(report.delivery.timestampPadding,report.delivery.decodedFrames-count);
      assert(report.delivery.decodedFrames===count||report.delivery.decodedFrames===15360);
    } else {
      assert(report.delivery.packetDiscardPadding>0);
      assert.equal(report.delivery.timestampPadding,0);
      assert.equal(report.delivery.decodedFrames,count);
    }
    assert.equal(report.delivery.sha256,createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex'));
  }
});

test('unmarked ADTS padding remains visible and explicit additional trim preserves the attack and wrap',t=>{
  if (!usable(t)) return;
  const dir=root(t);
  wav(dir,'source.wav',source());
  encode(dir,['-i','source.wav','-c:a','aac','-b:a','192k','programme.aac']);
  const raw=run(dir,plan('programme.aac'));
  assert.equal(raw.result.status,2,raw.result.stderr);
  assert.equal(raw.report.frameDelta,1277);
  assert.equal(raw.report.delivery.timestampPadding,0);
  assert.equal(raw.report.transients[0].status,'shifted');
  assert(raw.report.transients[0].deltaMs>19);
  assert.equal(raw.report.loops[0].status,'file-loop-length-mismatch');
  const trimmed=run(dir,plan('programme.aac',{additionalTrim:{leading:1024,trailing:253}}));
  assert.equal(trimmed.result.status,0,trimmed.result.stderr||JSON.stringify(trimmed.report?.flags));
  assert.deepEqual(trimmed.report.delivery.additionalTrim,{leading:1024,trailing:253});
  assert.equal(trimmed.report.delivery.playableFrames,count);
  assert.equal(trimmed.report.transients[0].status,'passed');
});

test('flags a real timing shift and seam damage after decoding a selected audio track',t=>{
  if (!usable(t)) return;
  const dir=root(t);
  wav(dir,'source.wav',source());
  const altered=source(432);
  altered.fill(.3,count-260);
  wav(dir,'shifted.wav',altered);
  encode(dir,['-i','source.wav','-i','shifted.wav','-map','0:a:0','-map','1:a:0','-c:a','aac','-b:a','192k','two-tracks.m4a']);
  const {result,report}=run(dir,plan('two-tracks.m4a',{audioTrack:1}));
  assert.equal(result.status,2,result.stderr);
  assert.equal(report.frameDelta,0);
  assert.equal(report.delivery.audioTrack,1);
  assert.equal(report.transients[0].status,'shifted');
  assert(report.transients[0].deltaMs>7&&report.transients[0].deltaMs<11);
  assert.equal(report.loops[0].status,'damaged');
  assert(report.loops[0].problems.includes('endpoint-step'));
  assert(report.loops[0].problems.includes('boundary-distortion'));
  assert.equal(report.loops[0].endpointSteps[0].sourceStep,0);
});

test('reports reconstructed delivery overs while protecting the input files',t=>{
  if (!usable(t)) return;
  const dir=root(t);
  const alternating=[.91,.91,-.91,-.91];
  wav(dir,'source.wav',Float64Array.from({length:count},(_,i)=>alternating[i%4]*Math.min(i/80,(count-i)/80,1)));
  encode(dir,['-i','source.wav','-c:a','aac','-b:a','192k','loud.m4a']);
  const spec=plan('loud.m4a',{transients:[],loops:[],maxTruePeakDbTP:0});
  const {result,report}=run(dir,spec);
  assert.equal(result.status,2,result.stderr);
  assert.deepEqual(report.flags.map(row=>row.kind),['true-peak']);
  assert(report.delivery.peak.truePeakDbTP>1);
  assert(report.delivery.peak.truePeakDbTP>report.delivery.peak.samplePeakDbFS);
  assert.equal(report.delivery.peak.oversample,8);
  const before=fs.readFileSync(path.join(dir,'source.wav'));
  const collision=run(dir,spec,'source.wav');
  assert.equal(collision.result.status,1);
  assert.match(collision.result.stderr,/separate from source files/);
  assert.deepEqual(fs.readFileSync(path.join(dir,'source.wav')),before);
});

test('rejects a changed sample grid and preserves inconclusive source windows as evidence',t=>{
  if (!usable(t)) return;
  const dir=root(t);
  wav(dir,'source.wav',source());
  encode(dir,['-i','source.wav','-c:a','aac','-ar','44100','wrong-rate.m4a']);
  const resampled=run(dir,plan('wrong-rate.m4a'),'resampled.json');
  assert.equal(resampled.result.status,1);
  assert.match(resampled.result.stderr,/sample rate and channel count must match/);
  assert.equal(fs.existsSync(path.join(dir,'resampled.json')),false);

  encode(dir,['-i','source.wav','-c:a','aac','preserved.m4a']);
  const uncertain=run(dir,plan('preserved.m4a',{
    transients:[{id:'silent-window',window:{from:200,to:600}}]
  }));
  assert.equal(uncertain.result.status,2,uncertain.result.stderr);
  assert.equal(uncertain.report.status,'inconclusive');
  assert.deepEqual(uncertain.report.flags,[]);
  assert.deepEqual(uncertain.report.unchecked,[{kind:'transient',id:'silent-window',status:'source-unobserved'}]);
});
