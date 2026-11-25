const assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const {test}=require('node:test');
const WAV=require('../cli/wav.js');
const Capture=require('../src/room-impulse-capture.js');
const {KIT}=require('..').load();
const Translator=require('../cli/playback-translation.js');

const rate=48000, span=38400, size=span*3, tau=2*Math.PI;
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const put=(file,obj)=>fs.writeFileSync(file,JSON.stringify(obj));
function temp(t) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-translation-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  return folder;
}
function save(file,samples,channels=1,sampleRate=rate) {
  fs.writeFileSync(file,WAV.encode({sampleRate,channels,samples},{encoding:'pcm24'}));
}
function fixture(dir) {
  const at=name=>path.join(dir,name);
  const low=new Float64Array(size*2), high=new Float64Array(size*2), side=new Float64Array(size*2);
  const background=new Float64Array(size*2);
  for(let i=0;i<size;i++) {
    const t=i/rate, part=i%span, fade=Math.min(1,part/240,(span-part-1)/240);
    const sub=Math.sin(tau*72*t)*fade, upper=Math.sin(tau*910*t)*fade;
    if (i<span) low[i*2]=low[i*2+1]=.18*sub+.007*upper;
    else if(i<span*2) high[i*2]=high[i*2+1]=.16*upper+.009*sub;
    else {side[i*2]=.19*sub;side[i*2+1]=-.19*sub;}
    background[i*2]=background[i*2+1]=.023*Math.sin(tau*650*t);
  }
  save(at('mix.wav'),low.map((value,i)=>value+high[i]+side[i]+background[i]),2);
  save(at('bass.wav'),low,2);save(at('bright.wav'),high,2);save(at('side.wav'),side,2);
  const phone=new Float64Array(80);
  phone[17]=.48;phone[18]=-.48;
  save(at('phone.wav'),phone);
  const laptop=new Float64Array(24000);
  laptop[25]=.4;laptop[28]=-.4;
  save(at('laptop.wav'),laptop,1,24000);
  put(at('laptop.json'),{
    format:Capture.format,version:1,response:'laptop.wav',
    measurement:{sampleRate:24000,channels:1,frames:laptop.length,calibration:'loopback'},
    edit:{directSample:25,directEndMs:1.5,splitMs:25,crossfadeMs:5,lengthMs:100,endFadeMs:10},
    probeMix:{earlyGain:1,tailGain:1}
  });
  const flat=new Float64Array(80);
  flat[22]=.25;
  save(at('small.wav'),flat);
  return {format:'ink-studio/playback-translation',version:1,title:'Test booth',mix:'mix.wav',targets:[
    {id:'phone',label:'Phone capture',device:'phone',response:'phone.wav',directSample:17},
    {id:'laptop',label:'Laptop capture',device:'laptop',response:'laptop.json',window:{fromSample:5,toSample:2405}},
    {id:'small',label:'Small speaker capture',device:'small-speaker',response:'small.wav',directSample:22,input:'stereo'}
  ],cues:[
    {id:'bass',label:'Bass cue',stem:'bass.wav',fromSample:1200,toSample:span-1200},
    {id:'bright',label:'Bright cue',stem:'bright.wav',fromSample:span+1200,toSample:span*2-1200},
    {id:'side',label:'Side bass',stem:'side.wav',fromSample:span*2+1200,toSample:size-1200},
    {id:'mix-low',label:'Mix only window',fromSample:1200,toSample:span-1200}
  ]};
}
function run(dir,plan,out='review') {
  put(path.join(dir,'plan.json'),plan);
  return spawnSync(process.execPath,[cli,'music','mix','translate','plan.json','--out',out],{
    cwd:dir,encoding:'utf8',timeout:30000
  });
}

test('renders measured WAVs and capture assets at one sample clock and distinguishes bass loss from fold cancellation',t=>{
  const dir=temp(t), plan=fixture(dir), result=run(dir,plan);
  assert.equal(result.status,0,result.stderr);
  const at=name=>path.join(dir,'review',name), report=read(at('report.json'));
  assert.deepEqual(report.targets.map(row=>row.device),['phone','laptop','small-speaker']);
  assert.equal(report.targets[1].measurement.alignedAtSample,40);
  assert.deepEqual(report.targets[1].measurement.window,{fromSample:5,toSample:2405});
  assert.equal(report.targets[1].measurement.capture,'loopback');
  assert.deepEqual(report.cues[0].measurements.map(row=>row.status),['bass-risk','bass-risk','no-bass-flag']);
  assert(report.cues[0].measurements[0].bassResponseDb<-15);
  assert(report.cues[0].measurements[0].sourceBassShare>.95);
  assert(report.cues[1].measurements.every(row=>row.status==='no-bass-flag'));
  assert.deepEqual(report.cues[2].measurements.map(row=>row.status),['lost-in-routing','lost-in-routing','no-bass-flag']);
  assert(report.cues[3].measurements.some(row=>row.status==='needs-isolation'));
  const prints=['reference','phone','laptop','small'].map(id=>WAV.read(at('audio/'+id+'.wav')));
  assert(prints.every(row=>row.samples.length===report.frames*2&&row.sampleRate===rate&&row.channels===2));
  for(let i=0;i<prints[0].samples.length;i++) assert(Math.abs(prints[0].samples[i]-prints[3].samples[i])<1e-6);
  assert(prints[1].samples.some((value,i)=>Math.abs(value-prints[0].samples[i])>.05));
  assert(fs.readFileSync(at('index.html'),'utf8').includes('Switch devices at the same point in the mix.'));
});

test('retains differences under one shared peak gain and refuses misaligned cue stems',t=>{
  const dir=temp(t), plan=fixture(dir);
  const mix=Float64Array.from({length:12000},(_,i)=>.92*Math.sin(tau*3400*i/rate));
  save(path.join(dir,'short.wav'),mix);
  const brief={...plan,mix:'short.wav',targets:plan.targets.slice(0,1),cues:[]};
  const file=path.join(dir,'brief.json');
  put(file,brief);
  const kit=require('..').load();
  const {report,sharedGain,previews}=Translator.build(file,kit);
  assert(sharedGain<1);
  assert(report.sharedPreviewGainDb<0);
  assert(previews.get('phone').length===previews.get('reference').length);
  const safe=run(dir,brief,'attenuated');
  assert.equal(safe.status,0,safe.stderr);
  for (const lane of ['reference','phone']) {
    const audio=WAV.read(path.join(dir,'attenuated/audio/'+lane+'.wav'));
    const peak=KIT.procedural.mediaGraph.mixerMonitor.peaks(audio).truePeakDbTP;
    assert(peak<=-.9999);
  }
  plan.cues[0].stem='short.wav';
  const invalid=run(dir,plan,'invalid');
  assert.equal(invalid.status,1,invalid.stderr);
  assert.match(invalid.stderr,/Cue stem must match the mix grid/);
  assert.equal(fs.existsSync(path.join(dir,'invalid')),false);
});
