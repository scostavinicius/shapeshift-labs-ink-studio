/* Run sensor rigs on native simulations or existing wave reports. */
const fs=require('node:fs'),path=require('node:path');
const WAV=require('./wav.js'),{embedModels}=require('./simulation-model-files.js');
const wave=require('./wave-network.js');

function run(kit,plan,file,dependency=()=>{}){
  const W=kit.KIT.world,S=W.virtualSensors,{check,record}=W.data,{fields}=W.boundarySignals;
  check(fields(plan,['format','version','rig','source','checkpoint','audio'])&&plan.format===S.runFormat&&
    plan.version===1&&record(plan.source),'Expected a version 1 sensor run');
  function resolve(reference){
    check(reference.length&&!path.isAbsolute(reference)&&!path.win32.isAbsolute(reference),
      'Sensor asset paths must be relative to their run plan');
    const result=path.resolve(path.dirname(path.resolve(file)),reference);
    dependency(result);return result;
  }
  const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const read=value=>typeof value==='string'?json(resolve(value)):value;
  const rig=read(plan.rig), checkpoint=read(plan.checkpoint), source=plan.source;
  if(source.kind==='wave'){
    check(fields(source,['kind','trace','run'])&&(source.trace===undefined)!==(source.run===undefined),
      'Wave sensor run needs a wave trace or run plan');
    const owner=typeof source.run==='string'?resolve(source.run):file;
    const trace=source.trace===undefined?wave.run(kit,typeof source.run==='string'?json(owner):source.run,owner,dependency):
      read(source.trace);
    return S.wave(rig,trace,{checkpoint});
  }
  check(source.kind==='world'&&fields(source,['kind','world','checkpoint','steps','every','bindings','actions','includeWorldCheckpoint'])&&
    (source.world!==undefined||source.checkpoint!==undefined)&&plan.audio===undefined,'Invalid world sensor run');
  const worldCheckpoint=read(source.checkpoint);
  const owner=typeof source.world==='string'?resolve(source.world):file;
  const world=embedModels((typeof source.world==='string'?json(owner):source.world)??worldCheckpoint?.world,owner,dependency);
  const runtime=W.runtime.create(world,{checkpoint:worldCheckpoint});
  if(source.actions!==undefined)runtime.schedule(read(source.actions));
  return S.world(rig,runtime,{steps:source.steps,every:source.every,bindings:source.bindings,checkpoint,
    includeWorldCheckpoint:source.includeWorldCheckpoint});
}

function writeWav(file,report,audio={}){
  const {channels=Object.keys(report.rig.sensors).filter(name=>report.rig.sensors[name].kind==='microphone'),gain=1}=audio;
  if(report.kind!=='wave'||!Array.isArray(channels)||!channels.length||channels.length>8||
    new Set(channels).size!==channels.length||!Array.from(channels).every(name=>Object.hasOwn(report.rig.sensors,name)&&
      report.rig.sensors[name].kind==='microphone')||!Number.isFinite(gain)||gain<=0)
    throw Error('Sensor WAV needs one to eight wave microphones and a positive finite gain');
  const samples=new Float64Array((report.end-report.start)*channels.length);
  for(const [channel,name] of channels.entries()){
    const source=report.readings[name];
    for(let i=0;i<source.length;i++)samples[i*channels.length+channel]=source[i]*gain;
  }
  const encoded=WAV.encode({sampleRate:report.sampleRate,channels:channels.length,samples});
  const destination=path.resolve(file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,encoded);
}
module.exports={run,writeWav};
