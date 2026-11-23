/* Prepared state integration with bounded error control and bracketed events. */
(function(K){
  const W=K.world, {check,id,record,equal}=W.data;
  const finite=Number.isFinite, positive=n=>finite(n)&&n>0;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const format='ink-studio/integrator-state';
  const methods=['rk4','semi-implicit','adaptive'], stageWeights=[0,.5,.5,1];
  const vector=(value,size)=>value!=null&&(Array.isArray(value)||ArrayBuffer.isView(value))&&
    value.length===size&&Array.from(value).every(finite);
  const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));

  function steps(size,derivative,acceleration){
    const make=()=>new Float64Array(size);
    const work=make(), slopes=Array.from({length:4},make), coarse=make(), half=make();
    const force=acceleration&&new Float64Array(size/2);
    function rk4(time,state,dt,end,out,input,stats){
      for(let stage=0;stage<4;stage++){
        const weight=stageWeights[stage];
        if(stage){
          for(let i=0;i<size;i++)work[i]=state[i]+dt*weight*slopes[stage-1][i];
          check(work.every(finite),'RK4 produced non-finite stage state');
        }
        const rate=slopes[stage];
        rate.fill(NaN);
        const stageTime=stage===3?end:time+dt*weight;
        derivative(stageTime,stage?work:state,rate,input);
        stats.evaluations++;
        check(rate.every(finite),'Integrator derivative must write a finite rate for every component');
      }
      const [a,b,c,d]=slopes;
      for(let i=0;i<size;i++)out[i]=state[i]+dt*((a[i]+d[i])/6+b[i]/3+c[i]/3);
      check(out.every(finite),'RK4 produced non-finite state');
    }
    function symplectic(time,state,dt,_end,out,input,stats){
      const n=force.length;
      force.fill(NaN);
      acceleration(time,state.subarray(0,n),state.subarray(n),force,input);
      stats.evaluations++;
      check(force.every(finite),'Integrator acceleration must write a finite value for every component');
      for(let i=0;i<n;i++){
        out[i+n]=state[i+n]+dt*force[i];
        out[i]=state[i]+dt*out[i+n];
      }
      check(out.every(finite),'Semi-implicit Euler produced non-finite state');
    }
    function fine(time,state,dt,end,out,input,stats){
      const middle=time+dt/2;
      rk4(time,state,middle-time,middle,half,input,stats);
      rk4(middle,half,end-middle,end,out,input,stats);
    }
    function trial(time,state,dt,end,out,input,stats,tolerances,relative,evidence){
      rk4(time,state,dt,end,coarse,input,stats);
      fine(time,state,dt,end,out,input,stats);
      let error=0, component=0;
      for(let i=0;i<size;i++){
        const scale=tolerances[i]+relative*Math.max(Math.abs(state[i]),Math.abs(out[i]));
        const difference=out[i]-coarse[i];
        const correction=finite(difference)?difference/15:out[i]/15-coarse[i]/15;
        const ratio=Math.abs(correction)/scale;
        if(ratio>error){error=ratio;component=i;}
      }
      if(evidence)evidence.component=component;
      return error;
    }
    return {rk4,'semi-implicit':symplectic,adaptive:fine,trial};
  }

  function eventDefinitions(raw){
    const seen=new Set();
    check(Array.isArray(raw)&&raw.length<=32,'Use at most 32 integrator event definitions');
    return Array.from(raw,row=>{
      const {id:name,value,direction='either',terminal=false,react}=row??{};
      check(id(name)&&!seen.has(name)&&typeof value==='function'&&['either','rising','falling'].includes(direction)&&
        typeof terminal==='boolean'&&(react===undefined||typeof react==='function'),'Invalid or duplicate integrator event');
      seen.add(name);
      return {id:name,value,direction,terminal,react};
    });
  }

  function crossing(a,b,direction){
    return (direction!=='falling'&&a<0&&b>=0)||(direction!=='rising'&&a>0&&b<=0);
  }

  function create(options={}){
    const {initial,time:initialTime=0,method='rk4',derivative,acceleration,step=1/60,maxStep=step,
      minStep=Math.min(step,maxStep)*1e-6,absoluteTolerance=1e-8,relativeTolerance=1e-6,
      eventStep=maxStep,eventTolerance=1e-9,maxSteps=10000,maxEvents=64}=options;
    const size=initial?.length, adaptive=method==='adaptive', mechanical=method==='semi-implicit';
    const tolerances=typeof absoluteTolerance==='number'&&integer(size,1,4096)?
      Array(size).fill(absoluteTolerance):absoluteTolerance;
    check(methods.includes(method)&&integer(size,1,4096)&&vector(initial,size)&&finite(initialTime)&&
      (mechanical?size%2===0&&typeof acceleration==='function':typeof derivative==='function'),
    'Integrator needs finite initial state and the callback for its method');
    check([step,minStep,maxStep,eventStep,eventTolerance].every(positive)&&minStep<=step&&step<=maxStep&&
      vector(tolerances,size)&&Array.from(tolerances).every(positive)&&finite(relativeTolerance)&&relativeTolerance>=0&&
      integer(maxSteps,1,100000)&&integer(maxEvents,1,256),'Invalid integrator step, tolerance, or work limit');
    const definitions=eventDefinitions(options.events??[]);
    const stepLimit=definitions.length?Math.min(maxStep,eventStep):maxStep;
    check(!adaptive||stepLimit>=minStep,'Integrator eventStep must cover the adaptive minimum step');
    const settings=K.procedural.data.freeze({method,step,minStep,maxStep,eventStep,eventTolerance,maxSteps,maxEvents,
      absoluteTolerance:Array.from(tolerances),relativeTolerance,
      events:definitions.map(({id,direction,terminal})=>({id,direction,terminal}))});
    const start=Float64Array.from(initial);
    const buffers=Array.from({length:5},()=>new Float64Array(size));
    const [committed,first,second,rootState,eventState]=buffers;
    const solver=steps(size,derivative,mechanical?acceleration:undefined), replay=solver[method];
    const clock={time:initialTime,nextStep:step};
    let busy=false;
    committed.set(start);
    const diagnostics=options.diagnostics??(options.invariants===undefined?undefined:true);
    const originalReview=diagnostics===undefined?null:W.diagnostics.create(diagnostics);
    let review=originalReview?.fork(), reviewStart=initialTime, maxAcceptedDt=0;
    const invariants=options.invariants??{};
    check(record(invariants)&&Object.keys(invariants).length<=32,'Expected up to 32 named integrator invariants');
    const probes=Object.entries(invariants).map(([name,probe])=>{
      const {measure}=probe??{};
      check(id(name)&&name.length<=80&&record(probe)&&typeof measure==='function',
        'Invalid integrator invariant '+name);
      const expected=probe.expected??measure(initialTime,start.slice());
      check(finite(expected),'Integrator invariant '+name+' needs a finite expected value');
      return {name,measure,expected};
    });
    function inspect(block,time,state){
      if(!block||!probes.length)return;
      const sample=Object.freeze(Array.from(state));
      for(const {name,measure,expected} of probes){
        const actual=measure(time,sample);
        check(finite(actual),'Integrator invariant '+name+' returned a non-finite value');
        block.error('invariant.'+name,actual-expected,Math.max(Math.abs(expected),Math.abs(actual)),
          {kind:'invariant',name},time,{actual,expected});
      }
    }
    function resetReview(){
      if(originalReview){
        review=originalReview.fork();
        reviewStart=clock.time;
        maxAcceptedDt=0;
      }
    }

    function value(event,time,state,input,stats){
      const result=event.value(time,state,input);
      stats.eventEvaluations++;
      check(finite(result),'Integrator event '+event.id+' must return a finite number');
      return result;
    }

    function locate(event,left,right,state,before,after,input,stats){
      if(after===0)return right;
      let lo=left,hi=right;
      for(let i=0;i<64&&hi-lo>eventTolerance;i++){
        const mid=lo+(hi-lo)/2;
        if(mid===lo||mid===hi)return hi;
        replay(left,state,mid-left,mid,rootState,input,stats);
        stats.eventIterations++;
        const sample=value(event,mid,rootState,input,stats);
        if(sample===0)return mid;
        if((sample<0)===(before<0))lo=mid;
        else hi=mid;
      }
      check(hi-lo<=eventTolerance,'Integrator could not localize the event within its iteration budget');
      return hi;
    }

    function advance(target,input){
      check(!busy,'Integrator is already advancing');
      check(finite(target)&&target>=clock.time&&finite(target-clock.time),'Integrator target must be a finite forward time');
      let time=clock.time, nextStep=clock.nextStep, current=first, candidate=second, terminal=null;
      const stats={acceptedSteps:0,rejectedSteps:0,evaluations:0,eventEvaluations:0,eventIterations:0};
      const events=[];
      const block=review?.fork(), evidence=block&&{};
      let acceptedMax=maxAcceptedDt;
      current.set(committed);
      busy=true;
      try {
        let before=time<target?definitions.map(event=>value(event,time,current,input,stats)):[];
        for(let attempts=0;time<target;attempts++){
          check(attempts<maxSteps,'Integrator step budget exceeded');
          const span=Math.min(adaptive?nextStep:step,stepLimit);
          const remaining=target-time;
          const proposed=time+span;
          check(proposed>time||remaining<=span,'Integrator step is below the time resolution');
          const roundoff=2*Number.EPSILON*Math.max(Math.abs(time),Math.abs(target),span);
          const end=remaining-span<=roundoff?target:Math.min(target,proposed);
          const dt=end-time;
          if(adaptive){
            const error=solver.trial(time,current,dt,end,candidate,input,stats,settings.absoluteTolerance,relativeTolerance,evidence);
            const growth=error===0?4:clamp(.9*error**(-.2),.2,4);
            nextStep=clamp(dt*growth,minStep,maxStep);
            if(error>1){
              check(dt>minStep&&time+nextStep<end,'Integrator cannot meet tolerance at the minimum step');
              stats.rejectedSteps++;
              continue;
            }
            if(block)block.limit('adaptive-trial-error',error,1,{kind:'component',index:evidence.component},end,{dt});
          }else replay(time,current,dt,end,candidate,input,stats);

          const after=definitions.map(event=>value(event,end,candidate,input,stats));
          const found=[];
          let earliest=end;
          for(const [i,event] of definitions.entries())if(crossing(before[i],after[i],event.direction)){
            const at=locate(event,time,end,current,before[i],after[i],input,stats);
            found.push({event,at});
            earliest=Math.min(earliest,at);
          }
          stats.acceptedSteps++;
          if(!found.length){
            [current,candidate]=[candidate,current];
            if(block){acceptedMax=Math.max(acceptedMax,end-time);inspect(block,end,current);}
            time=end;
            before=after;
            continue;
          }

          const due=found.filter(row=>row.at-earliest<=eventTolerance);
          const at=Math.max(...due.map(row=>row.at));
          check(at>time&&events.length+due.length<=maxEvents,'Integrator event budget or time resolution exceeded');
          if(at===end)eventState.set(candidate);
          else replay(time,current,at-time,at,eventState,input,stats);
          for(const {event} of due){
            const left=Array.from(eventState);
            event.react?.(at,eventState,input);
            check(eventState.every(finite),'Integrator event reaction produced non-finite state');
            events.push({id:event.id,time:at,before:left,after:Array.from(eventState),terminal:event.terminal});
            if(event.terminal&&terminal===null)terminal=event.id;
          }
          if(block){acceptedMax=Math.max(acceptedMax,at-time);inspect(block,at,eventState);}
          time=at;
          current.set(eventState);
          if(terminal!==null)break;
          before=definitions.map(event=>value(event,time,current,input,stats));
        }
        if(block){review.merge(block);maxAcceptedDt=acceptedMax;}
        committed.set(current);
        Object.assign(clock,{time,nextStep});
      }finally{busy=false;}
      return {time,state:Array.from(committed),terminal,events,stats};
    }

    function snapshot(){
      return {format,version:1,settings,time:clock.time,nextStep:clock.nextStep,state:Array.from(committed)};
    }
    function restore(saved){
      check(!busy,'Integrator is already advancing');
      check(saved?.format===format&&saved.version===1&&record(saved.settings)&&equal(saved.settings,settings)&&
        finite(saved.time)&&finite(saved.nextStep)&&saved.nextStep>=minStep&&saved.nextStep<=maxStep&&vector(saved.state,size),
      'Incompatible integrator snapshot');
      committed.set(saved.state);
      Object.assign(clock,{time:saved.time,nextStep:saved.nextStep});
      resetReview();
    }
    function reset(){
      check(!busy,'Integrator is already advancing');
      committed.set(start);
      Object.assign(clock,{time:initialTime,nextStep:step});
      resetReview();
    }
    return Object.freeze({advance,snapshot,restore,reset,...(review&&{
      diagnostics:()=>review.report({solver:'integrator',method,from:reviewStart,to:clock.time,
        configuredStep:step,stepCap:stepLimit,maxAcceptedDt})
    })});
  }

  W.integrators=Object.freeze({format,methods:Object.freeze(methods),create});
})(KIT);
