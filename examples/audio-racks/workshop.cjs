/* Run: node examples/audio-racks/workshop.cjs output [CLAP-fixture-manifest.json] */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {KIT:K}=require('../..').load(), {write,json}=require('../../cli/asset-files'),WAV=require('../../cli/wav');
const at=file=>path.resolve(process.argv[2] ?? 'rack-workshop',file);
const cli=path.resolve(__dirname,'../../cli/ink-studio.js'), fixtures=process.argv[3] && path.resolve(process.argv[3]);
const rate=24000,tempo=116,beat=60/tempo,tau=2*Math.PI,frames=seconds=>Math.round(seconds*rate);
const length=frames(6*beat), stereo=()=>new Float64Array(length*2);
const drums=stereo(), keys=stereo(), metal=stereo(), key=stereo();
function lay(target,time,span,pan,fn) {
  const start=frames(time), size=Math.min(frames(span),length-start), left=Math.sqrt(1-pan), right=Math.sqrt(1+pan);
  for (let i=0;i<size;i++) {
    const value=fn(i/rate,i)*Math.min(1,i/36,(size-i)/240), index=2*(i+start);
    target[index]+=value*left;target[index+1]+=value*right;
  }
}
function hit(target,name,atBeat,gain,pan) {
  const sample=WAV.read(path.join(__dirname,'../music-production/samples',name+'.wav'));
  const peak=sample.samples.reduce((max,x)=>Math.max(max,Math.abs(x)),0);
  lay(target,atBeat*beat,Math.min(.39,sample.samples.length/sample.sampleRate),pan,t=>
    gain*(sample.samples[Math.floor(t*sample.sampleRate)] ?? 0)/peak);
}
for (const [time,gain] of [[0,.46],[1.44,.32],[2.58,.44],[3.79,.25],[4.01,.45],[5.39,.32]]) {
  lay(drums,time*beat,.23,0,t=>gain*Math.sin(tau*(48*t+1.25*(1-Math.exp(-70*t))))*Math.exp(-t*20));
  lay(key,time*beat,.19,0,t=>.71*Math.exp(-t*6));
}
for (const [time,gain] of [[1.03,.29],[2.72,.10],[3.04,.33],[5.035,.27]]) hit(drums,'snare-rim',time,gain,.03);
for (const [i,time] of [.46,.77,1.49,1.81,2.47,3.44,3.73,4.41,4.78,5.52,5.79].entries())
  hit(drums,i%3 ? 'hat-closed' : 'hat-closed-alt',time,i%3 ? .065 : .11,i%2 ? .38 : -.3);
for (const [position,notes,gain] of [[.16,[57,64,71],.16],[1.34,[60,67],.17],[2.31,[55,62,69],.14],
  [3.16,[57,64,74],.15],[4.61,[53,60,67,76],.14]]) {
  for (const [i,note] of notes.entries()) {
    const hz=440*2**((note-69)/12);
    lay(keys,position*beat+i*.013,.47-i*.027,(i-1)*.37,t=>{
      const phase=tau*hz*t+.20*Math.sin(tau*hz*2.01*t)*Math.exp(-t*16);
      return gain*(Math.sin(phase)*.69+.24*Math.sin(tau*hz*2*t)*Math.exp(-t*8))*Math.exp(-t*4.8);
    });
  }
}
for (const [i,time] of [.12,.53,1.37,2.82,3.59,4.79,5.44].entries()) {
  hit(metal,i%2 ? 'metal-soft' : 'metal-alt',time,i%3===0 ? .19 : .115,i%2 ? .26 : -.32);
  const hz=[220,247,330,294,220,262,330][i];
  lay(metal,time*beat+.014,.29,i%2 ? -.12 : .2,t=>.13*Math.sin(tau*hz*t+.26*Math.sin(tau*hz*3*t))*Math.exp(-t*9));
}
for (const [id,samples] of Object.entries({drums,keys,metal,key})) {
  const max=samples.reduce((peak,x)=>Math.max(peak,Math.abs(x)),.9);
  write(at(id+'.wav'),WAV.encode({sampleRate:rate,channels:2,samples:samples.map(x=>x*.9/max)},{encoding:'pcm24'}));
}
const curve=(...points)=>({unit:'beats',points:points.map(([at,value])=>({at,value}))});
const takes=[
  ['steel-bus','Steel Bus','Breakbeat', 'Harder attacks and a dense parallel drum body.',{main:'drums.wav'},
    {macros:{attack:.67,weight:curve([0,.42],[5,.71])}},6.25],
  ['porcelain-room','Porcelain Room','Electric keys','Alternating echoes open into a dark stereo room.',{main:'keys.wav'},
    {macros:{distance:.76,shade:.58}},8.5],
  ['pocket-repeater','Pocket Repeater','Metal and tone','Beat-timed repeats, sampler grain and tape drift.',{main:'metal.wav'},
    {macros:{clock:curve([0,.38],[3,.64],[5.8,.33]),ghost:.60}},7],
];
const args=fixtures ? ['--clap-host',fixtures] : [];
const run=(...argv)=>JSON.parse(execFileSync(process.execPath,[cli,'music','rack',...argv],{encoding:'utf8'}));
if (fixtures) {
  json(at('relay-initial.json'),{sampleRate:rate,parameters:{6:.75}});
  const saved=run('plugin-state','relay',at('relay-initial.json'),...args,'--out',at('relay-state.json'));
  json(at('relay-key.json'),{format:'ink-studio/audio-rack',version:1,id:'relay-key',revision:1,title:'Relay Key',
    inputs:{main:'program',key:'trigger'},output:'master',
    strips:{program:{inserts:[{processor:'relay',sidechain:{strip:'trigger'}}]},
      trigger:{output:null},master:{}},processors:{relay:{type:'external',adapter:'clap',...saved,
        parameters:{6:curve([0,.75],[2,.75],[2.25,1.12],[5.5,.88])}}},
    taps:{program:{strip:'program'}}});
  takes.push([at('relay-key.json'),'Relay Key','Electric keys + silent drum key',
    'An external CLAP insert ducks the keys and recalls its saved trim.',{main:'keys.wav',key:'key.wav'},{},6.25]);
}
const M=K.procedural.mediaGraph.mixerMonitor, passes=[];
for (const [name,title,source,detail,assets,state,beats] of takes) {
  const id=path.basename(name,'.json'), recipe=at(id+'-recipe.json');
  json(recipe,{assets,state,options:{sampleRate:rate,map:{tempo},end:{beat:beats},tail:'cut',targetLufs:-19}});
  const rendered=run('audition',name,recipe,...args,'--out',at(id));
  const report=JSON.parse(fs.readFileSync(rendered.report,'utf8'));
  const wet=WAV.read(rendered.rack), bypass=WAV.read(rendered.bypass);
  assert.equal(wet.samples.length,bypass.samples.length);
  const raw=M.meter(bypass), mixed=M.meter(wet);
  assert(Math.abs(raw.integratedLufs-mixed.integratedLufs)<.0002);
  passes.push({id,title,source,detail,seconds:report.frames/rate,latency:report.mixer.latencySamples,
    matchingLufs:report.matchingLufs,files:[id+'/bypass.wav',id+'/rack.wav']});
}
json(at('demo.json'),{title:'Three Racks and a Relay',tempo,sampleRate:rate,passes});
console.log(JSON.stringify(passes));
