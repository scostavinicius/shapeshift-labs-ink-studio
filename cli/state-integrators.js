/* Read a CLI integration plan and load its creator-authored equations. */
const path=require('node:path');
const format='ink-studio/integration-plan';

function run(kit,plan,file,dependency=()=>{},diagnostics) {
  const {module:equations,config={},settings={},times,input}=plan??{};
  const {check,record}=kit.KIT.world.data;
  check(plan?.format===format&&plan.version===1&&record(config)&&record(settings)&&
    typeof equations==='string'&&/\.(?:js|cjs)$/i.test(equations)&&
    !path.isAbsolute(equations)&&!path.win32.isAbsolute(equations),
  'Integration plan needs a relative JavaScript equation module');
  check(Array.isArray(times)&&times.length>=1&&times.length<=4096&&
    Array.from(times).every((time,i)=>Number.isFinite(time)&&(i?time>times[i-1]:time>=(settings.time??0))),
  'Integration plan needs up to 4096 ordered output times');
  const location=path.resolve(path.dirname(path.resolve(file)),equations);
  dependency(location);
  const load=require(location);
  check(typeof load==='function','Integration module must export a function of kit and config');
  const {derivative,acceleration,events,invariants}=load(kit,config)??{};
  const solver=kit.KIT.world.integrators.create({...settings,derivative,acceleration,events,...(diagnostics!==undefined&&{invariants,diagnostics})});
  const initial=solver.snapshot(), results=[];
  for(const time of times){
    const result=solver.advance(time,input);
    results.push(result);
    if(result.terminal!==null)break;
  }
  return {format:'ink-studio/integration-trace',version:1,initial,results,checkpoint:solver.snapshot(),...(solver.diagnostics&&{diagnostics:solver.diagnostics()})};
}

module.exports={run};
