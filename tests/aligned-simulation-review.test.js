const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const ink=require('..'),W=ink.load().KIT.world, WAV=require('../cli/wav.js'),PNG=require('../cli/png.js');
const trace=(samples,sampleRate,startSample=0)=>({sampleRate,startSample,channels:{value:{unit:'Pa',samples}}});
const pair=(a,b,eventsA=[],eventsB=[])=>({reference:{track:a,log:eventsA},candidate:{track:b,log:eventsB}});
const ticks={fps:{numerator:30000,denominator:1001},sampleRate:48000};
const compare=(options,sources)=>W.alignedReview.compare({id:'probe',from:0,to:2,clock:{fps:2,sampleRate:8},
  traces:{probe:{source:'track'}},...options},sources);
const link=(node,port='value')=>({node,port});

test('composes native sample and fractional event order with nonintegral frame boundaries',()=>{
  const a=Array(534).fill(0), b=a.slice();
  b[0]=.005;b[2]=.4;
  const ref=[{at:{numerator:1069,denominator:32000},kind:'closure'}];
  const changed=[{at:{numerator:1071,denominator:32000},kind:'closure'}];
  const {report,frames,reference}=compare({from:1,to:3,clock:ticks,
    traces:{probe:{source:'track',tolerance:{absolute:.01}}},events:{switch:{source:'log'}}},
  pair(trace(a,8000,266),trace(b,8000,266),ref,changed));
  assert.equal(frames[0].firstSample,1601);
  assert.equal(report.traces.probe.from,266);
  assert.equal(report.traces.probe.to,800);
  assert.equal(report.firstEvent.reason,'event-time');
  assert.deepEqual(report.first.exact,{numerator:'1069',denominator:'32000'});
  assert.equal(report.first.kind,'event');
  assert.equal(report.first.takeSample,1603);
  assert.equal(report.firstSample.sample,268);
  assert.equal(report.firstSample.frame,1);
  assert.equal(report.traces.probe.changed,2);
  assert.equal(report.traces.probe.outsideTolerance,1);
  assert.equal(reference.traces.probe.startSample,266);

  b[0]=.1;
  const floor=compare({clock:ticks,from:1,to:3},pair(trace(a,8000,266),trace(b,8000,266))).report;
  assert.equal(floor.first.frame,1);
  assert.equal(floor.first.sample,266);
  assert.equal(floor.first.time,.03325);
});

test('retains missing coverage, tolerated differences, and ordered event-only comparisons',()=>{
  const left=trace(Array(8).fill(1),8), right=trace(Array(6).fill(1),8,2);
  const gap=compare({},pair(left,right)).report;
  assert.equal(gap.status,'diverged');
  assert.equal(gap.incomplete,true);
  assert.equal(gap.first.reason,'sample-coverage');
  assert.equal(gap.first.candidate,null);
  assert.equal(compare({},pair(right,right)).report.status,'incomplete');
  const amended=trace(Array(8).fill(1.01),8);
  const result=compare({traces:{probe:{source:'track',tolerance:{relative:.02}}}},pair(left,amended)).report;
  assert.equal(result.status,'within-tolerance');
  assert.equal(result.passed,true);
  assert.throws(()=>compare({},pair(left,trace(Array(8).fill(1),16))),/clocks or units differ/);

  const events={traces:{},events:{touch:{source:'log'}}};
  const a=[{at:.125,id:'one'},{at:.125,id:'two'}], b=[a[1],a[0]];
  const eventOrder=compare(events,pair(left,right,a,b)).report;
  assert.equal(eventOrder.first.reason,'event-payload');
  assert.equal(eventOrder.first.eventIndex,0);
  assert.equal(eventOrder.first.takeSample,1);
  const retained=W.outputAdapters.events(a);
  const lost=compare(events,pair(left,right,{...retained,dropped:1},retained)).report;
  assert.equal(lost.status,'incomplete');
  assert.equal(lost.passed,false);
});

function cutaway(){
  return {format:'ink-studio/graph-project',version:1,inputs:{controls:{type:'record'}},nodes:{
    scene:{op:'scene.diorama',inputs:{definition:{id:'cutaway-review',seed:1,style:'slate',
      solids:[{id:'block',kind:'box',at:[0,0,0],half:[.45,.45,.45],mat:{role:'stone'},res:.18}]}}},
    options:{op:'scene.bindControls',inputs:{template:{width:48,height:40,raw:true,cutaway:{
      planes:[{normal:[0,0,1],offset:0,keep:'negative'}]}},controls:{input:'controls'},
    targets:[{control:'section',path:'/cutaway/planes/0/offset'}]}},
    projected:{op:'scene.render',inputs:{source:link('scene'),options:link('options')}}
  },outputs:{picture:link('projected')}};
}

test('CLI exports aligned WAV, trace, plot and cutaway buffers, recording a failed match for CI',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-aligned-review-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name),save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const sampleRate=8000,a=Array(160).fill(0),b=a.slice();
  a.fill(.4,40,80);
  save('ref.json',trace(a,sampleRate));save('new.json',trace(b,sampleRate));save('section.graph.json',cutaway());
  const recipe={format:'ink-studio/aligned-simulation-review',version:1,id:'cutaway-match',
    clock:{fps:200,sampleRate},from:1,to:3,
    reference:{test:{file:'ref.json'},log:{value:[{at:.0065,id:'strike'}]}},
    candidate:{test:{file:'new.json'},log:{value:[{at:.0125,id:'strike'}]}},
    traces:{force:{source:'test'}},events:{contacts:{source:'log'}},
    audio:{tracks:['force'],gain:1.25},
    picture:{graph:'section.graph.json',output:'picture',format:'both',warmup:1,bindings:{
      section:{source:{kind:'trace',name:'force',stat:'peak'},input:[0,.4],output:[-.4,.4]}
    }}};
  function run(value,out='review'){
    save('recipe.json',value);
    return spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'sim','review',file('recipe.json'),
      '--out',file(out),'--require-match'],{cwd:os.tmpdir(),encoding:'utf8'});
  }
  const result=run(recipe);
  assert.equal(result.status,2,result.stderr);
  const report=JSON.parse(fs.readFileSync(file('review/review.json'),'utf8'));
  assert.equal(report.first.sample,40);
  assert.equal(report.focus.frame,1);
  assert.equal(report.firstEvent.reason,'event-time');
  assert.equal(report.focus.event.frame,1);
  assert.equal(report.focus.event.plot.file,'plots/first-event.png');
  const sound=side=>WAV.read(file('review/'+report.audio[side].file),{metadata:true});
  assert.equal(sound('reference').bwf.timeReference,'40');
  assert.equal(sound('reference').samples.length,80);
  assert.ok(Math.abs(sound('reference').samples[0]-.5)<1/2**23);
  assert.equal(sound('candidate').samples[0],0);
  const traceData=JSON.parse(fs.readFileSync(file('review/'+report.traces.force.reference.file),'utf8'));
  assert.equal(traceData.startSample,40);
  assert.equal(traceData.channels.force.samples[0],.4);
  assert.equal(PNG.read(file('review/'+report.focus.plot.file)).w,944);
  const aFrame=report.picture.reference.frames[0],bFrame=report.picture.candidate.frames[0];
  assert.equal(aFrame.endSample,80);
  assert.equal(aFrame.controls.section,.4);
  assert.equal(bFrame.controls.section,-.4);
  const digest=crypto.createHash('sha256').update(fs.readFileSync(file('review/'+report.focus.reference))).digest('hex');
  assert.equal(digest,aFrame.sha256);
  assert.notEqual(aFrame.sha256,bFrame.sha256);

  const matched=run({...recipe,candidate:recipe.reference},'same');
  assert.equal(matched.status,0,matched.stderr);
  const saved=JSON.parse(fs.readFileSync(file('same/review.json'),'utf8'));
  assert.equal(saved.status,'exact');
  assert.equal(saved.first,null);
  fs.mkdirSync(file('collision/reference'),{recursive:true});
  fs.symlinkSync(file('ref.json'),file('collision/reference/audio.wav'));
  const collide=run(recipe,'collision');
  assert.equal(collide.status,1,collide.stderr);
  assert.match(collide.stderr,/separate from their source assets/);
});
