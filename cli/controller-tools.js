/* Headless controller replay and bounded inverse fitting. */
const fs=require('node:fs'),path=require('node:path');
const {embedModels}=require('./simulation-model-files.js');

function resolver(W,file,dependency){
  return reference=>{
    W.data.check(typeof reference==='string'&&reference.length>0&&!path.isAbsolute(reference)&&
      !path.win32.isAbsolute(reference),'Controller and fit references must be relative to their plan');
    const location=path.resolve(path.dirname(path.resolve(file)),reference);
    dependency(location);
    return location;
  };
}
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));

function run(kit,plan,file,dependency=()=>{}){
  const W=kit.KIT.world,C=W.controllers, {check}=W.data;
  check(W.boundarySignals.fields(plan,['format','version','controller','checkpoint','dt','samples'])&&
    plan.format===C.runFormat&&plan.version===1,'Expected a version 1 controller run');
  const resolve=resolver(W,file,dependency);
  const read=value=>typeof value==='string'?json(resolve(value)):value;
  return C.trace(read(plan.controller),{dt:plan.dt,samples:plan.samples,checkpoint:read(plan.checkpoint)});
}

function fit(kit,plan,file,dependency=()=>{}){
  const W=kit.KIT.world,I=W.inverseTargets,{check,record}=W.data;
  I.definitions(plan);
  const {evaluator}=plan, resolve=resolver(W,file,dependency);
  if(evaluator?.kind==='world'){
    const owner=typeof evaluator.world==='string'?resolve(evaluator.world):file;
    const world=typeof evaluator.world==='string'?json(owner):evaluator.world;
    return I.fitWorld({...plan,evaluator:{...evaluator,world:embedModels(world,owner,dependency)}});
  }
  check(W.boundarySignals.fields(evaluator,['kind','file','config'])&&evaluator.kind==='module'&&
    typeof evaluator.file==='string'&&/\.(?:js|cjs)$/i.test(evaluator.file)&&record(evaluator.config??{}),
  'Inverse evaluator needs a native world or a relative JavaScript module');
  const create=require(resolve(evaluator.file));
  check(typeof create==='function','Inverse evaluator module must export a factory');
  return I.fit(plan,create(kit,evaluator.config??{}));
}
module.exports={run,fit};
