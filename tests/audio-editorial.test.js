const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'),{KIT:{procedural:{mediaGraph:A}}}=ink.load();
const edit=A.audioEditorial, WAV=require('../cli/wav'), {write,json}=require('../cli/asset-files');
const tone=(sampleRate,fill=0)=>({sampleRate,channels:1,samples:new Float64Array(400).fill(fill)});
const take=(asset,sample=200)=>({asset,sync:{sample},fromSample:80,toSample:300,
  handles:{fromSample:20,toSample:360}});
const clip=(id,spot,source=take('main'))=>({id,spot,track:'foley',take:'original',takes:{original:source}});
const session=(clips,picture={fps:25,shots:[{id:'door',frames:50}]},extra={})=>
  ({format:'ink-studio/audio-editorial',version:1,id:'spotting',sampleRate:8000,picture,clips,...extra});
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,a+' != '+b);

test('resolves source markers, rational picture frames, world ticks and tempo changes on the PCM grid',()=>{
  const source=tone(16000);
  const doc=A.sampleEdit.create(source,{source:{id:'recording'}});
  const marked=A.sampleEdit.edit(doc,[{op:'add',id:'impact',at:201}]);
  const project=session([
    clip('shot',{shot:'door',sourceFrame:19},{...take('main'),sync:{marker:'impact'}}),
    clip('picture',{frame:2}),
    clip('world',{event:'lock'}),
    clip('beat',{beat:3}),
    clip('sample',{samples:16})
  ],{fps:{numerator:24000,denominator:1001},shots:[{id:'walk',frames:10},{id:'door',inFrame:12,frames:50}]},{
    sourceEdits:{main:marked},world:{simulationRate:100,events:[{id:'33.0',tick:33}],aliases:{lock:'33.0'}},
    map:{tempo:120,changes:[{beat:2,tempo:60}]}
  });
  const result=edit.inspect(project,{main:source});
  const [shot,picture,world,beat,sample]=result.clips;
  assert.equal(result.frames,20020);
  assert.equal(shot.source.sourceSync,201);
  assert.equal(shot.source.sourceRate,16000);
  assert.deepEqual(shot.spot.timecode,{numerator:17017,denominator:24000});
  assert.equal(shot.spot.frame,17);
  assert.equal(shot.spot.sample,5672);
  assert.deepEqual(shot.range,{fromSample:5612,toSample:5722});
  assert.equal(picture.spot.sample,667);
  assert.deepEqual(world.spot,{kind:'event',event:'lock',eventId:'33.0',tick:33,sample:2640,frame:7,
    timecode:{numerator:33,denominator:100},beat:.66});
  assert.equal(beat.spot.sample,16000);
  assert.equal(sample.spot.sample,16);
  assert.throws(()=>edit.inspect(project,{main:tone(8000)}),/does not match/);
});

test('trim uses handles while a head slip preserves the pinned transient and tail',()=>{
  const src=tone(8000);
  src.samples[100]=.2;src.samples[200]=.6;src.samples[225]=.4;
  const project=session([clip('contact',{frame:12})]), assets={main:src};
  const changes=[
    {op:'trim',clip:'contact',fromSample:60,toSample:320},
    {op:'slip-head',clip:'contact',slip:{samples:-20,joinSamples:10}},
    {op:'fades',clip:'contact',fades:{inSamples:8,outSamples:12,curve:'equal-power'}}
  ];
  const before=edit.render(project,assets), revised=edit.revise(project,assets,changes);
  const after=edit.render(revised.value,assets,{stems:true}), pin=3840;
  assert.deepEqual(after.report.clips[0].range,{fromSample:3700,toSample:3960});
  near(before.value.samples[(pin-100)*2],.2);
  near(after.value.samples[(pin-100)*2],0);
  near(after.value.samples[(pin-80)*2],.2);
  for (let i=pin;i<pin+100;i++) near(before.value.samples[i*2],after.value.samples[i*2]);
  near(after.stems.foley.samples[pin*2],.6);
  assert.equal(project.clips[0].takes.original.fromSample,80);
  const positive=edit.revise(project,assets,[{op:'slip-head',clip:'contact',slip:{samples:40,joinSamples:10}}]);
  const advanced=edit.render(positive.value,assets);
  near(advanced.value.samples[(pin-40)*2],0);
  near(advanced.value.samples[(pin-140)*2],0);
  near(advanced.value.samples[pin*2],.6);
  assert.throws(()=>edit.revise(project,assets,[{op:'slip-head',clip:'contact',slip:{samples:-61,joinSamples:10}}]),/exceeds handles/);
  assert.throws(()=>edit.revise(project,assets,[{op:'trim',clip:'contact',fromSample:201}]),/remove its sync/);
});

test('time-range takes align at their own sync markers and transitions are editable',()=>{
  const main=tone(8000,.1), alternate=tone(8000,.5);
  alternate.samples[220]=.8;
  const project=session([clip('contact',{frame:4})]), assets={main,alternate}, source=take('alternate',220);
  const {value}=edit.revise(project,assets,[
    {op:'put-take',clip:'contact',take:'bright',source},
    {op:'trim',clip:'contact',take:'bright',fromSample:50},
    {op:'comp',clip:'contact',ranges:[{take:'bright',fromOffset:-3,toOffset:9,fadeSamples:2}]}
  ]);
  const rendered=edit.render(value,assets), at=i=>rendered.value.samples[(1280+i)*2];
  assert.equal(source.fromSample,80);
  near(at(-3),.1);near(at(-2),.3);near(at(0),.8);near(at(7),.3);near(at(8),.1);near(at(9),.1);
  assert.throws(()=>edit.revise(value,assets,[{op:'comp',clip:'contact',ranges:[
    {take:'bright',fromOffset:0,toOffset:5},{take:'bright',fromOffset:3,toOffset:7}]}]),/may not overlap/);
  const picked=edit.revise(value,assets,[{op:'comp',clip:'contact',ranges:[]},{op:'take',clip:'contact',take:'bright'}]);
  near(edit.render(picked.value,assets).value.samples[1280*2],.8);
});

test('reconform reports shifted, fixed and removed spots and new collisions with paired audio',()=>{
  const main=tone(8000);main.samples[200]=.9;
  const world={simulationRate:100,events:[{id:'16.0',tick:16},{id:'90.0',tick:90}],aliases:{bolt:'16.0'}};
  const project=session([
    clip('latch',{shot:'door',sourceFrame:5}),clip('cut',{frame:4}),
    clip('spill',{shot:'door',sourceFrame:1}),clip('bolt',{event:'bolt'}),clip('lost',{event:'90.0'})
  ],{fps:25,shots:[{id:'approach',frames:7},{id:'door',frames:19}]},{world});
  const revision={
    picture:{fps:25,shots:[{id:'approach',frames:2},{id:'door',inFrame:3,frames:30}]},
    world:{simulationRate:100,events:[{id:'28.0',tick:28}],aliases:{bolt:'28.0'}}
  };
  const result=edit.reconform(project,{main},revision), {changes,collisions}=result.report;
  assert.deepEqual(changes.map(row=>[row.id,row.status,row.shiftSamples]),[
    ['latch','moved',-2560],['cut','unchanged',0],['spill','unresolved',null],
    ['bolt','moved',960],['lost','unresolved',null]
  ]);
  assert.equal(changes[2].after.issue,'source-frame-trimmed');
  assert.equal(changes[4].after.issue,'missing-world-event');
  assert.deepEqual(collisions.map(row=>row.clips),[['cut','latch']]);
  assert.equal(result.before.samples.length,32*320*2);
  assert.equal(result.value.samples.length,result.before.samples.length);
  near(result.value.samples[4*320*2],1);
  near(result.before.samples[4*320*2],1);
  near(result.value.samples[12*320*2],0);
  assert.throws(()=>edit.render(result.session,{main}),/missing editorial spots/);
  assert.doesNotThrow(()=>edit.render(result.session,{main},{allowUnresolved:true}));
});

test('the editorial CLI writes movable recipes, stems and a paired reconform preview',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'ink-editorial-'));
  const at=name=>path.join(dir,name);
  const call=(...args)=>JSON.parse(execFileSync(process.execPath,[
    path.resolve(__dirname,'../cli/ink-studio.js'),'music','editorial',...args
  ],{encoding:'utf8'}));
  try {
    const main=tone(8000);main.samples[200]=.5;
    const project=session([clip('contact',{shot:'door',sourceFrame:4})]);
    write(at('take.wav'),WAV.encode(main));
    json(at('source.json'),{session:project,assets:{main:'take.wav'}});
    json(at('edit.json'),[{op:'fades',clip:'contact',fades:{inSamples:12}}]);
    json(at('new-cut.json'),{picture:{fps:25,shots:[{id:'insert',frames:2},...project.picture.shots]}});
    call('edit',at('source.json'),at('edit.json'),'--out',at('edited/project.json'));
    const revision=call('reconform',at('edited/project.json'),at('new-cut.json'),'--out',at('preview'));
    const report=JSON.parse(readFileSync(revision.report,'utf8'));
    assert.equal(report.changes[0].shiftSamples,640);
    const render=call('render',revision.project,'--out',at('delivery'),'--stems');
    assert.deepEqual(readFileSync(render.mix),readFileSync(revision.after));
    assert.deepEqual(readFileSync(render.stems.foley),readFileSync(render.mix));
    near(ink.readWav(render.mix).samples[1920*2],.5);
    assert.deepEqual(JSON.parse(readFileSync(at('source.json'),'utf8')).session,project);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
