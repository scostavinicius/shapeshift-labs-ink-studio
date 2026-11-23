/* Run: node examples/music-production/foley-workshop.cjs output-directory [radio.wav] */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),{world,procedural:{takeTime:T,mediaGraph:A}}=kit.KIT;
const WAV=require('../../cli/wav'),{write,json}=require('../../cli/asset-files');
const folder=path.resolve(process.argv[2] ?? 'foley-workshop'),out=name=>path.join(folder,name);
const fps=30,rate=32000,sim=120,frames=135,duration=frames/fps,tau=Math.PI*2;
const at=secs=>Math.round(secs*rate);
const audio=(seconds,channels=1)=>({sampleRate:rate,channels,samples:new Float64Array(at(seconds)*channels)});
const wave=(seconds,fn)=>{
  const pcm=audio(seconds);
  for (let i=0;i<pcm.samples.length;i++) pcm.samples[i]=fn(i/rate,i);
  return pcm;
};
const decode=name=>ink.readWav(path.join(__dirname,'samples',name+'.wav')).samples;
const sounds=Object.fromEntries(['metal-soft','metal-alt','metal-hit','snare-ghost'].map(name=>[name,decode(name)]));
const osc=(t,hz,decay,amplitude)=>t<0 ? 0 : amplitude*Math.cos(tau*hz*t)*Math.exp(-t*decay);
const tap=(name,t,multiplier=1)=>t<0 ? 0 : (sounds[name][at(t*multiplier)] ?? 0);
function noise(i,seed) {
  let x=Math.imul(i+17,0x9e3779b1)^seed;
  x=Math.imul(x^(x>>>16),0x7feb352d);
  return ((x^(x>>>15))>>>0)/2147483648-1;
}
function near(material,action,variant) {
  const lift=.075, pin=lift+.012*variant, length=action==='latch' ? 1 : .64;
  const sound=wave(length,(t,i)=>{
    const x=t-pin;
    if (x<0) return .015*(noise(i,1173)-noise(i-1,1173))*
      Math.max(0,Math.sin(Math.PI*(t-.020)/(pin-.020)))*Number(t>=.020);
    const shift=variant ? 1.12 : 1, grit=noise(i,629+variant);
    if (material==='oak') return osc(x,107*shift,33,.37)+osc(x,198*shift,61,.17)+
      osc(x,498*shift,68,.13)+.09*grit*Math.exp(-x*120)+.19*tap('snare-ghost',x,1.22);
    if (material==='gravel') return osc(x,143*shift,46,.26)+.28*grit*Math.exp(-x*34)+
      .17*tap('snare-ghost',x-.035,1.65)+.15*tap('snare-ghost',x-.091,1.36);
    if (action==='step') return osc(x,131*shift,27,.29)+osc(x,408*shift,33,.12)+
      .56*tap(variant ? 'metal-alt' : 'metal-soft',x,1.37);
    return osc(x,131*shift,17,.31)+osc(x,341*shift,5.4,.15)+osc(x,621*shift,7.2,.16)+
      osc(x,947*shift,8.4,.081)+.79*tap(variant ? 'metal-hit' : 'metal-alt',x,1.05)+
      .19*tap('metal-soft',x-.115,.80);
  });
  return {sound,pin:at(pin)};
}
function far({sound,pin},variant) {
  const delay=at(.027+.004*variant), tail=at(.16), n=sound.samples.length, pcm=audio((n+delay+tail)/rate,2);
  const filtered=new Float64Array(n);
  let memory=0;
  for (let i=0;i<n;i++) {
    memory+=.42*(sound.samples[i]-memory);
    filtered[i]=memory;
  }
  const paths=[
    [[0,.56],[.019,.27],[.031,-.092],[.046,.17],[.075,.12],[.121,-.077],[.154,.046]],
    [[0,.46],[.012,.24],[.037,.146],[.059,-.105],[.073,.132],[.096,.086],[.141,-.052]]
  ];
  for (let c=0;c<2;c++) for (const [time,level] of paths[c]) {
    const begin=delay+at(time);
    for (let i=0;i<n;i++) pcm.samples[2*(i+begin)+c]+=filtered[i]*level;
  }
  return {sound:pcm,pin:pin+delay};
}
const bank={},sourceEdits={},materials={};
function save(name,pcm) {
  bank[name]=name+'.wav';
  write(out(bank[name]),WAV.encode(pcm,{encoding:'pcm24'}));
}
function offer(material,action) {
  const choices={};
  for (const [variant,label] of ['one','two'].entries()) {
    const close=near(material,action,variant), pair={close,distant:far(close,variant)};
    choices[label]=Object.fromEntries(Object.entries(pair).map(([side,{sound,pin}])=>{
      const asset=[material,action,label,side].join('-');
      save(asset,sound);
      sourceEdits[asset]=A.sampleEdit.edit(A.sampleEdit.create(sound,{source:{id:asset}}),[
        {op:'add',id:'strike',at:pin,kind:'attack'}
      ]);
      return [side,{asset,sync:{marker:'strike'},fromSample:at(.022),toSample:sound.samples.length/sound.channels}];
    }));
  }
  (materials[material] ??= {})[action]=choices;
}
offer('oak','step');
offer('gravel','step');
offer('steel','step');
offer('steel','latch');

const contacts=[
  [107,'oak','step',.79],[162,'oak','step',.9],[218,'gravel','step',.88],
  [268,'steel','step',.78],[373,'steel','latch',.93]
];
const runtime=world.runtime.create({dt:1/sim,commands:contacts.map(([tick,material,action,strength])=>({
  tick,action:'world/event',args:{kind:'surface-contact',material,action,strength}
}))});
const events=[];
runtime.advance(duration*sim,{onTick:()=>events.push(...runtime.events.filter(row=>row.kind==='surface-contact'))});
assert.deepEqual(events.map(row=>row.tick),contacts.map(([tick])=>tick));
const binding={id:'contact',on:{kind:'surface-contact'}};
const picture={fps,shots:[{id:'walk-in',frames:frames}]};
const source={kit:{id:'sluice-foley',materials},picture,world:{simulationRate:sim,events,
  aliases:{latch:events.at(-1).id}},sampleRate:rate,bindings:[binding],sourceEdits,seed:347};
const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
  'music','editorial',...args],{encoding:'utf8'}));
const choices={};
for (const perspective of ['close','distant']) {
  json(out('kit-'+perspective+'.json'),{foley:{...source,perspective},assets:bank});
  choices[perspective]=cli('spot-foley',out('kit-'+perspective+'.json'),'--out',out('project-'+perspective+'.json'));
}
const original=choices.close.report.contacts, distant=choices.distant.report.contacts;
assert.deepEqual(original.map(({clip,performance,spot})=>[clip,performance,spot.sample]),
  distant.map(({clip,performance,spot})=>[clip,performance,spot.sample]));
const latch=distant.at(-1), replacement='distant-'+(latch.performance==='one' ? 'two' : 'one'), editedFrame=97;
const selected=JSON.parse(fs.readFileSync(choices.distant.project,'utf8')).session.clips.at(-1).takes[replacement];
const tail=sourceEdits[selected.asset].markers[0].at+at(.125);
json(out('changes.json'),[
  {op:'spot',clip:latch.clip,spot:{frame:editedFrame}},
  {op:'take',clip:latch.clip,take:replacement},
  {op:'stretch-tail',clip:latch.clip,tail:{fromSample:tail,factor:1.85,mode:'tones',joinSamples:at(.022)}},
  {op:'fades',clip:latch.clip,fades:{inSamples:at(.018),outSamples:at(.18),curve:'equal-power'}}
]);
choices.edited=cli('edit',choices.distant.project,out('changes.json'),'--out',out('project-edited.json'));
const edit=choices.edited.report.clips.at(-1);
assert.equal(edit.spot.frame,editedFrame);
assert.equal(edit.source.tail.factor,1.85);
assert.equal(edit.take,replacement);

save('relay',wave(.37,(t,i)=>osc(t,731,31,.16)+osc(t,1097,23,.077)+
  .033*noise(i,811)*Math.exp(-t*99)+osc(t-.089,951,49,.065)));
save('room',wave(duration,(t,i)=>(.026*Math.sin(tau*54*t+.25*Math.sin(tau*.31*t))+
  .015*Math.cos(tau*71*t)*(.54+.46*Math.sin(tau*.79*t)) +
  .008*(noise(i,77)+noise(i-1,77)))*Math.min(1,t*7,(duration-t)*6)));
save('score',wave(duration,t=>{
  const inTime=Math.max(0,t-.22), envelope=Math.min(1,inTime*2.6,(duration-t)*3);
  const one=.016*Math.sin(tau*146.83*inTime)+.018*Math.sin(tau*110*inTime)+.008*Math.sin(tau*220.7*inTime);
  const second=t>2.8 ? .018*Math.sin(tau*65.41*(t-2.8))*Math.min(1,(t-2.8)*2) : 0;
  return envelope*(one+second);
}));
const impulse=audio(.41,2);
for (const [c,channel] of [[[.004,.55],[.017,.29],[.039,-.18],[.074,.13],[.16,-.07]],
  [[.006,.49],[.026,.31],[.044,.16],[.071,-.11],[.14,.093]]].entries()) {
  for (const [time,level] of channel) impulse.samples[2*at(time)+c]=level;
  for (let i=at(.010);i<impulse.samples.length/2;i+=11)
    impulse.samples[2*i+c]+=.013*noise(i,145+c*19)*Math.exp(-i/rate*9);
}
save('tunnel-ir',impulse);
const radio=process.argv[3];
if (radio) save('radio',ink.readWav(radio));
function stage(name) {
  const far=name!=='close', pathName='scene-'+name+'.json';
  json(out(pathName),{format:'ink-studio/scene-audio',version:1,sampleRate:rate,
    assets:{foley:{editorial:path.basename(choices[name].project)},ambience:bank.room,music:bank.score,
      relay:bank.relay,tunnel:bank['tunnel-ir'],...(radio && {dialogue:bank.radio})},
    tracks:[{asset:'foley',bus:'foley'},{asset:'ambience',bus:'ambience'},{asset:'music',bus:'music'},
      {asset:'relay',bus:'effects',time:3.78},...(radio ? [{asset:'dialogue',bus:'dialogue',time:.14}] : [])],
    post:{assets:{tunnel:'tunnel'},strips:{
      dialogue:{inserts:['radio-low','radio-high'],fader:.58},
      foley:{inserts:far ? ['distance'] : ['detail'],sends:{room:{level:far ? .37 : .085}},fader:far ? .92 : .93},
      effects:{sends:{room:{level:.38}},pan:.33},ambience:{fader:far ? 1.1 : .62},music:{fader:.61},room:{inserts:['reflections']}
    },processors:{
      'radio-low':{type:'highpass',hz:310},'radio-high':{type:'lowpass',hz:4200},
      distance:{type:'lowpass',hz:7500},
      detail:{type:'eq',bands:[{mode:'peak',hz:1300,q:.7,gainDb:1.4}]},
      reflections:{type:'convolution',impulse:'tunnel',wet:1}
    }}
  });
  const loaded=ink.readSceneAudio(out(pathName),{kit});
  const result=loaded.render({startPoint:T.read(0),endPoint:T.read(duration)});
  for (const [bus,wav] of Object.entries(result.waves)) write(out('mixes/'+name+'/'+bus+'.wav'),wav);
  json(out('mixes/'+name+'/report.json'),result.report);
  assert.deepEqual(Object.keys(result.report.stems),['dialogue','foley','effects','ambience','music']);
}
for (const name of ['close','distant','edited']) stage(name);
json(out('demo.json'),{fps,rate,duration,spots:original.map(row=>({material:row.material,action:row.action,
  frame:row.spot.frame,sample:row.spot.sample,tick:row.spot.tick})),
  originalFrame:latch.spot.frame,editedFrame,editedSample:edit.spot.sample,tailFactor:edit.source.tail.factor,
  replacement,originalTake:latch.take});
console.log(JSON.stringify({directory:folder,frames,originalFrame:latch.spot.frame,editedFrame}));
