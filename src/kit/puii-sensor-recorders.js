/* Record the same instrumentation on native world ticks and wave sample blocks. */
(function(K){
  const W=K.world,P=K.procedural,S=W.virtualSensors,{check,record,endpoint}=W.data;
  const {fields,finite}=W.boundarySignals;
  const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
  const series=value=>Array.isArray(value)||ArrayBuffer.isView(value)&&typeof value.length==='number';
  const aligned=(a,b)=>a===b||Math.abs(a-b)<=4*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b));

  function wave(asset,trace,{checkpoint}={}){
    const model=S.prepare(asset), {sampleRate}=trace?.info??{}, {start,end}=trace??{}, count=end-start;
    check(trace?.format===W.waveNetworks.traceFormat&&trace.version===1&&integer(sampleRate,1000,192000)&&
      integer(start,0,Number.MAX_SAFE_INTEGER)&&integer(end,start+1,Number.MAX_SAFE_INTEGER)&&
      integer(count,1,262144)&&count*model.specs.length<=1000000,'Expected a bounded native wave trace');
    const dt=1/sampleRate, time=start/sampleRate;
    const state=checkpoint??model.initial(time);
    model.validate(state);
    check(aligned(state.time,time)&&Number.isSafeInteger(state.steps+count),'Sensor checkpoint disagrees with the wave sample clock');
    const sensors={}, readings={}, statistics={};
    for(const spec of model.specs){
      const {name,bound,quantity}=spec;
      check(bound.type==='wave','Wave recording needs a native wave probe on '+name);
      check(quantity.sampleRate===undefined||K.quantities.equalRate(quantity.sampleRate,sampleRate),
        'Wave microphone or tap cadence does not match its probe on '+name);
      const input=trace[bound.measure]?.[bound.probe];
      check(series(input)&&input.length===count,'Wave trace is missing '+bound.measure+' probe '+bound.probe);
      let current=state.sensors[name], min=Infinity,max=-Infinity,scale=0,scaledSquares=0;
      const output=new Array(count);
      for(let i=0;i<count;i++){
        const raw=input[i];
        check(finite(raw),'Wave probe '+bound.probe+' returned a non-finite sample');
        current=model.signal(spec,current,dt,{status:'ok',raw});
        const level=output[i]=current.value, absolute=Math.abs(level);
        min=Math.min(min,level);max=Math.max(max,level);
        if(absolute>scale){scaledSquares=scaledSquares*(scale/absolute)**2+1;scale=absolute;}
        else if(scale)scaledSquares+=(absolute/scale)**2;
      }
      sensors[name]=current;readings[name]=output;
      statistics[name]={min,max,peak:Math.max(Math.abs(min),Math.abs(max)),rms:scale*Math.sqrt(scaledSquares/count)};
    }
    const final={...state,time:end/sampleRate,steps:state.steps+count,sensors};
    return {format:S.reportFormat,version:1,kind:'wave',rig:model.info,sampleRate,start,end,readings,statistics,
      endpoint:model.report(final),checkpoint:final};
  }

  function assertFields(model,query){
    for(const {name,bound} of model.specs){
      for(const field of bound.fields)check(query.field(field),'Sensor '+name+' references unknown field '+field);
      if(bound.type==='acoustic')check(query.field(bound.fields[0])?.role==='acoustic-hearing',
        'Microphone '+name+' needs an acoustic propagation field');
    }
  }
  function world(asset,run,{steps,every=1,bindings={},checkpoint,includeWorldCheckpoint=false}={}){
    const model=S.prepare(asset), total=model.specs.length;
    check(integer(steps,0,W.runtime.maxTick)&&integer(every,1,W.runtime.maxTick)&&
      (steps+1)*total<=2000000&&(Math.ceil(steps/every)+1)*total<=100000&&record(bindings)&&
      typeof includeWorldCheckpoint==='boolean'&&model.specs.every(spec=>spec.bound.type!=='wave'),
    'Invalid world sensor schedule, source, or work budget');
    const context=run.composition();
    for(const [input,path] of Object.entries(bindings)){
      const expected=model.inputs[input];
      check(expected?.type==='number'&&typeof path==='string','World recorder bindings require a numeric sensor input');
      const [system,port]=endpoint(path), actual=context.systems[system]?.writes.outputs[port];
      check(actual?.type==='number','Sensor recorder needs a known scalar scene output at '+path);
      if(actual.quantity)K.quantities.assertLink(actual.quantity,expected.quantity,path,input,{sampled:true});
    }
    const from=run.view(), until=from.tick+steps;
    check(until<=W.runtime.maxTick,'World sensor run exceeds its tick range');
    assertFields(model,run.query());
    const T=P.takeTime;
    let rate;
    for(const spec of model.specs)if(spec.quantity.sampleRate!==undefined){
      rate??=K.quantities.rateValue(T.div(T.read(1),T.period(from.world.dt)));
      check(K.quantities.equalRate(spec.quantity.sampleRate,rate),'Sensor '+spec.name+' cadence does not match its world clock');
    }
    let state=checkpoint??model.initial(from.time);
    model.validate(state);
    check(aligned(state.time,from.time),'Sensor checkpoint does not match the world time');
    function sample(frame,dt,events){
      const inputs=Object.fromEntries(Object.entries(bindings).map(([key,path])=>[key,frame.signals[path]]));
      state=model.step(state,dt,{query:run.query(),inputs,events,time:frame.time});
    }
    if(!checkpoint)sample(from,0,[]);
    const frames=[{tick:from.tick,...model.report(state)}];
    for(let tick=from.tick+1;tick<=until;tick++){
      run.step();
      sample(run.view(),from.world.dt,run.events);
      if(tick===until||(tick-from.tick)%every===0)frames.push({tick,...model.report(state)});
    }
    return {format:S.reportFormat,version:1,kind:'world',rig:model.info,from:from.tick,to:until,dt:from.world.dt,frames,checkpoint:state,
      ...(includeWorldCheckpoint&&{worldCheckpoint:run.checkpoint()})};
  }

  W.runtime.register('virtual-sensors',config=>{
    check(fields(config,['rig']),'Virtual sensor system needs config.rig');
    const model=S.prepare(config.rig), history=model.specs.some(spec=>spec.bound.type==='world-events');
    check(model.specs.every(spec=>spec.bound.type!=='wave'),'Use a wave recorder for native wave probes');
    return {inputs:model.inputs,outputs:model.outputs,initial:model.initial.bind(null,0),validateState:model.validate,
      checkFields:query=>assertFields(model,query),
      settleInitial:(state,{query})=>model.step(state,0,{query}),
      step:(state,{dt,time,input,query})=>model.step(state,dt,{time,inputs:input,query},'ports'),
      ...(history&&{afterStep:(state,{dt,time,events})=>model.step(state,dt,{time,events},'world')}),
      output:model.ports,
      fields:{readings:{type:'record',read:({state,args})=>{
        const report=model.report(state);
        if(args.sensor===undefined)return W.query.ok(report);
        const selected=report.sensors[args.sensor];
        return Object.hasOwn(report.sensors,args.sensor)?W.query.ok(selected):W.query.missing('unknown sensor');
      }}}
    };
  });

  W.virtualSensors=Object.freeze({...S,wave,world});
  const options={type:'record',default:{}};
  P.graph.operations=Object.freeze({...P.graph.operations,'sim.wave-sensors':Object.freeze({
    cacheVersion:1,description:'Record calibrated pressure, flow, and virtual microphone samples from a native wave trace.',
    inputs:{rig:'record',trace:'record',checkpoint:options},outputs:{value:'record',checkpoint:'record'},
    run({rig,trace,checkpoint}){
      const value=wave(rig,trace,Object.keys(checkpoint).length?{checkpoint}:{});
      return {value,checkpoint:value.checkpoint};
    }
  })});
})(KIT);
