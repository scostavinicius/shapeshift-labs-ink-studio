/* Render portable wave traces and an explicitly scaled pressure audition. */
const fs=require('node:fs'), path=require('node:path');
const WAV=require('./wav.js');

function run(kit,plan,file,dependency=()=>{},diagnostics){
  const W=kit.KIT.world, N=W.waveNetworks, {check,record}=W.data;
  const {settings={},samples,inputs={},checkpoint,maxTotalWork=400000000}=plan??{};
  check(plan?.format===N.runFormat&&plan.version===1&&record(inputs)&&
    Number.isSafeInteger(samples)&&samples>=1&&samples<=262144&&Number.isSafeInteger(maxTotalWork)&&
    maxTotalWork>=1&&maxTotalWork<=2000000000,'Expected a bounded version 1 wave run');
  function read(value){
    if(typeof value!=='string')return value;
    check(value.length&&!path.isAbsolute(value)&&!path.win32.isAbsolute(value),'Wave assets must be relative to the run');
    const location=path.resolve(path.dirname(path.resolve(file)),value);
    dependency(location);
    return JSON.parse(fs.readFileSync(location,'utf8'));
  }
  const conditions=require('./boundary-conditions.js').resolve(settings?.conditions,file,dependency);
  const wave=N.prepare(read(plan.network),conditions===undefined?settings:{...settings,conditions},{diagnostics}), {info}=wave;
  check(samples*info.probes.length<=1000000,'Wave run exceeds its output sample budget');
  check(samples*info.workPerSample<=maxTotalWork,'Wave run exceeds its total work limit');
  if(checkpoint!==undefined)wave.restore(read(checkpoint));
  const start=wave.view().sample, keys=new Set(info.sources.map(row=>row.name));
  check(Object.keys(inputs).every(name=>keys.has(name)),'Invalid wave run source');
  const drives=Object.fromEntries(Object.entries(inputs).map(([name,value])=>{
    if(Number.isFinite(value))return [name,value];
    if(Array.isArray(value)){
      check(value.length===samples&&Array.from(value).every(Number.isFinite),'Wave run source needs a value per sample: '+name);
      return [name,Float64Array.from(value)];
    }
    check(record(value)&&Object.keys(value).every(k=>['value','impulses'].includes(k))&&Number.isFinite(value.value??0)&&
      Array.isArray(value.impulses)&&value.impulses.length<=4096,'Invalid wave impulse source '+name);
    const track=new Float64Array(samples).fill(value.value??0);
    for(const imp of value.impulses){
      check(Number.isSafeInteger(imp?.sample)&&imp.sample>=start&&imp.sample<start+samples&&
        Number.isFinite(imp.value),'Invalid wave impulse at '+name);
      track[imp.sample-start]+=imp.value;
      check(Number.isFinite(track[imp.sample-start]),'Wave impulse sum exceeded numeric range');
    }
    return [name,track];
  }));
  const channel=()=>Object.fromEntries(info.probes.map(name=>[name,new Float64Array(samples)]));
  const pressure=channel(),flow=channel();
  const block=Math.min(4096,Math.floor(info.maxWork/info.workPerSample));
  check(block>=1,'Wave run work limit cannot process one sample');
  for(let at=0;at<samples;at+=block){
    const count=Math.min(block,samples-at);
    const input=Object.fromEntries(Object.entries(drives).map(([name,value])=>
      [name,typeof value==='number'?value:value.subarray(at,at+count)]));
    const result=wave.process(count,{inputs:input});
    for(const name of info.probes){
      pressure[name].set(result.pressure[name],at);
      flow[name].set(result.flow[name],at);
    }
  }
  const json=rows=>Object.fromEntries(Object.entries(rows).map(([name,value])=>[name,Array.from(value)]));
  return {format:N.traceFormat,version:1,info,start,end:start+samples,pressure:json(pressure),
    flow:json(flow),checkpoint:wave.snapshot(),...(wave.diagnostics&&{diagnostics:wave.diagnostics()})};
}

function writeWav(file,report,{probe=report.info.probes[0],gain=1}={}){
  const series=Object.hasOwn(report.pressure,probe)?report.pressure[probe]:null;
  if(!series||!Number.isFinite(gain)||gain<=0)throw Error('Wave audition needs a known pressure probe and positive gain');
  const samples=Float64Array.from(series,value=>value*gain);
  const encoded=WAV.encode({sampleRate:report.info.sampleRate,channels:1,samples});
  const destination=path.resolve(file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,encoded);
}

module.exports={run,writeWav};
