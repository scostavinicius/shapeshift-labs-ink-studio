const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {gzipSync}=require('node:zlib'),ink=require('../..'),kit=ink.load(),R=kit.KIT.world.resonantModes;
const modal=require('../../cli/modal-resonator.js'),WAV=require('../../cli/wav.js'),
  {json,write}=require('../../cli/asset-files.js');

const dir=process.argv[2];
if(!dir)throw Error('Use node examples/coupled-resonance/demo.cjs <output-directory>');
const at=name=>path.resolve(dir,name),sampleRate=32000,frames=sampleRate*2.5,breakAt=.57;
function asset(id,modes,joint,strike,listen){
  const site=(gains,x)=>({gains,point:[x,0,0]});
  return R.bake({format:R.planFormat,version:1,id,source:{kind:'authored',
    modes:modes.map(([hz,decay],i)=>({id:'mode-'+(i+1),hz,decay}))},
    excitations:{joint:site(joint,1),strike:site(strike,.28)},pickups:{listen:site(listen,.61)}});
}
const gate=asset('gate',[[194,1.8],[382,3.4],[615,5.9],[936,9.2],[1326,16],[1963,24]],
  [.93,-.46,.29,.21,-.13,.09],[.79,.42,-.32,.23,.29,.22],[.82,.36,-.38,.21,.24,-.13]);
const railing=asset('railing',[[251,2.1],[493,3.2],[722,6],[1119,10.8],[1682,16.8],[2420,28]],
  [.92,.46,-.31,.21,.13,-.10],[.77,-.36,.36,.27,-.24,.21],[.94,-.42,.31,.33,.21,-.18]);
const bodies={gate:{asset:gate,site:'joint'},railing:{asset:railing,site:'joint'}};
const contact={stiffness:2350000,damping:18,slewMs:5,initial:1};
const channels=Object.keys(bodies).map(body=>({body,pickup:'listen'}));
const impulses=[[.06,.93],[.27,.32],[1.28,.72]].map(([time,value])=>({
  body:'gate',excitation:'strike',sample:Math.round(time*sampleRate),fraction:.3,value
}));
const control={format:R.coupledRunFormat,version:1,bodies,contact,settings:{sampleRate},samples:frames,impulses};
const passes={
  release:{...control,levels:[{sample:Math.round(breakAt*sampleRate),level:0}]},
  held:control,
  open:{...control,contact:{...contact,initial:0}}
};
const traces=Object.fromEntries(Object.entries(passes).map(([key,plan])=>[key,modal.run(kit,plan,at('source.json'))]));
let peak=0;
for(const trace of Object.values(traces))for(const body of Object.keys(bodies))
  for(const sample of trace.velocities[body].listen)peak=Math.max(peak,Math.abs(sample));
const gain=.79/peak,audio={gain,channels};
assert(traces.open.velocities.railing.listen.every(sample=>sample===0));
assert(traces.release.velocities.railing.listen.slice(sampleRate*.60,sampleRate*.85).some(x=>Math.abs(x)>.025));
const modes={};
for(const [key,trace] of Object.entries(traces)){
  const pcm=modal.coupledAudio(trace,audio);
  write(at(key+'.wav'),WAV.encode(pcm,{encoding:'pcm24'}));
  const length=200,envelopes=Object.keys(bodies).map(name=>Array.from({length},(_,i)=>{
    const series=trace.velocities[name].listen;
    let sum=0;
    for(let j=i*frames/length;j<(i+1)*frames/length;j++)sum+=series[j]**2;
    return Math.sqrt(sum/(frames/length))*gain;
  }));
  modes[key]={pcm:WAV.encode(pcm,{encoding:'pcm16'}).toString('base64'),envelopes};
  const plan=passes[key];
  json(at(key+'.json'),{...plan, audio,bodies:{gate:{asset:'gate.json',site:'joint'},railing:{asset:'railing.json',site:'joint'}}});
}
json(at('gate.json'),gate);
json(at('railing.json'),railing);
const file=at('release.json'),release=traces.release;
const selection=body=>({body,name:'listen',channel:'velocity',metersPerUnit:1});
json(at('spatial-listening.json'),{format:'ink-studio/physical-audio-run',version:1,
  inputs:{gate:{trace:path.basename(file),selection:selection('gate')},
    railing:{trace:path.basename(file),selection:selection('railing')}},
  plan:{format:kit.KIT.world.physicalAudio.format,version:1,id:'iron-joint',sampleRate,frames,channels:2,
    sources:{gate:{signal:'gate',pcmPerUnit:gain*.7,pan:-.55},railing:{signal:'railing',pcmPerUnit:gain*.7,pan:.55}}}});
json(at('report.json'),{sampleRate,frames,breakAt,peak,gain,impulses,
  endpoint:release.endpoint,coupling:contact,listener:channels});
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const config={sampleRate,bodies,contact,breakAt,duration:frames/sampleRate,modes,gain};
write(at('index.html'),read('review.html').replace('/*INK_PAIR_DATA*/',()=>JSON.stringify(config))
  .replace('/*INK_PAIR_ENGINE*/',()=>JSON.stringify(gzipSync(ink.bundle(),{level:9}).toString('base64')))
  .replace('/*INK_PAIR_SCRIPT*/',()=>read('review.js')));
console.log(JSON.stringify({sampleRate,frames,breakAt,peak,gain,
  gateHz:gate.modes[0].hz,railingHz:railing.modes[0].hz}));
