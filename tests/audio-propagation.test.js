const test=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const WAV=require('../cli/wav.js');
const {renderPreview}=require('../examples/pinned-binaural/preview.cjs');
const c=343, rate=48000, dt=.032;
const close=(actual,expected,tolerance=1e-8)=>assert(Math.abs(actual-expected)<tolerance,`${actual} differs from ${expected}`);
const motion=W.audioPropagation;
const opts=motion.settings({});

test('subsonic travel and Doppler use separate source and listener velocities',()=>{
  const source=[-343,0,0], listener=[0,0,0];
  const direct=motion.compile(c,opts,source,listener);
  close(direct.delaySeconds,1);
  close(direct.rateScale,1);
  const speed={sourceVelocity:[30,0,0],listenerVelocity:[-20,0,0]};
  const emitted=motion.compile(c,opts,source,listener,speed);
  close(emitted.delaySeconds,343/363);
  close(emitted.rateScale,363/313);
  const heard=motion.compile(c,opts,source,listener,{...speed,receiving:true});
  close(heard.delaySeconds,343/313);
  close(heard.rateScale,363/313);
  close(motion.compile(c,opts,[343,0,0],listener,speed).rateScale,323/373);
  close(motion.compile(c,opts,source,listener,{sourceVelocity:[120,0,0],listenerVelocity:[120,0,0]}).rateScale,1);
  const stylized=motion.compile(c,motion.settings({delayScale:2,maxDelay:.6,dopplerScale:0}),source,listener,speed);
  close(stylized.delaySeconds,.6);
  close(stylized.rateScale,1);
  const pitchOnly=motion.compile(c,motion.settings({delayScale:0,dopplerScale:3,maxShiftCents:100}),source,listener,speed);
  close(pitchOnly.delaySeconds,0);
  close(pitchOnly.cents,100);
  close(motion.compile(c,opts,listener,listener,{sourceVelocity:[0,30,0]}).rateScale,1);
  const fast=motion.compile(c,opts,source,listener,{sourceVelocity:[1300,0,0]});
  assert(fast.cents===1200&&Number.isFinite(fast.delaySeconds));
  assert.throws(()=>motion.settings({maxDelay:31}),/Invalid propagation/);
  assert.throws(()=>motion.medium({metersPerWorld:0}),/Invalid sound propagation scale/);
});

const movingWorld={dt,entities:{train:{position:[-48,2,0],sockets:{horn:[0,0,0]}}},systems:{rig:{kind:'mechanics',
  config:{gravity:[0,0,0],drag:0,bodies:{train:{position:[-48,2,0],half:[.5,.5,.5],velocity:[80,0,0]}}}}}};
const at={entity:'train',socket:'horn'}, listener={at:[0,2,-3],forward:[0,0,1]};
const travelCue={asset:'tone',at,propagation:{},distance:{rolloff:0,max:1000,fade:0}};
const engine={cues:{engine:travelCue},emitters:{train:{cue:'engine',offset:.125}}};
const tone={sampleRate:rate,channels:1,samples:Float32Array.from({length:rate},(_,i)=>.3*Math.cos(2*Math.PI*400*i/rate))};
const interval=(start,end)=>({startPoint:T.read(start),endPoint:T.read(end)});
const open=(world,spatial,source=tone,ear=listener)=>ink.createSceneAudio({format:'ink-studio/scene-audio',version:1,
  sampleRate:rate,spatial,listener:ear},{kit,resolveAsset:()=>source,runtime:()=>W.runtime.create(world)});

test('selected world emitters retain their first arrival and phase while an override can bypass motion',()=>{
  const run=W.runtime.create(movingWorld), planner=W.spatialAudio.create({...engine,emitters:{...engine.emitters,
    dry:{cue:'engine',propagation:false}}});
  const playback=planner.createPlayback(), frame=time=>planner.frame({query:run.query(),listener,time,playback});
  const [dry,initial]=frame(0).active;
  assert.equal(dry.id,'emitter:dry');
  assert.equal(dry.propagation,undefined);
  assert.equal(dry.delay,0);
  close(initial.delay,Math.hypot(48,3)/c);
  assert(initial.rate>1.25);
  const start=initial.propagation.arrival;
  let prior=initial;
  for(let tick=1;tick<32;tick++){
    run.step();
    const time=tick*dt, heard=frame(time).active[1];
    close(heard.propagation.arrival,start);
    close(heard.offset,prior.offset+prior.rate*Math.max(0,time-Math.max(start,time-dt)));
    close(heard.delay,Math.max(0,start-time));
    prior=heard;
  }
  assert(prior.rate<.84,'past the train, pitch should drop');
  assert(prior.apparentSource[0]<prior.position[0]);
  close(prior.offset,frame(31*dt).active[1].offset);
  const fresh=planner.frame({query:W.runtime.create(movingWorld).query(),listener,time:0,playback}).active[1];
  close(fresh.offset,.125);
  assert.deepEqual(run.query().frame(at,{motion:true}).velocity,[80,0,0]);
});

test('routed travel still uses the acoustic path and retains scene-wide compatibility',()=>{
  const run=W.runtime.create(require('../examples/world-acoustic-hatch.json'));
  const at={entity:'beacon',socket:'speaker'}, listener={entity:'listen-post'}, query=run.query();
  const cue={asset:'tone',at};
  const settings={occlusion:{acoustic:'acoustics/audible'},propagationDelay:true,
    cues:{legacy:cue,selected:{...cue,propagation:{delayScale:2}}}};
  const mix=W.spatialAudio.create(settings);
  const legacy=mix.cue({query,listener,cue:'legacy'}), selected=mix.cue({query,listener,cue:'selected'});
  assert(legacy.delay>0);
  close(selected.delay,legacy.delay*2);
  close(selected.rate,1);
  const fallback=W.spatialAudio.create({cues:{engine:travelCue}});
  const pose=(position)=>({frame:()=>({point:position})});
  let configured;
  const events=[{kind:'audio-cue',cue:'engine',at}], ear=[0,2,-3];
  fallback.frame({query:pose([-50,2,0]),listener:ear,time:0,events});
  configured=fallback.frame({query:pose([-45,2,0]),listener:ear,time:.1,events}).cues[0];
  assert(configured.rate>1,'pose-only hosts measure motion over consecutive samples');
  configured=fallback.frame({query:pose([500,2,0]),listener:ear,time:.2,events}).cues[0];
  close(configured.rate,1);
});

const firstSignal=samples=>samples.findIndex((n,i)=>i%2===0&&Math.abs(n)>.005)/2;
const fixedWorld={dt,commands:[{tick:2,action:'world/event',args:W.timedEvents.at(.05,{kind:'audio-cue',cue:'ping',at:[34.3,2,-3]})}]};
const ping={cues:{ping:{asset:'pulse',propagation:{dopplerScale:0},distance:{rolloff:0,max:200}}}};
const pulse={sampleRate:rate,channels:1,samples:Float32Array.from({length:64},()=>.5)};
const expectedSample=Math.round(.15*rate);

test('headless cue arrival uses the emission timestamp and a moving loop trims sample-accurately',()=>{
  const fixed=open(fixedWorld,ping,pulse,{at:[0,2,-3],forward:[1,0,0]});
  const full=WAV.decode(fixed.render(interval(0,.32)).waves.mix).samples;
  assert.equal(firstSignal(full),expectedSample);
  const renderer=open(movingWorld,engine), mixed=WAV.decode(renderer.render(interval(0,.96)).waves.mix).samples;
  const first=Math.round(Math.hypot(48,3)/c*rate);
  assert.equal(firstSignal(mixed),first);
  const crop=WAV.decode(renderer.render(interval(.32,.8)).waves.mix).samples;
  assert.deepEqual(crop,mixed.slice(.32*rate*2,.8*rate*2));
});

test('a positioned timeline trigger retains its emission time in live playback',()=>{
  const timeline=K.timeline.compile({duration:.5,sequences:{part:{duration:.5,
    audio:[{id:'ping',cue:'ping',time:.05}]}},clips:[{id:'timeline',sequence:'part',time:0}]},{exact:true});
  const planner=W.spatialAudio.create({cues:{ping:{...ping.cues.ping,at:[34.3,2,-3]}}});
  const shot=planner.frame({listener:[0,2,-3],time:.064,from:.032,timeline}).cues[0];
  close(shot.onset,.05);
  close(shot.delay,.1);
});

test('Chrome schedules the same delayed cue and tunes a flyby without restarting the source',
  {skip:!process.env.INK_TEST_CHROME,timeout:35000},async()=>{
  const chrome=process.env.INK_TEST_CHROME, ear={at:[0,2,-3],forward:[1,0,0]};
  const run=W.runtime.create(fixedWorld), planner=W.spatialAudio.create(ping);
  const a=planner.frame({query:run.query(),listener:ear,time:0});
  run.advance(2);
  const b=planner.frame({query:run.query(),listener:ear,time:2*dt,events:run.events});
  const delayed=await renderPreview(chrome,{rate,length:.32*rate,frames:[a,b],source:[...pulse.samples],panning:'equalpower',expectedStarts:1});
  assert.equal(firstSignal(delayed),expectedSample);
  const train=W.runtime.create(movingWorld), worldMix=W.spatialAudio.create(engine), frames=[];
  for(let tick=0;tick<30;tick++){
    const frame=worldMix.frame({query:train.query(),listener,time:tick*dt});
    frames.push({...frame,time:(Math.round(tick*dt*rate)+.25)/rate});
    train.step();
  }
  frames[0]={...frames[0],time:0};
  const live=await renderPreview(chrome,{rate,length:.96*rate,frames,source:[...tone.samples],panning:'equalpower',expectedStarts:1});
  const print=WAV.decode(open(movingWorld,engine).render(interval(0,.96)).waves.mix).samples;
  const crossingRate=(samples,from,to)=>{
    let count=0;
    for(let i=Math.round(from*rate)*2+2;i<Math.round(to*rate)*2;i+=2)if(samples[i-2]<0&&samples[i]>=0)count++;
    return count/(to-from);
  };
  const bands=[[.25,.45],[.77,.93]];
  const heard=bands.map(range=>crossingRate(live,...range)), exported=bands.map(range=>crossingRate(print,...range));
  assert(heard[0]>480&&heard[1]<360,JSON.stringify(heard));
  heard.forEach((hz,i)=>close(hz,exported[i],7));
});
