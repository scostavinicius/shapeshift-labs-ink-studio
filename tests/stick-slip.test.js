const test=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const PCM=require('../src/contact-pulse.js');
const WAV=require('../cli/wav.js');
const {renderPreview}=require('../examples/pinned-binaural/preview.cjs');
const rate=48000, dt=.032, position=[0,1,-2], listener=[0,1,0], duration=.512;
const friction={stiffness:3500,staticFriction:.9,kineticFriction:.42,roughness:0,minInterval:.012,gain:.7,body:180,decay:.083};
const spatial={distance:{rolloff:0},contactLoops:{interactions:{drag:{loadForFullGain:240,stickSlip:friction}}}};
const flags=[[1,0,'stick'],[3,.7,'slip'],[9,0,'stick'],[12,0,'end']];
const command=(tick,speed,state)=>({tick,action:'world/event',args:W.timedEvents.at(tick*dt,{
  kind:tick===1?'contact-start':state==='end'?'contact-end':'contact-update',
  contact:{id:'gate-foot',interaction:'drag',point:position,material:'iron',speed,load:110,frictionState:state}})});
const world={dt,commands:flags.map(row=>command(...row))};
const interval=(start,end)=>({startPoint:T.read(start),endPoint:T.read(end)});
const headless=()=>ink.createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate:rate,spatial,listener},
  {kit,runtime:()=>W.runtime.create(world),resolveAsset:name=>assert.fail('Expected a generated pulse without external asset '+name)});

function scenario(load,override={}){
  const settings=W.stickSlip.compile({...friction,...override}), model=W.stickSlip.contact(settings,'gate',9,240);
  const sample=(time,speed,state)=>model.update({speed,load,frictionState:state,at:position},time);
  assert.deepEqual(sample(0,0,'stick'),[]);
  const snap=sample(.08,.55,'slip'), slide=sample(.37,0,'stick');
  assert.equal(snap[0]?.pulse.phase,'breakaway');
  assert.equal(slide.at(-1)?.pulse.phase,'catch');
  assert.deepEqual(sample(.50,0,'stick'),[]);
  assert.deepEqual(model.finish(.7),[]);
  return [...snap,...slide];
}

test('normal load changes slip energy and spacing with distinct breakaway and regrip',()=>{
  const light=scenario(70), heavy=scenario(160);
  assert(heavy.length<light.length,'higher load should increase the travel needed to release a patch');
  assert(heavy[0].energy>light[0].energy*4);
  assert(heavy[0].gain>light[0].gain);
  assert(light.some(pulse=>pulse.pulse.phase==='slip'&&pulse.time>.08&&pulse.time<.37));
  assert.deepEqual(scenario(70,{roughness:.4}),scenario(70,{roughness:.4}));
  const locked=W.stickSlip.contact(W.stickSlip.compile({...friction,kineticFriction:.9}),'gate',9,240);
  locked.update({speed:2,load:180},0);
  assert.deepEqual(locked.update({speed:2,load:180},.5),[]);
  assert.throws(()=>W.stickSlip.compile({...friction,kineticFriction:1}),/Invalid stick-slip/);
});

test('contact snapshots infer normal pressure from force and clear without lift-off pulses',()=>{
  const planner=W.spatialAudio.create(spatial);
  const contact={id:'gate',interaction:'drag',point:position,force:[12,90,0],normal:[0,1,0],speed:.7,frictionState:'stick'};
  assert.equal(planner.frame({time:0,listener,contacts:[contact]}).cues.length,0);
  const {active,cues}=planner.frame({time:.032,listener,contacts:[{...contact,frictionState:'slip'}]});
  assert.deepEqual(active,[]);
  assert.equal(cues.length,1);
  const [voice]=cues;
  assert.equal(voice.bus,'foley');
  assert.equal(voice.asset,'procedural/stick-slip');
  assert.equal(voice.stickSlip.load,90);
  assert.deepEqual(voice.position,position);
  assert.equal(voice.onset,.032);
  assert.equal(planner.frame({time:.032,listener,contacts:[]}).cues.length,0);
  assert.equal(planner.frame({time:.1,listener,contacts:[]}).cues.length,0);
});

test('headless export synthesizes the dry pulses, reports the phases, and preserves cropped tails',()=>{
  const scene=headless(), {waves,report}=scene.render(interval(0,duration),{trace:true});
  const sound=WAV.decode(waves.mix).samples, receipts=report.storyAudio.stickSlip;
  assert(sound.some(n=>Math.abs(n)>.025));
  assert.equal(receipts[0].phase,'breakaway');
  assert.equal(receipts[0].onsetSample,Math.round(3*dt*rate));
  assert(receipts.some(row=>row.phase==='slip'));
  assert.equal(receipts.at(-1).phase,'catch');
  assert.equal(receipts.at(-1).onsetSample,Math.round(9*dt*rate));
  const crop=scene.render(interval(.30,.43),{trace:true});
  assert.deepEqual(WAV.decode(crop.waves.mix).samples,sound.slice(.30*rate*2,.43*rate*2));
  assert.equal(crop.report.storyAudio.stickSlip.at(-1).phase,'catch');
  assert.notDeepEqual(PCM.render(receipts[0],rate).samples,PCM.render(receipts.at(-1),rate).samples);
});

test('Chrome plays generated pulses at their sub-frame offsets with the monitoring buffer',
  {skip:!process.env.INK_TEST_CHROME,timeout:35000},async()=>{
  const run=W.runtime.create(world), planner=W.spatialAudio.create(spatial), frames=[];
  let count=0;
  for(let tick=0;tick<duration/dt;tick++){
    const frame=planner.frame({query:run.query(),events:run.events,listener,time:tick*dt});
    count+=frame.cues.length;
    frames.push({...frame,time:tick?(tick*dt*rate+.25)/rate:0});
    run.step();
  }
  const live=await renderPreview(process.env.INK_TEST_CHROME,{rate,length:duration*rate,frames,panning:'equalpower',expectedStarts:count});
  const printed=WAV.decode(headless().render(interval(0,duration)).waves.mix).samples;
  const onset=samples=>samples.findIndex((n,i)=>i%2===0&&Math.abs(n)>.008)/2;
  assert(Math.abs(onset(live)-onset(printed)-PCM.monitorDelay*rate)<=2);
  assert(live.slice((9*dt+PCM.monitorDelay)*rate*2).some(n=>Math.abs(n)>.015));
});
