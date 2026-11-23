const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ink=require('../..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const WAV=require('../../cli/wav.js');
const {write,json}=require('../../cli/asset-files.js');
const {renderPreview}=require('../pinned-binaural/preview.cjs');
const [out,chrome=process.env.INK_TEST_CHROME]=process.argv.slice(2);
if(!out||!chrome)throw Error('Use node examples/stick-slip/demo.cjs <output directory> <Chrome executable>');

const rate=48000, dt=.032, ticks=210, duration=ticks*dt;
const listener=[.35,1.45,.8], site={entity:'gate',socket:'shoe'};
const profile={stiffness:12000,staticFriction:.92,kineticFriction:.43,roughness:.33,minInterval:.014,
  body:162,decay:.13,hardness:.82,gain:.68};
const modes=[{id:'heavy',load:1,pulses:true},{id:'light',load:.43,pulses:true},{id:'steady',load:1,pulses:false}];
const marks={load:10,release:33,catch:97,restart:121,stop:173,end:185};
const keys=[[0,0,0,'idle'],[10,0,200,'stick'],[27,0,455,'stick'],[33,.14,465,'slip'],
  [48,.42,366,'slip'],[70,.54,252,'slip'],[83,.35,313,'slip'],[96,.085,497,'slip'],[97,0,490,'stick'],
  [112,0,365,'stick'],[121,.23,407,'slip'],[142,.49,288,'slip'],[155,.34,342,'slip'],
  [172,.082,506,'slip'],[173,0,490,'stick'],[184,0,183,'stick'],[185,0,0,'idle']];
const markerTimes=Object.fromEntries(Object.entries(marks).map(([name,tick])=>[name,tick*dt]));
function readings(loadScale){
  const result=[];
  let offset=0, index=0;
  for(let tick=0;tick<=ticks;tick++){
    while(keys[index+1]?.[0]<=tick)index++;
    const [a,speed0,load0,state]=keys[index], [b,speed1,load1]=keys[index+1]??[a,speed0,load0];
    const u=b===a?0:(tick-a)/(b-a), speed=state==='slip'?K.mix(speed0,speed1,u):0;
    const load=state==='idle'?0:loadScale*K.mix(load0,load1,u);
    result.push({time:tick*dt,offset,speed,load,state});
    offset+=speed*dt;
  }
  return result;
}
function makeWorld(telemetry){
  const commands=[];
  telemetry.forEach(({time,offset,speed,load,state},tick)=>{
    if(tick<marks.load||tick>marks.end)return;
    commands.push({tick,action:'world/patch',args:{edits:[{op:'set',path:'/entities/gate/position',value:[offset-.83,1.08,-1.6]}]}});
    const kind=tick===marks.load?'contact-start':tick===marks.end?'contact-end':'contact-update';
    commands.push({tick,action:'world/event',args:W.timedEvents.at(time,{kind,contact:{id:'iron-shoe',interaction:'drag',at:site,
      speed,load,material:'iron-on-stone',frictionState:state==='slip'?'slip':'stick'}})});
  });
  return {id:'iron-gate',dt,entities:{gate:{position:[-.83,1.08,-1.6],sockets:{shoe:[.38,-.44,.08]}}},commands};
}
const spatial=pulses=>({soundSeed:48,cues:{bed:{asset:'scrape',gain:.29,bus:'foley',distance:{rolloff:0}}},
  contactLoops:{attack:.041,crossfade:.07,response:.048,release:.075,interactions:{drag:{cue:'bed',
    speedForFullRate:.61,loadForFullGain:452,rate:[.58,1.25],stickSlip:pulses?profile:false}}}});
const noise=K.procedural.mediaGraph.synthesizeGesture({model:'scrape',sampleRate:rate,duration:.83,seed:37,
  parameters:{speed:.55,pressure:.71,body:185,grain:.77}}).value;
const asset=WAV.encode(noise,{encoding:'pcm24'});
write(path.join(out,'scrape-bed.wav'),asset);
const interval={startPoint:T.read(0),endPoint:T.read(duration)};
const wave=bytes=>'data:audio/wav;base64,'+WAV.encode(WAV.decode(bytes),{encoding:'pcm16'}).toString('base64');

async function demo(){
  const cases={}, clips={};
  for(const {id,load,pulses} of modes){
    const telemetry=readings(load), world=makeWorld(telemetry), config=spatial(pulses);
    const worldFile=id==='heavy'?'world.json':id+'.world.json', planFile=id==='heavy'?'soundtrack.json':id+'.soundtrack.json';
    json(path.join(out,worldFile),world);
    json(path.join(out,planFile),{format:'ink-studio/scene-audio',version:1,sampleRate:rate,gain:.87,listener,
      world:worldFile,assets:{scrape:'scrape-bed.wav'},spatial:config});
    const rendered=ink.readSceneAudio(path.join(out,planFile),{kit}).render(interval,{trace:true});
    const events=rendered.report.storyAudio.stickSlip??[];
    assert.equal(rendered.report.headroom,1);
    if(pulses)assert.deepEqual(events.filter(row=>row.phase!=='slip').map(row=>row.phase),['breakaway','catch','breakaway','catch']);
    else assert.equal(events.length,0);
    write(path.join(out,id+'.wav'),rendered.waves.mix);
    clips[id]=wave(rendered.waves.mix);
    cases[id]={telemetry,events};
    if(id==='heavy'){
      const run=W.runtime.create(world), planner=W.spatialAudio.create(config), frames=[];
      for(let tick=0;tick<ticks;tick++){
        const frame=planner.frame({query:run.query(),time:tick*dt,events:run.events,listener});
        frames.push({...frame,time:tick?(Math.round(tick*dt*rate)+.25)/rate:0});
        run.step();
      }
      assert.equal(frames.reduce((n,frame)=>n+frame.cues.length,0),events.length);
      const samples=await renderPreview(chrome,{rate,length:Math.round(duration*rate),frames,panning:'equalpower',
        source:Array.from(WAV.decode(asset).samples)});
      write(path.join(out,'browser-preview.wav'),WAV.encode({sampleRate:rate,samples,channels:2},{encoding:'pcm24'}));
    }
  }
  assert(cases.light.events.length>cases.heavy.events.length);
  assert(cases.heavy.events[0].energy>4*cases.light.events[0].energy);
  const data={title:'The Iron Gate',duration,dt,rate,markerTimes,cases,profile};
  json(path.join(out,'contact-trace.json'),data);
  const template=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
  write(path.join(out,'index.html'),template.replace('/*INK_STICK_SLIP_DEMO*/',()=>JSON.stringify({...data,clips}).replaceAll('<','\\u003c')));
  console.log(Object.fromEntries(Object.entries(cases).map(([id,{events}])=>[id,{pulses:events.length,firstEnergy:events[0]?.energy}])));
}
demo().catch(error=>{console.error(error.stack);process.exitCode=1;});
