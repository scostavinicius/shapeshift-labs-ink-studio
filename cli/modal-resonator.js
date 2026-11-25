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
  if(plan?.format===R.coupledRunFormat)return coupled(kit,plan,file,dependency);
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

function coupled(kit,plan,file,dependency){
  const W=kit.KIT.world,R=W.resonantModes,{check,record,own}=W.data,{fields}=W.boundarySignals;
  const {bodies,contact,settings,samples,levels=[],forces={},impulses=[],checkpoint,maxTotalWork=400000000}=plan;
  check(fields(plan,['format','version','bodies','contact','settings','samples','levels','forces','impulses',
    'checkpoint','maxTotalWork','audio'])&&plan.version===1&&record(bodies)&&Object.keys(bodies).length===2&&
    Number.isSafeInteger(samples)&&samples>=1&&samples<=262144&&Array.isArray(levels)&&levels.length<=8192&&
    record(forces)&&Array.isArray(impulses)&&impulses.length<=8192&&Number.isSafeInteger(maxTotalWork)&&
    maxTotalWork>=1&&maxTotalWork<=2000000000,'Expected a bounded version 1 coupled resonant mode run');
  const read=loader(file,dependency),resolved=Object.fromEntries(Object.entries(bodies).map(([name,row])=>{
    check(fields(row,['asset','site']),'Name an asset and contact site for each coupled body');
    return [name,{...row,asset:read(row.asset,json)}];
  }));
  const engine=R.prepareCoupled({bodies:resolved,contact},settings), {info}=engine;
  if(checkpoint!==undefined)engine.restore(read(checkpoint,json));
  const initial=engine.view(),start=initial.sample,end=start+samples;
  const readCount=Object.values(info.bodies).reduce((sum,row)=>sum+Object.keys(row.pickups).length,0);
  check(Number.isSafeInteger(end)&&samples*(2*readCount+1)<=2000000&&
    samples*info.workPerSample+impulses.length*info.impulseWork<=maxTotalWork,'Coupled run exceeds its work or output budget');
  const address=at=>Number.isSafeInteger(at)&&at>=start&&at<end;
  check(Array.from(levels).every((row,i)=>fields(row,['sample','level'])&&address(row.sample)&&
    (!i||row.sample>levels[i-1].sample)&&Number.isFinite(row.level)&&row.level>=0&&row.level<=1)&&
    Array.from(impulses).every(row=>record(row)&&address(row.sample)),
  'Contact levels and impulses need valid sample addresses inside the run');
  const input=Object.fromEntries(Object.entries(forces).map(([name,sites])=>{
    check(own(info.bodies,name)&&record(sites),'Unknown coupled excitation body');
    return [name,Object.fromEntries(Object.entries(sites).map(([site,value])=>{
      check(own(info.bodies[name].excitations,site),'Unknown coupled excitation');
      if(Number.isFinite(value))return [site,value];
      check(Array.isArray(value)&&value.length===samples&&Array.from(value).every(Number.isFinite),
        'Coupled force needs a finite level or one value per sample');
      return [site,Float64Array.from(value)];
    }))];
  }));
  const amount=new Float64Array(samples);
  let last=0,target=initial.contact.target;
  for(const row of levels){
    amount.fill(target,last,row.sample-start);
    target=row.level;last=row.sample-start;
  }
  amount.fill(target,last);
  const signals=()=>Object.fromEntries(Object.entries(info.bodies).map(([name,{pickups}])=>[name,
    Object.fromEntries(Object.keys(pickups).map(site=>[site,new Float64Array(samples)]))]));
  const pickups=signals(),velocities=signals(),linked=new Float64Array(samples);
  const maxBlock=Math.min(4096,Math.floor(info.maxWork/info.workPerSample),Math.floor(1000000/(2*readCount+1)));
  check(maxBlock>=1,'Coupled work limit cannot process one sample');
  for(let at=0;at<samples;){
    let count=Math.min(maxBlock,samples-at),events;
    for(;;){
      events=impulses.filter(row=>row.sample>=start+at&&row.sample<start+at+count);
      if(count*info.workPerSample+events.length*info.impulseWork<=info.maxWork)break;
      check(count>1,'Coupled work limit cannot process the impulses at one sample');
      count=Math.floor(count/2);
    }
    const block=engine.process(count,{contact:amount.subarray(at,at+count),impulses:events,
      forces:Object.fromEntries(Object.entries(input).map(([name,sites])=>[name,
        Object.fromEntries(Object.entries(sites).map(([site,value])=>[site,
          typeof value==='number'?value:value.subarray(at,at+count)]))]))});
    for(const [name,sites] of Object.entries(pickups))for(const site of Object.keys(sites)){
      pickups[name][site].set(block.pickups[name][site],at);
      velocities[name][site].set(block.velocities[name][site],at);
    }
    linked.set(block.contact,at);
    at+=count;
  }
  const serialize=rows=>Object.fromEntries(Object.entries(rows).map(([name,sites])=>[name,
    Object.fromEntries(Object.entries(sites).map(([site,values])=>[site,Array.from(values)]))]));
  return {format:R.coupledTraceFormat,version:1,info,start,end,pickups:serialize(pickups),velocities:serialize(velocities),
    contact:Array.from(linked),endpoint:engine.view(),checkpoint:engine.snapshot()};
}

function coupledAudio(trace,audio={}){
  const {channels,measure='velocity',gain=1}=audio;
  if(!Array.isArray(channels)||![1,2].includes(channels.length)||!['displacement','velocity'].includes(measure)||
    !Number.isFinite(gain)||gain<=0)throw Error('Coupled audition needs one or two body pickups, a measure and positive gain');
  const source=measure==='velocity'?trace.velocities:trace.pickups;
  const rows=Array.from(channels,row=>{
    const track=Object.hasOwn(source,row?.body)&&source[row.body];
    if(!track||!Object.hasOwn(track,row.pickup))throw Error('Unknown coupled audition pickup');
    return track[row.pickup];
  });
  const samples=new Float64Array(rows.length*(trace.end-trace.start));
  for(let i=0;i<samples.length;i++){
    const sample=rows[i%rows.length][Math.floor(i/rows.length)]*gain;
    if(!Number.isFinite(sample)||Math.abs(sample)>1)throw Error('Coupled audition exceeds full scale. Lower its gain');
    samples[i]=sample;
  }
  return {sampleRate:trace.info.sampleRate,channels:rows.length,samples};
}

function writeWav(file,trace,audio){
  if(trace.format==='ink-studio/coupled-resonant-mode-trace'){
    const destination=path.resolve(file);
    const bytes=WAV.encode(coupledAudio(trace,audio),{encoding:'pcm24'});
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.writeFileSync(destination,bytes);
    return;
  }
  const {pickup=Object.keys(trace.pickups)[0],gain=1}=audio??{};
  const signal=Object.hasOwn(trace.pickups,pickup)?trace.pickups[pickup]:null;
  if(!signal||!Number.isFinite(gain)||gain<=0)throw Error('Modal audition needs a known pickup and positive gain');
  const samples=Float64Array.from(signal,value=>value*gain);
  const bytes=WAV.encode({sampleRate:trace.info.sampleRate,channels:1,samples});
  const destination=path.resolve(file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,bytes);
}

module.exports={bake,run,writeWav,coupledAudio};
