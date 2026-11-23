/* Resolve and run one authored finite-volume operation. */
const fs=require('node:fs'), path=require('node:path');
const {compile}=require('./discretization.js');
const operations={
  boundaries:['diffusivity'],
  interpolate:['diffusivity','scheme'],
  sample:['diffusivity','sites'],
  gradient:['diffusivity'],
  'face-gradient':['diffusivity'],
  flux:['location'],
  divergence:[],
  diffusion:['diffusivity'],
  advection:['carrierFlux','velocity','location'],
  transport:['dt','diffusivity','carrierFlux','velocity','location','source']
};
function json(key,value) {
  return ArrayBuffer.isView(value)?Array.from(value):value;
}

function run(kit,plan,file,dependency=()=>{},diagnostics) {
  const W=kit.KIT.world, api=W.gridOperators, {check,own,record}=W.data;
  const {operation,values,boundary,conditions,settings={}}=plan??{};
  check(plan?.format===api.planFormat&&plan.version===1&&own(operations,operation)&&record(settings)&&
    Object.keys(settings).every(key=>key==='time'&&operation!=='divergence'||operations[operation].includes(key)),
  'Expected a version 1 grid operator plan with valid operation settings');
  let domain=plan.domain, owner=file;
  if(typeof domain==='string'){
    check(domain.length&&!path.isAbsolute(domain)&&!path.win32.isAbsolute(domain),'Grid operator domain path must be relative');
    owner=path.resolve(path.dirname(path.resolve(file)),domain);
    dependency(owner);
    domain=JSON.parse(fs.readFileSync(owner,'utf8'));
  }
  const supplied=require('./boundary-conditions.js').resolve(conditions,file,dependency);
  const ops=api.prepare(domain?.format===W.discretization.compiledFormat?domain:compile(kit,domain,owner,dependency),
    {conditions:supplied});
  const options={...settings,boundary};
  let result;
  switch(operation){
    case 'boundaries': result=ops.applyBoundaries(values,options); break;
    case 'face-gradient': result=ops.faceGradient(values,options); break;
    case 'sample': result=ops.sample(values,settings.sites,options); break;
    case 'transport':
    case 'advection': {
      check(settings.velocity===undefined||settings.carrierFlux===undefined,'Choose velocity or an integrated carrier flux');
      check(settings.location===undefined||settings.velocity!==undefined,'A velocity location requires a velocity field');
      if(settings.velocity!==undefined)options.carrierFlux=ops.flux(settings.velocity,options);
      result=diagnostics!==undefined&&operation==='transport'?
        ops.inspectTransport(values,options,{observed:plan.observed,diagnostics}):ops[operation](values,options);
      break;
    }
    default: result=ops[operation](values,options);
  }
  return JSON.parse(JSON.stringify({format:api.reportFormat,version:1,domain:ops.domain,...(ops.boundarySet&&{boundarySet:ops.boundarySet}),operation,result},json));
}

module.exports={run};
