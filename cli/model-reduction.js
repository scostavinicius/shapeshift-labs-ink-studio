/* Resolve relative inputs for the library's portable reduction plan. */
const fs=require('node:fs'), path=require('node:path');
const {embedModels}=require('./simulation-model-files.js');
const sections=require('./path-sections.js');
const WAV=require('./wav.js');
const resolve=(owner,file)=>path.resolve(path.dirname(path.resolve(owner)),file);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

function relative(owner,file,dependency) {
  if(typeof file!=='string'||!file||path.isAbsolute(file)||path.win32.isAbsolute(file))
    throw Error('Reduction source paths must be relative to the plan');
  const location=resolve(owner,file);
  dependency(location);
  return location;
}

function bake(kit,plan,file,dependency=()=>{}) {
  const reduction=kit.KIT.world.reduction;
  if(plan?.format!==reduction.format||plan.version!==1)
    throw Error('Expected a version 1 reduction plan');
  let {source,reference}=plan, owner=file;
  if(typeof source==='string'){
    reference={...reference,file:source};
    owner=relative(file,source,dependency);
    source=path.extname(owner).toLowerCase()==='.wav'?{wav:source}:read(owner);
  }
  if(plan.kind==='profile'&&source?.format===sections.format)
    source=sections.measure(kit,source,owner,dependency);
  if(['response','modes'].includes(plan.kind)&&source?.wav!==undefined){
    const {wav,channel=0}=source, audio=WAV.read(relative(file,wav,dependency));
    if(!Number.isSafeInteger(channel)||channel<0||channel>=audio.channels||audio.samples.length/audio.channels>65536)
      throw Error('Reduction WAV needs a valid channel and at most 65536 samples per channel');
    const samples=Float64Array.from({length:audio.samples.length/audio.channels},(_,i)=>
      audio.samples[i*audio.channels+channel]);
    source={sampleRate:audio.sampleRate,samples};
    reference={...reference,file:wav,channel};
  }else if(['response','modes'].includes(plan.kind)&&source?.model!==undefined){
    const {model,...capture}=source;
    const location=typeof model==='string'?relative(owner,model,dependency):owner;
    source=reduction.capture(embedModels(typeof model==='string'?read(location):model,location,dependency),capture);
    if(typeof model==='string') reference={...reference,model};
  }
  return reduction.bake({...plan,source,reference});
}

module.exports={bake};
