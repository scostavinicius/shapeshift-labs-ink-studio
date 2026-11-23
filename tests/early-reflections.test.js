const assert=require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..'),kit=ink.load(),{KIT:K}=kit;
const WAV=require('../cli/wav.js');
const plan=K.world.earlyReflections.compile;
const {V}=K,T=K.procedural.takeTime;
const source=[2,1,-1], ear=[3,1,1];
const side={center:[0,1,0],u:[0,0,4],v:[0,2,0],material:'brick'};
const materials={brick:{gain:.85,cutoff:4400},stone:{gain:.73,cutoff:6500},absorber:{gain:0}};
const near=(a,b,epsilon=1e-9)=>assert(Math.abs(a-b)<epsilon,a+' vs '+b);

test('mirrors a source across a finite panel and rejects misses, back sides, and blocked legs',()=>{
  const room=plan({materials,panels:{wall:side},order:1,gain:1});
  const [tap]=room.trace(source,ear);
  assert.deepEqual(tap.surfaces,['wall']);
  near(tap.distance,Math.sqrt(29));
  near(tap.delay,(Math.sqrt(29)-Math.sqrt(5))/343);
  near(tap.gain,.85);
  near(tap.apparentSource[0],0);
  near(tap.apparentSource[1],1);
  near(tap.apparentSource[2],-.2);
  assert.equal(tap.cutoff,4400);
  assert.deepEqual(room.trace(source,[-3,1,1]),[]);
  assert.deepEqual(room.trace(source,ear,{visible:(a,b)=>a[0]>0&&b[0]>0}),[]);
  const miss=plan({materials,panels:{wall:{...side,center:[0,1,2],u:[0,0,.4]}}});
  assert.deepEqual(miss.trace(source,ear),[]);
  const blocker={center:[1,1,-.59],u:[0,0,.14],v:[0,.2,0],material:'absorber'};
  const closed=plan({materials,panels:{wall:side,blocker}});
  assert.deepEqual(closed.trace(source,ear),[]);
});

test('room geometry contributes bounded, ordered multi-bounce paths with material cutoffs',()=>{
  const faces={west:'brick',east:false,floor:'stone',ceiling:'stone',south:false,north:false};
  const options={materials,room:{min:[0,0,-5],max:[8,4,5],faces},gain:.75};
  const paths=plan(options).trace(source,ear);
  assert(paths.some(row=>row.surfaces.join()==='west'));
  assert(paths.some(row=>row.surfaces.join()==='floor'));
  assert(paths.some(row=>row.surfaces.join()==='ceiling'));
  const double=paths.find(row=>row.surfaces.length===2&&row.surfaces.includes('west'));
  assert(double);
  assert.equal(double.cutoff,4400);
  near(double.gain,.75*.85*.73);
  const [a,b]=double.points;
  near(double.distance,V.dist(source,a)+V.dist(a,b)+V.dist(b,ear));
  assert(paths.every((row,i)=>!i||row.delay>=paths[i-1].delay));
  const [faster]=plan({...options,speedOfSound:686,maxTaps:1}).trace(source,ear);
  near(faster.delay,paths[0].delay/2);
  assert.throws(()=>plan({panels:{wall:{...side,material:undefined,v:[0,.2,1]}}}),/perpendicular/);
});

test('spatial cue plans carry reflections while direct falloff, opt-out, and live blockers stay distinct',()=>{
  const config={cues:{strike:{asset:'hit',at:source,distance:{reference:1,max:30,fade:0}},
    dry:{asset:'hit',at:source,earlyReflections:false}},
    earlyReflections:{materials,panels:{wall:side},order:1},occlusion:{rays:['fixture/ray']}};
  const audio=K.world.spatialAudio.create(config);
  const run=K.world.runtime.create({systems:{fixture:{kind:'mechanics',config:{gravity:[0,0,0],bodies:{
    baffle:{position:[1,1,-.6],fixed:true,half:[.08,.25,.15]}
  }}}}});
  const open=audio.cue({listener:ear,cue:'strike'}), blocked=audio.cue({query:run.query(),listener:ear,cue:'strike'});
  assert.equal(open.reflections.length,1);
  assert.equal(blocked.reflections,undefined);
  assert.equal(blocked.gain,open.gain);
  assert.equal(blocked.status,'spatial');
  near(open.reflections[0].gain,.8*.85/Math.sqrt(29));
  assert.equal(audio.cue({listener:ear,cue:'dry'}).reflections,undefined);
  const direct=K.world.spatialAudio.create({...config,earlyReflections:false}).cue({listener:ear,cue:'strike'});
  assert.deepEqual({...open,reflections:undefined},{...direct,reflections:undefined});
});

test('scene audio admits one cue and renders the reflected impulse at the reported sample',()=>{
  const sampleRate=48000, at=.10, world={id:'echo-test',dt:.05,commands:[{tick:2,action:'world/event',
    args:K.world.timedEvents.at(at,{kind:'audio-cue',cue:'hit',at:source})}]};
  const spatial={cues:{hit:{asset:'hit',distance:{reference:10,max:30,fade:0}}},
    voiceBudget:{maxVoices:1,reservedVoices:0},
    earlyReflections:{materials,panels:{wall:side},order:1}};
  const raw={samples:new Float32Array([.4]),channels:1,sampleRate};
  const create=(settings,post)=>ink.createSceneAudio({format:'ink-studio/scene-audio',
    version:1,listener:ear,sampleRate,spatial:settings,...(post&&{post:{}})},
    {kit,resolveAsset:()=>raw,runtime:()=>K.world.runtime.create(world)});
  const sequence={startPoint:T.read(0),endPoint:T.read(.18)};
  const direct=WAV.decode(create({...spatial,earlyReflections:false}).render(sequence).waves.mix).samples;
  const render=create(spatial).render(sequence,{trace:true}), mixed=WAV.decode(render.waves.mix).samples;
  const [shot]=render.report.storyAudio.cues, [echo]=shot.reflections, on=echo.arrivalSample;
  assert.equal(on,shot.arrivalSample+Math.round(echo.delay*sampleRate));
  assert.equal(render.report.stems.spatial.voices,1);
  assert.equal(render.report.stems.spatial.reflections,1);
  assert.deepEqual(mixed.subarray(0,on*2),direct.subarray(0,on*2));
  assert(mixed[on*2]>.03&&mixed[on*2]>mixed[on*2+1]*2);
  assert.notDeepEqual(create(spatial,true).render(sequence).waves.mix,create({...spatial,earlyReflections:false},true).render(sequence).waves.mix);
});
