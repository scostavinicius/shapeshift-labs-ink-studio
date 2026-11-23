/* Resolve native simulation files and write sample-addressed audio stems. */
const fs=require('node:fs'),path=require('node:path'),WAV=require('./wav.js');

const runFormat='ink-studio/physical-audio-run';
function prepare(kit,request,file,dependency=()=>{}){
  const W=kit.KIT.world,{check,record,id}=W.data,{fields}=W.boundarySignals;
  check(fields(request,['format','version','plan','inputs'])&&request.format===runFormat&&request.version===1&&
    record(request.inputs)&&Object.keys(request.inputs).length<=32&&Object.keys(request.inputs).every(id),
  'Expected a version 1 physical audio run');
  const cache=new Map(), owner=path.resolve(file);
  function read(value){
    if(typeof value!=='string')return {value,file:owner};
    check(value.length&&!path.isAbsolute(value)&&!path.win32.isAbsolute(value),
      'Physical audio asset paths must be relative to the run file');
    const filename=path.resolve(path.dirname(owner),value);
    if(!cache.has(filename)){
      dependency(filename);
      cache.set(filename,{value:JSON.parse(fs.readFileSync(filename,'utf8')),file:filename});
    }
    return cache.get(filename);
  }
  const producers={
    [W.waveNetworks.runFormat]:require('./wave-network.js'),
    [W.resonantModes.runFormat]:require('./modal-resonator.js'),
    [W.virtualSensors.runFormat]:require('./virtual-sensors.js')
  };
  const native=new Map();
  const signals=Object.fromEntries(Object.entries(request.inputs).map(([name,input])=>{
    check(fields(input,['signal','trace','selection'])&&
      (input.signal!==undefined)!==(input.trace!==undefined)&&(input.trace!==undefined||input.selection===undefined),
    'Input '+name+' needs a physical signal or a trace with a selection');
    if(input.signal!==undefined)return [name,read(input.signal).value];
    const entry=read(input.trace);
    if(!native.has(entry)){
      const format=entry.value?.format;
      const result=Object.hasOwn(producers,format)?producers[format].run(kit,entry.value,entry.file,dependency):entry.value;
      native.set(entry,result);
    }
    return [name,W.physicalSignals.fromTrace(native.get(entry),input.selection)];
  }));
  return {signals,result:W.physicalAudio.render(read(request.plan).value,signals)};
}

function writeStems(directory,result,{exclude=[]}={}){
  const {report}=result, items=[
    ...['source','propagation','mix'].map(name=>[name,result[name]]),
    ...Object.entries(result.sources).map(([name,audio])=>['source-'+name,audio]),
    ...Object.entries(result.paths).map(([name,audio])=>['path-'+name,audio])
  ];
  const files=items.map(([name])=>path.resolve(directory,name+'.wav'));
  const normalized=filename=>filename.toLowerCase();
  const used=new Set(exclude.map(filename=>normalized(path.resolve(filename))));
  for(const file of files){
    if(used.has(normalized(file)))throw Error('Physical audio stem paths must be distinct from each other, inputs and the report');
    used.add(normalized(file));
  }
  fs.mkdirSync(path.resolve(directory),{recursive:true});
  for(const [index,[name,audio]] of items.entries()){
    const data=WAV.encode(audio,{encoding:'pcm24',bwf:{
      description:report.id+' / '+name,timeReference:report.startSample
    }});
    fs.writeFileSync(files[index],data);
  }
  return Object.fromEntries(items.map(([name],index)=>[name,files[index]]));
}

module.exports={runFormat,prepare,run:(...args)=>prepare(...args).result,writeStems};
