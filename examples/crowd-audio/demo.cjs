const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ink=require('../..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const WAV=require('../../cli/wav.js');
const {write,json}=require('../../cli/asset-files.js');

const out=process.argv[2];
if(!out)throw Error('Use node examples/crowd-audio/demo.cjs <output-directory>');
const sampleRate=48000, dt=.032, duration=6.4, listener=[0,1.5,0];
const distance={rolloff:0};
const cues={
  step:{asset:'boot',group:'crowd',priority:-14,distance},
  rubble:{asset:'stone',group:'debris',priority:-22,distance},
  bell:{asset:'bell',priority:85,protected:true,distance,gain:.64}
};
const base={maxVoices:5,reservedVoices:1,stealFade:0};
const aggregation={groups:['crowd','debris'],sectors:2,grain:.112,gain:.9,bus:'foley'};
const sounds={boot:{model:'metal',duration:.155,body:104,hardness:.12,decay:.08,strike:.82},
  stone:{model:'metal',duration:.145,body:378,hardness:.9,decay:.085,strike:.7},
  bell:{model:'metal',duration:.76,body:470,hardness:.57,decay:.37,strike:.79}};
const assets={};
let seed=683;
function random(){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return seed/4294967296;
}
for(const [id,{model,duration,...parameters}] of Object.entries(sounds)){
  const generated=K.procedural.mediaGraph.synthesizeGesture({model,duration,sampleRate,parameters,seed:238}).value;
  const samples=Float64Array.from(generated.samples,(sample,i)=>{
    if(id==='bell')return sample*.82;
    const elapsed=i/sampleRate;
    const noise=(random()*2-1)*Math.exp(-elapsed/(id==='boot'?.021:.012));
    return sample*.65+noise*(id==='boot'?.12:.22)*Math.min(1,elapsed/.001);
  });
  const file=id+'.wav';
  write(path.join(out,file),WAV.encode({...generated,samples},{encoding:'pcm24'}));
  assets[id]=file;
}

const events=[];
function hit(tick,cue,x,gain,pitch){
  const time=tick*dt;
  events.push({time,cue,command:{tick,action:'world/event',
    args:{kind:'audio-cue',cue,at:[x,1.5,cue==='bell'?-2:0],gain,pitch}}});
}
for(let tick=12;tick<182;tick+=3){
  const count=tick<60?4:tick<128?8:5;
  for(let i=0;i<count;i++)hit(tick+(i===0?0:(i+tick)%3),'step',-2-random()*2,
    (i===0?.31:.13)+random()*.12,.70+random()*.66);
}
for(const [start,end] of [[53,83],[116,145]]){
  for(let tick=start;tick<end;tick+=2){
    for(let i=0;i<5;i++)hit(tick+(i%3),'rubble',2+random()*2,.09+random()*.16,.66+random()*1.08);
  }
}
for(const tick of [94,134,167])hit(tick,'bell',0,1,1);
events.sort((a,b)=>a.time-b.time);
json(path.join(out,'world.json'),{id:'station-overflow',dt,commands:events.map(event=>event.command)});

const clips={}, stats={}, range={startPoint:T.read(0),endPoint:T.read(duration)};
for(const [mode,voiceBudget] of Object.entries({aggregate:{...base,aggregation},drop:base})){
  const file=path.join(out,mode+'.json');
  json(file,{format:'ink-studio/scene-audio',version:1,world:'world.json',sampleRate,assets,listener,
    spatial:{cues,voiceBudget}});
  const {waves,report}=ink.readSceneAudio(file,{kit}).render(range,{trace:true});
  write(path.join(out,mode+'.wav'),waves.mix);
  const work=report.voiceBudget;
  stats[mode]={voices:work.peakVoices,direct:work.peakDirectVoices??work.peakVoices,streams:work.aggregationStreams??0,
    admitted:work.admitted,aggregated:work.aggregated??0,dropped:work.dropped,stolen:work.stolen,
    bell:work.decisions.filter(row=>row.cue==='bell'&&row.action==='admitted').length};
  if(mode==='aggregate'){
    assert(work.aggregated>200);
    assert.equal(work.aggregationStreams,2);
  }else assert(work.dropped>200);
  assert(work.peakVoices<=base.maxVoices);
  assert.equal(stats[mode].bell,3);
  const compact=WAV.encode(WAV.decode(waves.mix),{encoding:'pcm16'});
  clips[mode]='data:audio/wav;base64,'+compact.toString('base64');
}
const template=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
const info={duration,events:events.map(({time,cue})=>({time,cue})),stats,limit:base.maxVoices,clips};
write(path.join(out,'index.html'),template.replace('/*INK_CROWD_DEMO*/',()=>JSON.stringify(info)));
json(path.join(out,'comparison.json'),{duration,limit:base.maxVoices,stats});
console.log(JSON.stringify(stats,null,2));
