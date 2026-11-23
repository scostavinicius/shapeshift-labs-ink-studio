const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ink=require('../..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const WAV=require('../../cli/wav.js');
const {write,json}=require('../../cli/asset-files.js');
const {renderPreview}=require('../pinned-binaural/preview.cjs');
const [out,chrome=process.env.INK_TEST_CHROME]=process.argv.slice(2);
if(!out||!chrome)throw Error('Use node examples/propagation-doppler/demo.cjs <output directory> <Chrome executable>');

const rate=48000, dt=.032, duration=10.24, tau=2*Math.PI, speed=72, start=-368, nominal=360;
const hornTick=50, hornTime=hornTick*dt, pass=-start/speed;
const listener={at:[0,2,18],forward:[0,0,-1]}, motor={entity:'train'}, horn={entity:'train',socket:'horn'};
const world={id:'milepost-72',dt,entities:{train:{position:[start,2,0],sockets:{horn:[0,.35,0]}}},
  systems:{rig:{kind:'mechanics',config:{gravity:[0,0,0],drag:0,bodies:{train:{
    position:[start,2,0],velocity:[speed,0,0],half:[3,.8,1]}}}}},
  commands:[{tick:hornTick,action:'world/event',args:W.timedEvents.at(hornTime,{kind:'audio-cue',cue:'horn',at:horn})}]};
const modes=[
  {id:'physical',label:'Physical',effect:{delayScale:1,dopplerScale:1}},
  {id:'flat',label:'Off',effect:false},
  {id:'pushed',label:'Exaggerated',effect:{delayScale:1.35,dopplerScale:1.7,maxShiftCents:900}}
];
const curve={reference:95,max:1600,fade:100};
function spatial(effect){
  return {propagation:{metersPerWorld:1,speedOfSound:343},cues:{
    motor:{asset:'motor',gain:.82,distance:curve},
    horn:{asset:'horn',gain:.86,bus:'foley',at:horn,distance:{...curve,reference:180},propagation:effect}
  },emitters:{train:{cue:'motor',at:motor,propagation:effect}}};
}
const settings={format:'ink-studio/scene-audio',version:1,sampleRate:rate,listener,assets:{motor:'motor.wav',horn:'horn.wav'},world:'world.json'};
json(path.join(out,'world.json'),world);
for(const {id,effect} of modes)json(path.join(out,id==='physical'?'soundtrack.json':id+'.soundtrack.json'),{...settings,spatial:spatial(effect)});

function motorSound(){
  const samples=new Float32Array(rate*2);
  let noise=0, seed=701;
  for(let i=0;i<samples.length;i++){
    const t=i/rate, turn=tau*nominal*t, rattle=Math.exp(-(t%.125)*47);
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    noise+=.11*(seed/2147483648-1-noise);
    const pad=Math.min(1,t/.025,(2-t)/.025);
    samples[i]=.125*Math.sin(turn)+.045*Math.sin(turn*2)+.027*Math.sin(turn*3)+
      .096*Math.sin(tau*63*t)*(1+.25*Math.sin(tau*8*t))+.09*pad*noise*(.31+.69*rattle);
  }
  return {samples,channels:1,sampleRate:rate};
}
function hornSound(){
  const duration=.54, samples=new Float32Array(Math.round(rate*duration));
  for(let i=0;i<samples.length;i++){
    const t=i/rate, fade=Math.min(1,t/.014,(duration-t)/.078), fold=1+.1*Math.cos(tau*12*t);
    samples[i]=fade*fold*(.36*Math.sin(tau*440*t)+.18*Math.sin(tau*554.37*t)+.072*Math.sin(tau*880*t));
  }
  return {samples,channels:1,sampleRate:rate};
}
const sounds={};
for(const [id,pcm] of Object.entries({motor:motorSound(),horn:hornSound()})){
  const bytes=WAV.encode(pcm,{encoding:'pcm24'});
  write(path.join(out,id+'.wav'),bytes);
  sounds[id]=WAV.decode(bytes);
}
const interval={startPoint:T.read(0),endPoint:T.read(duration)};
const clip=pcm=>'data:audio/wav;base64,'+WAV.encode(pcm,{encoding:'pcm16'}).toString('base64');
async function demo(){
  const recordings={}, tracks={}, details={};
  for(const {id,effect} of modes){
    const mixer=W.spatialAudio.create(spatial(effect)), run=W.runtime.create(world), trace=[], frames=[];
    let cue;
    for(let tick=0;tick<=Math.round(duration/dt);tick++){
      const time=tick*dt, frame=mixer.frame({time,query:run.query(),listener,events:run.events});
      const voice=frame.active[0];
      if(frame.cues.length){assert.equal(frame.cues.length,1);cue=frame.cues[0];}
      trace.push({x:voice.position[0],heardX:voice.apparentSource[0],frequency:nominal*voice.rate,
        travel:voice.propagation?.delaySeconds??0,remaining:voice.delay});
      if(time<duration){
        frames.push({...frame,time:tick?(Math.round(time*rate)+.25)/rate:0});
        run.step();
      }
    }
    const file=id==='physical'?'soundtrack.json':id+'.soundtrack.json';
    const printed=ink.readSceneAudio(path.join(out,file),{kit}).render(interval);
    assert.equal(printed.report.headroom,1);
    write(path.join(out,id+'.wav'),printed.waves.mix);
    recordings[id]=clip(WAV.decode(printed.waves.mix));
    tracks[id]=trace;
    details[id]={first:frames[0].active[0].delay,horn:cue.onset+cue.delay,hornDelay:cue.delay};
    if(id==='physical'){
      const rendered=await renderPreview(chrome,{rate,length:Math.round(duration*rate),frames,panning:'equalpower',
        smoothing:.018,expectedStarts:2,sources:Object.fromEntries(Object.entries(sounds)
          .map(([name,{samples,channels}])=>[name,{samples:Array.from(samples),channels}]))});
      write(path.join(out,'browser-preview.wav'),WAV.encode({samples:rendered,channels:2,sampleRate:rate},{encoding:'pcm24'}));
    }
  }
  const data={duration,dt,speed,nominal,hornTime,pass,modes,details,tracks};
  assert(details.physical.hornDelay>.7);
  assert(details.pushed.hornDelay>details.physical.hornDelay);
  assert.equal(details.flat.horn,hornTime);
  assert(tracks.physical[75].frequency>nominal*1.22);
  assert(tracks.physical[250].frequency<nominal*.85);
  json(path.join(out,'trace.json'),data);
  const template=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
  write(path.join(out,'index.html'),template.replace('/*INK_TRAIN_DEMO*/',()=>
    JSON.stringify({...data,recordings}).replaceAll('<','\\u003c')));
  console.log(JSON.stringify(details,null,2));
}
demo().catch(error=>{console.error(error.stack);process.exitCode=1;});
