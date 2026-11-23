/* Review native solver plans and saved world evidence without changing their settings. */
const plans={
  'ink-studio/grid-operators-plan':'./grid-operators.js',
  'ink-studio/wave-run':'./wave-network.js',
  'ink-studio/lumped-network-run':'./lumped-network.js',
  'ink-studio/integration-plan':'./state-integrators.js',
  'ink-studio/solve-plan':'./numerical-solvers.js',
  'ink-studio/state-remap-plan':'./state-remap.js'
};

function run(kit,plan,file,dependency){
  const W=kit.KIT.world,D=W.diagnostics,{check,record}=W.data;
  check(record(plan),'Expected a simulation plan or saved coupling probe');
  const options=plan.diagnostics??true;
  const mode=Object.hasOwn(plans,plan.format)?plans[plan.format]:null;
  if(!mode){
    if(plan.format===W.stateRemap.reportFormat)return D.remap(plan,options);
    if(plan.format===W.solvers.reportFormat)return D.solve(plan,options);
    const probe=plan.status==='ok'?plan.value:plan;
    return D.coupling(probe,options);
  }
  if(mode==='./grid-operators.js')check(plan.operation==='transport','Grid diagnostics need a transport plan');
  try{
    const report=require(mode).run(kit,plan,file,dependency,options);
    if(mode==='./numerical-solvers.js')return D.solve(report,options);
    if(mode==='./state-remap.js')return D.remap(report,options);
    return report.diagnostics??report.result.diagnostics;
  }catch(error){
    if(error.diagnostics?.format===D.format)return error.diagnostics;
    throw error;
  }
}

module.exports={run};
