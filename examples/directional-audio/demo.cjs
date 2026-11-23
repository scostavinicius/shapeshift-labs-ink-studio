const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ink=require('../..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const WAV=require('../../cli/wav.js');
const {write,json}=require('../../cli/asset-files.js');
const {renderPreview}=require('../pinned-binaural/preview.cjs');
const [out,chrome=process.env.INK_TEST_CHROME]=process.argv.slice(2);
if(!out||!chrome)throw Error('Use node examples/directional-audio/demo.cjs <output directory> <Chrome executable>');

const rate=48000, dt=.032, duration=12.8, tau=Math.PI*2;
const listener={at:[0,1.4,-3.2],forward:[0,0,1]};
const points=[[0,0,0,0],[30,0,-.7,-1.4],[60,-.35,-2.8,-7],[90,-1,-5,-16],
  [125,-1.6,-8,-25],[160,-2,-10,-32],[180,-2,-11,-36]]
  .map(([angle,low,mid,high])=>({angle,db:{low,mid,high}}));
const worlds={id:'turntable-cabinet',dt,entities:{speaker:{position:[0,1.4,0],sockets:{driver:[0,0,0]}}},
  systems:{rig:{kind:'mechanics',config:{gravity:[0,0,0],drag:0,bodies:{speaker:{
    position:[0,1.4,0],half:[.38,.62,.29],angular:[0,tau/duration,0]}}}}}};
const spatial={radiationProfiles:{cabinet:{points}},
  cues:{program:{asset:'program',gain:.95,distance:{rolloff:0}}},
  emitters:{cabinet:{cue:'program',at:{entity:'speaker',socket:'driver'},radiation:'cabinet'}}};
const settings={format:'ink-studio/scene-audio',version:1,sampleRate:rate,listener,spatial};
json(path.join(out,'soundtrack.json'),{...settings,assets:{program:'program.wav'},world:'world.json'});
json(path.join(out,'world.json'),worlds);

function program(){
  const beat=.4, samples=new Float32Array(Math.round(4*beat*rate)), notes=[55,65.406,48.999,58.27];
  let seed=826, previous=0;
  for(let i=0;i<samples.length;i++){
    const at=i/rate, step=Math.min(3,Math.floor(at/beat)), t=at-step*beat, f=notes[step];
    const fade=Math.min(1,(beat-t)/.009), attack=1-Math.exp(-t*850);
    const kick=.17*Math.sin(tau*(47*t+1.1*(1-Math.exp(-t*50))))*Math.exp(-t*24)*attack;
    const bass=.25*Math.sin(tau*f*t)*Math.exp(-t*2.8)*(1-Math.exp(-t*80));
    const mt=(t+.23)%beat;
    const tone=(.13*Math.sin(tau*8*f*mt)+.055*Math.sin(tau*15*f*mt))*
      (1-Math.exp(-mt*180))*Math.exp(-mt*12)*Math.min(1,(beat-mt)/.009);
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const noise=seed/2147483648-1;
    const ht=t% .1, hat=(noise-previous)*.14*(1-Math.exp(-ht*750))*Math.exp(-ht*85);
    previous=noise;
    samples[i]=(kick+bass+tone+hat)*fade;
  }
  return {samples,channels:1,sampleRate:rate};
}
const assetBytes=WAV.encode(program(),{encoding:'pcm24'});
write(path.join(out,'program.wav'),assetBytes);
const source=WAV.decode(assetBytes), sequence={startPoint:T.read(0),endPoint:T.read(duration)};
const exported=ink.readSceneAudio(path.join(out,'soundtrack.json'),{kit}).render(sequence);
const omni={...spatial,emitters:{cabinet:{...spatial.emitters.cabinet,radiation:false}}};
const reference=ink.createSceneAudio({...settings,spatial:omni},{kit,resolveAsset:()=>source,runtime:()=>W.runtime.create(worlds)})
  .render(sequence);
assert.equal(exported.report.headroom,1);
assert.equal(reference.report.headroom,1);

async function demo(){
  const run=W.runtime.create(worlds), mixer=W.spatialAudio.create(spatial), frames=[], trace=[];
  for(let tick=0;tick<=duration/dt;tick++){
    const time=tick*dt, frame=mixer.frame({query:run.query(),listener,time});
    const {radiation,bands,distance}=frame.active[0];
    trace.push({time,...radiation,bands,distance});
    if(time<duration)frames.push({...frame,time:(Math.round(time*rate)+.25)/rate});
    if(time<duration)run.step();
  }
  assert(Math.abs(trace[200].angle-180)<1e-4);
  assert.equal(trace[200].distance,trace[0].distance);
  const browser=await renderPreview(chrome,{rate,length:Math.round(duration*rate),frames,source:Array.from(source.samples),
    panning:'equalpower',smoothing:.022});
  const primary=WAV.decode(exported.waves.mix), original=WAV.decode(reference.waves.mix);
  const score=(data,from,to)=>{
    let sum=0;
    for(let i=Math.round(from*rate)*2;i<Math.round(to*rate)*2;i++)sum+=data[i]**2;
    return sum/((to-from)*rate*2);
  };
  const left=6.4-.4, right=6.4+.4;
  const reduction=10*Math.log10(score(browser,left,right)/score(original.samples,left,right));
  assert(reduction<-2&&reduction>-18,'The rotating source should retain bass at the back');
  const preview={samples:browser,channels:2,sampleRate:rate};
  write(path.join(out,'preview.wav'),WAV.encode(preview,{encoding:'pcm24'}));
  write(path.join(out,'export.wav'),exported.waves.mix);
  write(path.join(out,'omni.wav'),reference.waves.mix);
  json(path.join(out,'radiation-trace.json'),{duration,rate,points,trace,rearBroadbandReductionDb:reduction});
  const clip=pcm=>'data:audio/wav;base64,'+WAV.encode(pcm,{encoding:'pcm16'}).toString('base64');
  const data={duration,dt,points,trace,rearBroadbandReductionDb:reduction,clips:{directional:clip(preview),omni:clip(original)}};
  const template=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
  write(path.join(out,'index.html'),template.replace('/*INK_RADIATION_DEMO*/',()=>JSON.stringify(data).replaceAll('<','\\u003c')));
  console.log('Rear window broadband level relative to the omni comparison: '+reduction.toFixed(2)+' dB.');
  assert.equal(primary.samples.length,browser.length);
}
demo().catch(error=>{console.error(error.stack);process.exitCode=1;});
