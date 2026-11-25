const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const Captions = require('../src/directional-captions.js');
const {build} = require('../cli/directional-captions.js');

const plan = require('../examples/directional-captions/plan.json');
const base = {position:[0,0,0],forward:[0,0,-1],up:[0,1,0]};
const ledger = (receipts,firstSample=0)=>({format:'ink-studio/audio-playback-receipts',
  version:1,world:'captions-test',sampleRate:8000,firstSample,endSample:32000,receipts});
function played(index,cue,sample,direction=null,opening=null) {
  return {beatId:'ink:beat:captions-test/main/'+index+'.0',cue,outcome:'played',actualSample:sample,
    caption:{sample,direction,opening}};
}

test('listener rotation, height and left-right diagonal use the apparent arrival point',()=>{
  assert.deepEqual([[0,0,4],[0,4,0],[-2,0,0],[1,0,-1],[0,-4,0],[0,0,0]]
    .map(at=>Captions.direction(at,base)),['behind','above','left','ahead-right','below',null]);
  assert.equal(Captions.direction([0,0,4],{...base,forward:[0,0,1]}),'ahead');
  assert.equal(Captions.direction([1,1,1],{...base,up:[0,0,-1]}),null);
});

test('groups actual arrival times, folds layers of one beat, and keeps doors and directions distinct',()=>{
  const rows = [
    {...played(1,'step-a',500,'behind'),outcome:'late',requestedSample:100},
    played(1,'step-b',600,'behind'),played(2,'step-b',1000,'behind'),
    played(3,'step-a',1800,'behind'),played(4,'step-b',2000,'left'),
    played(5,'bell',2400,'right','hatch-a'),played(6,'bell',2450,'right','hatch-b'),
    {...played(7,'bell',2900,'right'),actualSample:null,outcome:'muted'},
    {...played(8,'step-b',3000,'behind'),actualSample:null,outcome:'dropped'},
    {...played(9,'cart',3030),actualSample:null,outcome:'outside-window'},
    played(10,'unmarked',3100,'behind'),played(11,'step-a',5500,'behind')
  ];
  const {captions,counts} = build(ledger(rows),plan);
  assert.deepEqual(captions.map(({count,direction,opening})=>[count,direction,opening]),[
    [3,'behind',null],[1,'left',null],[1,'right','hatch-a'],[1,'right','hatch-b'],[1,'behind',null]
  ]);
  assert.equal(captions[0].text,'Bootsteps (×3) · behind you');
  assert.equal(captions[0].startSample,500);
  assert.equal(captions[0].endSample,11800);
  assert.equal(captions[0].beatIds.length,3);
  assert.deepEqual(captions[0].receipts,[0,1,2,3]);
  assert.equal(captions[2].text,'Pump bell rings · through a doorway · to your right');
  assert.deepEqual(counts,{played:8,late:1,muted:1,dropped:1,'outside-window':1,matched:11,captioned:8});
});

test('cropped playback uses actual surviving tails and legacy ledgers do not invent directions',()=>{
  const rows = [
    {...played(1,'cart',2000),caption:{sample:4000,direction:'left',opening:null}},
    {beatId:'past',cue:'cart',outcome:'played',actualSample:2200},
    {beatId:'legacy',cue:'duct',outcome:'played',actualSample:8000}
  ];
  const report = build(ledger(rows,4000),plan);
  assert.deepEqual(report.captions.map(({fileSample,text})=>[fileSample,text]),[
    [0,'Cart rattles · to your left'],[4000,'Metal duct clatters']
  ]);
});

test('writes sample-relative WebVTT and links JSON cues to the input receipts', t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-directional-captions-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const out = path.join(dir,'out'), receipts = path.join(dir,'playback.json'), planFile = path.join(dir,'plan.json');
  const spec = {...plan,rules:[{id:'bell',cues:['bell'],text:'Bell <test> & hinge'}]};
  fs.writeFileSync(receipts,JSON.stringify(ledger([played(2,'bell',12107,'above','door')],8000)));
  fs.writeFileSync(planFile,JSON.stringify(spec));
  const result = spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'story','audio-captions',receipts,planFile,'--out',out],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const vtt = fs.readFileSync(path.join(out,'captions.vtt'),'utf8');
  assert.match(vtt,/00:00:00\.513 --> 00:00:01\.764/);
  assert(vtt.includes('[Bell &lt;test&gt; &amp; hinge · through a doorway · above you]'));
  const track = JSON.parse(fs.readFileSync(path.join(out,'captions.json'),'utf8'));
  assert.equal(track.captions[0].fileSample,4107);
  assert.deepEqual(track.captions[0].receipts,[0]);
  assert.throws(()=>build(ledger([played(3,'bell',100,'invalid','door')]),spec),/arrival evidence/);
  assert.throws(()=>Captions.compile({...plan,rules:[plan.rules[0],{...plan.rules[0],id:'other'}]},8000),/More than one/);
});

test('live player captions only voices that start and uses the listener at arrival', async ()=>{
  const {createSpatialAudioPlayer} = await import('../src/webgl/spatial-audio-player.mjs');
  const param=()=>({cancelScheduledValues(){},setTargetAtTime(){},setValueAtTime(){},linearRampToValueAtTime(){}});
  const node=()=>({connect(){},disconnect(){}});
  const buffer = {duration:.9,getChannelData:()=>Float32Array.from([.5,0]),numberOfChannels:1};
  const context = {state:'running',currentTime:0,sampleRate:48000,destination:node(),
    listener:{setPosition(){},setOrientation(){}},
    createBufferSource:()=>({...node(),playbackRate:param(),start(){},stop(){}}),
    createGain:()=>({...node(),gain:param()}),
    createBiquadFilter:()=>({...node(),gain:param(),frequency:param(),Q:param()}),
    createPanner:()=>({...node(),setPosition(){}})};
  const player = createSpatialAudioPlayer(context,{resolveAsset:asset=>asset==='missing'
    ? Promise.reject(new Error('missing asset')):buffer,captions:plan,maxVoices:1});
  const voice = {id:'one',cue:'step-a',asset:'step',mode:'cue',offset:0,rate:1,delay:.2,
    position:[0,0,4],gain:.5,bands:{low:.5,mid:.5,high:.5},cutoff:22000};
  const frame = (cues,listener=base)=>({time:context.currentTime,listener,active:[],cues});
  await player.update(frame([voice,{...voice,id:'two',cue:'step-b',priority:-1}]));
  assert.deepEqual(player.readCaptions(),[]);
  context.currentTime=.12;
  await player.update(frame([],{...base,forward:[0,0,1]}));
  context.currentTime=.21;
  assert.deepEqual(player.readCaptions().map(row=>[row.text,row.startSample]),[['Bootstep · ahead',9600]]);
  player.reset();
  assert.deepEqual(player.readCaptions(),[]);
  await player.update(frame([{...voice,id:'scheduled',delay:1}]));
  await player.update(frame([{...voice,id:'preempted-by',asset:'missing',priority:60,delay:0}]))
    .then(()=>assert.fail('missing asset must fail'),error=>assert.match(error.message,/missing asset/));
  context.currentTime=1.3;
  assert.deepEqual(player.readCaptions(),[]);
  player.dispose();
});

test('worklet confirms grains only in a quantum where their packet actually plays', async ()=>{
  const saved = Object.fromEntries(['registerProcessor','AudioWorkletProcessor','currentFrame'].map(key=>[key,globalThis[key]]));
  let Processor;
  const messages=[];
  globalThis.registerProcessor=(_name,ctor)=>{Processor=ctor;};
  globalThis.AudioWorkletProcessor=class { constructor(){this.port={postMessage:message=>messages.push(message)};} };
  try {
    await import('../src/webgl/crowd-audio-worklet.mjs');
    const processor = new Processor({processorOptions:{packets:[{at:300,samples:new Float32Array(100).fill(.2),
      marks:[{offset:12,length:15,cue:'step-a'}]}]}});
    const process = at=>{globalThis.currentFrame=at;return processor.process([],[[new Float32Array(128)]]);};
    process(128);
    assert.deepEqual(messages,[]);
    process(256);
    assert.deepEqual(messages,[{marks:[{cue:'step-a',sample:312}]}]);
    process(384);
    processor.port.onmessage({data:{at:512,samples:new Float32Array(50),marks:[{offset:0,length:50,cue:'step-b'}]}});
    processor.port.onmessage({data:{clear:true}});
    process(512);
    assert.equal(messages.length,1);
  } finally {
    for (const [key,value] of Object.entries(saved)) {
      if (value===undefined) delete globalThis[key]; else globalThis[key]=value;
    }
  }
});
