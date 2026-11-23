/* Load authored systems and bounded scalar equations for the numerical solvers. */
const path=require('node:path');
const general=['absoluteTolerance','relativeTolerance','maxWork'];
const settingsByMethod={
  dense:[...general,'pivotTolerance'],
  tridiagonal:[...general,'pivotTolerance'],
  sparse:[...general,'maxIterations','restart','initial','history'],
  root:['xTolerance','relativeXTolerance','fTolerance','maxEvaluations','history']
};

function equation(kit,definition,file,dependency){
  const {check,record}=kit.KIT.world.data;
  const {module:reference,config={},coefficients}=definition??{};
  check(record(definition)&&record(config)&&Object.keys(definition).every(key=>['module','config','coefficients'].includes(key))&&
    (reference===undefined)!==(coefficients===undefined),'Choose a root polynomial or a relative equation module');
  if(coefficients!==undefined){
    check(Array.isArray(coefficients)&&coefficients.length>=1&&coefficients.length<=64&&
      Array.from(coefficients).every(Number.isFinite),'Polynomial needs one to 64 finite coefficients');
    return x=>{
      let value=coefficients.at(-1);
      for(let i=coefficients.length-2;i>=0;i--)value=value*x+coefficients[i];
      return value;
    };
  }
  check(typeof reference==='string'&&/\.(?:js|cjs)$/i.test(reference)&&
    !path.isAbsolute(reference)&&!path.win32.isAbsolute(reference),'Equation module must be relative to the plan');
  const location=path.resolve(path.dirname(path.resolve(file)),reference);
  dependency(location);
  const make=require(location);
  check(typeof make==='function','Equation module must export a function of kit and config');
  return make(kit,config);
}

function run(kit,plan,file,dependency=()=>{}){
  const W=kit.KIT.world, S=W.solvers, {check,record,own}=W.data;
  const {method,settings={}}=plan??{};
  check(plan?.format===S.planFormat&&plan.version===1&&own(settingsByMethod,method)&&record(settings)&&
    Object.keys(settings).every(key=>settingsByMethod[method].includes(key)),
  'Expected a version 1 solve plan with valid method settings');
  const result=method==='root'?S.root(equation(kit,plan.equation,file,dependency),plan.bracket,settings):
    S[method](plan.matrix,plan.rhs,settings);
  return {format:S.reportFormat,version:1,...result,
    ...(result.solution&&{solution:Array.from(result.solution)})};
}

module.exports={run};
