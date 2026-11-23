/* Render sample-aligned contact traces and an optional force projection. */
const fs=require('node:fs'),path=require('node:path');
const WAV=require('./wav.js');

function run(kit,plan,file,dependency=()=>{}){
  const W=kit.KIT.world,E=W.contactExciters,{check}=W.data;
  const {samples,checkpoint}=plan??{};
  check(plan?.format===E.runFormat&&plan.version===1&&Number.isSafeInteger(samples)&&samples>=1&&samples<=262144,
    'Expected a bounded version 1 contact excitation run');
  function read(value){
    if(typeof value!=='string')return value;
    check(value.length&&!path.isAbsolute(value)&&!path.win32.isAbsolute(value),'Contact assets must be relative to the run');
    const location=path.resolve(path.dirname(path.resolve(file)),value);
    dependency(location);
    return JSON.parse(fs.readFileSync(location,'utf8'));
  }
  const engine=E.prepare(read(plan.excitation)), {info}=engine;
  check(samples*info.tracks.length<=500000,'Contact trace exceeds its output sample budget');
  if(checkpoint!==undefined)engine.restore(read(checkpoint));
  const names=info.tracks.map(row=>row.name), start=engine.view().sample, events=[];
  const signals=['point','slip','impulse','force'];
  const tracks=Object.fromEntries(names.map(name=>[name,{active:new Uint8Array(samples),
    ...Object.fromEntries(signals.map(key=>[key,new Float64Array(samples*3)]))}]));
  for(let at=0;at<samples;at+=4096){
    const block=engine.process(Math.min(samples-at,4096));
    check(events.length+block.events.length<=65536,'Contact trace exceeds its event budget');
    events.push(...block.events);
    for(const name of names){
      tracks[name].active.set(block.tracks[name].active,at);
      for(const key of signals)tracks[name][key].set(block.tracks[name][key],at*3);
    }
  }
  const json=Object.fromEntries(names.map(name=>[name,Object.fromEntries(Object.entries(tracks[name])
    .map(([key,value])=>[key,Array.from(value)]))]));
  return {format:E.traceFormat,version:1,info,start,end:start+samples,events,tracks:json,checkpoint:engine.snapshot()};
}

function writeWav(file,trace,{track=trace.info.tracks[0].name,axis=[0,1,0],gain=1}={}){
  const series=Object.hasOwn(trace.tracks,track)?trace.tracks[track].force:null;
  const length=Array.isArray(axis)&&axis.length===3&&axis.every(Number.isFinite)?Math.hypot(...axis):NaN;
  if(!series||!Number.isFinite(length)||length===0||!Number.isFinite(gain)||gain<=0)
    throw Error('Contact force audition needs a known track, nonzero axis, and positive gain');
  const normal=axis.map(value=>value/length);
  const samples=Float64Array.from({length:series.length/3},(_,i)=>
    gain*(series[i*3]*normal[0]+series[i*3+1]*normal[1]+series[i*3+2]*normal[2]));
  const encoded=WAV.encode({sampleRate:trace.info.sampleRate,channels:1,samples});
  const destination=path.resolve(file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,encoded);
}
module.exports={run,writeWav};
