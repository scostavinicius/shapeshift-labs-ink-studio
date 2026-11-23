/* Resolve saved outputs or native run plans once for named CI measurements. */
const fs=require('node:fs'),path=require('node:path');

const runFormat='ink-studio/simulation-measurement-run';
const read=file=>path.extname(file).toLowerCase()==='.wav'?require('./wav.js').decode(fs.readFileSync(file)):
  JSON.parse(fs.readFileSync(file,'utf8'));
const nativeRunners={
  'ink-studio/wave-run':'./wave-network.js',
  'ink-studio/resonant-mode-run':'./modal-resonator.js',
  'ink-studio/contact-excitation-run':'./contact-exciter.js',
  'ink-studio/controller-run':'./controller-tools.js',
  'ink-studio/lumped-network-run':'./lumped-network.js',
  'ink-studio/integration-plan':'./state-integrators.js',
  'ink-studio/grid-operators-plan':'./grid-operators.js',
  'ink-studio/solve-plan':'./numerical-solvers.js',
  'ink-studio/state-remap-plan':'./state-remap.js',
  'ink-studio/sensor-run':'./virtual-sensors.js'
};

function sourceResolver(kit,file,dependency=()=>{}){
  const W=kit.KIT.world,{check,record,id,own}=W.data,{fields}=W.boundarySignals;
  const owner=path.resolve(file), documents=new Map(), results=new Map();
  const isNative=value=>own(nativeRunners,value?.format);
  function load(reference){
    if(typeof reference!=='string')return {value:reference,file:owner};
    check(reference.length&&!path.isAbsolute(reference)&&!path.win32.isAbsolute(reference),
      'Measurement assets must be relative to their run file');
    const filename=path.resolve(path.dirname(owner),reference);
    if(!documents.has(filename)){
      dependency(filename);
      documents.set(filename,{value:read(filename),file:filename});
    }
    return documents.get(filename);
  }

  function solve(entry,mode){
    const {value,file}=entry;
    if(mode==='saved')return value;
    if(mode==='diagnostics')return value?.format===W.diagnostics.format?value:
      require('./simulation-diagnostics.js').run(kit,value,file,dependency);
    const native=isNative(value)?nativeRunners[value.format]:undefined;
    check(mode!=='native'||native,'Unrecognized native simulation run format');
    return native?require(native).run(kit,value,file,dependency,value.diagnostics):value;
  }
  function sources(entries){
    check(record(entries)&&Object.keys(entries).length<=64&&Object.keys(entries).every(id),'Invalid measurement source table');
    return Object.fromEntries(Object.entries(entries).map(([name,entry])=>{
      check(fields(entry,['file','value','mode'])&&own(entry,'file')!==own(entry,'value')&&
        (!own(entry,'file')||typeof entry.file==='string')&&['auto','native','saved','diagnostics'].includes(entry.mode??'auto'),
      'Measurement source '+name+' needs a relative file or inline value and a supported mode');
      const prepared=own(entry,'file')?load(entry.file):{value:entry.value,file:owner};
      const mode=entry.mode??'auto';
      if(!results.has(prepared))results.set(prepared,new Map());
      const modes=results.get(prepared), key=mode==='auto'&&isNative(prepared.value)?'native':mode;
      if(!modes.has(key))modes.set(key,solve(prepared,key));
      return [name,modes.get(key)];
    }));
  }
  return {load,sources,isNative,solve};
}

function run(kit,request,file,dependency=()=>{}){
  const W=kit.KIT.world;
  W.data.check(W.boundarySignals.fields(request,['format','version','plan','sources'])&&
    request.format===runFormat&&request.version===1,'Expected a version 1 simulation measurement run');
  const resolver=sourceResolver(kit,file,dependency);
  const sources=resolver.sources(request.sources);
  return W.simulationMeasurements.run(resolver.load(request.plan).value,sources);
}
module.exports={runFormat,run,sourceResolver};
