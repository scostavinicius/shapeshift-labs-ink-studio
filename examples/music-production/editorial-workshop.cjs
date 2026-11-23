/* Run: node examples/music-production/editorial-workshop.cjs output-directory */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),{world,procedural:{mediaGraph:A}}=kit.KIT;
const WAV=require('../../cli/wav'),{write,json}=require('../../cli/asset-files');
const folder=path.resolve(process.argv[2] ?? 'editorial-workshop'), at=name=>path.join(folder,name);
const fps=30,sampleRate=32000,simulationRate=120,tau=Math.PI*2;
const sample=seconds=>Math.round(seconds*sampleRate);
const wav=(seconds,fn)=>({sampleRate,channels:1,samples:Float64Array.from(
  {length:sample(seconds)},(_,i)=>fn(i/sampleRate))});
const metal=Object.fromEntries(['soft','hit','alt'].map(name=>[name,ink.readWav(path.join(__dirname,'samples','metal-'+name+'.wav')).samples]));
function strike(name,t,level=1,rate=1) {
  const n=Math.round(t*rate*sampleRate);
  return n>=0 ? (metal[name][n] ?? 0)*level : 0;
}
function decay(t,hz,k,level) {
  return t>=0 ? level*Math.cos(tau*hz*t)*Math.exp(-k*t) : 0;
}
const pins={steel:.47,ceramic:.35,relay:.11,room:0};
const audio={
  steel:wav(1.36,t=>{
    const k=t-pins.steel;
    return strike('soft',k+.35,.66,1.16)+strike('alt',k+.27,.5,1.57)+strike('soft',k+.19,.53,1.26)+
      decay(k+.35,198,27,.10)+decay(k+.27,309,29,.074)+decay(k+.19,163,24,.054)+
      strike('hit',k,1.18)+decay(k,167,12,.33)+decay(k,1857,27,.10);
  }),
  ceramic:wav(1.25,t=>{
    const k=t-pins.ceramic;
    return strike('alt',k+.13,.34,.82)+strike('soft',k,.47,.76)+decay(k,222,15,.24)+
      decay(k-.12,661,8,.17)+decay(k-.12,932,9,.12)+
      decay(k-.25,537,8,.12)+decay(k-.25,805,9,.077);
  }),
  relay:wav(.75,t=>{
    const k=t-pins.relay;
    return strike('alt',k,.64,1.64)+decay(k,843,15,.4)+decay(k,610,10,.10)+decay(k-.085,1047,13,.17);
  }),
  room:wav(4.6,t=>(.048*Math.sin(tau*49*t+.26*Math.sin(tau*.51*t))+
    .018*Math.sin(tau*71*t)*Math.cos(tau*1.71*t)+.009*Math.sin(tau*123*t))*(.67+.33*Math.sin(tau*.32*t)))
};
const assets={},sourceEdits={};
for (const [id,sound] of Object.entries(audio)) {
  assets[id]=id+'.wav';
  write(at(assets[id]),WAV.encode(sound,{encoding:'pcm24'}));
  sourceEdits[id]=A.sampleEdit.edit(A.sampleEdit.create(sound,{source:{id}}),[
    {op:'add',id:'contact',at:sample(pins[id]),kind:'attack'}
  ]);
}

const original={fps,shots:[{id:'approach',frames:30},{id:'latch',frames:39},{id:'gate',frames:51}]};
const newCut={fps,shots:[{id:'approach',frames:51},{id:'latch',inFrame:3,frames:36},{id:'gate',frames:51}]};
function ledger(cut) {
  const opening=cut.shots[0].frames+cut.shots[1].frames;
  const latchTick=(opening+14)*simulationRate/fps+1;
  const runtime=world.runtime.create({dt:1/simulationRate,systems:{gate:{kind:'gate'}}},{
    implementations:{gate:()=>({
      contract:{emits:['relay-closed']},initial:()=>0,
      step(_,ctx){if (ctx.tick===latchTick) ctx.emit('relay-closed',{contact:'gate-open'});return ctx.tick;}
    })}
  });
  const events=[];
  runtime.advance(latchTick,{onTick:()=>events.push(...runtime.events)});
  const relay=events.find(row=>row.kind==='relay-closed');
  assert.equal(relay.tick,latchTick);
  return {simulationRate,events,aliases:{'gate-open':relay.id}};
}
const source=(asset,from,to,handleStart,handleEnd)=>({asset,sync:{marker:'contact'},fromSample:sample(from),
  toSample:sample(to),...(handleStart!==undefined && {handles:{fromSample:sample(handleStart),toSample:sample(handleEnd)}})});
const session={
  format:'ink-studio/audio-editorial',version:1,id:'latch-room',sampleRate,picture:original,world:ledger(original),
  map:{tempo:96},sourceEdits,clips:[
    {id:'latch',track:'mechanism',spot:{shot:'latch',sourceFrame:12},take:'steel',
      takes:{steel:source('steel',.14,1.18,.012,1.35),ceramic:source('ceramic',.025,1.12)},
      fades:{inSamples:sample(.013),outSamples:sample(.18),curve:'equal-power'}},
    {id:'relay',track:'mechanism',spot:{event:'gate-open'},take:'bell',
      takes:{bell:source('relay',.11,.73)},gain:.76,fades:{outSamples:sample(.15)}},
    {id:'room',track:'ambience',spot:{samples:0},take:'bed',
      takes:{bed:source('room',0,4.6)},fades:{inSamples:sample(.20),outSamples:sample(.48)}}
  ]
};
const changes=[
  {op:'trim',clip:'latch',fromSample:sample(.115),toSample:sample(1.24)},
  {op:'slip-head',clip:'latch',slip:{samples:-sample(.085),joinSamples:sample(.055)}},
  {op:'comp',clip:'latch',ranges:[{take:'ceramic',fromOffset:sample(.07),toOffset:sample(.57),
    fadeSamples:sample(.042),curve:'equal-power'}]}
];
json(at('source.json'),{session,assets});
json(at('edits.json'),changes);
json(at('cut.json'),{picture:newCut,world:ledger(newCut)});
const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
  'music','editorial',...args],{encoding:'utf8'}));
const baseline=cli('render',at('source.json'),'--out',at('original'),'--stems');
const project=cli('edit',at('source.json'),at('edits.json'),'--out',at('edited.json'));
const edited=cli('render',project.project,'--out',at('edited'),'--stems');
const preview=cli('reconform',project.project,at('cut.json'),'--out',at('reconform'));
const final=cli('render',preview.project,'--out',at('new-cut'),'--stems');
const report=name=>JSON.parse(fs.readFileSync(name,'utf8'));
const baseReport=report(baseline.report), editReport=report(edited.report), reReport=report(preview.report);
assert.equal(baseReport.clips[0].spot.sample,editReport.clips[0].spot.sample);
assert.equal(reReport.changes[0].shiftSamples,19200);
assert.equal(reReport.changes[1].shiftSamples,19200);
assert.deepEqual(fs.readFileSync(final.mix),fs.readFileSync(preview.after));
const before=ink.readWav(baseline.stems.mechanism).samples, after=ink.readWav(edited.stems.mechanism).samples;
const pin=editReport.clips[0].spot.sample*2;
assert(before[pin]>.2);
assert.deepEqual(before.slice(pin,pin+sample(.06)*2),after.slice(pin,pin+sample(.06)*2));
assert.notDeepEqual(before.slice(pin-sample(.20)*2,pin),after.slice(pin-sample(.20)*2,pin));
assert.notDeepEqual(before.slice(pin+sample(.14)*2,pin+sample(.35)*2),after.slice(pin+sample(.14)*2,pin+sample(.35)*2));

json(at('soundtrack.json'),{format:'ink-studio/scene-audio',version:1,sampleRate,
  assets:{editorial:'new-cut/mix.wav'},tracks:[{asset:'editorial',time:0}]});
const scene=ink.readSceneAudio(at('soundtrack.json'),{kit}), T=kit.KIT.procedural.takeTime;
const played=scene.capture({startPoint:T.read(0),endPoint:T.div(T.read(reReport.after.pictureFrames),T.read(fps))},
  {source:{kind:'stem',name:'tracks'}}).value;
assert.deepEqual(played.samples,Float32Array.from(ink.readWav(final.mix).samples));
json(at('demo.json'),{fps,sampleRate,original,newCut,slipMilliseconds:85,
  reports:[baseReport,editReport,reReport.after],reconform:reReport.changes});
console.log(JSON.stringify({original:baseline.mix,edited:edited.mix,revised:final.mix,report:preview.report}));
