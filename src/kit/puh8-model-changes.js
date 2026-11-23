/* Sample-timed controls and prepared topology swaps for scalar block models. */
(function (K) {
  const W=K.world, {check,copy,endpoint,equal,id,own,record}=W.data, {freeze}=K.procedural.data;
  const format='ink-studio/simulation-model-changes', checkpointFormat='ink-studio/model-changes-checkpoint';
  const maxSample=W.runtime.maxTick, maxEdits=4096, maxSwaps=128, maxBytes=256*1024*1024;
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const fields=(value,names)=>record(value)&&Object.keys(value).every(key=>names.includes(key));
  const floating=type=>type==='Float32Array'||type==='Float64Array';
  const accepted=status=>status==='ok'||status==='deadline';

  // The last key at or before this sample, or -1 before the first key.
  function keyAt(keys,sample) {
    let lo=0, hi=keys.length;
    while (lo<hi) {
      const mid=(lo+hi)>>>1;
      if (keys[mid].sample<=sample) lo=mid+1;
      else hi=mid;
    }
    return lo-1;
  }

  function valueAt(lane,key,sample) {
    if (!key) return lane.initial;
    if (sample>=key.end) return key.value;
    const t=(sample-key.sample)/(key.end-key.sample);
    const weight=key.curve==='smoothstep'?t*t*(3-2*t):t;
    return (1-weight)*key.from+weight*key.value;
  }

  function create(raw,{checkpoint:saved,onBlock}={}) {
    check(fields(raw,['format','version','id','initial','variants','parameters','outputs','changes']) &&
      raw.format===format && raw.version===1 && id(raw.id) &&
      record(raw.variants) && Object.keys(raw.variants).length<=32 &&
      Object.entries(raw.variants).every(([name,model])=>id(name)&&model?.format===W.models.format) &&
      own(raw.variants,raw.initial) && Array.isArray(raw.changes??[]) &&
      (onBlock===undefined||typeof onBlock==='function'),'Expected a version 1 model changes plan');
    const plan=freeze(copy(raw)), lanes=Object.create(null), parameters=Object.entries(plan.parameters??{});
    const channels=Object.entries(plan.outputs??{}), activations=[], swaps=[], edits=[];
    check(record(plan.parameters??{}) && parameters.length<=32 && record(plan.outputs) &&
      integer(channels.length,1,16) && channels.every(([name,buffer])=>id(name)&&id(buffer)) &&
      new Set(channels.map(([,buffer])=>buffer)).size===channels.length,'Invalid parameter or output buffer map');
    for (const [name,row] of parameters) {
      check(id(name) && fields(row,['buffer','min','max']) && id(row.buffer) &&
        (row.min===undefined||Number.isFinite(row.min)) && (row.max===undefined||Number.isFinite(row.max)) &&
        (row.min??-Infinity)<=(row.max??Infinity),'Invalid parameter lane '+name);
      lanes[name]={buffer:row.buffer,min:row.min??-Infinity,max:row.max??Infinity,keys:[]};
    }
    check(new Set(parameters.map(([,row])=>row.buffer)).size===parameters.length,'Parameter lanes need separate buffers');
    const laneList=parameters.map(([name])=>lanes[name]);
    const laneKeys=new Int32Array(laneList.length);
    const output=Object.seal(Object.fromEntries(channels.map(([name])=>[name,null])));
    let cursor=0, active=0, fading=false, running=false, editing=false, dt, capacity, bytes=0;
    let peakWork=0, peakWorkPerSample=0, peakRemapElements=0;

    function kernelFor(model,at,initial) {
      const {world,systems,ports}=W.runtime.modelInterface(model);
      const names=Object.keys(systems), name=names[0], modelSpec=world.simulationModel;
      check(names.length===1 && systems[name].kernel?.prepared && modelSpec.blockSize && !world.connections.length,
        'Each topology needs a single prepared block kernel');
      check(initial || world.dt===dt,'Topology variants must share a sample clock');
      const {kind,operatorRevision,config}=world.systems[name];
      const session=W.kernels.prepare(kind,operatorRevision,config,{id:name,dt:world.dt,seed:world.seed});
      const {processor}=session, report=processor.report(), {buffers}=report.memory;
      const limit=Math.min(modelSpec.blockSize,processor.capacity.effectiveMaxSamples);
      const controlBuffers=parameters.map(([alias],i)=>{
        const lane=laneList[i], port=modelSpec.inputs[alias], input=ports.inputs[port], buffer=buffers[lane.buffer];
        check(input?.type==='number' && buffer?.role==='input' && floating(buffer.type) && buffer.length>=limit,
          'Parameter '+alias+' needs a numeric model input and a full floating-point input buffer');
        if (initial) {
          lane.initial=input.default;
          lane.type=buffer.type;
          lane.quantity=input.quantity;
          check(validValue(lane,lane.initial),'Parameter default is outside the lane range for '+alias);
        } else check(lane.initial===input.default && lane.type===buffer.type && equal(lane.quantity,input.quantity),
          'Parameter '+alias+' must keep its default, quantity and buffer type across topologies');
        return processor.buffers[lane.buffer];
      });
      const lanePorts=new Set(parameters.map(([alias])=>modelSpec.inputs[alias]));
      check(lanePorts.size===parameters.length,'Parameter lanes need separate model input ports');
      const controls=Object.fromEntries(Object.entries(ports.inputs).map(([port,spec])=>
        [port,{name:endpoint(port)[1],initial:spec.default,keys:[]}]));
      for (const {tick,args:{port,value}} of world.commands) {
        check(!lanePorts.has(port),'Schedule commands to a buffered parameter in the model changes plan: '+port);
        controls[port].keys.push({sample:tick-1,value});
      }
      for (const control of Object.values(controls)) control.keys.sort((a,b)=>a.sample-b.sample);
      const signals=channels.map(([channel,key])=>{
        const buffer=buffers[key];
        check(buffer?.role==='output' && floating(buffer.type) && buffer.length>=limit,
          'Output '+channel+' needs a full floating-point output buffer');
        return processor.buffers[key];
      });
      return {at,session,processor,dt:world.dt,limit,controls:Object.values(controls),controlBuffers,
        signals,bytes:report.memory.allocatedBytes};
    }

    function validValue(lane,value) {
      return Number.isFinite(value) && value>=lane.min && value<=lane.max &&
        (lane.type!=='Float32Array'||Number.isFinite(Math.fround(value)));
    }

    function account(next,previous,transfer) {
      const required=bytes+next.bytes;
      check(required<=maxBytes,'Model changes exceed the aggregate prepared buffer budget');
      const {workPerBlock,workPerSample}=next.processor.capacity;
      const nextWork=workPerBlock+workPerSample*next.limit;
      const prior=previous?.processor.capacity;
      const block=Math.min(next.limit,previous?.limit??next.limit,capacity);
      const blendedWork=prior ? workPerBlock+prior.workPerBlock+
        (workPerSample+prior.workPerSample+channels.length)*block : 0;
      check(Number.isSafeInteger(blendedWork),'Crossfade exceeds the safe work count');
      bytes=required;
      peakWork=Math.max(peakWork,nextWork,blendedWork);
      peakWorkPerSample=Math.max(peakWorkPerSample,workPerSample,prior?workPerSample+prior.workPerSample+channels.length:0);
      peakRemapElements=Math.max(peakRemapElements,transfer?.elements??0);
    }

    const origin=kernelFor(plan.variants[plan.initial],0,true);
    dt=origin.dt;
    capacity=origin.limit;
    const buffers=Object.freeze(Object.fromEntries(channels.map(([name])=>[name,new Float64Array(capacity)])));
    const mix=channels.map(([name])=>buffers[name]);
    bytes=channels.length*capacity*Float64Array.BYTES_PER_ELEMENT+laneKeys.byteLength;
    account(origin);
    activations.push(origin);

    function applyEdit(change) {
      const {sample,type}=change;
      if (type==='parameter') {
        const {parameter,value,duration=0,curve='linear'}=change, lane=lanes[parameter];
        check(fields(change,['type','parameter','value','sample','duration','curve']) && lane &&
          integer(duration,0,maxSample-sample) && ['linear','smoothstep'].includes(curve) && validValue(lane,value),
        'Invalid parameter change for '+parameter);
        const index=keyAt(lane.keys,sample)+1, prior=lane.keys[index-1];
        check(prior?.sample!==sample,'Parameter lane already has a change at sample '+sample);
        lane.keys.splice(index,0,{sample,end:sample+duration,from:valueAt(lane,prior,sample),value,curve});
        for (let i=index+1;i<lane.keys.length;i++) {
          const next=lane.keys[i];
          next.from=valueAt(lane,lane.keys[i-1],next.sample);
        }
      } else {
        const {variant,model,policy,duration,mapping}=change;
        check(type==='swap' && fields(change,['type','sample','variant','model','policy','duration','mapping']) && id(variant) &&
          (model===undefined ? own(plan.variants,variant) : model?.format===W.models.format) &&
          ['reset','remap','crossfade'].includes(policy) &&
          (policy==='crossfade' ? integer(duration,1,maxSample-sample) : duration===undefined) &&
          (policy==='remap' ? Array.isArray(mapping) : mapping===undefined) && swaps.length<maxSwaps,
        'Invalid prepared topology swap');
        const prior=swaps.at(-1), previous=activations.at(-1);
        check(!prior || sample>prior.sample && sample>=prior.end,'Topology swaps must advance and cannot overlap a crossfade');
        const next=kernelFor(model??plan.variants[variant],sample,false);
        const transfer=policy==='remap' ? W.kernels.prepareStateTransfer(previous.processor,next.processor,mapping) : undefined;
        account(next,policy==='crossfade'?previous:undefined,transfer);
        activations.push(next);
        swaps.push({sample,end:sample+(duration??0),variant,policy,transfer});
      }
      edits.push(change);
    }

    function schedule(rawChange) {
      check(!running && !editing && edits.length<maxEdits && record(rawChange) &&
        integer(rawChange.sample,cursor,maxSample-1),'Model change must target an unprocessed sample');
      editing=true;
      try { applyEdit(freeze(copy(rawChange))); }
      finally { editing=false; }
    }

    for (const change of plan.changes??[]) schedule(change);
    const authored=edits.length;

    function load(saved) {
      check(fields(saved,['format','version','plan','edits','sample','current','previous','outputs']) &&
        saved.format===checkpointFormat && saved.version===1 && equal(saved.plan,plan) &&
        Array.isArray(saved.edits) && integer(saved.sample,0,maxSample) &&
        record(saved.outputs) && Object.keys(saved.outputs).length===channels.length &&
        channels.every(([name])=>own(saved.outputs,name) && (saved.sample===0?saved.outputs[name]===null:Number.isFinite(saved.outputs[name]))),
      'Checkpoint does not match this model changes plan');
      for (const change of saved.edits) schedule(change);
      active=keyAt(swaps,saved.sample-1)+1;
      const last=swaps[active-1], current=activations[active];
      fading=last?.policy==='crossfade' && saved.sample<last.end;
      const previous=fading?activations[active-1]:undefined;
      check(saved.current?.steps===saved.sample-current.at &&
        (previous ? saved.previous?.steps===saved.sample-previous.at : saved.previous===undefined),
      'Checkpoint kernel positions do not match the model change boundaries');
      current.session.restore(saved.current);
      if (previous) previous.session.restore(saved.previous);
      cursor=saved.sample;
      Object.assign(output,saved.outputs);
    }
    if (saved!==undefined) load(saved);

    function nextControl(kernel,stop) {
      if (!kernel) return stop;
      const local=cursor-kernel.at;
      for (const {name,initial,keys} of kernel.controls) {
        const index=keyAt(keys,local);
        kernel.processor.input[name]=index<0?initial:keys[index].value;
        if (keys[index+1]) stop=Math.min(stop,kernel.at+keys[index+1].sample);
      }
      return Math.min(stop,cursor+kernel.limit);
    }

    function prepareInputs(primary,secondary,stop) {
      for (let i=0;i<laneList.length;i++) {
        const {keys}=laneList[i], index=keyAt(keys,cursor);
        laneKeys[i]=index;
        if (keys[index+1]) stop=Math.min(stop,keys[index+1].sample);
      }
      for (let i=0;i<laneList.length;i++) {
        const lane=laneList[i], key=lane.keys[laneKeys[i]], input=primary.controlBuffers[i];
        const second=secondary?.controlBuffers[i];
        for (let j=0;j<stop-cursor;j++) {
          const value=valueAt(lane,key,cursor+j);
          input[j]=value;
          if (second) second[j]=value;
        }
      }
      return stop;
    }

    function publish(current,previous,fade,stop) {
      const length=stop-cursor;
      for (let i=0;i<channels.length;i++) {
        const result=mix[i], fresh=current.signals[i];
        if (previous) {
          const old=previous.signals[i], duration=fade.end-fade.sample;
          for (let j=0;j<length;j++) {
            const weight=(cursor+j-fade.sample)/duration;
            result[j]=(1-weight)*old[j]+weight*fresh[j];
          }
        } else {
          for (let j=0;j<length;j++) result[j]=fresh[j];
        }
        output[channels[i][0]]=result[length-1];
      }
    }

    function process(count) {
      check(!running && !editing && integer(count,0,maxSample-cursor),'Invalid or reentrant model changes request');
      const end=cursor+count;
      running=true;
      try {
        while (cursor<end) {
          const arriving=swaps[active]?.sample===cursor;
          const index=active+Number(arriving), current=activations[index], swap=swaps[index-1];
          const overlap=swap?.policy==='crossfade' && cursor<swap.end;
          const previous=overlap ? activations[index-1] : undefined;
          let stop=Math.min(end,cursor+capacity,swaps[index]?.sample??Infinity,overlap?swap.end:Infinity);
          stop=nextControl(previous,nextControl(current,stop));
          stop=prepareInputs(current,previous,stop);
          if (arriving) swap.transfer?.copy();
          const length=stop-cursor, status=previous ? W.kernels.processPair(previous.processor,current.processor,length) :
            current.processor.process(length);
          if (!accepted(status)) throw Error('Model changes playback stopped at sample '+cursor+' ('+status+')');
          publish(current,previous,swap,stop);
          const start=cursor;
          cursor=stop;
          active=index;
          fading=overlap && cursor<swap.end;
          onBlock?.(start,stop,buffers,status);
        }
        return cursor;
      } finally { running=false; }
    }

    function checkpoint() {
      return freeze({format:checkpointFormat,version:1,plan,sample:cursor,edits:edits.slice(authored),
        current:activations[active].session.snapshot(), ...(fading && {previous:activations[active-1].session.snapshot()}),
        outputs:{...output}});
    }

    function inspect() {
      const transfers=swaps.map(({sample,end,variant,policy,transfer})=>
        ({sample,end,variant,policy,...(transfer&&{stateElements:transfer.elements})}));
      return {id:plan.id,sample:cursor,dt,capacity,variant:swaps[active-1]?.variant??plan.initial,
        ...(fading&&{fadingFrom:swaps[active-2]?.variant??plan.initial}),outputs:{...output},
        parameters:Object.fromEntries(parameters.map(([name],i)=>{
          const lane=laneList[i], index=keyAt(lane.keys,cursor);
          return [name,valueAt(lane,lane.keys[index],cursor)];
        })),swaps:transfers,budget:{preparedKernels:activations.length,typedBufferBytes:bytes,
          peakWorkPerBlock:peakWork,peakKernelAndMixWorkPerSample:peakWorkPerSample,peakRemapElements}};
    }
    return Object.freeze({schedule,process,checkpoint,inspect,buffers,capacity,cursor:()=>cursor});
  }

  W.modelChanges=Object.freeze({format,checkpointFormat,create});
})(KIT);
