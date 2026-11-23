/* Bounded target following, relay control and time-aware PID. */
(function(K){
  const W=K.world,P=K.procedural,{check,id,record,copy,equal,own}=W.data;
  const {fields,finite,nonnegative,positive}=W.boundarySignals;
  const {clamp,mix}=W.gestureScoreData,{hysteresis}=W.fields,{freeze,hash}=P.data;
  const format='ink-studio/controller', checkpointFormat='ink-studio/controller-checkpoint';
  const modes={
    follow:['timeConstant'],
    hysteresis:['low','high','off','on','active'],
    pid:['kp','ki','kd','bias','derivativeTime','integralMin','integralMax']
  };
  const shape=(value,size)=>size===1?finite(value):Array.isArray(value)&&value.length===size&&Array.from(value).every(finite);
  const parts=(value,size)=>size===1?[value]:value;
  const pack=(values,size)=>size===1?values[0]:values;
  const gain=(dt,tau)=>tau===0?1:-Math.expm1(-dt/tau);

  function prepare(asset){
    check(fields(asset,['format','version','id','revision','mode','type','settings','limits','initial','quantities'])&&
      asset.format===format&&asset.version===1&&id(asset.id)&&Number.isSafeInteger(asset.revision)&&asset.revision>0&&
      own(modes,asset.mode),'Expected a version 1 controller');
    const definition=copy(asset);
    const {mode,type='number',settings={},limits={},quantities={}}=definition, size=type==='vec3'?3:1;
    check(['number','vec3'].includes(type)&&(mode!=='hysteresis'||size===1)&&fields(settings,modes[mode])&&
      fields(limits,['min','max','rise','fall'])&&fields(quantities,['target','output']),
    'Invalid controller shape, settings or limits');
    const identity=freeze({id:asset.id,revision:asset.revision,signature:hash(JSON.stringify(definition))});
    function values(raw,fallback,label,valid=finite){
      if(raw===undefined)return Array(size).fill(fallback);
      const row=size===1||typeof raw==='number'?Array(size).fill(raw):raw;
      check(Array.isArray(row)&&row.length===size&&Array.from(row).every(valid),'Invalid controller '+label);
      return row;
    }
    const min=values(limits.min,-Infinity,'minimum'), max=values(limits.max,Infinity,'maximum');
    const rise=values(limits.rise,Infinity,'rise rate',positive), fall=values(limits.fall,Infinity,'fall rate',positive);
    const timeConstant=values(settings.timeConstant,0,'time constant',nonnegative);
    const low=values(settings.low,-.05,'lower hysteresis threshold')[0],high=values(settings.high,.05,'upper hysteresis threshold')[0];
    const on=values(settings.on,1,'on output')[0],off=values(settings.off,0,'off output')[0],active=settings.active??false;
    check(low<high&&typeof active==='boolean','Hysteresis needs ordered thresholds and a boolean initial state');
    const kp=values(settings.kp,1,'proportional gain'),ki=values(settings.ki,0,'integral gain'),
      kd=values(settings.kd,0,'derivative gain'), bias=values(settings.bias,0,'bias');
    const tau=values(settings.derivativeTime,0,'derivative time constant',nonnegative);
    const imin=values(settings.integralMin,-Infinity,'integral minimum'),imax=values(settings.integralMax,Infinity,'integral maximum');
    const start=values(definition.initial,undefined,'initial output');
    for(let i=0;i<size;i++){
      check(min[i]<=max[i]&&imin[i]<=0&&imax[i]>=0,'Controller bounds must be ordered and integral limits must cover zero');
      if(start[i]===undefined)start[i]=clamp(mode==='hysteresis'?(active?on:off):0,min[i],max[i]);
      check(start[i]>=min[i]&&start[i]<=max[i],'Initial controller output is outside its bounds');
    }
    const targetQuantity=K.quantities.normalize(quantities.target??(mode==='follow'?quantities.output:undefined),'Controller target');
    const outputQuantity=K.quantities.normalize(quantities.output??(mode==='follow'?quantities.target:undefined),'Controller output');
    if(mode==='follow'){
      K.quantities.assertLink(targetQuantity,outputQuantity,'controller target','controller output');
      K.quantities.assertLink(outputQuantity,targetQuantity,'controller output','controller target');
    }
    const zero=pack(Array(size).fill(0),size);
    const port=(defaultValue,quantity)=>({type,default:defaultValue,...(quantity&&{quantity})});
    const inputs=freeze({target:port(zero,targetQuantity),...(mode!=='follow'&&{measurement:port(zero,targetQuantity)}),
      ...(mode==='pid'&&{feedForward:port(zero,outputQuantity)})});
    const outputs=freeze({value:port(pack(start.slice(),size),outputQuantity),error:port(zero),limited:'bool',
      ...(mode==='hysteresis'&&{active:{type:'bool',default:active}})});
    const keys=['value','raw','target','measurement','error','proportional','integral','derivative','feedForward',
      'active','rateLimited','rangeLimited','integralLimited'];
    const numbers=keys.slice(0,9).filter(key=>key!=='measurement');
    const flags=keys.slice(9);

    function initial(){
      return {format:checkpointFormat,version:1,controller:identity,time:0,steps:0,
        axes:start.map(value=>({value,raw:value,target:0,measurement:null,error:0,proportional:0,integral:0,derivative:0,feedForward:0,
          active:mode==='hysteresis'&&active,rateLimited:false,rangeLimited:false,integralLimited:false}))};
    }
    function validate(state){
      check(fields(state,['format','version','controller','time','steps','axes'])&&state.format===checkpointFormat&&state.version===1&&
        equal(state.controller,identity)&&nonnegative(state.time)&&Number.isSafeInteger(state.steps)&&state.steps>=0&&
        Array.isArray(state.axes)&&state.axes.length===size,'Incompatible controller checkpoint');
      check(Array.from(state.axes).every((row,i)=>fields(row,keys)&&numbers.every(key=>finite(row[key]))&&
        (row.measurement===null||finite(row.measurement))&&flags.every(key=>typeof row[key]==='boolean')&&
        row.value>=min[i]&&row.value<=max[i]&&row.integral>=imin[i]&&row.integral<=imax[i]&&
        (state.steps===0||mode==='follow'||row.measurement!==null)),'Invalid controller checkpoint state');
      check(state.steps!==0||equal(state,initial()),'Invalid initial controller checkpoint');
    }
    function transition(state,dt,input){
      const time=state.time+dt, steps=state.steps+1;
      check(positive(dt)&&finite(time)&&time>state.time&&Number.isSafeInteger(steps)&&
        fields(input,Object.keys(inputs))&&shape(input.target,size)&&
        (mode==='follow'||shape(input.measurement,size))&&(input.feedForward===undefined||shape(input.feedForward,size)),
      'Controller step needs a positive interval and finite inputs matching its ports');
      const goal=parts(input.target,size), measured=input.measurement===undefined?null:parts(input.measurement,size);
      const feed=parts(input.feedForward??zero,size);
      const axes=state.axes.map((prior,i)=>{
        const target=goal[i],measurement=measured?.[i]??null,feedForward=feed[i];
        const error=target-(measurement??prior.value);
        const lower=Math.max(min[i],prior.value-fall[i]*dt), upper=Math.min(max[i],prior.value+rise[i]*dt);
        let raw, proportional=0,integral=0,derivative=0,active=false,integralLimited=false;
        if(mode==='follow'){
          raw=mix(prior.value,target,gain(dt,timeConstant[i]));
        }else if(mode==='hysteresis'){
          active=hysteresis(prior.active,error,low,high);
          raw=active?on:off;
        }else{
          proportional=kp[i]*error;
          const slope=kd[i]===0||prior.measurement===null?0:-kd[i]*((measurement-prior.measurement)/dt);
          derivative=mix(prior.derivative,slope,gain(dt,tau[i]));
          const base=bias[i]+feedForward+proportional+derivative;
          const candidate=prior.integral+ki[i]*error*dt;
          const preferred=clamp(candidate,imin[i],imax[i]);
          // Allow the integral to advance up to the reachable command, including a slew-limited first step.
          integral=preferred>prior.integral?Math.min(preferred,Math.max(prior.integral,upper-base)):
            Math.max(preferred,Math.min(prior.integral,lower-base));
          integralLimited=integral!==candidate;
          raw=base+integral;
          check(finite(candidate)&&finite(base),'Controller PID exceeded numeric range on axis '+i);
        }
        const ranged=clamp(raw,min[i],max[i]), value=clamp(ranged,lower,upper);
        check([error,raw,value,proportional,integral,derivative].every(finite),'Controller exceeded numeric range on axis '+i);
        return {value,raw,target,measurement,error,proportional,integral,derivative,feedForward,active,
          rateLimited:value!==ranged,rangeLimited:ranged!==raw,integralLimited};
      });
      return {...state,time,steps,axes};
    }
    function ports(state){
      const {axes}=state;
      return {value:pack(axes.map(row=>row.value),size),error:pack(axes.map(row=>row.error),size),
        limited:axes.some(row=>row.rateLimited||row.rangeLimited||row.integralLimited),
        ...(mode==='hysteresis'&&{active:axes[0].active})};
    }
    function report(state){
      return {controller:identity,mode,type,time:state.time,steps:state.steps,...ports(state),axes:copy(state.axes)};
    }
    function open(saved){
      if(saved!==undefined)validate(saved);
      let state=saved===undefined?initial():copy(saved);
      return Object.freeze({
        step(dt,input){const next=transition(state,dt,input);state=next;return report(next);},
        view:()=>report(state),snapshot:()=>copy(state),
        restore(saved){validate(saved);state=copy(saved);},reset(){state=initial();}
      });
    }
    return Object.freeze({identity,inputs,outputs,initial,validate,transition,ports,report,open});
  }

  W.controllers=Object.freeze({format,checkpointFormat,runFormat:'ink-studio/controller-run',
    traceFormat:'ink-studio/controller-trace',prepare});
})(KIT);
