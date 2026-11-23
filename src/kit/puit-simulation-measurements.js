/* Named measurements and CI gates for trace, controller, balance and contact evidence. */
(function(K){
  const W=K.world,P=K.procedural,M=W.traceMeasurements,G=W.outputGeometry,{check,own,id,record,read,selector}=W.data;
  const {fields}=W.boundarySignals,{measured,unavailable}=M;
  const format='ink-studio/simulation-measurement-plan', reportFormat='ink-studio/simulation-measurement-report';
  const finite=Number.isFinite, nonnegative=n=>finite(n)&&n>=0;
  const unit=label=>typeof label==='string'&&label.length>0&&label.length<=96;
  const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;

  function stats(mode){
    let count=0, max=0, scale=0, squares=0, mean=0, worst=null;
    return {
      add(value,location){
        const abs=Math.abs(value);
        if(count===0||abs>max){max=abs;worst={...(typeof location==='function'?location():location),signed:value};}
        const target=mode==='mean-absolute'?abs:value;
        mean=mean*(count/(count+1))+target/(count+1);
        if(abs>scale){squares=squares*(scale/abs)**2+1; scale=abs;}
        else if(scale)squares+=(abs/scale)**2;
        count++;
      },
      result(){
        const value=mode==='peak'?max:mode==='rms'?scale*Math.sqrt(squares/(count||1)):mean;
        return {value,count,worst};
      }
    };
  }

  function steady(source,spec,trace){
    check(fields(spec,['source','path','kind','rows','valuePath','timePath','fromTime','toTime','unit',
      'channel','trace','window','target','mode'])&&finite(spec.target),'Steady state needs an explicit target');
    const {target,mode='rms',rows,valuePath,timePath,fromTime,toTime}=spec;
    check(['rms','peak','bias','mean-absolute'].includes(mode),'Invalid steady-state error reducer');
    const capture=stats(mode);
    let evidence, units;
    if(rows!==undefined){
      check(spec.channel===undefined&&spec.trace===undefined&&spec.window===undefined&&unit(spec.unit)&&
        nonnegative(fromTime)&&finite(toTime)&&toTime>fromTime,'Row steady state needs a unit and an explicit time window');
      const sequence=read(source,selector(rows)), valueAt=selector(valuePath??'/value'), timeAt=selector(timePath??'/time');
      check(Array.isArray(sequence)&&sequence.length<=262144,'Steady-state series must be bounded timestamped rows');
      let previous=-Infinity;
      for(const [i,row] of sequence.entries()){
        const time=read(row,timeAt);
        check(nonnegative(time)&&time>previous,'Steady-state row times must increase');
        previous=time;
        if(time<fromTime||time>=toTime)continue;
        const value=read(row,valueAt);
        check(finite(value)&&finite(value-target),'Steady-state row needs a finite error at index '+i);
        capture.add(value-target,{row:i,time});
      }
      evidence={rows,fromTime,toTime,valuePath:valuePath??'/value',timePath:timePath??'/time'}; units=spec.unit;
    }else{
      check([spec.unit,valuePath,timePath,fromTime,toTime].every(value=>value===undefined),
        'Sampled steady state uses a native sample window and trace units');
      const range=M.withChannel(trace(),spec);
      for(let i=range.start;i<range.end;i++){
        const sample=range.from+i-range.start, error=range.samples[i]-target;
        if(!finite(error))return unavailable(range.unit,'measurement-overflow',range.evidence);
        capture.add(error,{sample,time:sample/range.sampleRate});
      }
      evidence=range.evidence; units=range.unit;
    }
    const {value,count,worst}=capture.result();
    const details={...evidence,mode,target,count,worst};
    return count?measured(value,units,details):unavailable(units,'empty-steady-state-window',details);
  }

  function conservation(source,spec){
    check(fields(spec,['source','path','kind','metric','mode','unit'])&&id(spec.metric)&&
      (spec.unit===undefined||unit(spec.unit)),'Choose a named conservation metric');
    const {metric,mode='absolute'}=spec;
    check(['absolute','signed','ratio'].includes(mode)&&source.format===W.diagnostics.format&&source.version===1&&
      Array.isArray(source.metrics)&&source.metrics.length<=4096,'Conservation needs a native diagnostics report and a valid reducer');
    const row=source.metrics.find(row=>row?.code===metric);
    const nativeUnits={'network-energy-balance':'J','wave-flow-balance':'m^3/s'};
    const units=mode==='ratio'?'1':spec.unit??row?.details?.unit??row?.details?.units??nativeUnits[metric]??'1';
    check(unit(units),'Conservation metric needs valid units');
    const evidence={metric,mode};
    if(!row)return unavailable(units,'conservation-metric-not-found',evidence);
    check(finite(row.value)&&nonnegative(row.threshold),'Invalid conservation diagnostic '+metric);
    Object.assign(evidence,{signed:row.value,threshold:row.threshold,...(row.location!==undefined&&{location:row.location}),
      ...(row.time!==undefined&&{time:row.time}),...(row.severity!==undefined&&{diagnosticSeverity:row.severity})});
    const value=mode==='ratio'?(row.threshold>0?Math.abs(row.value)/row.threshold:row.value===0?0:null):
      mode==='signed'?row.value:Math.abs(row.value);
    return value===null?unavailable(units,'zero-conservation-tolerance',evidence):measured(value,units,evidence);
  }

  function contact(source,spec,trace){
    check(fields(spec,['source','path','kind','track','window','project','mode'])&&id(spec.track)&&
      source.format===W.contactExciters.traceFormat&&source.version===1,'Contact force needs a named native contact trace');
    const {track,project='magnitude',mode='peak'}=spec;
    check(['rms','mean','peak'].includes(mode),'Invalid contact force reducer');
    const native=trace({track,measure:'force'}), {x,y,z}=native.channels, active=source.tracks[track].active;
    check((Array.isArray(active)||ArrayBuffer.isView(active))&&active.length===native.frames,'Invalid contact activity channel');
    const {start,end,from,to,sampleRate}=M.window(native,spec.window), pick=W.soundMeasurements.projection(project);
    const vector=new Float64Array(3), capture=stats(mode);
    for(let i=start;i<end;i++){
      check(active[i]===0||active[i]===1,'Invalid contact activity flag');
      if(!active[i])continue;
      vector[0]=x.samples[i]; vector[1]=y.samples[i]; vector[2]=z.samples[i];
      const value=pick(vector), sample=from+i-start;
      check(finite(value),'Contact force needs a vector projection');
      capture.add(value,()=>({sample,time:sample/sampleRate,vector:Array.from(vector)}));
    }
    const {value,count,worst}=capture.result(), evidence={track,project,mode,sampleRate,
      firstSample:from,endSample:to,activeSamples:count,worst};
    return count?measured(value,'N',evidence):unavailable('N','no-active-contact-samples',evidence);
  }

  function names(value,min,max,label){
    check(record(value)&&Object.keys(value).length>=min&&Object.keys(value).length<=max&&Object.keys(value).every(id),
      'Invalid named '+label);
    return Object.entries(value);
  }

  function run(plan,sources){
    check(fields(plan,['format','version','id','measurements','assertions'])&&plan.format===format&&plan.version===1&&
      id(plan.id)&&record(sources),'Expected a version 1 simulation measurement plan and named sources');
    const cache=new Map(), measurements=Object.fromEntries(names(plan.measurements,1,64,'measurements').map(([name,spec])=>{
      check(record(spec)&&id(spec.source)&&own(sources,spec.source),'Missing source for measurement '+name);
      const source=G.select(sources[spec.source],spec.path);
      function trace(options=spec.trace??{}){
        check(record(options),'Expected trace measurement options');
        const key=JSON.stringify([spec.source,spec.path??null,options]);
        if(!cache.has(key))cache.set(key,W.outputAdapters.trace(source,options));
        return cache.get(key);
      }
      let result;
      if(['arrival','frequency','decay'].includes(spec.kind))result=M[spec.kind](trace(),spec);
      else if(spec.kind==='signal-compare')result=W.signalComparison.compare(trace(),spec);
      else if(spec.kind==='steady-state')result=steady(source,spec,trace);
      else if(spec.kind==='conservation')result=conservation(source,spec);
      else if(spec.kind==='contact-force')result=contact(source,spec,trace);
      else throw Error('Unknown simulation measurement kind '+spec.kind);
      return [name,{kind:spec.kind,source:spec.source,...(spec.path!==undefined&&{path:spec.path}),...result}];
    }));
    const assertions=Object.fromEntries(names(plan.assertions??{},0,128,'assertions').map(([name,spec])=>{
      check(fields(spec,['measurement','unit','min','max','expected','absolute','relative'])&&own(measurements,spec.measurement),
        'Assertion '+name+' needs a known measurement');
      const {measurement,min,max,expected,absolute=0,relative=0}=spec, row=measurements[measurement];
      check((spec.unit===undefined||spec.unit===row.unit)&&
        (expected===undefined?(min!==undefined||max!==undefined)&&(min===undefined||finite(min))&&
          (max===undefined||finite(max))&&(min===undefined||max===undefined||min<=max)&&
          spec.absolute===undefined&&spec.relative===undefined:
          finite(expected)&&min===undefined&&max===undefined&&nonnegative(absolute)&&nonnegative(relative)),
      'Invalid bounds, tolerances or unit for assertion '+name);
      const tolerance=expected===undefined?undefined:Math.max(absolute,relative*Math.abs(expected));
      check(tolerance===undefined||finite(tolerance),'Assertion tolerance exceeds the numeric range');
      const available=row.status==='ok', value=row.value;
      const passed=available&&(expected!==undefined?Math.abs(value-expected)<=tolerance:
        (min===undefined||value>=min)&&(max===undefined||value<=max));
      return [name,{measurement,passed,value,unit:row.unit,status:available?(passed?'pass':'out-of-bounds'):'unavailable',
        ...(expected!==undefined?{expected,absolute,relative,tolerance}:{...(min!==undefined&&{min}),...(max!==undefined&&{max})}),
        ...(!available&&{reason:row.reason})}];
    }));
    return {format:reportFormat,version:1,id:plan.id,passed:Object.values(assertions).every(row=>row.passed),
      measurements,assertions};
  }

  W.simulationMeasurements=Object.freeze({format,reportFormat,run});
  P.graph.operations=Object.freeze({...P.graph.operations,'sim.measure':Object.freeze({
    cacheVersion:2,description:'Measure named physical evidence, compare time and frequency estimates, and evaluate CI bounds.',
    inputs:{plan:'record',sources:'record'},
    outputs:{value:'record',measurements:'record',assertions:'record',passed:'boolean'},
    run({plan,sources}){
      const value=run(plan,sources);
      return {value,measurements:value.measurements,assertions:value.assertions,passed:value.passed};
    }
  })});
})(KIT);
