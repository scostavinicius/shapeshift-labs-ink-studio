const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const ink=require('..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const WAV=require('../cli/wav.js');
const {renderPreview}=require('../examples/pinned-binaural/preview.cjs');
const row=(angle,low,mid,high)=>({angle,db:{low,mid,high}});
const cabinet={points:[row(0,0,0,0),row(60,-1,-3,-7),row(90,-1,-5,-15),row(180,-2,-10,-32)]};
const directives={radiationProfiles:{cabinet},cues:{program:{asset:'signal',radiation:'cabinet',distance:{rolloff:0}}},
  emitters:{speaker:{cue:'program',at:{entity:'box',socket:'driver'}}}};
const listener={at:[0,1,-3],forward:[0,0,1]}, rate=48000;
const makeWorld=(turn=0,angular=[0,0,0])=>({id:'test-cabinet',dt:.025,
  entities:{box:{position:[0,1,0],sockets:{driver:[0,0,0]}}},systems:{rig:{kind:'mechanics',config:{gravity:[0,0,0],drag:0,
    bodies:{box:{position:[0,1,0],half:[.25,.4,.3],turn,angular}}}}}});
const checkNear=(a,b,margin=1e-7)=>assert(Math.abs(a-b)<margin,`${a} differs from ${b}`);

test('radiation follows an entity socket and interpolates independent band pressure in decibels',()=>{
  const run=W.runtime.create(makeWorld(0,[0,Math.PI,0])), mix=W.spatialAudio.create(directives);
  const sample=()=>mix.frame({query:run.query(),listener,time:run.view().time}).active[0];
  const front=sample();
  assert.deepEqual(front.bands,{low:1,mid:1,high:1});
  assert.deepEqual(front.radiation.forward,[0,0,-1]);
  run.advance(20);
  const side=sample();
  checkNear(side.radiation.angle,90);
  checkNear(side.bands.low,10**(-1/20));
  checkNear(side.bands.high,10**(-15/20));
  run.advance(40);
  const rear=sample();
  checkNear(rear.radiation.angle,180,1e-5);
  checkNear(rear.bands.mid,10**(-10/20));
  checkNear(rear.bands.high,10**(-32/20));
  assert.equal(rear.distance,front.distance);
  const bypass=W.spatialAudio.create({...directives,emitters:{speaker:{...directives.emitters.speaker,radiation:false}}})
    .frame({query:run.query(),listener}).active[0];
  assert.equal(bypass.radiation,undefined);
  assert.deepEqual(bypass.bands,front.bands);
  const arc=W.directionalAudio.compile(cabinet);
  checkNear(arc.sample([0,0,-1],[1,0,-1]).db.high,-5.25);
  assert.throws(()=>W.directionalAudio.compile({points:[row(0,0,0,0),row(90,0,0,0)]}),/0 to 180/);
  assert.throws(()=>W.spatialAudio.create({...directives,cues:{bad:{asset:'x',radiation:'missing'}}}),/Invalid audio cue/);
});

test('early reflections use their first departure leg rather than the bearing to the listener',()=>{
  const settings={radiationProfiles:{cabinet},cues:{hit:{asset:'sound',radiation:'cabinet',distance:{rolloff:0}}},
    earlyReflections:{room:{min:[-3,0,-3],max:[3,4,3],faces:{north:'panel',south:false,east:false,west:false,floor:false,ceiling:false}},
      materials:{panel:{gain:.8,cutoff:6500}},order:1}};
  const origin=[0,1,0];
  const mix=W.spatialAudio.create(settings), frame=mix.frame({time:0,listener:[.7,1,1.25],
    events:[{kind:'audio-cue',cue:'hit',at:origin}]});
  const direct=frame.cues[0], tap=direct.reflections[0];
  assert(direct.radiation.angle>140);
  assert(tap.radiation.angle<20);
  assert(tap.bands.high>direct.bands.high*5);
  assert.equal(tap.cutoff,6500);
});

test('portal transmission measures radiation toward the first opening',()=>{
  const run=W.runtime.create(require('../examples/world-acoustic-hatch.json'));
  const query=run.query(), listener=[-2,1,1.5], at={entity:'beacon',socket:'speaker'};
  const mix=W.spatialAudio.create({radiationProfiles:{cabinet:{...cabinet,forward:[-1,0,0]}},
    cues:{beacon:{asset:'signal',at,radiation:'cabinet',distance:{rolloff:0}}},occlusion:{acoustic:'acoustics/audible'}});
  const route=query.probe('acoustics/audible',listener,{from:at,details:true}).value;
  assert.notEqual(route.fromRoom,route.toRoom);
  const sound=mix.cue({query,listener,cue:'beacon'});
  checkNear(sound.radiation.angle,0);
  checkNear(sound.bands.high,10**(-(route.bands.high.lossDb-route.distanceLossDb)/20));
});

const frequencies=[90,1000,7200];
const source={samples:Float32Array.from({length:rate*.4},(_,i)=>frequencies.reduce((sum,hz)=>sum+.12*Math.sin(2*Math.PI*hz*i/rate),0)),
  channels:1,sampleRate:rate};
const interval=(start,end)=>({startPoint:T.read(start),endPoint:T.read(end)});
const duration=.4;
function exported(world,spatial=directives){
  return ink.createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate:rate,spatial,listener},
    {kit,resolveAsset:()=>source,runtime:()=>W.runtime.create(world)});
}
function measure(samples){
  const begin=Math.round(rate*.1), end=Math.round(rate*.3);
  return frequencies.map(hz=>{
    let sine=0,cosine=0;
    for(let i=begin;i<end;i++){
      const theta=2*Math.PI*hz*i/rate;
      sine+=samples[i*2]*Math.sin(theta);cosine+=samples[i*2]*Math.cos(theta);
    }
    return Math.hypot(sine,cosine)/(end-begin);
  });
}
const delta=(front,rear)=>front.map((n,i)=>20*Math.log10(rear[i]/n));
const assertRear=levels=>{
  assert(levels[0] < -.8 && levels[0] > -4,JSON.stringify(levels));
  assert(levels[1] < -6 && levels[1] > -14,JSON.stringify(levels));
  assert(levels[2] < -22,JSON.stringify(levels));
};

test('the rear response shapes exported bass, mids, and treble and keeps filter history in crops',()=>{
  const front=exported(makeWorld()), rear=exported(makeWorld(Math.PI));
  const full=scene=>WAV.decode(scene.render(interval(0,duration)).waves.mix).samples;
  const rearPCM=full(rear);
  assertRear(delta(measure(full(front)),measure(rearPCM)));
  const moving=exported(makeWorld(0,[0,Math.PI*2,0])), movingFull=full(moving);
  const crop=WAV.decode(moving.render(interval(.15,.35)).waves.mix).samples;
  assert.deepEqual(crop,movingFull.slice(rate*.15*2,rate*.35*2));
});

test('Chrome and headless export agree on the steady rear spectrum',
  {skip:!process.env.INK_TEST_CHROME,timeout:35000},async()=>{
  const transfer={format:'ink-studio/binaural-profile',version:1,id:'radiation-test',sampleRate:rate,
    directions:[{azimuth:0,elevation:0,left:[1],right:[1]}]};
  const profile=JSON.stringify(transfer), sha256=createHash('sha256').update(profile).digest('hex');
  for(const pinned of [false,true]){
    const spatial=pinned?{...directives,binauralProfile:transfer}:directives;
    const browser=[], offline=[];
    for(const turn of [0,Math.PI]){
      const world=makeWorld(turn), run=W.runtime.create(world);
      const frame=W.spatialAudio.create(spatial).frame({query:run.query(),listener});
      browser.push(measure(await renderPreview(process.env.INK_TEST_CHROME,{rate,length:rate*duration,frames:[frame],
        source:Array.from(source.samples),panning:'equalpower',...(pinned&&{profile,sha256})})));
      offline.push(measure(WAV.decode(exported(world,spatial).render(interval(0,duration)).waves.mix).samples));
    }
    const actual=delta(...browser), expected=delta(...offline);
    assertRear(actual);
    actual.forEach((n,i)=>checkNear(n,expected[i],.08));
  }
});
