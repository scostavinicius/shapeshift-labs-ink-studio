/* Fit numeric bindings into native simulation runs from an immutable template. */
const {sourceResolver}=require('./simulation-measurements.js');
const runFormat='ink-studio/parameter-fit-run';

function run(kit,request,file,dependency=()=>{}){
  const W=kit.KIT.world,{check,record,id,selector,read,own}=W.data,{fields}=W.boundarySignals;
  check(fields(request,['format','version','plan','candidate','reference','bindings'])&&
    request.format===runFormat&&request.version===1&&record(request.candidate)&&record(request.bindings)&&
    Object.keys(request.candidate).length>=1&&Object.keys(request.candidate).length<=16&&
    Object.keys(request.candidate).every(id),'Expected a version 1 parameter-fit run with candidate templates and bindings');
  const dependencies=new Set();
  const io=sourceResolver(kit,file,location=>{
    if(dependencies.has(location))return;
    dependency(location);
    dependencies.add(location);
  });
  const plan=io.load(request.plan).value, budget=plan?.settings?.maxEvaluations??128;
  check(plan?.format===W.parameterFit.planFormat&&record(plan.parameters)&&
    Object.keys(plan.parameters).length>=1&&Object.keys(plan.parameters).length<=12&&
    Object.keys(plan.parameters).every(id)&&Object.keys(request.bindings).length===Object.keys(plan.parameters).length,
  'Fit bindings must cover the plan parameters');
  check(Number.isSafeInteger(budget)&&budget>=1&&budget*Object.keys(request.candidate).length<=4096,
    'Parameter fitting exceeds 4096 native candidate runs');
  const templates=Object.fromEntries(Object.entries(request.candidate).map(([name,source])=>{
    const entry=io.load(source);
    check(io.isNative(entry.value),'Fit candidate '+name+' needs a native simulation run template');
    return [name,entry];
  }));
  const claimed=new Set();
  const destinations=Object.entries(plan.parameters).flatMap(([parameter])=>{
    const rows=own(request.bindings,parameter)&&request.bindings[parameter];
    check(Array.isArray(rows)&&rows.length>=1&&rows.length<=16,'Missing or invalid fit bindings for '+parameter);
    return Array.from(rows,row=>{
      check(fields(row,['source','path'])&&id(row.source)&&own(templates,row.source),
        'Fit binding needs a known candidate source for '+parameter);
      const {source}=row, parts=selector(row.path), key=JSON.stringify([source,parts.map(String)]);
      check(!claimed.has(key)&&Number.isFinite(read(templates[source].value,parts)),
        'Fit binding must target a distinct existing finite number on '+source+' for '+parameter);
      claimed.add(key);
      return {parameter,source,path:parts};
    });
  });
  const grouped=Object.fromEntries(Object.keys(templates).map(name=>[name,destinations.filter(row=>row.source===name)]));
  const editsFor=parameters=>Object.fromEntries(Object.entries(grouped).map(([name,rows])=>[name,
    rows.map(({parameter,path})=>({op:'set',path,value:parameters[parameter]}))]));
  const fixed=new Map();
  const report=W.parameterFit.fit(plan,io.sources(request.reference??{}),parameters=>{
    const edits=editsFor(parameters);
    return Object.fromEntries(Object.entries(templates).map(([name,entry])=>{
      if(!edits[name].length){
        if(!fixed.has(name))fixed.set(name,io.solve(entry,'native'));
        return [name,fixed.get(name)];
      }
      const {world:value}=W.apply(entry.value,edits[name],{validate:null});
      return [name,io.solve({...entry,value},'native')];
    }));
  });
  return {...report,edits:report.parameters?editsFor(report.parameters):{}};
}

module.exports={runFormat,run};
