/* A prepared, bounded typed-buffer processor. The host publishes snapshots separately. */
(function (K) {
  const W = K.world, {check,id,own,record} = W.data;
  const integer = (value,min,max) => Number.isSafeInteger(value) && value>=min && value<=max;
  const finite = (type,value) => type==='number' ? Number.isFinite(value) : typeof value==='boolean';
  const maxBytes = 64*1024*1024, maxWorkingBuffers = 128;
  const roles = ['state','table','scratch','input','output'];

  function limits(raw,maxBlockSize) {
    check(record(raw) && Object.keys(raw).every(key=>['maxSamples','maxWork','maxBytes','deadlineMs'].includes(key)) &&
      integer(raw.maxSamples,1,maxBlockSize) && integer(raw.maxWork,1,Number.MAX_SAFE_INTEGER) &&
      integer(raw.maxBytes,0,maxBytes) && (raw.deadlineMs===undefined ||
        Number.isFinite(raw.deadlineMs) && raw.deadlineMs>0 && raw.deadlineMs<=60000),
    'Invalid prepared kernel capacity');
    return Object.freeze({...raw});
  }

  function create(spec,settings,{arrays,clock,maxStateBytes}) {
    const capacity=spec.processing, {dt,seed,id:instance}=settings;
    const randomKey=K.procedural.data.hash(instance,seed);
    check(clock===undefined || typeof clock==='function','Prepared kernel clock must be a function');
    const now=clock ?? (typeof performance!=='undefined' && typeof performance.now==='function' ?
      performance.now.bind(performance) : undefined);
    const inputPorts=Object.entries(spec.inputs), outputPorts=Object.entries(spec.outputs);
    const input=Object.fromEntries(inputPorts.map(([name,port])=>[name,port.default]));
    const published=Object.fromEntries(outputPorts.map(([name,port])=>[name,port.default]));
    const staged={...published}, previous={...published}, state={}, publicBuffers={}, layout={}, backups=[];
    let allocatedBytes=0, stateBytes=0, rollbackBytes=0, allocating=true, running=false;
    function allocate(name,type,length,role='scratch') {
      check(allocating && id(name) && !own(layout,name) && own(arrays,type) &&
        integer(length,0,maxBytes) && roles.includes(role) && Object.keys(layout).length<maxWorkingBuffers,
      'Invalid or late prepared kernel buffer allocation: '+name);
      const Type=arrays[type], bytes=length*Type.BYTES_PER_ELEMENT, retained=role==='state';
      const rollback=retained || role==='output', charge=bytes*(rollback?2:1);
      check(allocatedBytes+charge<=capacity.maxBytes,'Prepared kernel byte capacity exceeded by '+name);
      check(!retained || stateBytes+bytes<=maxStateBytes && Object.keys(state).length<64,
        'Prepared kernel state exceeds the portable buffer budget');
      const buffer=new Type(length);
      allocatedBytes+=charge;
      layout[name]={type,length,role,bytes};
      if (retained) {
        stateBytes+=bytes;
        state[name]=buffer;
      } else if (role==='input' || role==='output') publicBuffers[name]=buffer;
      if (rollback) {
        rollbackBytes+=bytes;
        backups.push([buffer,new Type(length)]);
      }
      return buffer;
    }
    const prepared=spec.prepare(settings.config,{id:instance,seed,dt,allocate,capacity});
    allocating=false;
    const synchronous=hook=>typeof hook==='function' && Object.prototype.toString.call(hook)==='[object Function]';
    check(record(prepared) && synchronous(prepared.process) &&
      (prepared.reset===undefined || synchronous(prepared.reset)) &&
      integer(prepared.workPerSample,0,capacity.maxWork) && integer(prepared.workPerBlock??0,0,capacity.maxWork),
    'Prepared kernel needs synchronous hooks and bounded work counts');
    const {workPerSample,workPerBlock=0}=prepared;
    const effectiveMaxSamples=Math.min(capacity.maxSamples,workPerSample===0 ? capacity.maxSamples :
      Math.floor((capacity.maxWork-workPerBlock)/workPerSample));
    check(effectiveMaxSamples>=1,'Prepared kernel work capacity cannot process one sample');

    Object.seal(input);
    Object.seal(staged);
    const levels=Object.freeze(Object.defineProperties({},Object.fromEntries(outputPorts.map(([name])=>[name,
      {get:()=>published[name],enumerable:true}]))));
    let position=0, end=0, requests=0, completed=0, processedSamples=0,
      sampleOverruns=0, workOverruns=0, deadlines=0, faults=0,
      peakSamples=0,peakWork=0,peakMs=null,lastMs=null,timedBlocks=0,totalMs=0,firstDeadline=null,
      status='ready', work=0, refused=false, lastRequestedSamples=0, lastWork=null, undoCount=0;
    const context=Object.freeze({get start(){return position;},get end(){return end;},dt,input,output:staged,
      charge(units) {
        check(running && Number.isSafeInteger(units) && units>=0,'Invalid prepared work charge');
        if (refused || units>capacity.maxWork-work) {
          refused=true;
          return false;
        }
        work+=units;
        return true;
      },
      randomAt(sample,stream=0) {
        const key=(sample^Math.imul(Math.floor(sample/4294967296),0x85ebca6b))^randomKey^Math.imul(stream,0x9e3779b1);
        const value=Math.imul(key^key>>>16,0x7feb352d);
        const mixed=Math.imul(value^value>>>15,0x846ca68b);
        return ((mixed^mixed>>>16)>>>0)/4294967296;
      }});
    function readClock() {
      try { return now?.(); } catch { return undefined; }
    }

    function publish() {
      for (let i=0;i<outputPorts.length;i++) {
        const port=outputPorts[i];
        if (!finite(port[1].type,staged[port[0]])) throw Error('Invalid prepared output '+port[0]);
      }
      for (let i=0;i<outputPorts.length;i++) {
        const name=outputPorts[i][0];
        published[name]=staged[name];
      }
    }
    function reset() {
      check(!running,'Prepared kernel is already processing');
      for (const [buffer] of backups) buffer.fill(0);
      for (const [name,port] of outputPorts) staged[name]=port.default;
      prepared.reset?.(staged);
      publish();
      position=0;
      undoCount=0;
    }
    function install(buffers,outputs,at) {
      check(!running,'Prepared kernel is already processing');
      for (const name of Object.keys(state)) state[name].set(buffers[name]);
      for (const [name] of outputPorts) published[name]=outputs[name];
      position=at;
      undoCount=0;
    }
    function restoreWorkingBuffers() {
      for (let i=0;i<backups.length;i++) backups[i][0].set(backups[i][1]);
    }
    function rollbackLast() {
      check(!running && undoCount>0,'No prepared block to roll back');
      restoreWorkingBuffers();
      for (let i=0;i<outputPorts.length;i++) {
        const name=outputPorts[i][0];
        published[name]=previous[name];
      }
      position-=undoCount;
      processedSamples-=undoCount;
      completed--;
      undoCount=0;
      status='rolled-back';
    }
    function process(count,forPair=false) {
      check(!running && Number.isSafeInteger(count) && count>=0 && Number.isSafeInteger(position+count),
        'Invalid prepared process range');
      undoCount=0;
      requests++;
      lastRequestedSamples=count;
      const requestedWork=count===0 ? 0 : workPerBlock+workPerSample*count;
      lastWork=Number.isSafeInteger(requestedWork)?requestedWork:null;
      lastMs=null;
      if (count>capacity.maxSamples) {
        sampleOverruns++;
        return status='sample-capacity';
      }
      if (count>effectiveMaxSamples) {
        workOverruns++;
        return status='work-capacity';
      }
      if (count===0) return status='empty';
      const start=readClock();
      for (let i=0;i<inputPorts.length;i++) {
        const port=inputPorts[i];
        if (!finite(port[1].type,input[port[0]])) throw Error('Invalid prepared input '+port[0]);
      }
      for (let i=0;i<backups.length;i++) backups[i][1].set(backups[i][0]);
      for (let i=0;i<outputPorts.length;i++) {
        const name=outputPorts[i][0];
        if (forPair) previous[name]=published[name];
        staged[name]=undefined;
      }
      end=position+count;
      work=workPerBlock+workPerSample*count;
      refused=false;
      running=true;
      try {
        const returned=prepared.process(context);
        check(returned===undefined,'Prepared process must write to provided outputs and return undefined');
        if (refused) {
          restoreWorkingBuffers();
          lastWork=work;
          workOverruns++;
          return status='work-capacity';
        }
        publish();
      } catch(error) {
        restoreWorkingBuffers();
        faults++;
        status='fault';
        throw error;
      } finally {
        running=false;
      }
      if (forPair) undoCount=count;
      position+=count;
      completed++;
      processedSamples+=count;
      peakSamples=Math.max(peakSamples,count);
      peakWork=Math.max(peakWork,work);
      lastWork=work;
      const elapsed=readClock()-start;
      if (Number.isFinite(elapsed) && elapsed>=0) {
        lastMs=elapsed;
        peakMs=Math.max(peakMs??0,elapsed);
        timedBlocks++;
        totalMs+=elapsed;
        if (capacity.deadlineMs!==undefined && elapsed>capacity.deadlineMs) {
          deadlines++;
          firstDeadline??=Object.freeze({startSample:position-count,endSample:position,elapsedMs:elapsed,deadlineMs:capacity.deadlineMs});
          return status='deadline';
        }
      }
      return status='ok';
    }

    const memory=Object.freeze({allocatedBytes,stateBytes,rollbackBytes,
      buffers:Object.freeze(Object.fromEntries(Object.entries(layout).map(([name,row])=>[name,Object.freeze(row)])))});
    const planned=Object.freeze({...capacity,effectiveMaxSamples,workPerSample,workPerBlock,clockAvailable:now!==undefined});
    const report=()=>({capacity:planned,memory,
      observed:{requests,completed,cursor:position,processedSamples,peakSamples,peakWork,peakMs,
        lastMs,timedBlocks,totalMs,meanMs:timedBlocks?totalMs/timedBlocks:null,firstDeadline,
        lastRequestedSamples,lastWork,status,overruns:{samples:sampleOverruns,work:workOverruns,deadline:deadlines},faults}});
    return Object.freeze({process,rollbackLast,reset,install,input,output:levels,buffers:Object.freeze(publicBuffers),state:Object.freeze(state),
      report,capacity:planned,position:()=>position});
  }

  W.kernelProcessing=Object.freeze({create,limits});
})(KIT);
