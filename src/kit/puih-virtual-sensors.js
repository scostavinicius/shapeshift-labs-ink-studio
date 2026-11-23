/* Versioned physical sensor rigs with calibration, taring and portable history. */
(function(K){
  const W=K.world,P=K.procedural,{check,copy,equal,id,own,record}=W.data;
  const {fields,finite,nonnegative,positive}=W.boundarySignals;
  const {clamp,mix}=W.gestureScoreData,M=W.sensorSources;
  const format='ink-studio/sensor-rig',checkpointFormat='ink-studio/sensor-checkpoint', reportFormat='ink-studio/sensor-report';
  const kindUnits={microphone:'Pa','pressure-tap':'Pa','displacement-probe':'m','strain-gauge':'1','flow-meter':'m^3/s','event-counter':'1'};
  const maxEvents=10000;
  const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;

  function sensor(name,raw){
    check(fields(raw,['kind','source','quantity','calibration','responseTime','reference','filter'])&&own(kindUnits,raw.kind),
      'Invalid sensor '+name);
    const {kind,source,calibration={},responseTime=0,filter={},reference=source?.kind==='geometry'?'initial':null}=raw;
    const bound=M.prepare(name,kind,source), counter=kind==='event-counter',flow=kind==='flow-meter';
    const unit=bound.type==='acoustic'?'1':kindUnits[kind];
    check(fields(calibration,['gain','offset','min','max'])&&nonnegative(responseTime), 'Invalid sensor response '+name);
    const {gain=1,offset=0,min=-Infinity,max=Infinity}=calibration;
    check(finite(gain)&&finite(offset)&&(calibration.min===undefined||finite(min))&&(calibration.max===undefined||finite(max))&&
      min<=max&&(!counter||responseTime===0&&Object.keys(calibration).length===0)&&
      (bound.type==='geometry'&&(reference==='initial'||finite(reference)&&(kind!=='strain-gauge'||positive(reference)))||
      bound.type!=='geometry'&&reference===null),'Invalid sensor calibration or geometry reference '+name);
    check(fields(filter,['kind','source','phase','system'])&&Object.values(filter).every(value=>
      typeof value==='string'&&value.length>0&&value.length<=96)&&
      (counter||Object.keys(filter).length===0),'Invalid sensor event filter '+name);
    const quantity=K.quantities.normalize(raw.quantity??{unit},'Sensor '+name);
    const canonical={...quantity,unit};
    check(!counter||quantity.unit==='1','Event count units are dimensionless integers');
    const display=K.quantities.converter(canonical,quantity), convertBack=K.quantities.converter(quantity,canonical);
    return {name,kind,bound,counter,flow,unit,canonical,quantity,gain,offset,min,max,responseTime,filter,reference,display,convertBack};
  }

  function fresh(spec){
    return {status:'missing',valid:false,seen:false,raw:null,value:0,reference:finite(spec.reference)?spec.reference:null,detail:null,
      ...(spec.flow&&{forward:0,reverse:0}),...(spec.counter&&{count:0,delta:0,lastEventTime:null})};
  }

  function count(spec,state,rows,through){
    if(rows===undefined)return {...state,status:'missing',valid:false,raw:null,delta:0};
    check(Array.isArray(rows)&&rows.length<=maxEvents,'Sensor event batch exceeds its budget');
    let delta=0,lastEventTime=state.lastEventTime;
    const pairs=Object.entries(spec.filter);
    for(const event of rows){
      check(record(event),'Event counter needs event records');
      if(!pairs.every(([key,selected])=>event[key]===selected))continue;
      delta++;
      const time=W.timedEvents.timeOf(event)??event.time??through;
      check(nonnegative(time),'Invalid sensor event time');
      lastEventTime=Math.max(lastEventTime??0,time);
    }
    const total=state.count+delta;
    check(Number.isSafeInteger(total),'Sensor counter exceeded the safe integer range');
    return {...state,raw:delta,status:'ok',valid:true,seen:true,value:total,count:total,delta,lastEventTime};
  }

  function signal(spec,state,dt,measurement){
    const {status,detail=null}=measurement;
    let {raw}=measurement, reference=state.reference;
    if(raw===null)return {...state,status,valid:false,raw:null,detail};
    if(spec.bound.type==='geometry'){
      if(reference===null){
        if(spec.kind==='strain-gauge'&&raw<=0)return {...state,status:'invalid-reference',valid:false,raw:null,detail};
        reference=raw;
      }
      raw=spec.kind==='strain-gauge'?(raw-reference)/reference:raw-reference;
    }
    const calibrated=spec.display(raw*spec.gain+spec.offset), bounded=clamp(calibrated,spec.min,spec.max);
    const alpha=spec.responseTime===0||!state.seen?1:-Math.expm1(-dt/spec.responseTime);
    const measured=mix(state.value,bounded,alpha);
    check([raw,calibrated,measured].every(finite),'Sensor '+spec.name+' exceeded its numeric range');
    const next={status,valid:true,seen:true,raw,value:measured,reference,detail};
    if(spec.flow){
      // Integrate the current interval's calibrated flow before applying display lag.
      const amount=spec.convertBack(bounded)*dt;
      next.forward=state.forward+Math.max(0,amount);
      next.reverse=state.reverse+Math.max(0,-amount);
      check([next.forward,next.reverse].every(finite),'Flow meter total exceeded its numeric range');
    }
    return next;
  }

  function prepare(asset){
    check(fields(asset,['format','version','id','revision','sensors'])&&asset.format===format&&asset.version===1&&
      id(asset.id)&&integer(asset.revision,1,Number.MAX_SAFE_INTEGER)&&record(asset.sensors)&&
      integer(Object.keys(asset.sensors).length,1,128)&&Object.keys(asset.sensors).every(n=>id(n)&&n.length<=76),
    'Expected a version 1 sensor rig');
    const specs=Object.entries(copy(asset.sensors)).map(([name,raw])=>sensor(name,raw));
    const {freeze,hash}=P.data;
    const identity=freeze({id:asset.id,revision:asset.revision,signature:hash(JSON.stringify(asset))});
    const info=freeze({identity,sensors:Object.fromEntries(specs.map(spec=>[spec.name,{
      kind:spec.kind,source:copy(asset.sensors[spec.name].source),quantity:spec.quantity,rawUnit:spec.unit,
      ...(spec.flow&&{totalUnit:'m^3'})
    }]))});
    const inputs={}, outputs={};
    function port(table,k,descriptor,shared=false){
      check(id(k)&&(!own(table,k)||shared&&equal(table[k],descriptor)),'Conflicting sensor port '+k);
      table[k]=descriptor;
    }
    for(const spec of specs){
      const {name,bound,counter,flow,quantity,canonical}=spec;
      if(bound.type==='input')port(inputs,bound.port,counter?{type:'event'}:{type:'number',quantity:canonical},true);
      port(outputs,name,{type:'number',quantity});
      port(outputs,name+'.valid','bool');
      if(flow)port(outputs,name+'.total',{type:'number',quantity:{unit:'m^3'}});
      if(counter)port(outputs,name+'.delta',{type:'number',quantity:{unit:'1'}});
    }
    function initial(time=0){
      check(nonnegative(time),'Sensor clock must start at a nonnegative time');
      return {format:checkpointFormat,version:1,rig:identity,time,steps:0,
        sensors:Object.fromEntries(specs.map(spec=>[spec.name,fresh(spec)]))};
    }
    function validate(state){
      check(fields(state,['format','version','rig','time','steps','sensors'])&&state.format===checkpointFormat&&state.version===1&&
        equal(state.rig,identity)&&nonnegative(state.time)&&integer(state.steps,0,Number.MAX_SAFE_INTEGER)&&
        record(state.sensors)&&Object.keys(state.sensors).length===specs.length,'Incompatible sensor checkpoint');
      for(const spec of specs){
        const row=state.sensors[spec.name], shape=fresh(spec);
        check(fields(row,Object.keys(shape))&&Object.keys(row).length===Object.keys(shape).length&&typeof row.status==='string'&&
          typeof row.seen==='boolean'&&typeof row.valid==='boolean'&&finite(row.value)&&
          (row.raw===null||finite(row.raw))&&(row.reference===null||finite(row.reference))&&
          (row.detail===null||record(row.detail))&&(!row.valid||row.seen&&row.raw!==null)&&
          (spec.reference==='initial'?(spec.kind!=='strain-gauge'||row.reference===null||positive(row.reference)):
            row.reference===spec.reference)&&
          (!spec.flow||nonnegative(row.forward)&&nonnegative(row.reverse))&&
          (!spec.counter||integer(row.count,0,Number.MAX_SAFE_INTEGER)&&integer(row.delta,0,row.count)&&
            row.value===row.count&&(row.lastEventTime===null||nonnegative(row.lastEventTime))),
        'Invalid sensor checkpoint row '+spec.name);
      }
    }
    function step(state,dt,ctx={},phase='all'){
      check(nonnegative(dt)&&finite(ctx.time??state.time+dt)&&(dt===0||integer(state.steps+1,1,Number.MAX_SAFE_INTEGER)),
        'Invalid sensor interval');
      const time=ctx.time??state.time+dt;
      check(time>=state.time,'Sensor clock cannot move backward');
      const sensors={...state.sensors};
      for(const spec of specs){
        const world=spec.bound.type==='world-events';
        if(phase==='world'&&!world||phase==='ports'&&world||dt===0&&spec.counter)continue;
        const reading=spec.bound.read(ctx), prior=sensors[spec.name];
        sensors[spec.name]=spec.counter?count(spec,prior,reading,time):signal(spec,prior,dt,reading);
      }
      return {...state,time,steps:state.steps+(dt>0&&phase!=='world'?1:0),sensors};
    }
    function report(state){
      return {time:state.time,steps:state.steps,sensors:Object.fromEntries(specs.map(({name,flow})=>{
        const {seen,...row}=state.sensors[name];
        return [name,{...copy(row),...(flow&&{total:row.forward-row.reverse})}];
      }))};
    }
    function ports(state){
      const values={};
      for(const spec of specs){
        const {name,flow,counter}=spec,row=state.sensors[name];
        values[name]=row.value;values[name+'.valid']=row.valid;
        if(flow)values[name+'.total']=row.forward-row.reverse;
        if(counter)values[name+'.delta']=row.delta;
      }
      return values;
    }
    function open(saved){
      if(saved!==undefined)validate(saved);
      let state=saved===undefined?initial():copy(saved);
      return Object.freeze({
        step(dt,ctx){check(positive(dt),'Sensor step needs a positive interval');state=step(state,dt,ctx);return report(state);},
        sample(ctx={}){state=step(state,0,ctx);return report(state);},
        view:()=>report(state),snapshot:()=>copy(state),
        restore(saved){validate(saved);state=copy(saved);},reset(){state=initial();}
      });
    }
    return Object.freeze({info,inputs:freeze(inputs),outputs:freeze(outputs),specs:freeze(specs),initial,validate,step,signal,report,ports,open});
  }

  W.virtualSensors=Object.freeze({format,checkpointFormat,reportFormat,runFormat:'ink-studio/sensor-run',prepare});
})(KIT);
