/* Fit named physical targets with bounded parameters and a deterministic work budget. */
(function(K){
  const W=K.world,{check,id,record}=W.data,{fields,finite,positive}=W.boundarySignals;
  const {clamp,mix}=W.gestureScoreData,{freeze,hash}=K.procedural.data;
  const planFormat='ink-studio/inverse-target-plan',reportFormat='ink-studio/inverse-target-report';
  const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;

  function definitions(plan){
    check(fields(plan,['format','version','id','revision','parameters','targets','settings','starts','evaluator'])&&
      plan.format===planFormat&&plan.version===1&&id(plan.id)&&integer(plan.revision??1,1,Number.MAX_SAFE_INTEGER),
    'Expected a version 1 inverse target plan');
    const named=(raw,max,what)=>{
      check(record(raw)&&integer(Object.keys(raw).length,1,max)&&Object.keys(raw).every(id),'Invalid inverse '+what+' table');
      return Object.entries(raw);
    };
    const parameters=named(plan.parameters,12,'parameter').map(([name,row])=>{
      check(fields(row,['min','max','initial','quantity'])&&finite(row.min)&&finite(row.max)&&row.max>row.min&&
        finite(row.max-row.min),'Inverse parameter '+name+' needs finite ordered bounds');
      const {min,max,initial=(min*.5+max*.5)}=row;
      check(finite(initial)&&initial>=min&&initial<=max,'Initial inverse parameter is outside bounds on '+name);
      return {name,min,max,initial,quantity:K.quantities.normalize(row.quantity,'Inverse parameter '+name)};
    });
    let components=0;
    const targets=named(plan.targets,32,'target').map(([name,row])=>{
      check(fields(row,['value','tolerance','weight','quantity']),'Invalid inverse target '+name);
      const {value,tolerance,weight=1}=row, array=Array.isArray(value), values=array?Array.from(value):[value];
      const tolerances=Array.isArray(tolerance)?Array.from(tolerance):Array(values.length).fill(tolerance);
      check(integer(values.length,1,256)&&values.every(finite)&&tolerances.length===values.length&&tolerances.every(positive)&&
        positive(weight)&&weight<=1000000&&(components+=values.length)<=512,'Invalid inverse target value, tolerance or weight on '+name);
      return {name,array,values,tolerances,weight,quantity:K.quantities.normalize(row.quantity,'Inverse target '+name)};
    });
    return {parameters,targets,components};
  }

  function fit(plan,evaluate){
    check(typeof evaluate==='function','Inverse fitting needs a deterministic evaluator');
    const {parameters,targets,components}=definitions(plan), n=parameters.length, {settings={},starts=[]}=plan;
    check(fields(settings,['maxEvaluations','parameterTolerance','initialRadius','differenceStep','damping','history','goal']),
      'Unknown inverse fit settings');
    const {maxEvaluations=256,parameterTolerance=1e-6,initialRadius=.25,differenceStep=1e-4,damping=1e-6,
      history=false,goal='tolerance'}=settings, minimize=goal==='minimize';
    check(integer(maxEvaluations,1,4096)&&positive(parameterTolerance)&&parameterTolerance<=.25&&
      positive(initialRadius)&&initialRadius<=1&&initialRadius>=parameterTolerance&&positive(differenceStep)&&differenceStep<=.25&&
      positive(damping)&&damping<=1&&(typeof history==='boolean'||history==='errors')&&
      ['tolerance','minimize'].includes(goal)&&components*maxEvaluations<=524288&&Array.isArray(starts)&&starts.length<=16,
    'Invalid inverse fit work, step or history settings');
    const parameterNames=new Set(parameters.map(p=>p.name));
    const encode=raw=>parameters.map(({name,min,max,initial})=>{
      const value=raw[name]??initial;
      check(finite(value)&&value>=min&&value<=max,'Inverse starting value is outside bounds on '+name);
      return clamp((value-min)/(max-min),0,1);
    });
    const starting=[encode({}),...Array.from(starts,row=>{
      check(record(row)&&Object.entries(row).every(([name,value])=>parameterNames.has(name)&&finite(value)),'Invalid inverse starting point');
      return encode(row);
    })];
    const physical=x=>Object.fromEntries(parameters.map(({name,min,max},i)=>[name,clamp(mix(min,max,x[i]),min,max)]));
    const trace=history?[]:null, cache=new Map();
    const retainErrors=history==='errors';
    let evaluations=0,infeasible=0,best=null,iteration=0;
    const done=()=>minimize?best?.cost===0:best?.met;
    function better(a,b){
      return a!==null&&(!b||(minimize||a.met===b.met?a.cost<b.cost:a.met));
    }
    function sample(x){
      const key=x.join(',');
      if(cache.has(key))return cache.get(key);
      if(evaluations===maxEvaluations)return null;
      const params=physical(x);
      evaluations++;
      const measured=evaluate(freeze({...params}));
      if(measured===null){
        infeasible++;
        cache.set(key,null);
        trace?.push({evaluation:evaluations,parameters:params,feasible:false});
        return null;
      }
      check(record(measured),'Inverse evaluator must return named measurements or null');
      const vector=[], rows={}, ratio=[], objectiveErrors={};
      for(const target of targets){
        const {name,array,values,tolerances,weight,quantity}=target, received=measured[name];
        check(array?Array.isArray(received):finite(received),'Invalid inverse measurement shape on '+name);
        const actual=array?Array.from(received):[received];
        check(actual.length===values.length&&actual.every(finite),'Invalid inverse measurement '+name);
        const errors=actual.map((value,i)=>value-values[i]), normalized=errors.map((error,i)=>error/tolerances[i]);
        for(const value of normalized){
          const weighted=value*Math.sqrt(weight);
          check(finite(weighted)&&Math.abs(weighted)<=1e140,'Inverse residual exceeds numeric range on '+name);
          vector.push(weighted);
          ratio.push(Math.abs(value));
        }
        const shape=items=>array?items:items[0];
        const worst=normalized.reduce((j,value,i)=>Math.abs(value)>Math.abs(normalized[j])?i:j,0);
        const worstRatio=Math.abs(normalized[worst]);
        rows[name]={target:shape(values),measured:shape(actual),residual:shape(errors),tolerance:shape(tolerances),
          ratio:worstRatio,...(quantity&&{quantity})};
        if(retainErrors){
          const factor=Math.sqrt(errors.length);
          objectiveErrors[name]={rms:Math.hypot(...errors.map(error=>error/factor)),
            bias:errors.reduce((sum,error)=>sum+error/errors.length,0),
            worst:{index:worst,residual:errors[worst],ratio:worstRatio}};
        }
      }
      const cost=vector.reduce((sum,value)=>sum+value*value,0)/components, maxRatio=Math.max(...ratio);
      const row={x,evaluation:evaluations,parameters:params,targets:rows,cost,maxRatio,vector,met:maxRatio<=1};
      cache.set(key,row);
      if(better(row,best))best=row;
      trace?.push({evaluation:evaluations,parameters:params,rms:Math.sqrt(cost),maxRatio,feasible:true,
        ...(retainErrors&&{errors:objectiveErrors})});
      return row;
    }

    function descent(origin,radius){
      const {x,vector}=origin, columns=[];
      for(let j=0;j<n;j++){
        const point=x.slice(), step=Math.min(differenceStep,radius);
        point[j]=clamp(x[j]+(x[j]<=.5?step:-step),0,1);
        const tested=sample(point), span=point[j]-x[j];
        if(!tested||!span)return null;
        const column=tested.vector.map((value,i)=>(value-vector[i])/span);
        if(!column.every(finite))return null;
        columns.push(column);
      }
      // Normalize the system by the largest derivative so damping is dimensionless.
      let scale=0;
      for(const column of columns)for(const value of column)scale=Math.max(scale,Math.abs(value));
      if(!scale)return null;
      const basis=columns.map(column=>column.map(value=>value/scale));
      const error=vector.map(value=>value/scale);
      const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
      const matrix=basis.map((a,j)=>basis.map((b,k)=>dot(a,b)+(j===k?damping:0)));
      const rhs=basis.map(axis=>-dot(axis,error));
      if(!rhs.every(finite))return null;
      const result=W.solvers.dense(matrix,rhs);
      if(!result.converged)return null;
      const norm=Math.max(...Array.from(result.solution,Math.abs)), factor=norm>radius?radius/norm:1;
      return sample(x.map((value,i)=>clamp(value+factor*result.solution[i],0,1)));
    }
    function poll(x,radius,origin){
      let candidate=origin;
      for(let i=0;i<n;i++)for(const sign of [-1,1]){
        const point=x.slice();
        point[i]=clamp(point[i]+sign*radius,0,1);
        const at=sample(point);
        if(better(at,candidate))candidate=at;
        if(done()||evaluations===maxEvaluations)return candidate;
      }
      return candidate;
    }

    for(const start of starting){
      if(done()||evaluations===maxEvaluations)break;
      sample(start);
    }
    let radius=initialRadius;
    if(!best){
      for(const start of starting){
        if(evaluations===maxEvaluations||best)break;
        poll(start,radius,null);
      }
    }
    while(best&&!done()&&evaluations<maxEvaluations&&radius>=parameterTolerance){
      const origin=best;
      iteration++;
      const trial=descent(origin,radius);
      if(!better(trial,origin)&&!done())poll(origin.x,radius,origin);
      if(!better(best,origin))radius*=.5;
    }
    const status=done()?(minimize?'exact-minimum':'tolerance-met'):
      !best?'no-feasible-sample':evaluations===maxEvaluations?'evaluation-limit':'resolution';
    const bounds=best?Object.fromEntries(parameters.flatMap(({name,min,max})=>best.parameters[name]===min?[[name,'min']]:
      best.parameters[name]===max?[[name,'max']]:[])):{};
    const report={format:reportFormat,version:1,plan:{id:plan.id,revision:plan.revision??1,signature:hash(JSON.stringify(plan))},
      status,converged:best?.met??false,parameters:best?.parameters??null,targets:best?.targets??{},
      rms:best?Math.sqrt(best.cost):null,maxRatio:best?.maxRatio??null,bounds,
      work:{evaluations,maxEvaluations,infeasible,iterations:iteration},...(trace&&{history:trace}),
      ...(retainErrors&&{bestEvaluation:best?.evaluation??null})};
    return freeze(report);
  }

  W.inverseTargets=Object.freeze({planFormat,reportFormat,definitions,fit});
})(KIT);
