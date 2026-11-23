/* Reuse controller state and inverse fitting in graphs, worlds and headless runs. */
(function(K){
  const W=K.world,P=K.procedural,{check,record,endpoint}=W.data;
  const {fields,positive}=W.boundarySignals;
  const C=W.controllers,F=W.inverseTargets;

  function trace(asset,{dt,samples,checkpoint}={}){
    check((dt===undefined||positive(dt))&&Array.isArray(samples)&&samples.length>=1&&samples.length<=4096,
      'Controller run needs up to 4096 input samples and a positive interval');
    const run=C.prepare(asset).open(checkpoint), initial=run.view();
    const results=Array.from(samples,row=>{
      check(fields(row,['dt','target','measurement','feedForward']),'Invalid controller sample');
      const {dt:interval=dt,...input}=row;
      return run.step(interval,input);
    });
    return {format:C.traceFormat,version:1,initial,results,checkpoint:run.snapshot()};
  }

  W.runtime.register('feedback-controller',config=>{
    check(fields(config,['controller']),'Feedback controller needs config.controller');
    const model=C.prepare(config.controller);
    return {inputs:model.inputs,outputs:model.outputs,initial:model.initial,validateState:model.validate,
      step:(state,{dt,input})=>model.transition(state,dt,input),output:model.ports,
      fields:{detail:{type:'record',read:({state})=>W.query.ok(model.report(state))}}};
  });

  function worldEvaluator(plan){
    const {evaluator}=plan, {parameters,targets}=F.definitions(plan);
    check(fields(evaluator,['kind','world','inputs','outputs'])&&evaluator.kind==='world'&&record(evaluator.world)&&
      record(evaluator.inputs)&&Object.keys(evaluator.inputs).length===parameters.length&&
      record(evaluator.outputs)&&Object.keys(evaluator.outputs).length===targets.length,'Invalid world inverse evaluator');
    const root=W.runtime.create(evaluator.world), composition=root.composition();
    const connected=new Set(composition.connections.map(row=>row.to));
    function lookup(path,direction){
      check(typeof path==='string','Inverse world binding needs a system/port name');
      const [system,port]=endpoint(path);
      const spec=composition.systems[system];
      return direction==='input'?spec?.reads.inputs[port]:spec?.writes.outputs[port];
    }
    const ports=new Set();
    const inputs=parameters.map(({name,quantity})=>{
      const path=evaluator.inputs[name], descriptor=lookup(path,'input');
      check(descriptor?.type==='number'&&!ports.has(path)&&!connected.has(path),
        'Inverse parameter '+name+' needs a distinct unconnected scalar world input at '+path);
      ports.add(path);
      K.quantities.assertLink(quantity,descriptor.quantity,'parameter '+name,path,{sampled:true});
      return {name,port:path};
    });
    const byTick=new Map();
    for(const {name,array,values,quantity} of targets){
      const binding=evaluator.outputs[name];
      check(fields(binding,['port','tick'])&&Number.isSafeInteger(binding.tick)&&binding.tick>=1&&binding.tick<=10000,
        'Inverse output '+name+' needs a port and a positive world tick');
      const descriptor=lookup(binding.port,'output'), kind=array?'vec3':'number';
      check(descriptor?.type===kind&&(!array||values.length===3),'World output shape does not match inverse target '+name);
      K.quantities.assertLink(descriptor.quantity,quantity,binding.port,'target '+name,{sampled:true});
      if(!byTick.has(binding.tick))byTick.set(binding.tick,[]);
      byTick.get(binding.tick).push({name,port:binding.port});
    }
    const ticks=[...byTick.keys()].sort((a,b)=>a-b);
    const budget=plan.settings?.maxEvaluations??256;
    check(Number.isSafeInteger(budget)&&budget>=1&&budget<=4096&&ticks.at(-1)*budget<=2000000,
      'Inverse world fitting exceeds its tick budget');
    function commands(candidate){
      return inputs.map(({name,port})=>({tick:1,action:'world/input',args:{port,value:candidate[name]}}));
    }
    function evaluate(candidate){
      const run=root.reset(), measured={};
      run.schedule(commands(candidate));
      for(const tick of ticks){
        const {signals}=run.advance(tick);
        for(const {name,port} of byTick.get(tick))measured[name]=signals[port];
      }
      return measured;
    }
    return Object.freeze({evaluate,commands});
  }

  function fitWorld(plan){
    const replay=worldEvaluator(plan), result=F.fit(plan,replay.evaluate);
    return P.data.freeze({...result,...(result.parameters&&{commands:replay.commands(result.parameters)})});
  }
  W.controllers=Object.freeze({...C,trace});
  W.inverseTargets=Object.freeze({...F,fitWorld});
  const port={type:'record',default:{}};
  P.graph.operations=Object.freeze({...P.graph.operations,
    'sim.controller':Object.freeze({
      cacheVersion:1,description:'Replay a controller from timed target and measurement samples.',
      inputs:{controller:'record',samples:'array<record>',options:port,checkpoint:port},
      outputs:{value:'record',checkpoint:'record'},
      run({controller,samples,options,checkpoint}){
        check(fields(options,['dt']),'Unknown controller graph option');
        const value=trace(controller,{...options,samples,
          ...(Object.keys(checkpoint).length&&{checkpoint})});
        return {value,checkpoint:value.checkpoint};
      }
    }),
    'sim.fit-targets':Object.freeze({
      cacheVersion:1,description:'Fit a native world’s inputs within bounds at named observation ticks.',
      inputs:{plan:'record'},outputs:{value:'record'},
      run({plan}){return {value:fitWorld(plan)};}
    })
  });
})(KIT);
