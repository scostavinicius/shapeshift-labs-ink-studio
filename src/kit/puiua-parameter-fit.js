/* Compare bounded candidates with measured values and aligned reference curves. */
(function(K){
  const W=K.world,I=W.inverseTargets,M=W.simulationMeasurements;
  const {check,id,own,record,selector,read}=W.data,{fields,positive}=W.boundarySignals,{freeze,hash}=K.procedural.data;
  const planFormat='ink-studio/parameter-fit-plan',reportFormat='ink-studio/parameter-fit-report';
  const finite=Number.isFinite, unit=value=>typeof value==='string'&&value.length>0&&value.length<=96;

  function definition(plan){
    check(fields(plan,['format','version','id','revision','parameters','objectives','settings','starts'])&&
      plan.format===planFormat&&plan.version===1&&id(plan.id)&&
      Number.isSafeInteger(plan.revision??1)&&(plan.revision??1)>0&&record(plan.objectives)&&
      Object.keys(plan.objectives).length>=1&&Object.keys(plan.objectives).length<=32,
    'Expected a version 1 parameter-fit plan with named objectives');
    let components=0;
    const objectives=Object.entries(plan.objectives).map(([name,spec])=>{
      check(id(name)&&fields(spec,['kind','candidate','reference','times','tolerance','weight'])&&
        ['measurement','series'].includes(spec.kind)&&record(spec.candidate)&&record(spec.reference)&&
        positive(spec.tolerance)&&positive(spec.weight??1)&&(spec.weight??1)<=1000000,'Invalid fit objective '+name);
      const {kind,candidate,reference,times,tolerance,weight=1}=spec;
      check(id(candidate.source)&&(id(reference.source)||kind==='measurement'&&fields(reference,['value','unit'])&&
        finite(reference.value)&&unit(reference.unit)),'Fit objective '+name+' needs named sources or an explicit scalar reference');
      check(kind==='measurement'?times===undefined:
        Array.isArray(times)&&times.length>=2&&times.length<=256&&Array.from(times).every((time,i)=>
          finite(time)&&time>=0&&(!i||time>times[i-1])),'Fit series needs 2 to 256 increasing times in seconds on '+name);
      const count=times?.length??1;
      check((components+=count)<=512,'Fit objectives exceed 512 residual components');
      return {name,kind,candidate,reference,times:times?.slice(),tolerance,weight,count};
    });
    const {settings={}}=plan;
    check(fields(settings,['maxEvaluations','parameterTolerance','initialRadius','differenceStep','damping']),
      'Unknown parameter-fit settings');
    return {objectives,components,settings};
  }

  function seriesSampler(source,spec,cache){
    const {source:name,rows,channel,trace,timePath,valuePath}=spec;
    check(fields(spec,['source','path','rows','channel','trace','timePath','valuePath','unit']),
      'Invalid fit series source on '+name);
    const key=JSON.stringify(spec);
    if(cache.has(key))return cache.get(key);
    let result;
    if(rows!==undefined){
      check(unit(spec.unit)&&channel===undefined&&trace===undefined,'Timed rows need an explicit unit for '+name);
      const table=read(source,selector(rows)), at=selector(timePath??'/time'), of=selector(valuePath??'/value');
      check(Array.isArray(table)&&table.length>=1&&table.length<=262144,'Fit source needs bounded timed rows on '+name);
      const times=new Float64Array(table.length), values=times.slice();
      for(let i=0;i<table.length;i++){
        const time=read(table[i],at), value=read(table[i],of);
        check(finite(time)&&time>=0&&(!i||time>times[i-1])&&finite(value),
          'Fit timed rows need increasing times and finite values on '+name+' at row '+i);
        times[i]=time;values[i]=value;
      }
      result={unit:spec.unit,at(time){
        if(time<times[0]||time>times.at(-1))return null;
        let low=0,high=times.length-1;
        while(high-low>1){
          const mid=Math.floor((low+high)/2);
          if(times[mid]>time)high=mid;
          else low=mid;
        }
        if(low===high||time===times[low])return values[low];
        const blend=(time-times[low])/(times[high]-times[low]);
        return values[low]*(1-blend)+values[high]*blend;
      }};
    }else{
      check(timePath===undefined&&valuePath===undefined&&spec.unit===undefined,'Sampled fit series use the native channel unit');
      const native=W.outputAdapters.trace(source,trace??{}),keys=Object.keys(native.channels);
      const selected=channel??(keys.length===1?keys[0]:undefined);
      check(own(native.channels,selected),'Select a known fit trace channel on '+name);
      const {samples,unit:label}=native.channels[selected],{startSample,sampleRate,frames}=native;
      result={unit:label,at(time){
        const offset=time*sampleRate-startSample, end=frames-1;
        if(!frames||offset< -1e-8||offset>end+1e-8)return null;
        const address=Math.min(end,Math.max(0,offset)), lower=Math.floor(address), blend=address-lower;
        return blend?samples[lower]*(1-blend)+samples[lower+1]*blend:samples[lower];
      }};
    }
    cache.set(key,result);
    return result;
  }

  function observations(plan,objectives,side,sources){
    check(record(sources),'Fit '+side+' needs a named source table');
    const measured=Object.fromEntries(objectives.filter(row=>row.kind==='measurement'&&id(row[side].source)).
      map(row=>[row.name,row[side]]));
    const statistics=Object.keys(measured).length?M.run({format:M.format,version:1,id:plan.id,measurements:measured},sources).measurements:{};
    const cache=new Map();
    return Object.fromEntries(objectives.map(({name,kind,times,[side]:binding})=>{
      if(kind==='measurement'){
        if(!own(statistics,name))return [name,{value:binding.value,unit:binding.unit}];
        const result=statistics[name];
        return [name,result.status==='ok'?{value:result.value,unit:result.unit}:{reason:result.reason}];
      }
      check(own(sources,binding.source),'Missing fit '+side+' series source '+binding.source);
      const source=W.outputGeometry.select(sources[binding.source],binding.path), sampler=seriesSampler(source,binding,cache);
      const value=times.map(time=>sampler.at(time)), missing=value.findIndex(sample=>!finite(sample));
      return [name,missing===-1?{value,unit:sampler.unit}:{reason:'time-outside-series',time:times[missing]}];
    }));
  }

  function fit(plan,referenceSources,evaluate){
    check(typeof evaluate==='function','Parameter fitting needs a deterministic candidate evaluator');
    const {objectives,components,settings}=definition(plan);
    const expected=observations(plan,objectives,'reference',referenceSources);
    const totalWeight=objectives.reduce((total,{weight})=>total+weight,0);
    const targets=Object.fromEntries(objectives.map(({name,count,tolerance,weight})=>{
      const {value,reason}=expected[name];
      check(!reason,'Fit reference '+name+' is unavailable ('+reason+')');
      // Equal authored weights represent equal objectives regardless of curve length.
      return [name,{value,tolerance,weight:weight/totalWeight*components/count}];
    }));
    const issues=[];
    const optimization={format:I.planFormat,version:1,id:plan.id,revision:plan.revision,parameters:plan.parameters,
      targets,starts:plan.starts,settings:{maxEvaluations:128,...settings,goal:'minimize',history:'errors'}};
    const result=I.fit(optimization,parameters=>{
      const source=evaluate(parameters);
      if(source===null){issues.push([{reason:'candidate-rejected'}]);return null;}
      const rows=observations(plan,objectives,'candidate',source);
      const invalid=Object.entries(rows).flatMap(([objective,{reason,time}])=>reason?[{
        objective,reason,...(time!==undefined&&{time})
      }]:[]);
      issues.push(invalid);
      if(invalid.length)return null;
      return Object.fromEntries(Object.entries(rows).map(([name,{value,unit}])=>{
        check(unit===expected[name].unit,'Fit objective '+name+' units differ ('+unit+' and '+expected[name].unit+')');
        return [name,value];
      }));
    });
    const {status,parameters,bounds,work,bestEvaluation,rms,maxRatio,converged,history}=result;
    return freeze({format:reportFormat,version:1,
      plan:{id:plan.id,revision:plan.revision??1,signature:hash(JSON.stringify(plan)),referenceSignature:hash(JSON.stringify(expected))},
      status,metTolerance:converged,bestEvaluation,parameters,bounds,rms,maxRatio,work,
      objectives:Object.fromEntries(objectives.map(({name,kind,tolerance,weight,times})=>[name,{
        kind,unit:expected[name].unit,tolerance,weight,...(times&&{times}),reference:expected[name].value,
        ...(parameters&&{measured:result.targets[name].measured,residual:result.targets[name].residual,
          maxRatio:result.targets[name].ratio})
      }])),
      candidates:history.map((row,i)=>issues[i].length?{...row,issues:issues[i]}:row)
    });
  }

  W.parameterFit=Object.freeze({planFormat,reportFormat,fit});
})(KIT);
