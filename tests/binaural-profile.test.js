const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const ink=require('..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const B=require('../src/binaural-profile.js');
const WAV=require('../cli/wav.js');
const {renderPreview}=require('../examples/pinned-binaural/preview.cjs');
const rate=32000, dt=.032;
const impulse=(length,at,gain)=>Array.from({length},(_,i)=>i===at?gain:0);
const pair=(azimuth,elevation,l,r)=>({azimuth,elevation,left:impulse(32,l[0],l[1]),right:impulse(32,r[0],r[1])});
const definition={format:B.format,version:1,id:'desk-v1',sampleRate:rate,transition:.004,directions:[
  pair(0,0,[5,.5],[5,.6]),pair(-90,0,[2,.8],[13,.25]),pair(90,0,[13,.25],[2,.8]),pair(180,0,[9,.5],[9,.5]),
  pair(0,90,[16,.3],[14,.4]) ]};
const json=JSON.stringify(definition), sha256=createHash('sha256').update(json).digest('hex');
const listener={at:{entity:'ear'}}, spatial={binauralProfile:definition,
  cues:{hit:{asset:'hit',distance:{rolloff:0}},bed:{asset:'bed',distance:{rolloff:0}}},
  emitters:{tick:{cue:'bed',at:[0,0,0]}}};
const world={dt,entities:{ear:{position:[0,0,1]}},commands:[
  {tick:2,action:'world/patch',args:{edits:[{op:'set',path:'/entities/ear/position',value:[1,0,0]}]}},
  {tick:4,action:'world/patch',args:{edits:[{op:'set',path:'/entities/ear/position',value:[-1,0,0]}]}},
  {tick:6,action:'world/event',args:{kind:'audio-cue',cue:'hit',at:[0,0,.2]}}
]};
const source=Float32Array.from({length:1024},(_,i)=>i%97===3?.25:0);
const short={...spatial,emitters:{}};
const make=(config=spatial, runtime=world, input={samples:source,channels:1,sampleRate:rate})=>ink.createSceneAudio({format:'ink-studio/scene-audio',version:1,
  sampleRate:rate,spatial:config,listener},{kit,runtime:()=>W.runtime.create(runtime),
  resolveAsset:name=>name==='hit'?{samples:new Float32Array([.25]),channels:1,sampleRate:rate}:input});
const interval=(start,end)=>({startPoint:T.read(start),endPoint:T.read(end)});
const peakDelta=(a,b)=>a.reduce((peak,n,i)=>Math.max(peak,Math.abs(n-b[i])),0);

test('profile validates a bounded stereo grid and resolves head-relative directions',()=>{
  const profile=B.compile(definition), plan=B.prepare(profile,rate);
  const front={position:[0,0,0],forward:[0,0,-1],up:[0,1,0]};
  assert.deepEqual(B.direction(front,[1,0,0]),[1,0,0]);
  const rotated={...front,forward:[1,0,0]};
  assert.deepEqual(B.direction(rotated,[1,0,0]),[0,0,1]);
  assert.deepEqual(plan.kernel(B.axis(0,90)).left,Float32Array.from(definition.directions[4].left));
  const l=plan.kernel(B.axis(-90,0));
  assert.equal(l.left.indexOf(Math.fround(.8)),2);
  assert.equal(l.right.indexOf(.25),13);
  assert.throws(()=>B.compile({...definition,directions:[...definition.directions,pair(-180,0,[1,1],[2,1])]}),/Coincident/);
  assert.throws(()=>B.compile({...definition,directions:[{...definition.directions[0],left:[1],right:[1,0]}]}),/ear samples/);
  const frame=make().binauralProfile;
  assert(Object.isFrozen(frame.directions[0].left));
});

test('headless print preserves the HRIR tail in a crop and records a verified file pin',t=>{
  const run={...world,commands:[{tick:1,action:'world/event',args:{kind:'audio-cue',cue:'hit',at:[0,0,0]}}]};
  const scene=make(short,run), {waves,report}=scene.render(interval(0,.064));
  const out=WAV.decode(waves.mix).samples;
  assert.equal(report.binauralProfile.id,'desk-v1');
  assert.equal(out[(1024+5)*2],.125);
  assert(Math.abs(out[(1024+5)*2+1]-.15)<1e-7);
  const crop=scene.render(interval(.0321,.064));
  assert.deepEqual(WAV.decode(crop.waves.mix).samples,out.subarray(1027*2));
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-binaural-pin-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=path.join(folder,'soundtrack.json'), profile=path.join(folder,'hrir.json'), files=[];
  fs.writeFileSync(profile,json);
  fs.writeFileSync(file,JSON.stringify({format:'ink-studio/scene-audio',version:1,sampleRate:rate,assets:{},
    spatial:{binauralProfile:{file:'hrir.json',sha256}}}));
  const pinned=ink.readSceneAudio(file,{kit,onFile:name=>files.push(name)});
  assert.equal(pinned.render(interval(0,.032)).report.binauralProfile.sha256,sha256);
  assert(files.includes(profile));
  fs.appendFileSync(profile,'\n');
  assert.throws(()=>ink.readSceneAudio(file,{kit}),/SHA-256 mismatch/);
});

test('Chrome preview uses the same moving-listener impulse samples as the headless mix',
  {skip:!process.env.INK_TEST_CHROME,timeout:35000},async()=>{
  const scenario={...world,commands:world.commands.slice(0,2)};
  const run=W.runtime.create(scenario), planner=W.spatialAudio.create(spatial), frames=[];
  const take=()=>{const {time}=run.view(),{binauralProfile,...frame}=planner.frame({time,query:run.query(),listener});frames.push(frame);};
  take();run.advance(2);take();run.advance(4);take();
  const end=.224, sampleCount=Math.round(end*rate);
  const channels=3, samples=Float32Array.from(Array.from(source,n=>[n,n*.5,n*.25]).flat());
  const browser=await renderPreview(process.env.INK_TEST_CHROME,{rate,length:sampleCount,frames,channels,source:[...samples],profile:json,sha256});
  const offline=WAV.decode(make(spatial,scenario,{samples,channels,sampleRate:rate}).render(interval(0,end)).waves.mix).samples;
  const delta=peakDelta(offline,browser);
  assert(delta<2e-7,`maximum sample difference ${delta}`);
  assert(browser.some(n=>n>.10));
});


test('Chrome refuses to load a changed profile under the same pin',
  {skip:!process.env.INK_TEST_CHROME,timeout:35000},async()=>{
  await assert.rejects(renderPreview(process.env.INK_TEST_CHROME,{rate,length:128,
    frames:[{time:0,active:[],cues:[]}],source:[1],profile:json+'\n',sha256}),/SHA-256 mismatch/);
});
