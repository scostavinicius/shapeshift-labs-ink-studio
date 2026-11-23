const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'),kit=ink.load(),K=kit.KIT,{mediaGraph:A,takeTime:T}=K.procedural;
const WAV=require('../cli/wav');

const sound=(samples,sampleRate=8000)=>({sampleRate,channels:1,samples});
const pair=(a,b)=>({close:{asset:a,sync:{sample:2}},distant:{asset:b,sync:{marker:'strike'}}});
const assets={heel:sound([0,0,.6,.4,.1,0]), room:sound([0,0,0,0,.32,.22,.12,0]),
  toe:sound([0,0,.46,.32,.12,0]),'room-toe':sound([0,0,0,0,.29,.24,.08,0])};
const sourceEdits=Object.fromEntries(['room','room-toe'].map(name=>[name,
  A.sampleEdit.edit(A.sampleEdit.create(assets[name]),[{op:'add',id:'strike',at:4}])]));
const percussion={id:'footsteps',materials:{steel:{step:{heel:pair('heel','room'),toe:pair('toe','room-toe')}}}};
const picture={fps:30,shots:[{id:'catwalk',frames:30}]};
const envelope=(events,extra={})=>({kit:percussion,picture,sampleRate:8000,world:{simulationRate:120,events},
  sourceEdits,seed:4,bindings:[{id:'contact',on:{kind:'surface-contact',system:'walker',
    where:{path:'/action',value:'step'}}}],...extra});
const event=(tick,id=tick+'.0',other={})=>({id,tick,kind:'surface-contact',system:'walker',material:'steel',
  action:'step',strength:.5,...other});
const time=(start,end)=>({startPoint:T.read(start),endPoint:T.read(end)});
const close=(a,b)=>assert(Math.abs(a-b)<1e-6,a+' != '+b);
const pcm=(value,sample)=>value.samples[sample*2];

test('material and action bindings spot committed subframe events and preserve seeded perspective pairs',()=>{
  const events=[event(121),event(31),event(31,'31.1',{system:'other'}),event(60),event(83,'83.0',{action:'scrape'})];
  const doc=envelope(events);
  doc.world.aliases={heel:'31.0'};
  const a=A.foley.plan(doc,assets);
  const b=A.foley.plan({...doc,perspective:'distant',world:{...doc.world,events:[...events].reverse()}},assets);
  assert.deepEqual(a.report.skipped,{'outside-picture':1});
  assert.deepEqual(a.report.contacts.map(row=>[row.event,row.spot.sample]),[['heel',2066],['60.0',4000]]);
  assert.deepEqual(a.report.contacts.map(row=>row.performance),b.report.contacts.map(row=>row.performance));
  const contact=a.report.contacts[0], key=contact.clip, side='distant-'+contact.performance;
  const start=A.audioEditorial.render(a.value,assets).value;
  const distant=A.audioEditorial.revise(a.value,assets,[{op:'take',clip:key,take:side}]).value;
  const printed=A.audioEditorial.render(distant,assets).value;
  close(pcm(start,2066),assets[a.value.clips[0].takes[contact.take].asset].samples[2]*.5);
  close(pcm(printed,2066),assets[a.value.clips[0].takes[side].asset].samples[4]*.5);
  assert.deepEqual(distant.clips[0].spot,{event:'heel'});
  const edited=A.audioEditorial.revise(distant,assets,[{op:'spot',clip:key,spot:{frame:9}}]);
  assert.equal(edited.report.clips[0].spot.sample,2400);
  const broken=envelope([event(31,'31.0',{material:'stone'})]);
  assert.throws(()=>A.foley.plan(broken,assets),/needs a kit action/);
});

test('stretch-tail keeps source attack samples unchanged and extends the decay without tuning it',()=>{
  const tone=Array.from({length:1400},(_,i)=>.32*Math.sin(i*Math.PI/5)*Math.exp(-i/800));
  tone[20]=.82;
  const bank={tone:sound(tone)};
  const project={format:'ink-studio/audio-editorial',version:1,id:'door',picture,sampleRate:8000,
    clips:[{id:'hit',spot:{samples:320},take:'a',takes:{a:{asset:'tone',sync:{sample:20}}}}]};
  const before=A.audioEditorial.render(project,bank);
  const {value,report}=A.audioEditorial.revise(project,bank,[
    {op:'stretch-tail',clip:'hit',tail:{fromSample:220,factor:1.5,joinSamples:64}}
  ]);
  const extended=A.audioEditorial.render(value,bank);
  assert.equal(report.clips[0].range.toSample-before.report.clips[0].range.toSample,590);
  assert.equal(report.clips[0].spot.sample,320);
  assert.deepEqual(before.value.samples.slice(0,520*2+2),extended.value.samples.slice(0,520*2+2));
  assert.equal(pcm(before.value,2101),0);
  assert(extended.value.samples.slice(1800*2,2260*2).some(x=>Math.abs(x)>.01));
  const crossings=extended.value.samples.filter((x,i,array)=>i%2===0 && i>1800 && i<3000 && x>0 && array[i-2]<=0);
  assert(Math.abs(crossings.length-60)<4);
  const cleared=A.audioEditorial.revise(value,bank,[{op:'stretch-tail',clip:'hit',tail:null}]);
  assert.deepEqual(A.audioEditorial.render(cleared.value,bank).value.samples,before.value.samples);
  assert.throws(()=>A.audioEditorial.revise(project,bank,[{op:'stretch-tail',clip:'hit',
    tail:{fromSample:19,factor:2}}]),/tail start after sync/);
});

test('scene post exposes five wet stems, retains history across crops and preserves pre-fader headroom',()=>{
  const config={format:'ink-studio/scene-audio',version:1,sampleRate:8000,tracks:[
    {asset:'tick',bus:'dialogue',gain:4},{asset:'tick',bus:'foley',time:.01},{asset:'glow',bus:'music',loop:true},
    {asset:'tick',bus:'effects',time:.0875},{asset:'glow',loop:true}
  ],post:{strips:{dialogue:{fader:.25},foley:{inserts:['echo']},music:{fader:.25}},
    processors:{echo:{type:'delay',seconds:.04,feedback:.25,wet:1}}}};
  const audio=ink.createSceneAudio(config,{kit,resolveAsset:key=>key==='tick' ? sound([.5]) : sound([.0625])});
  const whole=audio.render(time(0,.16));
  assert.deepEqual(Object.keys(whole.report.stems),['dialogue','foley','effects','ambience','music']);
  assert.equal(whole.report.headroom,1);
  const dump=name=>audio.capture(time(0,.16),{source:{kind:'stem',name}}).value;
  const dialogue=dump('dialogue'),foley=dump('foley');
  close(pcm(dialogue,0),.5);
  close(pcm(foley,80),0);
  close(pcm(foley,400),.5);
  const cropped=audio.capture(time(.035,.16),{source:{kind:'stem',name:'foley'}}).value;
  assert.deepEqual(cropped.samples,foley.samples.slice(560));
  close(pcm(dump('ambience'),0),.0625);
  close(pcm(dump('music'),0),.015625);
  close(pcm(dump('effects'),700),.5);
  assert.throws(()=>ink.createSceneAudio({...config,post:undefined},{kit,resolveAsset:()=>sound([0])}),/Invalid soundtrack placement/);
});

test('CLI creates a portable cue sheet and scene export renders the referenced editorial project directly',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-foley-')), at=name=>path.join(dir,name);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const save=(filename,data)=>fs.writeFileSync(at(filename),JSON.stringify(data));
  const bank={};
  for (const [id,data] of Object.entries(assets)) {
    bank[id]=id+'.wav';
    fs.writeFileSync(at(bank[id]),WAV.encode(data,{encoding:'float64'}));
  }
  save('kit.json',{foley:envelope([event(2)]),assets:bank});
  const cli=path.resolve(__dirname,'../cli/ink-studio.js'), project=at('edit/foley.json');
  const result=JSON.parse(execFileSync(process.execPath,[cli,'music','editorial','spot-foley',at('kit.json'),'--out',project]));
  assert.equal(result.report.contacts.length,1);
  assert.equal(JSON.parse(fs.readFileSync(project,'utf8')).assets.heel,'../heel.wav');
  save('soundtrack.json',{format:'ink-studio/scene-audio',version:1,sampleRate:8000,post:{},
    assets:{steps:{editorial:'edit/foley.json',track:'foley'}},tracks:[{asset:'steps',bus:'foley'}]});
  const audio=ink.readSceneAudio(at('soundtrack.json'),{kit});
  const {manifest}=ink.exportScene(()=>({scene:'foley-picture',sample:()=>({w:2,h:2,rgb:new Uint8Array(12)})}),
    {kit,audio,out:at('picture'),formats:['loop'],fps:30,to:.1,width:2,height:2});
  const printed=ink.readWav(path.join(at('picture'),manifest.audio.stems.foley.file));
  assert.equal(manifest.audio.stems.foley.voices,1);
  assert(printed.samples[266]>.15);
  assert.equal(printed.samples[264],0);
  assert.equal(manifest.audio.frames,800);
});
