/* Bake portable modal assets and render named displacement tracks. */
const fs=require('node:fs'),path=require('node:path'), WAV=require('./wav.js');

function loader(file,dependency){
  return (value,read)=>{
    if(typeof value!=='string')return value;
    if(!value.length||path.isAbsolute(value)||path.win32.isAbsolute(value))throw Error('Modal assets must be relative to the plan');
    const location=path.resolve(path.dirname(path.resolve(file)),value);
    dependency(location);
    return read(location);
  };
}
const json=value=>JSON.parse(fs.readFileSync(value,'utf8'));

function bake(kit,plan,file,dependency=()=>{}){
  const read=loader(file,dependency), {source}=plan??{}, R=kit.KIT.world.resonantModes;
  if(source?.kind!=='mesh')return R.bake(plan);
  let prepared={...source};
  if(source.file!==undefined){
    if(Object.hasOwn(source,'mesh')||Object.hasOwn(source,'domain')||typeof source.file!=='string')
      throw Error('Choose one modal mesh file, inline mesh, or compiled domain');
    const {file:reference,...settings}=source;
    prepared={...settings,mesh:read(reference,location=>require('../index.js').readMesh(location))};
  }else if(typeof source.domain==='string')prepared.domain=read(source.domain,json);
  return R.bake({...plan,source:prepared});
}

function run(kit,plan,file,dependency=()=>{}){
  const W=kit.KIT.world,R=W.resonantModes,{check,record,own}=W.data;
  const {settings={},samples,forces={},impulses=[],checkpoint,maxTotalWork=400000000}=plan??{};
  check(plan?.format===R.runFormat&&plan.version===1&&Number.isSafeInteger(samples)&&samples>=1&&samples<=262144&&
    record(forces)&&Array.isArray(impulses)&&impulses.length<=8192&&Number.isSafeInteger(maxTotalWork)&&
    maxTotalWork>=1&&maxTotalWork<=2000000000,'Expected a bounded version 1 resonant mode run');
  const read=loader(file,dependency), renderer=R.prepare(read(plan.asset,json),settings), {info}=renderer;
  if(checkpoint!==undefined)renderer.restore(read(checkpoint,json));
  const keys=Object.keys(info.pickups), start=renderer.view().sample, end=start+samples;
  const terms=2+keys.length+Object.keys(info.excitations).length;
  check(samples*keys.length<=1000000&&info.modes.length*(samples*terms+impulses.length)<=maxTotalWork,
    'Modal run exceeds its work or output budget');
  check(Object.keys(forces).every(name=>own(info.excitations,name))&&Array.from(impulses).every(row=>
    record(row)&&Number.isSafeInteger(row.sample)&&row.sample>=start&&row.sample<end),'Invalid modal source or out-of-run impulse');
  const drives=Object.fromEntries(Object.entries(forces).map(([name,value])=>{
    if(Number.isFinite(value))return [name,value];
    check(Array.isArray(value)&&value.length===samples&&Array.from(value).every(Number.isFinite),
      'Modal force needs a finite level or array per source');
    return [name,Float64Array.from(value)];
  }));
  const room=Math.floor(info.maxWork/info.modes.length);
  const block=Math.min(4096,Math.floor(room/terms));
  check(block>=1,'Modal work limit cannot process one sample');
  const pickups=Object.fromEntries(keys.map(name=>[name,new Float64Array(samples)]));
  for(let at=0;at<samples;){
    const upper=Math.min(block,samples-at);
    const entries=impulses.filter(row=>row.sample>=start+at&&row.sample<start+at+upper);
    const count=Math.min(upper,Math.max(1,Math.floor((room-entries.length)/terms)));
    const input=Object.fromEntries(Object.entries(drives).map(([name,value])=>
      [name,typeof value==='number'?value:value.subarray(at,at+count)]));
    const part=renderer.process(count,{forces:input,impulses:entries.filter(row=>row.sample<start+at+count)});
    for(const name of keys)pickups[name].set(part.pickups[name],at);
    at+=count;
  }
  return {format:R.traceFormat,version:1,info,start,end,
    pickups:Object.fromEntries(keys.map(name=>[name,Array.from(pickups[name])])),
    checkpoint:renderer.snapshot()};
}

function writeWav(file,trace,{pickup=Object.keys(trace.pickups)[0],gain=1}={}){
  const signal=Object.hasOwn(trace.pickups,pickup)?trace.pickups[pickup]:null;
  if(!signal||!Number.isFinite(gain)||gain<=0)throw Error('Modal audition needs a known pickup and positive gain');
  const samples=Float64Array.from(signal,value=>value*gain);
  const bytes=WAV.encode({sampleRate:trace.info.sampleRate,channels:1,samples});
  const destination=path.resolve(file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,bytes);
}

module.exports={bake,run,writeWav};
